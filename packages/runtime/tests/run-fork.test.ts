/**
 * run-fork.test.ts — Arc 1 Task 6: `agent.fork()` v1, counterfactual restart
 * from any checkpoint.
 *
 * Layer 1 (below): `checkpointAt` + `loadForkPayload` — pure store/payload
 * logic, no LLM. Proves (a) the checkpoint at-or-below the requested
 * iteration is returned (not necessarily the latest), and (b) NO config-hash
 * guard — a fork is a deliberate counterfactual restart, unlike crash-resume,
 * so a mismatched/overridden config must NOT fail the load.
 *
 * Layer 2 (below): `agent.fork()` end-to-end with the keyless `test` provider
 * — a durable kernel run to completion, then a fork from an earlier
 * checkpoint, asserting a NEW run row with `forkedFrom`/`forkedAtIteration`
 * provenance distinct from the source run.
 *
 * Framing (binding, user-ratified): fork = "counterfactual restart from
 * checkpoint". LLM calls after the fork point are live, fresh calls — never
 * "time travel" and never a replay.
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStoreLive, RunStoreService } from "../src/services/run-store.js";
import { loadForkPayload } from "../src/engine/durable-resume.js";
import { ReactiveAgents } from "../src/builder.js";

describe("fork payload", () => {
  test("returns the checkpoint at or below the requested iteration, ignoring config hash", async () => {
    const dbPath = `/tmp/claude-1000/fork-${Date.now()}.db`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "src", agentId: "a", task: "t", configHash: "ORIGINAL" });
        yield* store.putCheckpoint("src", 1, '{"codecVersion":1,"state":{"i":1}}');
        yield* store.putCheckpoint("src", 3, '{"codecVersion":1,"state":{"i":3}}');
        yield* store.putCheckpoint("src", 5, '{"codecVersion":1,"state":{"i":5}}');
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );
    const payload = await Effect.runPromise(
      loadForkPayload({ runId: "src", dbPath, at: 4 }),
    );
    expect(JSON.parse(payload.stateJson).state.i).toBe(3); // highest checkpoint ≤ 4
    expect(payload.run.runId).toBe("src");
    expect(payload.iteration).toBe(3);
    // No config-hash param exists on loadForkPayload at all — the type
    // signature itself proves there is no guard to satisfy. A stored hash of
    // "ORIGINAL" (unrelated to any "current" agent hash) still loads fine.
    expect(payload.run.configHash).toBe("ORIGINAL");
  });

  test("defaults to the latest checkpoint when `at` is omitted", async () => {
    const dbPath = `/tmp/claude-1000/fork-latest-${Date.now()}.db`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "src", agentId: "a", task: "t", configHash: "X" });
        yield* store.putCheckpoint("src", 1, '{"codecVersion":1,"state":{"i":1}}');
        yield* store.putCheckpoint("src", 5, '{"codecVersion":1,"state":{"i":5}}');
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );
    const payload = await Effect.runPromise(loadForkPayload({ runId: "src", dbPath }));
    expect(JSON.parse(payload.stateJson).state.i).toBe(5);
    expect(payload.iteration).toBe(5);
  });

  test("fails DurableRunNotFoundError for an unknown run", async () => {
    const dbPath = `/tmp/claude-1000/fork-missing-${Date.now()}.db`;
    const err = await Effect.runPromise(
      loadForkPayload({ runId: "does-not-exist", dbPath }).pipe(Effect.flip),
    );
    expect(err._tag).toBe("DurableRunNotFoundError");
  });

  test("fails DurableRunNotFoundError when no checkpoint qualifies at-or-below `at`", async () => {
    const dbPath = `/tmp/claude-1000/fork-toolow-${Date.now()}.db`;
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "src", agentId: "a", task: "t", configHash: "X" });
        yield* store.putCheckpoint("src", 5, '{"codecVersion":1,"state":{"i":5}}');
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );
    const err = await Effect.runPromise(
      loadForkPayload({ runId: "src", dbPath, at: 2 }).pipe(Effect.flip),
    );
    expect(err._tag).toBe("DurableRunNotFoundError");
  });
});

// ─── Integration: agent.fork() end-to-end (keyless, test provider) ─────────
function makeToolDef(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    parameters: [
      {
        name: "input",
        type: "string" as const,
        description: "Input",
        required: true,
      },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

const echoTools = {
  tools: [
    {
      definition: makeToolDef("echo-tool"),
      handler: (args: Record<string, unknown>) => Effect.succeed(`echoed: ${String(args["input"])}`),
    },
  ],
};

describe("agent.fork() — end-to-end", () => {
  test("forks a completed run into a NEW run row carrying forkedFrom/forkedAtIteration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-fork-e2e-"));
    try {
      const agent = await ReactiveAgents.create()
        .withName("fork-subject")
        .withSystemPrompt("You are a precise calculator.")
        .withTestScenario([
          { toolCall: { name: "echo-tool", args: { input: "hi" } } },
          { text: "FINAL ANSWER: forty-two" },
        ] as never)
        .withTools(echoTools)
        .withReasoning()
        .withMaxIterations(4)
        .withDurableRuns({ dir, checkpointEvery: 1 })
        .build();
      try {
        // Phase 1: run to completion via runStream so checkpoints land.
        for await (const _event of agent.runStream("compute the answer")) {
          void _event;
        }
        const runs = await agent.listRuns();
        expect(runs.length).toBeGreaterThanOrEqual(1);
        const sourceRunId = runs[0]!.runId;
        expect(sourceRunId).toBeTruthy();

        // Phase 2: fork from checkpoint 0 — the only checkpoint a STREAMED run
        // captures today (pre-existing "boundary-only" gap noted in Task 5's
        // follow-ups; not this task's concern). Override the task text since
        // a fresh test-scenario replay only has one line left.
        const result = await agent.fork(sourceRunId, {
          at: 0,
          task: "compute the answer, take two",
        });
        expect(result.output).toContain("forty-two");

        const all = await agent.listRuns();
        const forked = all.find((r) => r.runId !== sourceRunId);
        expect(forked).toBeDefined();
        expect(forked!.runId).toContain(`${sourceRunId}-fork-`);
        expect(forked!.forkedFrom).toBe(sourceRunId);
        expect(forked!.forkedAtIteration).toBe(0);
        expect(forked!.status).toBe("completed");
      } finally {
        await agent.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);
});
