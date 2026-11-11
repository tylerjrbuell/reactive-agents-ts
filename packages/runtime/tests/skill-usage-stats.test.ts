// Run: bun test packages/runtime/tests/skill-usage-stats.test.ts --timeout 20000
//
// Living skills, roadmap F5: a SkillStore skill a run used gets its
// useCount / successRate / lastActivatedAt updated from the run outcome
// (engine/finalize/skill-outcomes.ts, called from local-learning.ts).
//
// ORACLE: the SkillStore row itself, read back from the agent's SQLite file.
//
// RED-ON-CUT (both verified): drop the `recordSkillOutcomes` call in
// local-learning.ts and the agent-level case fails (useCount stays at its
// seed); drop the `skillStoreOptLayer` argument to
// `buildReactiveIntelSkillsLayer` in runtime.ts and it fails too (the stored
// skill never reaches the run's catalog, so nothing activates).
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import type { SkillRecord } from "@reactive-agents/core";
import {
  MemoryDatabaseLive,
  SkillStoreService,
  SkillStoreServiceLive,
  defaultMemoryConfig,
} from "@reactive-agents/memory";
import { ReactiveAgents } from "../src/builder.js";
import {
  nextSkillStats,
  recordSkillOutcomes,
  usedSkillNames,
} from "../src/engine/finalize/skill-outcomes.js";

const BASE = mkdtempSync(join(tmpdir(), "ra-skill-stats-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));

const storeLayer = (dbPath: string, agentId: string) =>
  SkillStoreServiceLive.pipe(
    Layer.provide(MemoryDatabaseLive({ ...defaultMemoryConfig(agentId), dbPath })),
  );

const skill = (agentId: string, over: Partial<SkillRecord> = {}): SkillRecord => {
  const now = new Date("2026-11-01T00:00:00Z");
  return {
    id: `sk-${over.name ?? "learned-x"}`,
    name: "learned-x",
    description: "Learned procedure for marker tasks.",
    agentId,
    source: "learned",
    instructions: "Reply with the marker.",
    version: 1,
    versionHistory: [],
    config: {
      strategy: "reactive",
      temperature: 0.7,
      maxIterations: 5,
      promptTemplateId: "default",
      systemPromptTokens: 0,
      compressionEnabled: false,
    },
    evolutionMode: "auto",
    confidence: "tentative",
    successRate: 1,
    useCount: 3,
    refinementCount: 0,
    taskCategories: ["general"],
    modelAffinities: [],
    base: null,
    avgPostActivationEntropyDelta: 0,
    avgConvergenceIteration: 0,
    convergenceSpeedTrend: [],
    conflictsWith: [],
    lastActivatedAt: null,
    lastRefinedAt: null,
    createdAt: now,
    updatedAt: now,
    contentVariants: { full: "Reply with the marker.", summary: null, condensed: null },
    ...over,
  };
};

const seed = (dbPath: string, agentId: string, record: SkillRecord) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* SkillStoreService;
      yield* store.store(record);
    }).pipe(Effect.provide(storeLayer(dbPath, agentId)), Effect.scoped),
  );

const readBack = (dbPath: string, agentId: string, name: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* SkillStoreService;
      return yield* store.getByName(agentId, name);
    }).pipe(Effect.provide(storeLayer(dbPath, agentId)), Effect.scoped),
  );

describe("nextSkillStats", () => {
  it("success and partial credit the skill; failure does not; abstained adds no evidence", () => {
    expect(nextSkillStats({ useCount: 3, successRate: 1 }, "success")).toEqual({ useCount: 4, successRate: 1 });
    expect(nextSkillStats({ useCount: 3, successRate: 1 }, "partial")).toEqual({ useCount: 4, successRate: 1 });
    expect(nextSkillStats({ useCount: 3, successRate: 1 }, "failure")).toEqual({ useCount: 4, successRate: 0.75 });
    expect(nextSkillStats({ useCount: 3, successRate: 1 }, "abstained")).toEqual({ useCount: 3, successRate: 1 });
    // A fresh synthesized skill (useCount 0) takes the first outcome as its rate.
    expect(nextSkillStats({ useCount: 0, successRate: 1 }, "failure")).toEqual({ useCount: 1, successRate: 0 });
  });
});

describe("usedSkillNames", () => {
  it("unions bootstrap activations and ledger skill-activated facts, deduped", () => {
    const names = usedSkillNames({
      autoActivateSkills: [{ name: "a" }, { name: "b" }, { nope: 1 }],
      runLedger: [
        { seq: 0, kind: "skill-activated", name: "b", sha256: "x", source: "learned", via: "agent", tokens: 10 },
        { seq: 1, kind: "skill-activated", name: "c", sha256: "y", source: "learned", via: "agent", tokens: 10 },
        { seq: 2, kind: "harness-signal" },
      ],
    });
    expect(names).toEqual(["a", "b", "c"]);
  });

  it("no metadata means no skills", () => {
    expect(usedSkillNames(undefined)).toEqual([]);
  });
});

describe("recordSkillOutcomes", () => {
  it("updates stored stats for used skills and skips names with no record", async () => {
    const dbPath = join(BASE, "unit.db");
    await seed(dbPath, "ag", skill("ag"));
    const at = new Date("2026-11-11T12:00:00Z");
    await Effect.runPromise(
      recordSkillOutcomes({ agentId: "ag", skillNames: ["learned-x", "fs-only"], runOutcome: "failure", now: at }).pipe(
        Effect.provide(storeLayer(dbPath, "ag")),
        Effect.scoped,
      ),
    );
    const row = await readBack(dbPath, "ag", "learned-x");
    expect(row?.useCount).toBe(4);
    expect(row?.successRate).toBe(0.75);
    expect(row?.lastActivatedAt?.toISOString()).toBe(at.toISOString());
  });

  it("is a no-op without SkillStoreService", async () => {
    await Effect.runPromise(recordSkillOutcomes({ agentId: "ag", skillNames: ["x"], runOutcome: "success" }));
  });
});

describe("agent run updates the stats of a pinned store skill", () => {
  it("two successful runs raise useCount and stamp lastActivatedAt", async () => {
    const dbPath = join(BASE, "agent.db");
    const agent = await ReactiveAgents.create()
      .withName("skill-stats-agent")
      .withProvider("test")
      .withTestScenario([{ text: "Done." }])
      .withMemory({ dbPath })
      .withSkills({ activate: ["learned-x"] })
      .build();
    // The built agent's id carries a suffix; seed under it.
    const agentId = agent.agentId;
    await seed(dbPath, agentId, skill(agentId, { successRate: 0.5, useCount: 2 }));
    const activated: string[] = [];
    await agent.subscribe("SkillActivated", (e) => {
      activated.push(e.skillName);
    });
    try {
      await agent.run("Reply with the marker.");
      await agent.run("Reply with the marker again.");
    } finally {
      await agent.dispose();
    }

    // The run's resolver sees the stored skill (runtime-skills-layer.ts
    // provides the SkillStore into it), so the pin loads it at bootstrap.
    expect(activated).toEqual(["learned-x", "learned-x"]);
    const row = await readBack(dbPath, agentId, "learned-x");
    // Seed 2 uses at 0.5, then two successes: 4 uses, 3/4.
    expect(row?.useCount).toBe(4);
    expect(row?.successRate).toBe(0.75);
    expect(row?.lastActivatedAt).not.toBeNull();
  }, 20000);
});
