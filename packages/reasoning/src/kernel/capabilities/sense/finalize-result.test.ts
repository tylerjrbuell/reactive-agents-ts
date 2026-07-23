import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { deliverableToContent, sentinelDeliverable } from "@reactive-agents/core";
import type { TaskContract } from "@reactive-agents/core";
import { finalizeStrategyResult, finalizePausedStrategyResult } from "./finalize-result.js";
import type { JudgedReasoningResult } from "./finalize-result.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../envelope/run-envelope.js";
import type { ReasoningResult } from "../../../types/index.js";
import type { RunLedger } from "../../ledger/run-ledger.js";
import { makeStep, buildStrategyResult } from "./step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";

// @ts-expect-error — the brand symbol must stay module-private; exporting it
// would defeat the mint (a direct type import must fail to compile, not just
// the derived-type witness below).
import type { Judged } from "./finalize-result.js";

const baseParams = {
  strategy: "reactive" as const,
  steps: [],
  output: "The answer is 42.",
  status: "completed" as const,
  start: 0,
  totalTokens: 10,
  totalCost: 0,
};

describe("finalizeStrategyResult — the only mint of a judged result", () => {
  it("produces a result identical to buildStrategyResult's shape, plus a verdict record", async () => {
    const r = await Effect.runPromise(
      provideTestEnvelope(finalizeStrategyResult(baseParams)),
    );
    expect(r.status).toBe("completed");
    expect(r.output).toBe("The answer is 42.");
    // No wither configured ⇒ judgment records and never enforces (Task 8's
    // zero-config invariant; see the dedicated describe block below).
    expect(r.metadata.verdict).toBeDefined();
    expect(r.metadata.verdict?.enforced).toBe(false);
  });

  it("a JudgedReasoningResult is assignable to ReasoningResult (consumers unchanged)", async () => {
    const r: JudgedReasoningResult = await Effect.runPromise(
      provideTestEnvelope(finalizeStrategyResult(baseParams)),
    );
    const plain: ReasoningResult = r; // must compile
    expect(plain.strategy).toBe("reactive");
  });

  it("witness: a plain ReasoningResult is NOT a JudgedReasoningResult", () => {
    const plain: ReasoningResult = {
      strategy: "reactive",
      steps: [],
      output: "x",
      metadata: { duration: 0, tokensUsed: 0, cost: 0, stepsCount: 0, confidence: 1 },
      status: "completed",
    };
    // @ts-expect-error — the brand is unexported; only finalizeStrategyResult mints it.
    const judged: JudgedReasoningResult = plain;
    expect(judged).toBeDefined(); // runtime no-op; the assertion is the compile error above
  });

  it("records the declared repair gap when the strategy reports no per-iteration repair", async () => {
    const r = await Effect.runPromise(
      provideTestEnvelope(
        finalizeStrategyResult({ ...baseParams, repairCapabilities: { perIteration: false } }),
        buildRunEnvelope({ fabricationGuard: "block" }),
      ),
    );
    expect(r.metadata.verdict?.repairGaps).toEqual(["per-iteration"]);
  });

  describe("groundedOnRequired — the only computed branch (Fix 3)", () => {
    it("requiredTools declared + a successful matching required tool call ⇒ groundedOnRequired: true", async () => {
      const groundedStep = makeStep(
        "observation",
        "read the config file",
        { observationResult: makeObservationResult("file-read", true, "contents of config") },
      );
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            steps: [groundedStep],
            requiredTools: ["file-read"],
          }),
        ),
      );
      expect(r.metadata.verdict?.groundedOnRequired).toBe(true);
      // A grounded run has nothing to flag as failed.
      expect(r.metadata.verdict?.failed).toEqual([]);
    });

    it("requiredTools declared + no successful matching step ⇒ groundedOnRequired: false", async () => {
      const unrelatedStep = makeStep(
        "observation",
        "listed the directory",
        { observationResult: makeObservationResult("list-directory", true, "a.txt, b.txt") },
      );
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            steps: [unrelatedStep],
            requiredTools: ["file-read"],
          }),
        ),
      );
      expect(r.metadata.verdict?.groundedOnRequired).toBe(false);
    });
  });

  // ── Task 8: judgment goes live ──────────────────────────────────────────────
  //
  // This block WAS the "Task-3 inertness gate": it asserted that the identical
  // HOT config (requiredTools declared, nothing satisfies them, a guard
  // configured) left `enforced:false` and rode the caller's status/output
  // through untouched. Task 8 is what flipped it. The Task-3 comment said so
  // explicitly — "if this test ever goes green for the wrong reason, rewrite it
  // as a red-on-cut for enforcement, not delete it" — so it is rewritten here,
  // same fixture, opposite expectation, plus the three sibling cases that fence
  // the flip in (warn records, no-wither is untouched, grounded is untouched).
  describe("Task-8 enforcement gate — block-mode guard flips an ungrounded run", () => {
    const ABSTENTION = deliverableToContent(sentinelDeliverable("no_substantive_output"));

    it("block-mode guard + ungrounded run ⇒ status failed, honest sentinel output, enforced:true", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            requiredTools: ["file-read"],
            steps: [], // no successful file-read step
          }),
          buildRunEnvelope({ fabricationGuard: "block" }),
        ),
      );
      expect(r.status).toBe("failed");
      expect(r.metadata.verdict?.enforced).toBe(true);
      expect(r.metadata.verdict?.groundedOnRequired).toBe(false);
      expect(r.metadata.verdict?.failed).toEqual(["grounding-on-required"]);
      // The output is the canonical abstention rendering — not a hand-written
      // string, and never the model's ungrounded claim.
      expect(r.output).toBe(ABSTENTION);
      expect(String(r.output)).toContain("Could not complete the task");
      expect(String(r.output)).not.toBe("Task complete.");
      expect(r.output).not.toBe(baseParams.output);
      // The error names the failed checks, so the caller can say WHY.
      expect(r.error).toContain("grounding-on-required");
      // Coherence: a failed result must not carry a "completed" confidence.
      expect(r.metadata.confidence).toBe(0.4);
    });

    it("warn-mode guard + ungrounded run ⇒ status unchanged, verdict records the failure", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            requiredTools: ["file-read"],
            steps: [],
          }),
          buildRunEnvelope({ fabricationGuard: "warn" }),
        ),
      );
      // Recorded…
      expect(r.metadata.verdict?.groundedOnRequired).toBe(false);
      expect(r.metadata.verdict?.failed).toEqual(["grounding-on-required"]);
      // …never enforced. `warn` is a reporting mode.
      expect(r.metadata.verdict?.enforced).toBe(false);
      expect(r.status).toBe(baseParams.status);
      expect(r.output).toBe(baseParams.output);
      expect(r.error).toBeUndefined();
    });

    it("no wither configured ⇒ enforced:false and result untouched (zero-config invariant)", async () => {
      // THE most important property in Task 8: a user who configured nothing
      // must see byte-identical behavior. Same ungrounded fixture as the
      // block-mode case above — the ONLY difference is the empty envelope.
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            requiredTools: ["file-read"],
            steps: [],
          }),
          // No `fabricationGuard`, no `taskContract`, no `grounding`.
          buildRunEnvelope(),
        ),
      );
      expect(r.metadata.verdict?.enforced).toBe(false);
      expect(r.status).toBe(baseParams.status);
      expect(r.output).toBe(baseParams.output);
      expect(r.error).toBeUndefined();
      expect(r.metadata.confidence).toBe(0.8);
      // Judgment still OBSERVES (groundedOnRequired is computed unconditionally)
      // but records nothing as failed, because no wither asked it to.
      expect(r.metadata.verdict?.groundedOnRequired).toBe(false);
      expect(r.metadata.verdict?.failed).toEqual([]);
      expect(r.metadata.verdict?.contractSatisfied).toBeUndefined();
    });

    it("grounded run + block guard ⇒ untouched", async () => {
      const groundedStep = makeStep("observation", "read the config file", {
        observationResult: makeObservationResult("file-read", true, "contents of config"),
      });
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            requiredTools: ["file-read"],
            steps: [groundedStep],
          }),
          buildRunEnvelope({ fabricationGuard: "block" }),
        ),
      );
      expect(r.metadata.verdict?.groundedOnRequired).toBe(true);
      expect(r.metadata.verdict?.enforced).toBe(false);
      expect(r.metadata.verdict?.failed).toEqual([]);
      expect(r.status).toBe("completed");
      expect(r.output).toBe(baseParams.output);
    });

    it("no requiredTools declared + block guard ⇒ nothing to ground against, untouched", async () => {
      // A pure Q&A run declares no required tools; the grounding verdict is not
      // computed at all, so block-mode has no basis to flip anything.
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({ ...baseParams, steps: [] }),
          buildRunEnvelope({ fabricationGuard: "block" }),
        ),
      );
      expect(r.metadata.verdict?.groundedOnRequired).toBeUndefined();
      expect(r.metadata.verdict?.enforced).toBe(false);
      expect(r.status).toBe("completed");
      expect(r.output).toBe(baseParams.output);
    });

    it("an already-failed result is left alone (the honest error survives)", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            status: "failed",
            output: "partial notes",
            error: "LLM stream failed at iteration 2: provider 413",
            requiredTools: ["file-read"],
            steps: [],
          }),
          buildRunEnvelope({ fabricationGuard: "block" }),
        ),
      );
      // Judgment records the ungrounded finding…
      expect(r.metadata.verdict?.failed).toEqual(["grounding-on-required"]);
      // …but does not overwrite a run that already failed for a real reason.
      expect(r.metadata.verdict?.enforced).toBe(false);
      expect(r.error).toBe("LLM stream failed at iteration 2: provider 413");
      expect(r.output).toBe("partial notes");
    });

    it("a strategy that carries NO requiredTools still judges against the declared contract's", async () => {
      // `direct` hard-codes `requiredTools: []` (DirectInput has no such field),
      // so without the contract fallback an envelope-declared required tool
      // would enforce on plan-execute and stay silent on direct — the exact
      // input-interface-omission defect class the cascade closes.
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({ ...baseParams, requiredTools: [], steps: [] }),
          buildRunEnvelope({
            fabricationGuard: "block",
            taskContract: {
              prompt: "Add the numbers",
              tools: [{ kind: "required", name: "add" }],
              success: { type: "regex", pattern: "5" },
            },
          }),
        ),
      );
      expect(r.metadata.verdict?.groundedOnRequired).toBe(false);
      expect(r.metadata.verdict?.enforced).toBe(true);
      expect(r.status).toBe("failed");
      expect(r.output).toBe(ABSTENTION);
    });

    it("a PAUSED run is never flipped — the pause is a clean terminal, not a fabrication", async () => {
      // A HITL pause has (by construction) not yet called the required tool.
      // Enforcing on it would convert every approval gate under
      // `.withFabricationGuard("block")` into a failed run and destroy the
      // resume rails.
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizePausedStrategyResult({
            strategy: "reactive",
            steps: [],
            pause: {
              reason: "awaiting-approval",
              output: "Run paused — awaiting human approval.",
              awaitingApprovalFor: { gateId: "g1", toolName: "file-write", args: {} },
            },
            start: 0,
            totalTokens: 0,
            totalCost: 0,
            requiredTools: ["file-read"],
          }),
          buildRunEnvelope({ fabricationGuard: "block" }),
        ),
      );
      expect(r.status).toBe("completed");
      expect(r.output).toBe("Run paused — awaiting human approval.");
      expect(r.metadata.verdict?.enforced).toBe(false);
      const meta = r.metadata as { awaitingApprovalFor?: { toolName: string } };
      expect(meta.awaitingApprovalFor?.toolName).toBe("file-write");
    });

    // ── The adaptive relay route (review fix 1) ──────────────────────────────
    //
    // `adaptive` re-mints its sub-strategy's result and relays the pause
    // descriptors through `extraMetadata` ONLY — it passes neither `pause` nor
    // `kernelMeta`. A fence reading `params` alone therefore did not fire, and a
    // PAUSED adaptive run under `.withFabricationGuard("block")` was flipped to
    // `status:"failed"` with the abstention sentinel replacing the pause
    // message (reproduced 2026-07-22). That is the fe5dc93b defect class.
    //
    // Cutting the `base.metadata.awaiting*` reads in `finalize-result.ts` turns
    // both of these red.
    it("adaptive shape: pause relayed via extraMetadata ONLY is still fenced (not flipped)", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            strategy: "adaptive",
            output: "Run paused — awaiting human approval.",
            requiredTools: ["file-write"],
            steps: [], // paused BEFORE the gated call ran — by construction ungrounded
            extraMetadata: {
              selectedStrategy: "reactive",
              fallbackOccurred: false,
              terminatedBy: "end_turn",
              rawTerminatedBy: "awaiting-approval",
              awaitingApprovalFor: { gateId: "g1", toolName: "file-write", args: {} },
            },
          }),
          buildRunEnvelope({ fabricationGuard: "block" }),
        ),
      );
      expect(r.metadata.verdict?.enforced).toBe(false);
      expect(r.status).toBe("completed");
      expect(r.output).toBe("Run paused — awaiting human approval.");
      expect(r.error).toBeUndefined();
      // The resume rails survive — a paused run must stay resumable.
      const meta = r.metadata as {
        awaitingApprovalFor?: { gateId: string };
        terminatedBy?: string;
      };
      expect(meta.awaitingApprovalFor?.gateId).toBe("g1");
      expect(meta.terminatedBy).toBe("end_turn");
    });

    it("adaptive shape: an INTERACTION pause relayed via extraMetadata is fenced too", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            strategy: "adaptive",
            output: "Run paused — awaiting your input.",
            requiredTools: ["file-write"],
            steps: [],
            extraMetadata: {
              awaitingInteractionFor: {
                interactionId: "i1",
                kind: "text",
                prompt: "Which file?",
                schemaJson: "{}",
              },
            },
          }),
          buildRunEnvelope({ fabricationGuard: "block" }),
        ),
      );
      expect(r.metadata.verdict?.enforced).toBe(false);
      expect(r.status).toBe("completed");
      expect(r.output).toBe("Run paused — awaiting your input.");
    });

    // ── Enforced terminal coherence (review fix 2) ───────────────────────────
    //
    // The enforced re-mint spreads `...params`, so a relayed
    // `extraMetadata.terminatedBy: "final_answer"` used to survive the flip:
    // `status:"failed"` beside `terminatedBy:"final_answer"`, which
    // `resolveGoalAchieved` (runtime/src/builder/helpers.ts) maps to `true` and
    // `local-learning.ts` counts as a non-failure. An enforced honest
    // abstention reported SUCCESS downstream.
    it("an ENFORCED result reports the honest terminal, never a success-shaped terminatedBy", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            requiredTools: ["file-read"],
            steps: [],
            extraMetadata: {
              selectedStrategy: "reactive",
              terminatedBy: "final_answer",
              rawTerminatedBy: "final_answer",
            },
          }),
          buildRunEnvelope({ fabricationGuard: "block" }),
        ),
      );
      expect(r.metadata.verdict?.enforced).toBe(true);
      expect(r.status).toBe("failed");
      const meta = r.metadata as {
        terminatedBy?: string;
        rawTerminatedBy?: string;
        selectedStrategy?: string;
      };
      // `"abstained"` is the legal TerminatedBy literal deriveGoalAchieved maps
      // to `false` — the run honestly declined.
      expect(meta.terminatedBy).toBe("abstained");
      expect(meta.terminatedBy).not.toBe("final_answer");
      expect(meta.rawTerminatedBy).toBe("abstained");
      // Everything else the strategy relayed is untouched.
      expect(meta.selectedStrategy).toBe("reactive");
    });

    it("a NON-enforced result keeps its relayed terminatedBy verbatim", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            requiredTools: ["file-read"],
            steps: [],
            extraMetadata: { terminatedBy: "final_answer", rawTerminatedBy: "final_answer" },
          }),
          buildRunEnvelope({ fabricationGuard: "warn" }),
        ),
      );
      expect(r.metadata.verdict?.enforced).toBe(false);
      const meta = r.metadata as { terminatedBy?: string; rawTerminatedBy?: string };
      expect(meta.terminatedBy).toBe("final_answer");
      expect(meta.rawTerminatedBy).toBe("final_answer");
    });

    // ── "off" is an opt-OUT, not a configuration (review fix 3) ──────────────
    it("fabricationGuard 'off' records NOTHING on `failed` (an opt-out must not arm enforcement)", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            requiredTools: ["file-read"],
            steps: [],
          }),
          buildRunEnvelope({ fabricationGuard: "off" }),
        ),
      );
      // The observation is still computed (it is free and informational)…
      expect(r.metadata.verdict?.groundedOnRequired).toBe(false);
      // …but `failed` is the ENFORCEMENT basis, so an opt-out records nothing.
      expect(r.metadata.verdict?.failed).toEqual([]);
      expect(r.metadata.verdict?.enforced).toBe(false);
      expect(r.status).toBe(baseParams.status);
      expect(r.output).toBe(baseParams.output);
    });

    // ── The load-bearing property, asserted STRUCTURALLY ─────────────────────
    //
    // The per-field checks above can only catch what they name. This one diffs
    // the WHOLE metadata object against `buildStrategyResult`'s, so any future
    // enforcement-path field (like Fix 2's `terminatedBy` override) that leaks
    // into the zero-config path fails here even though no test mentions it.
    // `duration` is wall-clock and `verdict` is the one sanctioned addition.
    it("zero-config: the mint is byte-identical to buildStrategyResult (whole-metadata diff)", async () => {
      const params = {
        ...baseParams,
        strategy: "adaptive" as const,
        requiredTools: ["file-read"],
        extraMetadata: {
          selectedStrategy: "reactive",
          terminatedBy: "final_answer",
          rawTerminatedBy: "final_answer",
        },
      };
      const plain = buildStrategyResult(params);
      const strip = (m: Record<string, unknown>): Record<string, unknown> => {
        const { verdict: _verdict, duration: _duration, ...rest } = m;
        return rest;
      };
      // Both "no RunEnvelope in context" and "an envelope with nothing set".
      for (const envelope of [undefined, buildRunEnvelope({})]) {
        const judged = await Effect.runPromise(
          provideTestEnvelope(finalizeStrategyResult(params), envelope),
        );
        expect(judged.status).toBe(plain.status);
        expect(judged.output).toBe(plain.output);
        expect(judged.error).toBe(plain.error);
        expect(JSON.stringify(strip(judged.metadata as Record<string, unknown>))).toBe(
          JSON.stringify(strip(plain.metadata as Record<string, unknown>)),
        );
        // Additive only, and inert: nothing recorded without a guard.
        expect(judged.metadata.verdict).toEqual({
          enforced: false,
          groundedOnRequired: false,
          failed: [],
        });
      }
    });
  });

  describe("contract judgment — informational in Task 8 (records, never flips)", () => {
    const CONTRACT: TaskContract = {
      prompt: "Add the numbers",
      tools: [{ kind: "required", name: "add" }],
      success: { type: "regex", pattern: "5" },
    };
    const addSucceeded: RunLedger = [
      {
        kind: "tool-result",
        seq: 0,
        iteration: 0,
        toolName: "add",
        success: true,
        preview: "5",
      },
    ];
    const addFailed: RunLedger = [
      {
        kind: "tool-result",
        seq: 0,
        iteration: 0,
        toolName: "add",
        success: false,
        preview: "boom",
      },
    ];

    it("declared contract + ledger evidence satisfying it ⇒ contractSatisfied: true", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({ ...baseParams, runLedger: addSucceeded }),
          buildRunEnvelope({ taskContract: CONTRACT }),
        ),
      );
      expect(r.metadata.verdict?.contractSatisfied).toBe(true);
      expect(r.metadata.verdict?.enforced).toBe(false);
    });

    it("declared contract + no satisfying evidence ⇒ contractSatisfied: false, still NOT enforced", async () => {
      // THE scope line for Task 8: the contract wither alone stays
      // informational. This run is GROUNDED (the required `add` succeeded), so
      // the guard has no grounding failure to act on — yet the contract's
      // declared output section is missing. `contractSatisfied: false` is
      // recorded and NOTHING flips. Widening enforcement to the contract is a
      // separate, gated decision, not a side effect of recording it.
      const groundedAdd = makeStep("observation", "added the numbers", {
        observationResult: makeObservationResult("add", true, "5"),
      });
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            steps: [groundedAdd],
            runLedger: addSucceeded,
          }),
          buildRunEnvelope({
            taskContract: { ...CONTRACT, outputShape: { mustInclude: ["Appendix Z"] } },
            fabricationGuard: "block",
          }),
        ),
      );
      expect(r.metadata.verdict?.groundedOnRequired).toBe(true);
      expect(r.metadata.verdict?.contractSatisfied).toBe(false);
      expect(r.metadata.verdict?.enforced).toBe(false);
      expect(r.metadata.verdict?.failed).toEqual([]);
      expect(r.status).toBe("completed");
      expect(r.output).toBe(baseParams.output);
    });

    it("a FAILED required-tool call in the ledger ⇒ contractSatisfied: false", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({ ...baseParams, runLedger: addFailed }),
          buildRunEnvelope({ taskContract: CONTRACT }),
        ),
      );
      expect(r.metadata.verdict?.contractSatisfied).toBe(false);
      expect(r.metadata.verdict?.enforced).toBe(false);
    });

    it("no contract declared ⇒ contractSatisfied absent (zero-config: nothing computed)", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(finalizeStrategyResult({ ...baseParams, runLedger: addFailed })),
      );
      expect(r.metadata.verdict?.contractSatisfied).toBeUndefined();
    });
  });

  describe("wrapped invariants must survive the mint (Fix 5)", () => {
    it("HS-106 output/status coherence: empty output + status:'completed' comes back 'failed'", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            output: "",
            status: "completed",
          }),
        ),
      );
      expect(r.status).toBe("failed");
    });

    it("pause-rail forwarding: a pause carried via `pause` surfaces awaitingApprovalFor on metadata", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            output: "Run paused — awaiting human approval.",
            pause: {
              reason: "awaiting-approval",
              output: "Run paused — awaiting human approval.",
              awaitingApprovalFor: { gateId: "g1", toolName: "file-write", args: {} },
            },
          }),
        ),
      );
      const meta = r.metadata as {
        awaitingApprovalFor?: { gateId: string; toolName: string; args: unknown };
      };
      expect(meta.awaitingApprovalFor).toEqual({
        gateId: "g1",
        toolName: "file-write",
        args: {},
      });
    });

    it("pause-rail forwarding: a pause carried via `kernelMeta` surfaces awaitingInteractionFor on metadata", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            output: "Run paused — awaiting user input.",
            kernelMeta: {
              awaitingInteractionFor: {
                interactionId: "i1",
                kind: "form",
                prompt: "Pick one",
                schemaJson: "{}",
              },
            },
          }),
        ),
      );
      const meta = r.metadata as {
        awaitingInteractionFor?: {
          interactionId: string;
          kind: string;
          prompt: string;
          schemaJson: string;
        };
      };
      expect(meta.awaitingInteractionFor).toEqual({
        interactionId: "i1",
        kind: "form",
        prompt: "Pick one",
        schemaJson: "{}",
      });
    });
  });
});
