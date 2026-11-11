// Run: bun test packages/runtime/tests/skill-lifecycle.test.ts --timeout 20000
//
// Living skills, roadmap F5 second half: promotion, rollback and refine.
//
//   - engine/finalize/skill-outcomes.ts: after the per-run stats update, each
//     used skill is re-read and run through SkillEvolutionService
//     checkRegression / checkPromotion; SkillRolledBack / SkillPromoted publish.
//   - agent/skill-refine.ts + agent/skills-facade.ts: agent.refineSkills()
//     builds SkillDistillerDeps from the agent's SkillStore, episodic memory
//     and LLM, publishes SkillRefined, and reports per-skill counts.
//
// ORACLE: the SkillStore row read back from SQLite plus the events on the bus.
//
// RED-ON-CUT (verified): drop the `evolveSkill` call in skill-outcomes.ts and
// the promotion and rollback cases fail (confidence stays tentative, version
// stays 2, no events); drop `taskId: String(task.id)` from the
// recordSkillOutcomes call in local-learning.ts and the agent-run promotion
// case fails (event has no taskId); make the facade return NO_SKILL_REFINEMENT when no
// distiller is provided and the agent-level refine case fails (refined 0).
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { EventBus, EventBusLive, type AgentEvent, type SkillRecord } from "@reactive-agents/core";
import {
  EpisodicMemoryService,
  EpisodicMemoryServiceLive,
  MemoryDatabaseLive,
  SkillEvolutionService,
  SkillStoreService,
  SkillStoreServiceLive,
  defaultMemoryConfig,
  makeSkillEvolutionService,
  type MemoryLLM,
} from "@reactive-agents/memory";
import { MemoryIdSchema } from "@reactive-agents/memory";
import { ReactiveAgents } from "../src/builder.js";
import { recordSkillOutcomes } from "../src/engine/finalize/skill-outcomes.js";

const BASE = mkdtempSync(join(tmpdir(), "ra-skill-lifecycle-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));

const dbLayer = (dbPath: string, agentId: string) =>
  MemoryDatabaseLive({ ...defaultMemoryConfig(agentId), dbPath });

const storeLayer = (dbPath: string, agentId: string) =>
  SkillStoreServiceLive.pipe(Layer.provide(dbLayer(dbPath, agentId)));

const skill = (agentId: string, over: Partial<SkillRecord> = {}): SkillRecord => {
  const now = new Date("2026-11-01T00:00:00Z");
  return {
    id: "sk-learned-x",
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
    useCount: 4,
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

const withStore = <A>(
  dbPath: string,
  agentId: string,
  f: (store: Context.Tag.Service<typeof SkillStoreService>) => Effect.Effect<A, unknown>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* f(yield* SkillStoreService);
    }).pipe(Effect.provide(storeLayer(dbPath, agentId)), Effect.scoped),
  );

const seed = (dbPath: string, agentId: string, record: SkillRecord) =>
  withStore(dbPath, agentId, (store) => store.store(record));

const readBack = (dbPath: string, agentId: string) =>
  withStore(dbPath, agentId, (store) => store.getByName(agentId, "learned-x"));

/** recordSkillOutcomes against the SQLite store with a live bus; returns the skill events. */
const recordWithBus = async (
  dbPath: string,
  agentId: string,
  runOutcome: "success" | "failure",
): Promise<AgentEvent[]> => {
  const events: AgentEvent[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const bus = yield* EventBus;
      yield* bus.subscribe((e) =>
        Effect.sync(() => {
          if (e._tag.startsWith("Skill")) events.push(e);
        }),
      );
      yield* recordSkillOutcomes({ agentId, taskId: "task-1", skillNames: ["learned-x"], runOutcome });
    }).pipe(Effect.provide(Layer.merge(storeLayer(dbPath, agentId), EventBusLive)), Effect.scoped),
  );
  return events;
};

describe("run-end promotion", () => {
  it("a tentative skill crossing 5 uses at 0.8+ is promoted to trusted and SkillPromoted publishes", async () => {
    const dbPath = join(BASE, "promote.db");
    await seed(dbPath, "ag", skill("ag", { useCount: 4, successRate: 1 }));

    const events = await recordWithBus(dbPath, "ag", "success");

    const row = await readBack(dbPath, "ag");
    expect(row?.useCount).toBe(5);
    expect(row?.confidence).toBe("trusted");
    expect(events).toEqual([
      { _tag: "SkillPromoted", skillName: "learned-x", fromConfidence: "tentative", toConfidence: "trusted", taskId: "task-1" },
    ]);
  });

  it("an agent run that promotes a pinned skill tags SkillPromoted with the run's taskId", async () => {
    const dbPath = join(BASE, "promote-run.db");
    const agent = await ReactiveAgents.create()
      .withName("skill-promote-agent")
      .withProvider("test")
      .withTestScenario([{ text: "Done." }])
      .withMemory({ dbPath })
      .withSkills({ activate: ["learned-x"] })
      .build();
    const agentId = agent.agentId;
    await seed(dbPath, agentId, skill(agentId, { useCount: 4, successRate: 1 }));
    const promoted: AgentEvent[] = [];
    await agent.subscribe("SkillPromoted", (e) => {
      promoted.push(e);
    });
    let taskId: string;
    try {
      taskId = (await agent.run("Reply with the marker.")).taskId;
    } finally {
      await agent.dispose();
    }

    expect(taskId.length).toBeGreaterThan(0);
    expect(promoted).toEqual([
      { _tag: "SkillPromoted", skillName: "learned-x", fromConfidence: "tentative", toConfidence: "trusted", taskId },
    ]);
  }, 20000);

  it("below the threshold nothing promotes and no event publishes", async () => {
    const dbPath = join(BASE, "no-promote.db");
    await seed(dbPath, "ag", skill("ag", { useCount: 2, successRate: 1 }));
    const events = await recordWithBus(dbPath, "ag", "success");
    expect((await readBack(dbPath, "ag"))?.confidence).toBe("tentative");
    expect(events).toEqual([]);
  });

  it("a locked skill never promotes", async () => {
    const dbPath = join(BASE, "locked.db");
    await seed(dbPath, "ag", skill("ag", { evolutionMode: "locked", useCount: 9, successRate: 1 }));
    const events = await recordWithBus(dbPath, "ag", "success");
    expect((await readBack(dbPath, "ag"))?.confidence).toBe("tentative");
    expect(events).toEqual([]);
  });
});

describe("run-end rollback", () => {
  it("a refined candidate that regresses over 3 uses rolls back to v1 and SkillRolledBack publishes", async () => {
    const dbPath = join(BASE, "rollback.db");
    await seed(dbPath, "ag", skill("ag", { useCount: 4, successRate: 1, confidence: "trusted" }));

    // Refine once with a scripted LLM: v2 becomes the candidate at rate 1.
    const llm: MemoryLLM = {
      complete: () => Effect.succeed({ content: "Reply with the marker, then stop." }),
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SkillStoreService;
        const evolution = yield* SkillEvolutionService;
        const current = yield* store.getByName("ag", "learned-x");
        if (current === null) return;
        yield* evolution.refine(current, []);
      }).pipe(
        Effect.provide(makeSkillEvolutionService(llm).pipe(Layer.provideMerge(storeLayer(dbPath, "ag")))),
        Effect.scoped,
      ),
    );
    expect((await readBack(dbPath, "ag"))?.version).toBe(2);

    // Each failure drops the rate below the rate at refinement, but one or two
    // outcomes are not evidence: rollback waits for 3 uses since refinement.
    expect(await recordWithBus(dbPath, "ag", "failure")).toEqual([]);
    expect(await recordWithBus(dbPath, "ag", "failure")).toEqual([]);
    expect((await readBack(dbPath, "ag"))?.version).toBe(2);

    const events = await recordWithBus(dbPath, "ag", "failure");

    const row = await readBack(dbPath, "ag");
    expect(row?.version).toBe(1);
    expect(row?.instructions).toBe("Reply with the marker.");
    expect(events).toEqual([
      { _tag: "SkillRolledBack", skillName: "learned-x", fromVersion: 2, toVersion: 1, reason: "regression", taskId: "task-1" },
    ]);
  });
});

describe("agent.refineSkills()", () => {
  it("refines a stored skill through the agent's LLM, bumps its version, publishes SkillRefined and reports counts", async () => {
    const dbPath = join(BASE, "refine.db");
    const agent = await ReactiveAgents.create()
      .withName("skill-refine-agent")
      .withProvider("test")
      .withTestScenario([{ text: "## Marker\nReply with the marker, then stop." }])
      .withMemory({ dbPath })
      .build();
    const agentId = agent.agentId;
    await seed(dbPath, agentId, skill(agentId));
    // A second skill with no evidence since its creation is skipped.
    await seed(dbPath, agentId, skill(agentId, { id: "sk-fresh", name: "fresh", createdAt: new Date("2100-01-01T00:00:00Z") }));
    // Five real episodes after the skill's creation: the default threshold.
    await Effect.runPromise(
      Effect.gen(function* () {
        const episodic = yield* EpisodicMemoryService;
        for (let i = 0; i < 5; i++) {
          yield* episodic.log({
            id: MemoryIdSchema.make(`ep-${i}`),
            agentId,
            date: "2026-11-10",
            content: `Marker task ${i} completed.`,
            eventType: "task-completed",
            createdAt: new Date(`2026-11-10T00:00:0${i}Z`),
          });
        }
      }).pipe(Effect.provide(EpisodicMemoryServiceLive.pipe(Layer.provide(dbLayer(dbPath, agentId)))), Effect.scoped),
    );

    const refined: AgentEvent[] = [];
    await agent.subscribe("SkillRefined", (e) => {
      refined.push(e);
    });
    let result: Awaited<ReturnType<typeof agent.refineSkills>>;
    try {
      result = await agent.refineSkills();
    } finally {
      await agent.dispose();
    }

    expect(result).toEqual({ refined: 1, unchanged: 0, skipped: 1, failed: 0 });
    expect(refined).toEqual([
      { _tag: "SkillRefined", skillName: "learned-x", previousVersion: 1, newVersion: 2, taskCategory: "general" },
    ]);
    const row = await readBack(dbPath, agentId);
    expect(row?.version).toBe(2);
    expect(row?.instructions).toBe("## Marker\nReply with the marker, then stop.");
    expect(row?.versionHistory.map((v) => [v.version, v.status])).toEqual([
      [1, "active"],
      [2, "candidate"],
    ]);
  }, 20000);

  it("without memory it reports zero counts", async () => {
    const agent = await ReactiveAgents.create().withName("no-mem").withProvider("test").build();
    try {
      expect(await agent.refineSkills()).toEqual({ refined: 0, unchanged: 0, skipped: 0, failed: 0 });
    } finally {
      await agent.dispose();
    }
  });
});
