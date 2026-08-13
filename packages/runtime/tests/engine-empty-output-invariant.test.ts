// Run: bun test packages/runtime/tests/engine-empty-output-invariant.test.ts --timeout 20000
//
// Engine-boundary output/success invariant (M7's engine mirror).
//
// Empirical origin (2026-07-11 probe fleet): p10's second run and a p5 rerun
// shipped `success:true` with EMPTY output on the inline path — the engine
// derived success from ctx.metadata.isComplete and never looked at the output
// or the deliverables. Deterministic repro: a tool-call turn followed by an
// empty final turn → success:true, outputLen:0, verdict tool-grounded.
//
// Invariant: success with empty output is only honest when every DECLARED
// deliverable verifiably landed — then the artifacts ARE the answer and a
// deterministic completion note (marked harness-authored) replaces the
// silence. Otherwise the empty "success" is a failure with a real cause.
import { describe, it, expect, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { ReactiveAgents } from "../src/index.js";

afterAll(() => rmSync("qa-test-empty", { recursive: true, force: true }));

describe("engine empty-output invariant", () => {
  it("empty final turn + verified deliverable → success with a harness-authored completion note", async () => {
    rmSync("qa-test-empty", { recursive: true, force: true });
    const agent = await ReactiveAgents.create()
      .withTools({ builtins: ["file-write"], required: ["file-write"] })
      .withTestScenario([
        {
          toolCall: {
            id: "t1",
            name: "file-write",
            args: { path: "./qa-test-empty/x.txt", content: "hi" },
          },
        },
        { text: "" },
      ])
      .build();
    try {
      const r = await agent.run("Write hi to the file ./qa-test-empty/x.txt.");
      expect(existsSync("qa-test-empty/x.txt")).toBe(true);
      expect(r.success).toBe(true);
      // The silence is replaced by a deterministic note…
      expect(String(r.output ?? "").trim().length).toBeGreaterThan(0);
      // Move 1 merge (2026-08-13): the note is synthesized from the kernel's
      // own normalized tool observation (tool-execution.ts's
      // normalizeObservation, pre-existing and unrelated to this merge --
      // deliberately keeps only the basename: `rawPath.split("/").pop()`),
      // which a bare builder never routed through before. Assert the
      // basename, not the full relative path, to match.
      expect(String(r.output)).toContain("x.txt");
      // …and honestly labeled as harness-authored, not model prose.
      //
      // OPEN FINDING (Move 1 merge triage, 2026-08-13), NOT resolved — traced,
      // not patched, because the fix site is inside the honesty-labeling spine
      // (H5/completion-status.ts) and deserves its own careful pass, not a
      // rushed change under this test:
      //
      // `state.output` for this scenario is ALREADY non-empty by the time
      // BOTH honesty-labeling mechanisms check it -- the kernel's own §9
      // "harness-assembled output always attempts synthesis" path backfills
      // `state.output` from the tool's normalized observation ("✓ Written to
      // ./x.txt") before the model's genuinely-empty final turn is ever
      // considered empty. That defeats:
      //   (a) runner.ts's onlyHarnessAuthorshipFailed (H5) -- its condition
      //       (`state.meta.terminatedBy === "harness_deliverable"`) checks a
      //       KernelState field that is never actually assigned that literal
      //       string anywhere; the string only appears as a candidate/
      //       hypothetical value passed into a VERIFIER CALL's input context
      //       (verifier.ts:333's `ctx.terminatedBy`, set by
      //       stall-deliverable.ts:354) -- two different fields with the same
      //       string, one real one synthetic, checked inconsistently.
      //   (b) execution-engine.ts's own `!hasSubstantiveOutput` branch
      //       (:1283) -- also never true here, for the same reason.
      // Fixed (this session, separately): execution-engine.ts's result
      // assembly only read (a)'s flag from `ctx.metadata`, never from the
      // kernel's own `rr?.metadata.harnessAuthoredOutput` -- widened, and
      // correct on its own terms, but does not help THIS scenario since (a)
      // never fires to begin with.
      expect(
        (r.metadata as { harnessAuthoredOutput?: boolean }).harnessAuthoredOutput,
      ).toBe(true);
      expect(r.receipt?.deliverables).toEqual([
        { spec: "produce the file ./qa-test-empty/x.txt", produced: true },
      ]);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("empty output with NO verified deliverable → success:false with a real cause", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ text: "" }])
      .build();
    try {
      const r = await agent.run("Summarize the plot of Hamlet in one sentence.");
      expect(r.success).toBe(false);
      // OPEN FINDING (Move 1 merge triage, 2026-08-13), NOT resolved -- same
      // root cause as the harnessAuthoredOutput finding in the test above.
      // execution-engine.ts:1408's ctx.metadata.emptyOutputFailure branch
      // (which produces the "no output" message this asserts) is gated on
      // `!hasSubstantiveOutput`, computed from `state.output` -- but the
      // kernel's own harness-assembled-output synthesis backfills
      // `state.output` with SOME text even when the model's genuine final
      // turn was empty, so `hasSubstantiveOutput` reads true and this branch
      // never fires. Falls through to the generic "Reasoning failed" label
      // instead. Same fix site as the finding above (the kernel's synthesis
      // needs to distinguish "genuinely empty, no fallback" from "empty but
      // I filled something in" before either downstream honesty check can
      // trust `state.output`'s emptiness) -- both should be fixed together,
      // not each patched around independently.
      expect(String((r as { error?: string }).error ?? "")).toContain("no output");
    } finally {
      await agent.dispose();
    }
  }, 20000);
});
