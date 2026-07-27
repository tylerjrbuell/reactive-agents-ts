// Run: bun test packages/runtime/tests/cache-hit-receipt-honesty.test.ts --timeout 60000
//
// A REPLAYED answer must not out-rank the run that actually did the work.
//
// A semantic-cache hit short-circuits the agent loop: no LLM call, no tool
// dispatch, zero steps, no ledger. The receipt for such a run used to read:
//
//   run 1 (wrote the file)   verdict=partially-grounded  conf=0.6  verifier=escalate
//   run 2 (CACHE HIT)        verdict=ungrounded          conf=0.8  verifier=pass
//
// The run with no evidence at all reported a CLEANER verification than the run
// that produced the artifact. A consumer gating on `verifierVerdict === "pass"`
// would accept the replay and reject the grounded run — the trust signal
// inverted, inside the artifact whose entire job is honesty.
//
// Two causes, both fixed:
//
//  1. The result-boundary verifier ran on the empty record. Every check it
//     performs detects a PROBLEM in the evidence (scaffold leak, harness
//     parrot, mid-thought continuation, fabricated measurement), so with no
//     evidence it found no problem and returned `pass` — a vacuous pass. It now
//     DECLINES on a run with no steps, leaving `verifierVerdict` absent, which
//     the receipt documents as "unverified" and never as "clean".
//  2. Nothing marked the run as a replay. `cacheHit` was set on the execution
//     context and read only by cost-tracking, so the shipped result was
//     indistinguishable from a real one. It now rides to the receipt as
//     `replayed: true`, alongside `metadata.cacheHit`.
import { describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "../src/index.js";

const ARTIFACT = "./.cache-receipt.tmp.md";
const TASK = "TERSE_TRIGGER: write the report file.";

const scenario = (): TestTurn[] => [
  { json: { required: [], relevant: ["file-write"] } },
  {
    match: "TERSE_TRIGGER",
    text: "Writing it now.",
    toolCall: { name: "file-write", args: { path: ARTIFACT, content: "payload" } },
  },
  { text: "Report written." },
];

interface RunView {
  readonly cacheHit: boolean;
  readonly stepsCount: number;
  readonly verifierVerdict: string | undefined;
  readonly replayed: boolean;
}

/**
 * Run the SAME task twice against one agent. The second is a cache hit — the
 * first run's answer replayed with nothing executed.
 */
async function bothRuns(): Promise<{ readonly real: RunView; readonly replay: RunView }> {
  await rm(join(process.cwd(), ARTIFACT), { force: true });
  const agent = await ReactiveAgents.create()
    .withName("cache-receipt")
    .withProvider("test")
    .withModel("test-model")
    .withMaxIterations(8)
    .withTools()
    .withReasoning({ defaultStrategy: "reactive" })
    .withCostTracking()
    .withTestScenario(scenario())
    .build();

  try {
    const views: RunView[] = [];
    for (const taskId of ["real", "replay"]) {
      const res = await agent.run(TASK, { taskId });
      const meta = (res.metadata ?? {}) as {
        cacheHit?: boolean;
        stepsCount?: number;
      };
      const receipt = res.receipt as
        | { verifierVerdict?: string; replayed?: true }
        | undefined;
      views.push({
        cacheHit: meta.cacheHit === true,
        stepsCount: meta.stepsCount ?? 0,
        verifierVerdict: receipt?.verifierVerdict,
        replayed: receipt?.replayed === true,
      });
    }
    return { real: views[0]!, replay: views[1]! };
  } finally {
    await agent.dispose();
    await rm(join(process.cwd(), ARTIFACT), { force: true });
  }
}

describe("a cache hit's receipt tells the truth about itself", () => {
  it("CONTROL: the second run really is a replay, and the first really ran", async () => {
    // Without this the assertions below could pass because BOTH runs executed
    // normally and neither was ever a cache hit — the cell would be measuring
    // nothing. This is the arrangement the rest of the file depends on.
    const { real, replay } = await bothRuns();
    expect(real.cacheHit).toBe(false);
    expect(real.stepsCount).toBeGreaterThan(0);
    expect(replay.cacheHit).toBe(true);
    expect(replay.stepsCount).toBe(0);
  }, 60_000);

  it("the replay is MARKED as a replay", async () => {
    const { real, replay } = await bothRuns();
    expect(replay.replayed).toBe(true);
    // An ordinary run stays byte-identical — the marker is absent, not `false`.
    expect(real.replayed).toBe(false);
  }, 60_000);

  it("the replay claims NO verifier verdict — absent, not 'pass'", async () => {
    const { replay } = await bothRuns();
    // The defect in one line: this used to be "pass".
    expect(replay.verifierVerdict).toBeUndefined();
  }, 60_000);

  it("the replay never out-ranks the run that did the work", async () => {
    const { real, replay } = await bothRuns();
    // The property that actually matters, stated directly. A run with zero
    // evidence must never carry a verifier verdict the grounded run did not
    // earn. Previously: real=escalate, replay=pass.
    expect(real.verifierVerdict).toBeDefined();
    expect(replay.verifierVerdict).toBeUndefined();
  }, 60_000);
});
