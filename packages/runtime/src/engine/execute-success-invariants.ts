/**
 * Success derivation + engine-boundary honesty invariants.
 *
 * Owns: the `terminatedByRaw` extraction (with its DEBT-REGISTER §3
 * canonical-TerminatedBy binding), the ctx.metadata termination passthrough,
 * the observed-dialect extraction, the coarse `executionSucceeded` bit
 * (status/partial tolerance lane), the F7 abstention veto, the W5 outstanding
 * contract veto, and the M7-mirror empty-output/deliverable-honesty invariant
 * (declared-deliverable scan, harness-authored completion note, F1
 * "talking is not doing" veto).
 *
 * Writes the honesty markers onto ctx.metadata exactly as the inline code did
 * (shared object identity — the ctx instance is the engine's own).
 *
 * Moved verbatim from execution-engine.ts (GH #221 W26 decomposition, former
 * terminatedBy/success/invariants block lines 1161-1330).
 */
import type { Task, TerminatedBy } from "@reactive-agents/core";
import type { ExecutionContext, ReactiveAgentsConfig } from "../types.js";
import { deriveReceiptDeliverables } from "../builder/helpers.js";
import { readRunLedger } from "./run-ledger-scope.js";

/** Shape of the reasoning result stored in ctx.metadata.reasoningResult. */
type ReasoningResultLike = ExecutionContext["metadata"]["reasoningResult"];

export interface SuccessInvariantsDeps {
  readonly ctx: ExecutionContext;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
  readonly rr: ReasoningResultLike;
  readonly hasSubstantiveOutput: boolean;
  readonly outputForSuccess: string;
}

export interface SuccessInvariantsResult {
  readonly terminatedByRaw: TerminatedBy;
  readonly dialectObserved:
    | "native-fc"
    | "fenced-json"
    | "pseudo-code"
    | "nameless-shape"
    | "none";
  readonly executionSucceeded: boolean;
  readonly emptyOutputCompletionNote: string | undefined;
}

export function deriveExecutionSuccess(
  deps: SuccessInvariantsDeps,
): SuccessInvariantsResult {
  const { ctx, task, config, rr, hasSubstantiveOutput, outputForSuccess } = deps;

  // Extract terminatedBy from reasoning metadata, with fallback inference.
  //
  // DEBT-REGISTER §3 (2026-07-23): this cast used to name a
  // hand-written 5-value union that OMITTED "abstained" (and any
  // future TerminatedBy member). The runtime value passed through
  // fine — `ctx.metadata.terminatedBy` is assigned raw below — but
  // every downstream typed read was told an abstention could not
  // occur, months after `.withFabricationGuard()` made it a routine
  // terminal. Now bound to core's canonical `TerminatedBy`, so a
  // new member is a compile error here rather than a silent lie.
  const terminatedByRaw = (rr?.metadata?.terminatedBy ?? "end_turn") as TerminatedBy;

  // Surface the parallel raw kernel termination reason on ctx so
  // run-finalize can publish it as AgentCompleted.terminationReason.
  // Falls back to terminatedByRaw when the strategy didn't preserve
  // the raw channel (legacy strategies).
  ctx.metadata.terminatedBy = terminatedByRaw;
  if (rr?.metadata?.rawTerminatedBy !== undefined) {
    ctx.metadata.rawTerminatedBy = rr.metadata.rawTerminatedBy;
  }

  // Extract dialect from reasoning metadata (set by Task 13 resolver threading)
  const dialectObserved = ((rr?.metadata as { lastDialectObserved?: string } | undefined)?.lastDialectObserved ?? "none") as
    "native-fc" | "fenced-json" | "pseudo-code" | "nameless-shape" | "none";

  // Reactive strategy often reports partial + max_iterations whenever the kernel did not
  // reach state "done", even if the last LLM turn produced a usable string. Treat
  // completed, or partial with non-empty output, as success; empty partial as failure.
  let executionSucceeded =
    rr !== undefined && typeof rr.status === "string"
      ? rr.status === "failed" || rr.status === "error"
        ? false
        : rr.status === "completed" ||
          (rr.status === "partial" && hasSubstantiveOutput)
      : Boolean(ctx.metadata.isComplete);

  // F7 (2026-07-28): an ABSTENTION is not a success. The kernel
  // reports `status: "completed"` for a forced abstention — the
  // decline completed cleanly — so this landed on `true` and the
  // run published `AgentCompleted.success: true` and a trace
  // `run-completed.status: "success"` for a run that delivered
  // nothing and said so.
  //
  // `deriveRunOutcome` has mapped `abstained -> "failure"` since
  // 2026-07-23 precisely so the learning loop is not taught that
  // declining is a win — but that classifier governs the debrief
  // and learning lanes only. The terminal status was a separate,
  // disagreeing rule, so the gate lane (testing/src/gate/runner.ts
  // reads run-completed.status) still scored abstentions as
  // successes. Same dishonest-success shape as F1, one lane over.
  //
  // The decline stays HONEST and machine-readable: `terminatedBy`
  // is "abstained" and `result.abstention` carries reason +
  // missing. Only the coarse success bit changes.
  if (executionSucceeded && terminatedByRaw === "abstained") {
    executionSucceeded = false;
    ctx.metadata.abstainedNotSuccess = true;
  }

  // W5 fold (kernel review Important 2): an OUTSTANDING contract
  // requirement is not a success, whatever the coarse status bit
  // says. The W5.1 coverage cap caps the terminal STATUS at
  // `partial` + stamps `metadata.outstandingCriteria`, but the
  // pre-existing partial+substantive TOLERANCE lane above maps
  // that partial to `success: true`, so the S3 false-success
  // survived on the user-visible bit ("S3 false-success -> 0"
  // was only true on the verdict lane). Resolved invariant
  // (envelope-authority, NOT blanket partial=>false): a terminal
  // whose evidence partition still names outstanding/blocked
  // requirements cannot claim success; an uncapped partial with
  // nothing outstanding keeps the documented tolerance lane
  // byte-identical, and `completed` is unchanged. Mirrors the
  // abstention veto above: same lane, one bit over.
  const outstandingAtTerminal = rr?.metadata?.outstandingCriteria;
  if (
    executionSucceeded &&
    Array.isArray(outstandingAtTerminal) &&
    outstandingAtTerminal.length > 0
  ) {
    executionSucceeded = false;
    ctx.metadata.outstandingContractNotSuccess = true;
  }

  // ── Engine-boundary output/success invariant (M7's engine
  // mirror, 2026-07-11 probe fleet). The inline path derived
  // success from isComplete alone, shipping success:true with
  // EMPTY output (p10 second run, p5 rerun). Empty-output
  // success is honest ONLY when every DECLARED deliverable
  // verifiably landed — the artifacts are the answer, and a
  // deterministic completion note (marked harness-authored, #40
  // channel) replaces the silence. Otherwise it is a failure
  // with a real cause. Deliverable flags come from the
  // RunContract × step-ledger scan — no model judgment.
  let emptyOutputCompletionNote: string | undefined;
  // Task 3 (2026-08-14): this deliverable-honesty scan used to run
  // ONLY when `executionSucceeded` was already true — but a plain
  // empty final turn with no tool artifacts already forces
  // `executionSucceeded = false` above (HS-106's output/status
  // coherence guard flips a strategy result to `status:"failed"`
  // the moment output is empty, independent of WHY it's empty), so
  // the richer "no output and no verified deliverable" diagnosis
  // below never ran and the generic `rr?.error`/"Reasoning failed"
  // fallback at the result-assembly step shipped instead. Widen the
  // gate to also enter when output is empty and the kernel supplied
  // no real failure detail of its own (`rr?.error` empty) — i.e. the
  // ONLY reason this run isn't "succeeded" is the empty output
  // itself, not a genuine kernel/provider error. Additive: does not
  // touch the `executionSucceeded === true` path (test coverage:
  // engine-empty-output-invariant.test.ts's first case), and does
  // not let a real kernel error (rr.error non-empty) be shadowed by
  // this branch — that detail still wins via the `rr?.error` check
  // in the result's `error` field below.
  const emptyOutputNoErrorDetail =
    !hasSubstantiveOutput &&
    !(typeof rr?.error === "string" && rr.error.trim().length > 0);
  if (executionSucceeded || emptyOutputNoErrorDetail) {
    const declaredDeliverables = deriveReceiptDeliverables({
      task: String((task.input as { question?: unknown })?.question ?? task.id),
      ...(config.requiredTools?.tools ? { requiredTools: config.requiredTools.tools } : {}),
      ...(config.taskContract !== undefined ? { taskContract: config.taskContract } : {}),
      reasoningSteps: (ctx.metadata.reasoningSteps ?? []) as import("@reactive-agents/reasoning").ReasoningStep[],
      // Wave C1 (task 6) — same `rr.metadata.runLedger` forwarded
      // onto TaskResult.metadata below (task 5); a ledger
      // `artifact` entry marks a declared deliverable produced
      // without re-scanning reasoningSteps.
      // Wave C.2 — run-scoped (all passes), not just the last one.
      runLedger: readRunLedger(ctx.metadata) ?? rr?.metadata?.runLedger,
      output: hasSubstantiveOutput ? outputForSuccess : "",
    });
    const declared = declaredDeliverables ?? [];
    const allProduced = declared.length > 0 && declared.every((d) => d.produced);

    if (!hasSubstantiveOutput) {
      // Empty output is honest ONLY when every declared deliverable
      // verifiably landed — the artifacts are the answer, and a
      // deterministic completion note (harness-authored, #40
      // channel) replaces the silence.
      if (allProduced) {
        emptyOutputCompletionNote = `Completed: ${declared.map((d) => d.spec).join("; ")}.`;
        ctx.metadata.harnessAuthoredOutput = true;
      } else {
        executionSucceeded = false;
        ctx.metadata.emptyOutputFailure = true;
      }
    } else if (declared.length > 0 && !allProduced) {
      // ── F1 (2026-07-28): TALKING IS NOT DOING. ──────────────
      // This check used to run ONLY when output was empty, so a
      // run that produced PROSE skipped deliverable verification
      // entirely and shipped `success`. Measured on the default
      // path, haiku, 3/3 runs plus a 4th confirmation: the agent
      // dispatched ZERO tools, wrote no file, replied
      // "I don't have the ability to read files directly", and the
      // run reported status=success with a declared deliverable
      // (./avg.txt) that never existed.
      //
      // That is the framework's own moat failing where most users
      // are — 08 §0 names in-runtime verification as the #1 unmet
      // need, and the trust spine returned success for a run that
      // did nothing. Same family as the abstention chain, where an
      // honest decline was scored success at four sites.
      //
      // A declared deliverable is a CONTRACT, and prose is not a
      // substitute for it. Blast radius is bounded by construction:
      // `deriveReceiptDeliverables` returns [] when nothing is
      // declared (no requiredTools, no taskContract, no artifact
      // phrasing), so tasks that declare nothing are untouched.
      executionSucceeded = false;
      ctx.metadata.unproducedDeliverableFailure = true;
    }
  }

  return { terminatedByRaw, dialectObserved, executionSucceeded, emptyOutputCompletionNote };
}
