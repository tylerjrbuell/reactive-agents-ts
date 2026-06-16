// Run: bun test packages/runtime/tests/approve-deny-resume.test.ts
//
// Durable HITL (Phase D) — approve/deny API + cross-instance resume. The gate
// FIRING is proven at the act seam (reasoning: approval-gate-pause.test.ts); here
// we prove the durable API plumbing: a paused run persisted in the RunStore is
// surfaced by listPendingApprovals, and approveRun/denyRun (from a FRESH agent
// instance reading the same on-disk store — cross-process equivalent) record the
// decision, resume from the real checkpoint, and flip the run to completed.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";
import { RunStoreService, RunStoreLive } from "../src/services/run-store.js";

function makeToolDef(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    parameters: [
      { name: "input", type: "string" as const, description: "Input", required: true },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

function makeAgent(dir: string) {
  return ReactiveAgents.create()
    .withName("hitl-api")
    .withSystemPrompt("You are precise.")
    .withTestScenario([{ text: "FINAL ANSWER: done" }])
    .withTools({
      tools: [
        { definition: makeToolDef("risky-tool"), handler: () => Effect.succeed("ran") },
      ],
    })
    .withReasoning()
    .withMaxIterations(4)
    .withDurableRuns({ dir, checkpointEvery: 1 })
    .withApprovalPolicy({ tools: ["risky-tool"], mode: "detach" })
    .build();
}

/** Run a durable agent via runStream so a run row + checkpoint are written; return its runId. */
async function seedRun(agent: Awaited<ReturnType<typeof makeAgent>>): Promise<string> {
  for await (const _ev of agent.runStream("compute the answer")) void _ev;
  const runs = await agent.listRuns();
  return runs[0]!.runId;
}

/** Inject an awaiting-approval pause onto an existing run, directly via the RunStore. */
function injectPause(dbPath: string, runId: string): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* RunStoreService;
      yield* store.setStatus(runId, "awaiting-approval");
      yield* store.putApproval({
        runId,
        gateId: "gate-1",
        toolName: "risky-tool",
        argsJson: JSON.stringify({ input: "go" }),
      });
    }).pipe(Effect.provide(RunStoreLive(dbPath))),
  );
}

describe("durable HITL — run() durable path", () => {
  it("run() on a durable agent persists a run row (durable wiring fires on the non-stream path)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-run-durable-"));
    try {
      const agent = await makeAgent(dir);
      const result = await agent.run("compute the answer");
      // Normal completion (the test provider does not pause through the runtime).
      expect(result.status ?? "completed").toBe("completed");
      // The durable wiring ran on the run() path: a run row exists + is completed.
      const runs = await agent.listRuns();
      expect(runs.length).toBeGreaterThanOrEqual(1);
      const completed = await agent.listRuns({ status: "completed" });
      expect(completed.length).toBeGreaterThanOrEqual(1);
      await agent.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);

  it("run({ onApproval }) does not invoke the callback when the run never pauses", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-run-onapproval-"));
    try {
      const agent = await makeAgent(dir);
      let asked = 0;
      const result = await agent.run("compute the answer", {
        onApproval: () => {
          asked += 1;
          return true;
        },
      });
      expect(asked).toBe(0); // never paused → callback never fired
      expect(result.status ?? "completed").toBe("completed");
      await agent.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);
});

describe("durable HITL approve/deny API", () => {
  it("listPendingApprovals + approveRun resume from a fresh instance, flips to completed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-hitl-api-approve-"));
    try {
      const a = await makeAgent(dir);
      const runId = await seedRun(a);
      await injectPause(join(dir, "runs.db"), runId);
      await a.dispose();

      // Fresh instance (same dir) — cross-process equivalent.
      const b = await makeAgent(dir);
      try {
        const pending = await b.listPendingApprovals();
        expect(pending.map((p) => p.runId)).toContain(runId);
        expect(pending.find((p) => p.runId === runId)?.toolName).toBe("risky-tool");
        expect(pending.find((p) => p.runId === runId)?.args).toEqual({ input: "go" });

        const resumed = await b.approveRun(runId);
        expect(resumed.output.toLowerCase()).toContain("done");

        const after = await b.listPendingApprovals();
        expect(after.map((p) => p.runId)).not.toContain(runId);
        const completed = await b.listRuns({ status: "completed" });
        expect(completed.some((r) => r.runId === runId)).toBe(true);
      } finally {
        await b.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);

  it("denyRun records the decision and resumes to completion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-hitl-api-deny-"));
    try {
      const a = await makeAgent(dir);
      const runId = await seedRun(a);
      await injectPause(join(dir, "runs.db"), runId);
      await a.dispose();

      const b = await makeAgent(dir);
      try {
        const resumed = await b.denyRun(runId, "not allowed");
        expect(resumed.output.toLowerCase()).toContain("done");
        const after = await b.listPendingApprovals();
        expect(after.map((p) => p.runId)).not.toContain(runId);
      } finally {
        await b.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);

  it("approveRun on a run with no pending approval throws ApprovalStateError", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-hitl-api-none-"));
    try {
      const a = await makeAgent(dir);
      const runId = await seedRun(a); // completed, no pending approval
      let err: unknown;
      try {
        await a.approveRun(runId);
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(String((err as { _tag?: string })?._tag ?? err)).toContain("ApprovalStateError");
      await a.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);
});
