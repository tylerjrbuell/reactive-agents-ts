// Run: bun test packages/runtime/tests/reflexion-answer-floor-and-adaptive-outcome.test.ts --timeout 20000
//
// (1) A verified, accepted plain-answer reflexion run is not failed by a stale
//     `answer` floor forwarded as outstanding (completion-envelope.ts).
// (2) adaptive relays its sub-strategy's terminalOutcome + kernelIteration so
//     run-completed.outcome is not blank.
//
// RED-ON-CUT:
//  - remove the `answerBlessed` filter in envelopeFromKernelState -> (1) red.
//  - remove `relayedOutcome` from adaptive.ts's finalizeStrategyResult call -> (2) red.
import { describe, it, expect } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrace } from "@reactive-agents/trace";
import { ReactiveAgents } from "../src/builder.js";

async function runCompleted(strategy: string, switching: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "ra-answer-floor-"));
  const agent = await ReactiveAgents.create()
    .withName(`floor-${strategy}`)
    .withProvider("test")
    .withModel("test")
    .withTestScenario([{ text: "The metric rose 12% last quarter." }] as never)
    .withReasoning({ defaultStrategy: strategy as never, enableStrategySwitching: switching })
    .withMaxIterations(4)
    .withObservability({ tracing: { dir } })
    .build();
  const result = await agent.run("Summarize the metric change.");
  await agent.dispose();
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const rc = (await loadTrace(join(dir, name))).events.find((e) => e.kind === "run-completed");
    if (rc?.kind === "run-completed") return { rc, result };
  }
  throw new Error("no run-completed event in trace");
}

describe("answer floor must not veto a verified deliverable", () => {
  it("(1) reflexion plain answer: not failed", async () => {
    const { rc } = await runCompleted("reflexion", false);
    expect(rc.outcome?.outstanding ?? []).not.toContain("answer");
    expect(rc.status).toBe("success");
  }, 30_000);
});

describe("adaptive relays sub-strategy terminal outcome", () => {
  it("(2) run-completed.outcome is populated for adaptive", async () => {
    const { rc } = await runCompleted("adaptive", true);
    expect(rc.outcome).toBeDefined();
    expect(rc.outcome?.status).toBe("completed");
    expect(rc.outcome?.deliverable).not.toBeNull();
  }, 30_000);
});
