// harness-hook-envelope-coverage.test.ts — cross-cutting cascade Task 6, scope C.
//
// `ReasoningService.execute` is called from FOUR places in the runtime, not one.
// `reasoning-think.ts` (the main think pass) builds the `RunEnvelope`; the
// post-think harness hooks re-run reasoning and — until 2026-07-22 — built their
// request WITHOUT one. The consequence was concrete: on a
// `.withCustomTermination()` retry the approval gate was DISARMED, so a tool the
// caller declared `requiresApproval: true` executed unattended on the
// continuation even though the identical call would have paused on the first pass.
//
// This pins the retry pass. Cutting `envelope: continuationEnvelope` from
// `reasoning-harness-hooks.ts`'s `buildExecuteRequest` makes the gated handler
// run and fails the `executions` assertion.
import { describe, it, expect, afterAll } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";

const dir = mkdtempSync(join(tmpdir(), "ra-hook-envelope-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("harness hooks carry the RunEnvelope (cascade scope C)", () => {
  it("withCustomTermination retry: the approval gate is still armed on the continuation", async () => {
    let executions = 0;

    const agent = await ReactiveAgents.create()
      .withName("hook-envelope-gate")
      .withProvider("test")
      // First pass answers with NO tool call, so the run completes and the
      // custom-termination predicate (never satisfied) triggers the retry.
      // The test provider consumes turns SEQUENTIALLY (callIndex never rewinds),
      // so turn 0 is the first pass's answer and turn 1 — the gated tool call —
      // can only be reached by the retry pass.
      .withTestScenario([
        { text: "Here is an initial answer with no tools." },
        { toolCall: { name: "risky-tool", args: { input: "go" } } },
      ] as never)
      .withTools({
        tools: [
          {
            definition: {
              name: "risky-tool",
              description: "Mutates state — requires approval.",
              parameters: [
                { name: "input", type: "string" as const, description: "Input", required: true },
              ],
              riskLevel: "high" as const,
              requiresApproval: true,
              timeoutMs: 5_000,
              source: "function" as const,
            },
            handler: () =>
              Effect.sync(() => {
                executions += 1;
                return "ran";
              }),
          },
        ],
      })
      .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
      .withRequiredTools({ adaptive: false })
      .withMaxIterations(3)
      .withDurableRuns({ dir, checkpointEvery: 1 })
      .withApprovalPolicy({ tools: ["risky-tool"], mode: "detach" })
      // Never satisfied → the hook always re-runs reasoning.
      .withCustomTermination(() => false)
      .build();

    await agent.run("do the risky thing");

    // The retry pass asked for the gated tool. It must have PAUSED, exactly as
    // the first pass would have — not executed unattended.
    expect(executions).toBe(0);
  }, 30_000);

  // ── Review C1: the envelope's ENFORCEMENT half must not bite a fragment ────
  //
  // Carrying the envelope on a continuation pass (the fix above) armed more
  // than the approval gate: it armed the terminal mint. A continuation refines
  // prose against an answer an EARLIER pass grounded, so its own `steps` hold
  // no required-tool evidence — judged as a terminal it looks exactly like a
  // fabrication. Under `.withFabricationGuard("block")` a correct, tool-grounded
  // run was flipped to `status:"failed"` and the answer replaced by the
  // abstention sentinel.
  //
  // ⚠ CORRECTED 2026-07-23 (adversarial review). This block previously claimed:
  // "Cutting `auxiliaryPass: true` from `reasoning-harness-hooks.ts`'s
  // `buildRunEnvelopeFromConfig` call turns this red." That claim was FALSE and
  // is retracted. The cut was made and re-run: this file stayed GREEN (2 pass /
  // 0 fail); the only assertions that went red were the two in
  // `auxiliary-pass-wiring.test.ts` (lines 103 and 137). In this scenario the
  // run's `verdict` comes back `{enforced: false}` and the output is the refined
  // prose WITH and WITHOUT the flag — identical — so nothing here discriminates
  // the fence. In this repo red-on-cut is the definition of done, and a false
  // red-on-cut claim is worse than none: it invites a maintainer to delete the
  // real pin and trust this one.
  //
  // What ACTUALLY pins `auxiliaryPass`, both red-on-cut:
  //   - `packages/runtime/tests/auxiliary-pass-wiring.test.ts` — that the two
  //     FRAGMENT-pass builders SET the flag on the request they emit (drives the
  //     real `runReasoningHarnessHooks` against a recording ReasoningService).
  //   - `packages/reasoning/src/kernel/capabilities/sense/finalize-result.test.ts`
  //     ("auxiliaryPass fence") — that the terminal mint HONOURS it.
  //
  // What THIS test is, honestly: an end-to-end smoke that a tool-grounded run
  // under `.withFabricationGuard("block")` with a continuation hook still ships
  // its answer rather than the abstention sentinel. That is worth having — it is
  // the only assertion of the property through the public builder — but it is
  // not a pin of the flag, and must not be cited as one.
  it("continuation pass: a grounded run keeps its answer under fabricationGuard block", async () => {
    let noteCalls = 0;

    const agent = await ReactiveAgents.create()
      .withName("hook-envelope-aux")
      .withProvider("test")
      .withTestScenario([
        // Pass 1 GROUNDS the run: the required tool actually runs…
        { toolCall: { name: "record-note", args: { text: "alpha" } } },
        // …and answers.
        { text: "Recorded the note: alpha." },
        // The minIterations continuation refines prose only — no tool call.
        { text: "Recorded the note: alpha. (refined)" },
        { text: "Recorded the note: alpha. (refined again)" },
        { text: "Recorded the note: alpha. (refined once more)" },
      ] as never)
      .withTools({
        tools: [
          {
            definition: {
              name: "record-note",
              description: "Records a note.",
              parameters: [
                { name: "text", type: "string" as const, description: "Text", required: true },
              ],
              riskLevel: "low" as const,
              requiresApproval: false,
              timeoutMs: 5_000,
              source: "function" as const,
            },
            handler: () =>
              Effect.sync(() => {
                noteCalls += 1;
                return "recorded";
              }),
          },
        ],
      })
      .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
      .withRequiredTools({ tools: ["record-note"], adaptive: false })
      .withFabricationGuard("block")
      // Never satisfied → the hook always re-runs reasoning, so a continuation
      // pass provably happens (unlike `.withMinIterations`, whose floor the
      // first pass can already satisfy).
      .withCustomTermination(() => false)
      .withMaxIterations(4)
      .build();

    const result = await agent.run("record a note about alpha");

    // The run really was grounded — the required tool ran on pass 1.
    expect(noteCalls).toBeGreaterThan(0);
    // …so the user must NOT be told the agent could not ground an answer.
    expect(String(result.output ?? "")).not.toContain("Could not complete the task");
    // `verdict` IS present on `result.metadata` at runtime (verified 2026-07-23:
    // `{"enforced":false,"grounded…}`), but `AgentResultMetadata` — the public
    // builder surface — does not DECLARE it, so it has to be read structurally.
    // The typing gap is logged in DEBT-REGISTER §3.
    const meta = result.metadata as { verdict?: { enforced?: boolean } };
    expect(meta.verdict?.enforced).not.toBe(true);
  }, 30_000);
});
