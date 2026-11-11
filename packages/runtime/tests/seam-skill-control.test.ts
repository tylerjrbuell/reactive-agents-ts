// Run: bun test packages/runtime/tests/seam-skill-control.test.ts --timeout 20000
//
// Seam pins for the skill control API on the agent (agent/skills-facade.ts,
// agent/skill-install.ts) and the provenance list filters on agent.memory()
// (agent/memory-facade.ts):
//   1. loadSkill: a new skill defaults to 'locked'; { evolutionMode: 'auto' }
//      sets it; reloading changed content keeps the skill's history and adds
//      a version; an unchanged reload keeps the version and the stored mode.
//   2. setSkillMode locks and unlocks in place: version history intact.
//   3. rollbackSkill restores the previous version and publishes
//      SkillRolledBack with reason 'manual' and no taskId.
//   4. Unknown names reject with the raw MemoryNotFoundError; without memory
//      the calls reject with the raw MemoryNotEnabledError.
//   5. semantic.list / procedural.list filter by taskId / runId in the query.
//
// ORACLE: the SkillStore / memory rows read back through the agent, plus the
// events on the agent's bus.
//
// RED-ON-CUT (verified): drop the publishSkillEvent call in rollbackSkill and
// pin 3 fails; drop provenanceOf(options) from semantic.list and pin 5 fails;
// make installedSkillRecord ignore `existing` and pin 1 fails (version 1, no
// history).
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import type { AgentEvent, SkillRecord } from "@reactive-agents/core";
import {
  MemoryDatabaseLive,
  MemoryIdSchema,
  ProceduralMemoryService,
  ProceduralMemoryServiceLive,
  SemanticMemoryService,
  SemanticMemoryServiceLive,
  defaultMemoryConfig,
} from "@reactive-agents/memory";
import { ReactiveAgents } from "../src/builder.js";
import { MemoryNotEnabledError } from "../src/agent/memory-facade.js";

const BASE = mkdtempSync(join(tmpdir(), "ra-skill-control-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));

let seq = 0;
const dbPath = (): string => join(BASE, `memory-${++seq}.db`);

const writeSkill = (body: string): string => {
  const dir = join(BASE, `skill-${++seq}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: deploy-steps\ndescription: How to deploy.\n---\n\n${body}`);
  return dir;
};

const buildAgent = (db: string | null) => {
  const b = ReactiveAgents.create().withName("skill-control").withProvider("test").withTestScenario([{ text: "ok" }]);
  return (db === null ? b : b.withMemory({ dbPath: db })).build();
};

const deploy = (skills: SkillRecord[]): SkillRecord | undefined => skills.find((s) => s.name === "deploy-steps");

const rejectionOf = (p: Promise<unknown>): Promise<unknown> => p.then(() => null, (e: unknown) => e);

describe("agent skill control (rollbackSkill / setSkillMode / loadSkill)", () => {
  it("loadSkill: new skill is locked by default; a changed reload keeps history and bumps the version", async () => {
    const agent = await buildAgent(dbPath());
    try {
      await agent.loadSkill(writeSkill("Step one."));
      const first = deploy(await agent.skills());
      expect(first?.evolutionMode).toBe("locked");
      expect(first?.version).toBe(1);

      await agent.setSkillMode("deploy-steps", "auto");
      await agent.loadSkill(writeSkill("Step one. Step two."));
      const second = deploy(await agent.skills());
      expect(second?.id).toBe(first?.id);
      expect(second?.version).toBe(2);
      expect(second?.instructions).toBe("Step one. Step two.");
      // Reload without an option keeps the mode the user set.
      expect(second?.evolutionMode).toBe("auto");
      expect(second?.versionHistory.map((v) => [v.version, v.instructions])).toEqual([
        [1, "Step one."],
        [2, "Step one. Step two."],
      ]);

      // Unchanged reload: no new version; explicit option wins.
      await agent.loadSkill(writeSkill("Step one. Step two."), { evolutionMode: "locked" });
      const third = deploy(await agent.skills());
      expect(third?.version).toBe(2);
      expect(third?.versionHistory.length).toBe(2);
      expect(third?.evolutionMode).toBe("locked");
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("loadSkill { evolutionMode: 'auto' } stores a new skill unlocked", async () => {
    const agent = await buildAgent(dbPath());
    try {
      await agent.loadSkill(writeSkill("Step one."), { evolutionMode: "auto" });
      expect(deploy(await agent.skills())?.evolutionMode).toBe("auto");
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("setSkillMode locks then unlocks with version history intact", async () => {
    const agent = await buildAgent(dbPath());
    try {
      await agent.loadSkill(writeSkill("v1 body"), { evolutionMode: "auto" });
      await agent.loadSkill(writeSkill("v2 body"));
      const before = deploy(await agent.skills());
      expect(before?.versionHistory.length).toBe(2);

      await agent.setSkillMode("deploy-steps", "locked");
      const locked = deploy(await agent.skills());
      expect(locked?.evolutionMode).toBe("locked");

      await agent.setSkillMode("deploy-steps", "auto");
      const unlocked = deploy(await agent.skills());
      expect(unlocked?.evolutionMode).toBe("auto");
      expect(unlocked?.version).toBe(before?.version);
      expect(unlocked?.instructions).toBe("v2 body");
      expect(unlocked?.versionHistory).toEqual(before?.versionHistory ?? []);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("rollbackSkill restores the previous version and publishes SkillRolledBack reason 'manual' (no taskId)", async () => {
    const agent = await buildAgent(dbPath());
    const events: AgentEvent[] = [];
    try {
      await agent.subscribe("SkillRolledBack", (e) => {
        events.push(e);
      });
      await agent.loadSkill(writeSkill("v1 body"));
      await agent.loadSkill(writeSkill("v2 body"));

      expect(await agent.rollbackSkill("deploy-steps")).toEqual({ fromVersion: 2, toVersion: 1 });
      const restored = deploy(await agent.skills());
      expect(restored?.version).toBe(1);
      expect(restored?.instructions).toBe("v1 body");
      expect(events).toEqual([
        { _tag: "SkillRolledBack", skillName: "deploy-steps", fromVersion: 2, toVersion: 1, reason: "manual" },
      ]);

      // No earlier version left: raw MemoryNotFoundError, no event.
      const noPrev = await rejectionOf(agent.rollbackSkill("deploy-steps"));
      expect(noPrev).toMatchObject({ _tag: "MemoryNotFoundError" });
      expect(events.length).toBe(1);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("unknown names reject with the raw MemoryNotFoundError", async () => {
    const agent = await buildAgent(dbPath());
    try {
      expect(await rejectionOf(agent.setSkillMode("nope", "locked"))).toMatchObject({
        _tag: "MemoryNotFoundError",
        message: 'Skill "nope" not found',
      });
      expect(await rejectionOf(agent.rollbackSkill("nope"))).toMatchObject({ _tag: "MemoryNotFoundError" });
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("without memory the control calls reject with the raw MemoryNotEnabledError", async () => {
    const agent = await buildAgent(null);
    try {
      expect(await rejectionOf(agent.setSkillMode("deploy-steps", "locked"))).toBeInstanceOf(MemoryNotEnabledError);
      expect(await rejectionOf(agent.rollbackSkill("deploy-steps"))).toBeInstanceOf(MemoryNotEnabledError);
    } finally {
      await agent.dispose();
    }
  }, 20000);
});

describe("agent.memory() list provenance filters", () => {
  it("semantic.list and procedural.list filter by taskId / runId", async () => {
    const db = dbPath();
    const agent = await buildAgent(db);
    try {
      const agentId = agent.agentId;
      const now = new Date();
      const layer = Layer.mergeAll(SemanticMemoryServiceLive, ProceduralMemoryServiceLive).pipe(
        Layer.provide(MemoryDatabaseLive({ ...defaultMemoryConfig(agentId), dbPath: db })),
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const s = yield* SemanticMemoryService;
          const p = yield* ProceduralMemoryService;
          for (const [id, taskId, runId] of [["s-a", "task-a", "run-a"], ["s-b", "task-b", "run-b"]] as const) {
            yield* s.store({
              id: MemoryIdSchema.make(id), agentId, content: id, summary: id, importance: 0.5, verified: false,
              tags: [], createdAt: now, updatedAt: now, accessCount: 0, lastAccessedAt: now, taskId, runId,
            });
            yield* p.store({
              id: MemoryIdSchema.make(`p-${id}`), agentId, name: id, description: id, pattern: id,
              successRate: 1, useCount: 1, tags: [], createdAt: now, updatedAt: now, taskId, runId,
            });
          }
        }).pipe(Effect.provide(layer), Effect.scoped),
      );

      const mem = agent.memory();
      const ids = (rows: ReadonlyArray<{ readonly id: string }>): string[] => rows.map((e) => String(e.id));
      expect(ids(await mem.semantic.list()).sort()).toEqual(["s-a", "s-b"]);
      expect(ids(await mem.semantic.list({ taskId: "task-a" }))).toEqual(["s-a"]);
      expect(ids(await mem.semantic.list({ runId: "run-b" }))).toEqual(["s-b"]);
      expect(await mem.semantic.list({ taskId: "task-a", runId: "run-b" })).toEqual([]);
      expect(ids(await mem.procedural.list({ runId: "run-a" }))).toEqual(["p-s-a"]);
      expect(ids(await mem.procedural.list({ taskId: "task-b", limit: 5 }))).toEqual(["p-s-b"]);
    } finally {
      await agent.dispose();
    }
  }, 20000);
});
