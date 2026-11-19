// File: src/strategies/substrate/strategy-run.ts
/**
 * Strategy run substrate: one trajectory per strategy run.
 *
 * A strategy run is a trajectory (steps, spend, one run ledger, the completion
 * envelopes of its passes, a pause) plus control flow (what to do next).
 * `runStrategy` owns the trajectory and the one terminal every strategy
 * shares; the strategy body owns only its control flow. Before this, every
 * strategy re-implemented the accounting (`totalTokens +=`, `llmCalls +=`),
 * the pause short-circuit, the ledger merge, the worst-of status cap and the
 * kernel-terminal relay, and each harness fix had to be wired into each copy.
 *
 * These behaviors are the ONLY behavior, never per-strategy options:
 *   - every kernel pass's ledger facts accumulate into one run ledger;
 *   - every contributing pass's completion envelope caps the claimed status;
 *   - a paused pass ends the run with the paused result (a deferred pause, for
 *     concurrent passes, ends it at the next checkpoint or at the terminal);
 *   - relay keys (terminatedBy, runLedger, abstention, honesty markers) are
 *     derived here and cannot be overwritten by strategy extras.
 *
 * Spec: wiki/Architecture/Design-Specs/2026-11-04-strategy-run-substrate.md
 */
import { Data, Effect, Ref } from "effect";
import type { CompletionResponse } from "@reactive-agents/llm-provider";
import { LLMService } from "@reactive-agents/llm-provider";
import { ExecutionError } from "../../errors/errors.js";
import { STRATEGY_ERROR_TERMINATOR } from "../../kernel/state/terminal-authority.js";
import type { ReasoningMetadata, ReasoningStatus, ReasoningStep } from "../../types/index.js";
import { gatewayComplete, type GatewayRequest, type LlmCallIntent } from "../../kernel/llm-gateway.js";
import { runPass, type PassResult } from "../../kernel/loop/run-pass.js";
import { deriveTerminatedBy } from "../../kernel/loop/react-kernel.js";
import { unfinishedEvidence } from "../../kernel/loop/exit-gate.js";
import { kernelPause, type KernelPause } from "../../kernel/capabilities/sense/step-utils.js";
import { reachesDomainTool } from "../../kernel/capabilities/sense/give-up-answer.js";
import {
  finalizePausedStrategyResult,
  finalizeStrategyResult,
  type JudgedReasoningResult,
  type RepairCapabilities,
  type StrategyDelivery,
  type StrategyTerminalInput,
} from "../../kernel/capabilities/sense/finalize-result.js";
import { RunEnvelope } from "../../kernel/envelope/run-envelope.js";
import { makeToolCallBudget, type ToolCallBudget } from "../../kernel/capabilities/decide/tool-call-budget.js";
import { runToolCallCounts } from "../../kernel/capabilities/decide/run-tool-call-counts.js";
import { rootContext } from "@reactive-agents/core";
import type { Plan as CorePlan } from "@reactive-agents/core";
import { ensureRunScope } from "@reactive-agents/core/internal/run-scope";
import {
  capStatusToEnvelope,
  capStatusUnderVerdict,
  envelopeFromKernelState,
  honestEnvelopeMetadata,
  honestPartialMetadata,
  joinEnvelopes,
  resolveCompletionStatus,
  type CompletionEnvelope,
  type StatusCapRecord,
  type StrategyDeliveryVerdict,
} from "../../kernel/state/completion-envelope.js";
import { tallySignals } from "../../kernel/state/signal-ledger.js";
import { actOrAnswerTally, sumActOrAnswerTally, type ActOrAnswerTally } from "../../kernel/capabilities/reason/act-or-answer-tally.js";
import type { KernelInput, KernelRunOptions, KernelState, ThoughtKernel } from "../../kernel/state/kernel-state.js";
import type { LedgerEntry, RunLedger } from "../../kernel/ledger/run-ledger.js";
import type { RunContract } from "../../kernel/contract/run-contract.js";
import "../../kernel/state/pass-seed.js";
import { makeStrategyEmitLog, resolveStrategyServices } from "../../kernel/utils/service-utils.js";
import { growRunLedger, ledgerSinkTarget } from "../../kernel/ledger/ledger-sink.js";
import { resolveRunSpend } from "../budget/run-budget-spend.js";
import type { BudgetSpend } from "../budget/remaining-budget.js";
import { addKnown, contributedHalf } from "../../kernel/utils/known-count.js";
import { usageSpend } from "../../kernel/run-budget.js";
import { passIterationShare, passIterationsUsed, type IterationBudget } from "../budget/iteration-budget.js";
import { defaultReasoningConfig } from "../../types/config.js";
import { PLAN_INCOMPLETE_GUARD, planIncompleteReason, settlePlan, type PlanStepLike } from "../../kernel/policy/plan-completion.js";
import { emitGuardFired } from "../../kernel/utils/diagnostics.js";

/**
 * What a strategy run has spent so far, across kernel passes, direct calls and
 * accounted work. A half is `undefined` (unknown) once any contribution that
 * spent tokens left it unreported (`addKnown` / `contributedHalf`).
 */
export interface StrategySpend {
  readonly tokens: number;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly cost: number;
  readonly llmCalls: number;
}

/**
 * A kernel pass ended on a durable pause (approval or user interaction). It
 * is the run's terminal: `runStrategy` turns it into the paused result, so no
 * strategy can forget the short-circuit or run more passes around it.
 */
export class StrategyPaused extends Data.TaggedError("StrategyPaused")<{
  readonly pause: KernelPause;
}> {}

/** How one kernel pass takes part in the run. */
export interface PassOptions {
  /**
   * Record a pause instead of ending the run immediately. For passes that run
   * concurrently (plan waves): every sibling's steps and spend are recorded,
   * and the run ends on the pause at the next `run.checkpoint` or at the
   * terminal. Default false.
   */
  readonly deferPause?: boolean;
  /**
   * Whether this pass's completion envelope caps the run's claimed status
   * (worst-of). A pass whose output was discarded does not contribute. Default true.
   */
  readonly contributes?: boolean;
  /**
   * Which of the pass's steps join the run's step record. `"all"` (default)
   * for strategies whose answer IS a kernel pass; `"evidence"` keeps only tool
   * evidence (action steps with a toolCall, observations with a result) for
   * strategies that narrate their own attempts, so pass thoughts never
   * masquerade as the strategy's answer.
   */
  readonly record?: "all" | "evidence";
  /**
   * This pass continues the run on the same task (a reflexion improve pass),
   * not a sub-goal. It adopts the run contract an earlier pass compiled and
   * starts from the run ledger so far (`KernelInput.seedRunContract` /
   * `seedRunLedger`), so its requirements and assessment cover the whole run
   * instead of its own prompt. Default false: a pass compiles its own contract.
   */
  readonly continues?: boolean;
}

/**
 * The entries a seeded pass added after its seed. A pass that adopted the seed
 * starts its ledger with the seed's entries (same objects); only what follows
 * is new. A pass that did not adopt it (resumed, already carried a ledger)
 * returns its whole ledger.
 */
export function passLedgerAfterSeed(pass: RunLedger | undefined, seed: RunLedger | undefined): RunLedger | undefined {
  if (pass === undefined || seed === undefined || seed.length === 0 || pass.length < seed.length) return pass;
  return seed.every((entry, i) => pass[i] === entry) ? pass.slice(seed.length) : pass;
}

/** A step that carries tool evidence (the shape isArtifactProduced's linkage scan verifies). */
const isToolEvidence = (step: ReasoningStep): boolean =>
  step.metadata?.toolCall !== undefined || step.metadata?.observationResult !== undefined;

/** The trajectory handle a strategy body drives. */
export interface StrategyRun {
  /** Strategy name, as registered. */
  readonly strategy: StrategyName;
  /** Run/task id used for events and the terminal decision. */
  readonly taskId: string;
  /** `Date.now()` at run start. */
  readonly start: number;
  /** Structured log emitter for this strategy. */
  readonly emitLog: ReturnType<typeof makeStrategyEmitLog>;
  /** Steps recorded so far (live view, in order). */
  readonly steps: () => readonly ReasoningStep[];
  /** Spend this run recorded so far. */
  readonly spend: () => StrategySpend;
  /**
   * Spend resolved against the run-scoped meter when one is armed (#231): the
   * one accounting source strategy budget gates must read, so they agree with
   * the kernel's Arbitrator on the boundary.
   */
  readonly runSpend: () => Effect.Effect<BudgetSpend>;
  /** The one run ledger: every pass's facts, in order, with run-scoped seqs. */
  readonly ledger: () => Effect.Effect<RunLedger>;
  /**
   * The run ledger as a sink, for work that records facts outside a kernel pass:
   * direct tool dispatch (`executeToolAndObserve`'s `ledgerSink`) and the plan
   * checklist. Kernel passes are absorbed into the same ledger, so a run has one
   * ledger source whatever mix of passes and direct work it runs.
   */
  readonly ledgerSink: Ref.Ref<RunLedger>;
  /**
   * The run's direct-dispatch call budget, built once from
   * `RunEnvelope.rails.maxCallsPerTool`. Tool calls made outside a kernel pass
   * (`tool_call` plan steps via `executeToolAndObserve`'s `callBudget`,
   * code-action's sandbox bridge) reserve against it. Kernel passes get the
   * same caps through `runKernel`'s envelope merge, and their tool gate reads
   * and charges the same run-wide count (`run-tool-call-counts.ts`), so a cap
   * holds across every pass and dispatch path of the run.
   */
  readonly toolCallBudget: ToolCallBudget;
  /**
   * Run one kernel pass: records its steps, accounts its spend and calls,
   * absorbs its ledger facts and its completion envelope. A paused pass fails
   * with StrategyPaused unless `deferPause` is set.
   */
  readonly pass: (
    kernel: ThoughtKernel,
    input: KernelInput,
    options: KernelRunOptions,
    passOptions?: PassOptions,
  ) => Effect.Effect<PassResult, StrategyPaused, LLMService>;
  /** End the run here if a deferred pause is pending (after a concurrent wave). */
  readonly checkpoint: () => Effect.Effect<void, StrategyPaused>;
  /**
   * One direct model call (expand, score, critique, plan), accounted like a
   * kernel pass. A provider failure becomes an ExecutionError carrying
   * `onError`. Recovery (retry, compaction) belongs to the gateway, never here.
   */
  readonly call: (
    intent: LlmCallIntent,
    request: GatewayRequest,
    onError: { readonly message: string; readonly step?: number },
  ) => Effect.Effect<CompletionResponse, ExecutionError, LLMService>;
  /**
   * Account work that did not go through `pass` or `call` (a 0-LLM worker, a
   * sandbox, a direct critique/synthesis). Reads only the spend fields, so a
   * result that carries a `TokenSpend` (critique, synthesis, quality gate,
   * plan patch) passes as is. Spend from an LLM response carries its split
   * (`usageSpend`): tokens without halves make the run's halves unknown.
   */
  readonly account: (spend: Partial<StrategySpend>) => void;
  /** Record strategy-authored steps (control notes, scored candidates). */
  readonly record: (...steps: readonly ReasoningStep[]) => void;
  /**
   * The iterations the next kernel pass may use: its share of the run's
   * iteration budget still left (`passIterationShare` over
   * `StrategyRunSpec.iterationBudget`). `passesLeft` counts this pass and every
   * pass that may follow it. Without a spec budget, the default run budget.
   */
  readonly iterationShare: (passesLeft: number) => number;
}

/** Metadata keys the substrate derives; strategy extras may not set them. */
type ReservedRelayKey =
  | "terminatedBy"
  | "rawTerminatedBy"
  | "runLedger"
  | "abstention"
  | "llmCalls"
  | "harnessAuthoredOutput"
  | "budgetTerminalPartial"
  | "verificationWarning"
  | "outstandingCriteria"
  | "statusCap";

/** Strategy-specific result metadata. Relay keys are reserved (type error to set). */
export type StrategyExtras = Readonly<Record<string, unknown>> & {
  readonly [K in ReservedRelayKey]?: never;
};

/**
 * A strategy's own honest non-success, decided by the strategy rather than
 * relayed from a kernel pass. The substrate turns it into the relay fields
 * (strategies cannot set those directly), and either one caps the status at
 * `partial`.
 *
 * - `Abstained`: the strategy refused to claim an answer (e.g. required tools
 *   never ran). Becomes `terminatedBy: "abstained"` plus the `abstention`
 *   descriptor, so the receipt reports an earned abstention.
 * - `BudgetStopped`: the strategy stopped launching work at the run budget.
 *   Becomes `budgetTerminalPartial` + `harnessAuthoredOutput` (only when the
 *   joined output is non-empty), `warning`
 *   appended to the run's verification warning, and `rawTerminatedBy: rawReason`
 *   (e.g. `budget-limit:tokens:1200/1000`).
 * - `Unverified`: the strategy shipped model-authored work its own check did
 *   not verify (code-action's failing verifier verdict at the iteration cap).
 *   Only `warning` is appended (" | ") to the run's verification warning; no
 *   budget, harness-authored or abstention markers are set, and terminatedBy
 *   follows the normal claim rule (`end_turn` for the capped `partial`).
 * - `HarnessJoined`: the model never wrote the answer, so the strategy shipped
 *   the joined step results instead (e.g. blueprint's failed SOLVE call).
 *   Becomes `harnessAuthoredOutput` (only when the output is non-empty) and
 *   `warning` appended to the verification warning; no budget marker.
 * - `PlanOnly`: the strategy was asked for the plan alone (`planOnly`) and
 *   stopped after planning. Becomes `rawTerminatedBy: "plan-only"` and
 *   `planOnly: true`; the optional `warning` (a plan defect) joins the
 *   verification warning. The status is `partial` and nothing is harness-authored.
 * - `StrategyError`: the strategy body failed (an `ExecutionError`: a failed
 *   direct model call, an unparseable plan, a refused config). Set only by
 *   `runStrategy` itself. Becomes `rawTerminatedBy: "strategy_error"` (terminal
 *   authority `strategy-error`); the cause rides `error`, and the status is
 *   `failed`.
 */
export type StrategyOutcome =
  | { readonly _tag: "Abstained"; readonly reason: string; readonly missing: readonly string[] }
  | { readonly _tag: "BudgetStopped"; readonly rawReason: string; readonly warning: string }
  | { readonly _tag: "Unverified"; readonly warning: string }
  | { readonly _tag: "HarnessJoined"; readonly warning: string }
  | { readonly _tag: "PlanOnly"; readonly warning?: string }
  | { readonly _tag: "StrategyError" };

/**
 * How a strategy run ends.
 *
 * - `KernelTerminal`: the last kernel pass is the answer. Output, status,
 *   terminatedBy, abstention and the honesty markers are relayed from it.
 * - `Result`: the strategy computed its own output and status (a critique
 *   loop, a plan solve). `basedOn` names the pass the answer came from, so the
 *   same relay applies; `verdict` is the strategy's own delivery verdict, which
 *   may waive an unmarked partial envelope (never an honesty marker).
 * - `Delegated`: the run handed the task to another strategy (adaptive's
 *   dispatch) whose result is already minted. That result IS the terminal: its
 *   status, output, terminatedBy, abstention, honesty markers, verdict, pause
 *   rails and terminal decision are relayed untouched (no second mint, no
 *   re-cap, no re-claim). The substrate only labels it with this strategy,
 *   prepends this run's own steps and folds this run's own spend (e.g. a
 *   classifier call) into tokens, cost and llmCalls.
 */
export type StrategyEnd =
  | {
      readonly _tag: "KernelTerminal";
      readonly pass: PassResult;
      readonly extraMetadata?: StrategyExtras;
    }
  | {
      readonly _tag: "Delegated";
      readonly result: JudgedReasoningResult;
      readonly extraMetadata?: StrategyExtras;
    }
  | ({
      readonly _tag: "Result";
      readonly output: string | null;
      readonly status: "completed" | "partial" | "failed";
      readonly error?: string | null;
      readonly basedOn?: PassResult;
      readonly verdict?: StrategyDeliveryVerdict;
      readonly outcome?: StrategyOutcome;
      readonly kernelMeta?: KernelState["meta"];
      readonly extraMetadata?: StrategyExtras;
      /** D9: the contract the delivery is judged against, plus the strategy's own exit-gate decision if any (no kernel meta). */
      readonly delivery?: StrategyDelivery;
      /**
       * The plan's steps as the run left them. The terminal records each step's
       * ending (`planSteps`) and, while any step is still open, caps the run at
       * `partial` with a verification warning and a `plan-incomplete` signal
       * (`kernel/policy/plan-completion.ts`). Absent: the strategy has no plan.
       */
      readonly plan?: readonly PlanStepLike[];
      /**
       * The run's final plan in the portable core shape (each step's final
       * status). Rides `metadata.extensions.plan`; only the strategies that own
       * a plan set it.
       */
      readonly corePlan?: CorePlan;
    });

/** The `Result` arm of {@link StrategyEnd}. */
type ResultEnd = Extract<StrategyEnd, { readonly _tag: "Result" }>;

/**
 * The completion invariant on a plan-carrying `Result`: record every step's
 * ending, and with steps still open cap the status at `partial` and add the
 * warning (an `Unverified` outcome, unless the strategy already decided its own).
 */
export function applyPlanInvariant(end: ResultEnd): { readonly end: ResultEnd; readonly open: readonly PlanStepLike[] } {
  if (end.plan === undefined) return { end, open: [] };
  const { steps, open } = settlePlan(end.plan);
  const extraMetadata: StrategyExtras = {
    ...end.extraMetadata,
    planSteps: steps,
    ...(open.length > 0 ? { planIncomplete: { open: open.map((s) => s.id) } } : {}),
  };
  if (open.length === 0) return { end: { ...end, extraMetadata }, open };
  const capped: ResultEnd = {
    ...end,
    extraMetadata,
    ...(end.status === "failed" ? {} : { status: "partial" as const }),
    ...(end.outcome === undefined ? { outcome: { _tag: "Unverified" as const, warning: planIncompleteReason(open) } } : {}),
  };
  return { end: capped, open };
}

/** A registered strategy name, as the result mint records it. */
export type StrategyName = Parameters<typeof finalizeStrategyResult>[0]["strategy"];

/** Per-run settings the shared terminal needs. */
export interface StrategyRunSpec {
  readonly strategy: StrategyName;
  readonly taskId?: string;
  /** Required tools for the terminal grounding verdict. */
  readonly requiredTools?: readonly string[];
  /** Repair capabilities this strategy has. Default: per-iteration repair (kernel-backed). */
  readonly repairCapabilities?: RepairCapabilities;
  /** Source-site tag for the strategy's log emitter. */
  readonly logSite: string;
  /** Agent the run's ledger announcements are attributed to. */
  readonly agentId?: string;
  /**
   * The run's iteration budget, for strategies that run several kernel passes.
   * `run.iterationShare` splits it across passes. A pass that ends at its own
   * share returns its draft and evidence to the strategy; its envelope caps the
   * run at `partial` at worst (`capStatusToEnvelope` never fails a run from a
   * sub-pass envelope), so only the strategy's own verdict can fail it.
   */
  readonly iterationBudget?: IterationBudget;
}

/**
 * Absorb one pass's ledger facts into the run ledger. Strategy passes are one
 * run (not sibling retries), so facts stay primary-pass facts and later
 * requirement statuses supersede earlier ones; only `seq` is re-assigned so
 * the run ledger stays densely indexed.
 */
export function absorbPassLedger(run: RunLedger, pass: RunLedger | undefined): RunLedger {
  if (pass === undefined || pass.length === 0) return run;
  const out: LedgerEntry[] = [...run];
  for (const entry of pass) out.push({ ...entry, seq: out.length });
  return out;
}

/**
 * The metadata every kernel-backed terminal relays across the result boundary.
 * One derivation for every strategy, so a new field reaches all of them.
 * `actOrAnswer` defaults to this pass's counts; `runStrategy` passes the sum
 * over every pass of the run.
 */
export function kernelTerminalMetadata(
  state: KernelState,
  runLedger: RunLedger,
  actOrAnswer: ActOrAnswerTally = actOrAnswerTally(state),
): Record<string, unknown> {
  // The canonical narrowing whitelist (react-kernel.ts): a harness give-up is
  // never relabeled `final_answer`.
  const { terminatedBy, rawTerminatedBy } = deriveTerminatedBy(state);
  const evidence = unfinishedEvidence(state);
  return {
    terminatedBy,
    // The run's canonical tool ledger, so the receipt never falls back to
    // step-scanning.
    runLedger,
    // Honesty fields (warning, harness-authored, budget-terminal). Empty on a clean run.
    ...honestPartialMetadata(state.meta),
    // Open-string channel for reasons outside the closed enum (e.g.
    // "budget-limit:tokens:1/0"); reaches AgentCompleted.terminationReason.
    ...(rawTerminatedBy !== undefined ? { rawTerminatedBy } : {}),
    // `actOrAnswer`: the stall / forced-call counts (calibration learning).
    // `unfinishedEvidence`: the raw tool evidence of a run the exit gate ended
    // unfinished (the harness never writes it up as an answer).
    extensions: {
      signalTally: tallySignals(state.signalLedger ?? []),
      actOrAnswer,
      ...(evidence !== undefined ? { unfinishedEvidence: evidence } : {}),
      // Why a loop guard stopped the run (reason, repeated call, tools done,
      // unfinished rows): lets any run, durable or not, surface a stop summary.
      ...(state.meta.loopStop !== undefined ? { loopStop: state.meta.loopStop } : {}),
    },
    ...(state.meta.finalAnswerCapture !== undefined
      ? { finalAnswerCapture: state.meta.finalAnswerCapture }
      : {}),
    // Present only when the kernel terminated by an earned abstention, so
    // projectAbstention can set receipt.abstained. Pause descriptors are not
    // here: the mint forwards them from `kernelMeta`.
    ...(state.meta.abstention !== undefined ? { abstention: state.meta.abstention } : {}),
    ...(state.meta.lastDialectObserved !== undefined
      ? { lastDialectObserved: state.meta.lastDialectObserved }
      : {}),
    // The full (uncompressed) tool-result store, so external evidence checks
    // (validateCitations) read the corpus the kernel's grounding checks use.
    ...(state.scratchpad.size > 0 ? { scratchpad: Object.fromEntries(state.scratchpad) } : {}),
  };
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * `metadata.extensions` of a Result terminal: the strategy's own extensions
 * joined with the relayed pass extensions (the relay wins a shared key), plus
 * the run's final plan when it has one. Empty when there is nothing to carry.
 */
function joinedExtensions(own: unknown, relayed: unknown, plan: CorePlan | undefined): { readonly extensions?: Readonly<Record<string, unknown>> } {
  const merged = { ...(isRecord(own) ? own : {}), ...(isRecord(relayed) ? relayed : {}), ...(plan !== undefined ? { plan } : {}) };
  return Object.keys(merged).length > 0 ? { extensions: merged } : {};
}

/** What a strategy-decided outcome contributes to the terminal relay. */
interface OutcomeRelay {
  readonly rawTerminatedBy?: string;
  /** Present only on an abstention (it also makes the claim `abstained`). */
  readonly abstention?: { readonly reason: string; readonly missing: readonly string[] };
  readonly markers: Readonly<Record<string, unknown>>;
}

/**
 * The relay fields one strategy outcome sets. A warning is appended (" | ",
 * never clobbering) to the contributing passes' own verification warning.
 * `hasOutput`: the result ships output; a budget stop with nothing joined
 * claims no harness-authored output.
 */
function outcomeRelay(outcome: StrategyOutcome, priorWarning: unknown, hasOutput: boolean): OutcomeRelay {
  const appendWarning = (warning: string): string =>
    [priorWarning, warning].filter((w): w is string => typeof w === "string" && w.length > 0).join(" | ");
  switch (outcome._tag) {
    case "Abstained":
      return { rawTerminatedBy: "abstained", abstention: { reason: outcome.reason, missing: outcome.missing }, markers: {} };
    case "BudgetStopped":
      // The output is harness-joined work cut off by the budget.
      return {
        rawTerminatedBy: outcome.rawReason,
        markers: {
          budgetTerminalPartial: true,
          ...(hasOutput ? { harnessAuthoredOutput: true } : {}),
          verificationWarning: appendWarning(outcome.warning),
        },
      };
    case "Unverified":
      // Model-authored work its check did not verify: the warning, and nothing more.
      return { markers: { verificationWarning: appendWarning(outcome.warning) } };
    case "HarnessJoined":
      // Harness-joined work with no budget stop: the label and the warning.
      return {
        markers: {
          ...(hasOutput ? { harnessAuthoredOutput: true } : {}),
          verificationWarning: appendWarning(outcome.warning),
        },
      };
    case "PlanOnly":
      return {
        rawTerminatedBy: "plan-only",
        markers: { planOnly: true, ...(outcome.warning !== undefined ? { verificationWarning: appendWarning(outcome.warning) } : {}) },
      };
    case "StrategyError":
      return { rawTerminatedBy: STRATEGY_ERROR_TERMINATOR, markers: {} };
  }
}

/**
 * Relay a delegated child strategy's minted result as this run's terminal.
 * Only the label, the step record (this run's steps first) and the spend
 * (child + this run's own) change; every judged field is the child's.
 */
export function relayDelegated(
  strategy: StrategyName,
  start: number,
  steps: readonly ReasoningStep[],
  spend: StrategySpend,
  end: Extract<StrategyEnd, { readonly _tag: "Delegated" }>,
): JudgedReasoningResult {
  const child = end.result;
  const childMeta: Readonly<Record<string, unknown>> = child.metadata;
  const childCalls = typeof childMeta["llmCalls"] === "number" ? childMeta["llmCalls"] : 0;
  const relayedSteps = [...steps, ...child.steps];
  // The child's halves are re-derived below: dropped from the spread so an
  // unknown combined half is absent, not the child's partial figure.
  const { inputTokens: childIn, outputTokens: childOut, ...childRest } = child.metadata;
  const inputTokens = addKnown(contributedHalf(childIn, childRest.tokensUsed), spend.inputTokens);
  const outputTokens = addKnown(contributedHalf(childOut, childRest.tokensUsed), spend.outputTokens);
  const metadata = {
    ...childRest,
    ...end.extraMetadata,
    duration: Date.now() - start,
    tokensUsed: child.metadata.tokensUsed + spend.tokens,
    cost: child.metadata.cost + spend.cost,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    stepsCount: relayedSteps.length,
    llmCalls: childCalls + spend.llmCalls,
  };
  return { ...child, strategy, steps: relayedSteps, metadata };
}

/**
 * Stamp the run's kernel turn count on its result: this run's own passes plus
 * a delegated child's count (relayed in the child's metadata). Unchanged when
 * neither ran a kernel pass. `stepsCount` is never touched.
 */
export function withKernelIterations<R extends { readonly metadata: ReasoningMetadata }>(
  result: R,
  own: number | undefined,
): R {
  const relayed = result.metadata.kernelIterations;
  if (own === undefined && relayed === undefined) return result;
  return { ...result, metadata: { ...result.metadata, kernelIterations: (relayed ?? 0) + (own ?? 0) } };
}

/** One contributing pass's envelope, remembered with its pass for exclusion. */
interface PassEnvelope {
  readonly pass: PassResult;
  readonly envelope: CompletionEnvelope;
}

/** A body failure other than a pause. */
type Unpaused<E> = Exclude<E, Extract<E, StrategyPaused>>;
/** What still escapes `runStrategy`: neither a pause nor an `ExecutionError` (e.g. blueprint's degrade signal). */
type RunFailure<E> = Exclude<Unpaused<E>, Extract<Unpaused<E>, ExecutionError>>;

/**
 * Run a strategy body against one trajectory and close it with the shared
 * terminal: the paused result for a pause, a failed result for a body
 * `ExecutionError`, otherwise the judged mint (`finalizeStrategyResult`) with
 * the accumulated spend, steps, run ledger and the worst-of envelope cap.
 */
export function runStrategy<E, R>(
  spec: StrategyRunSpec,
  body: (run: StrategyRun) => Effect.Effect<StrategyEnd, E, R>,
): Effect.Effect<JudgedReasoningResult, RunFailure<E>, R | LLMService | RunEnvelope> {
  return Effect.gen(function* () {
    const llm = yield* LLMService;
    const taskId = spec.taskId ?? spec.strategy;
    const start = Date.now();
    const steps: ReasoningStep[] = [];
    // Tool evidence a strategy recorded itself (no kernel pass ran it): the
    // substrate projects it into the run ledger once, at the terminal.
    const recordedEvidence: ReasoningStep[] = [];
    let spend: StrategySpend = { tokens: 0, inputTokens: 0, outputTokens: 0, cost: 0, llmCalls: 0 };
    const ledgerRef = yield* Ref.make<RunLedger>([]);
    // Over the run's one call count, the count every kernel pass's gate reads and charges.
    const toolCallBudget = makeToolCallBudget((yield* RunEnvelope).rails.maxCallsPerTool, (yield* runToolCallCounts) ?? undefined);
    // The run contract: compiled by the first pass, adopted by every continuing pass.
    let runContract: RunContract | undefined;
    const envelopes: PassEnvelope[] = [];
    // Every pass's act-or-answer counts (contributing or not): the run relays their sum.
    const actOrAnswerTallies: ActOrAnswerTally[] = [];
    let pendingPause: KernelPause | undefined;
    // Iterations every kernel pass of this run used (the run's iteration budget draw).
    let iterationsSpent = 0;
    // Kernel turns (`state.iteration`) summed over passes; undefined until a pass runs.
    let kernelIterations: number | undefined;
    // Whether any kernel pass offered a domain tool; undefined until a pass runs.
    let toolsVisible: boolean | undefined;

    const add = (s: Partial<StrategySpend>): void => {
      spend = {
        tokens: spend.tokens + (s.tokens ?? 0),
        inputTokens: addKnown(spend.inputTokens, contributedHalf(s.inputTokens, s.tokens)),
        outputTokens: addKnown(spend.outputTokens, contributedHalf(s.outputTokens, s.tokens)),
        cost: spend.cost + (s.cost ?? 0),
        llmCalls: spend.llmCalls + (s.llmCalls ?? 0),
      };
    };

    const run: StrategyRun = {
      strategy: spec.strategy,
      taskId,
      start,
      emitLog: makeStrategyEmitLog(spec.logSite),
      steps: () => steps,
      spend: () => spend,
      runSpend: () => resolveRunSpend({ tokens: spend.tokens, cost: spend.cost }),
      ledger: () => Ref.get(ledgerRef),
      ledgerSink: ledgerRef,
      toolCallBudget,
      pass: (kernel, input, options, passOptions) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(ledgerRef);
          const seed = passOptions?.continues === true && current.length > 0 ? current : undefined;
          const seeded: KernelInput = passOptions?.continues !== true ? input : {
            ...input,
            ...(runContract !== undefined && input.seedRunContract === undefined ? { seedRunContract: runContract } : {}),
            ...(seed !== undefined && input.seedRunLedger === undefined ? { seedRunLedger: seed } : {}),
          };
          toolsVisible = toolsVisible === true || reachesDomainTool(seeded);
          const result = yield* runPass(kernel, seeded, options);
          runContract = runContract ?? result.state.meta.runContract;
          actOrAnswerTallies.push(actOrAnswerTally(result.state));
          steps.push(...(passOptions?.record === "evidence" ? result.steps.filter(isToolEvidence) : result.steps));
          add({
            tokens: result.tokens,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            cost: result.cost,
            llmCalls: result.state.llmCalls ?? 0,
          });
          yield* Ref.update(ledgerRef, (l) => absorbPassLedger(l, passLedgerAfterSeed(result.state.ledger, seeded.seedRunLedger)));
          iterationsSpent += passIterationsUsed(result.state);
          kernelIterations = (kernelIterations ?? 0) + result.state.iteration;
          if (passOptions?.contributes !== false) {
            envelopes.push({ pass: result, envelope: envelopeFromKernelState(result.state) });
          }
          const pause = kernelPause(result.state);
          if (pause !== undefined) {
            if (passOptions?.deferPause === true) {
              pendingPause = pendingPause ?? pause;
            } else {
              return yield* Effect.fail(new StrategyPaused({ pause }));
            }
          }
          return result;
        }),
      checkpoint: () =>
        pendingPause === undefined ? Effect.void : Effect.fail(new StrategyPaused({ pause: pendingPause })),
      call: (intent, request, onError) =>
        gatewayComplete(llm, intent, request).pipe(
          Effect.mapError(
            (cause) =>
              new ExecutionError({
                strategy: spec.strategy,
                message: onError.message,
                ...(onError.step !== undefined ? { step: onError.step } : {}),
                cause,
              }),
          ),
          Effect.tap((response) =>
            Effect.sync(() => add({ ...usageSpend(response.usage), llmCalls: 1 })),
          ),
        ),
      account: (more) => add(more),
      record: (...more) => {
        steps.push(...more);
        recordedEvidence.push(...more.filter(isToolEvidence));
      },
      iterationShare: (passesLeft) =>
        passIterationShare(
          spec.iterationBudget ?? { run: defaultReasoningConfig.strategies.reactive.maxIterations },
          iterationsSpent,
          passesLeft,
        ),
    };

    /** The one terminal input: every fact the mint judges on, built here and nowhere else. */
    const terminalInput = (ledger: RunLedger): StrategyTerminalInput => ({
      taskId,
      requiredTools: spec.requiredTools ?? [],
      runLedger: ledger,
      repairCapabilities: spec.repairCapabilities ?? { perIteration: true },
      // Tool evidence a strategy recorded outside a pass means tools were in play.
      ...(toolsVisible !== undefined ? { toolsVisible: toolsVisible || recordedEvidence.length > 0 } : {}),
    });
    const totals = () => ({
      start,
      totalTokens: spend.tokens,
      totalInputTokens: spend.inputTokens,
      totalOutputTokens: spend.outputTokens,
      totalCost: spend.cost,
    });
    /** Worst-of envelope over contributing passes, optionally excluding the answering pass. */
    const joined = (exclude?: PassResult): CompletionEnvelope =>
      joinEnvelopes(envelopes.filter((e) => e.pass !== exclude).map((e) => e.envelope));

    const paused = (pause: KernelPause) =>
      Ref.get(ledgerRef).pipe(Effect.flatMap((ledger) => finalizePausedStrategyResult({
        strategy: spec.strategy,
        steps,
        pause,
        ...totals(),
        ...terminalInput(ledger),
        extraMetadata: { llmCalls: spend.llmCalls, runLedger: ledger },
      })));

    /** The plan completion invariant (`applyPlanInvariant`), then the mint; open steps raise `plan-incomplete`. */
    const terminal = (end: StrategyEnd, ledger: RunLedger): Effect.Effect<JudgedReasoningResult, never, RunEnvelope> => {
      if (end._tag !== "Result" || end.plan === undefined || pendingPause !== undefined) return mint(end, ledger);
      const planned = applyPlanInvariant(end);
      const minted = mint(planned.end, ledger);
      return planned.open.length === 0
        ? minted
        : emitGuardFired({
            taskId,
            iteration: 0,
            guard: PLAN_INCOMPLETE_GUARD,
            outcome: "warn",
            reason: planIncompleteReason(planned.open),
            metadata: { open: planned.open.map((s) => s.id), strategy: spec.strategy },
          }).pipe(Effect.zipRight(minted));
    };

    const mint = (end: StrategyEnd, ledger: RunLedger): Effect.Effect<JudgedReasoningResult, never, RunEnvelope> => {
      if (pendingPause !== undefined) return paused(pendingPause);
      if (end._tag === "Delegated") return Effect.succeed(relayDelegated(spec.strategy, start, steps, spend, end));
      if (end._tag === "KernelTerminal") {
        // The answering pass's own status law, capped by every OTHER
        // contributing pass (single-pass strategies: unchanged).
        const status = capStatusToEnvelope(resolveCompletionStatus(end.pass.state), joined(end.pass));
        return finalizeStrategyResult({
          strategy: spec.strategy,
          steps,
          output: end.pass.output,
          status,
          error: end.pass.state.error,
          ...totals(),
          ...terminalInput(ledger),
          kernelMeta: end.pass.state.meta,
          extraMetadata: {
            ...end.extraMetadata,
            ...kernelTerminalMetadata(end.pass.state, ledger, sumActOrAnswerTally(actOrAnswerTallies)),
            llmCalls: spend.llmCalls,
          },
        });
      }
      const envelope = joined();
      // 1. Status. A strategy-decided outcome is an honest non-success, judged
      //    at `partial` without the cap machinery (nothing to waive); otherwise
      //    the strategy's verdict (or the plain worst-of envelope) caps it.
      const capped: { readonly status: ReasoningStatus; readonly cap?: StatusCapRecord } =
        end.outcome !== undefined
          ? { status: end.status === "failed" ? "failed" : "partial" }
          : end.verdict !== undefined
            ? capStatusUnderVerdict(end.status, envelope, end.verdict)
            : { status: capStatusToEnvelope(end.status, envelope) };
      // 2. Honesty markers of the contributing passes (dropped when the
      //    strategy's verified delivery waived an unmarked partial). Under the
      //    strategy's own verdict a pass's outstanding criteria are step-scoped
      //    (N5): the run's own contract coverage decides at finalize.
      const { outstandingCriteria: _stepScoped, ...runScoped } = envelope;
      const envelopeMeta = capped.cap?.capped === false ? {} : honestEnvelopeMetadata(end.verdict !== undefined ? runScoped : envelope);
      // 3. Pass relay: the answering pass, else the last contributing pass,
      //    names the raw reason (e.g. a step kernel's budget-limit string). Only
      //    an answering pass can carry an abstention.
      const relayPass = end.basedOn ?? envelopes[envelopes.length - 1]?.pass;
      const relayTb = relayPass !== undefined ? deriveTerminatedBy(relayPass.state) : undefined;
      const passAbstained = end.basedOn !== undefined && relayTb?.terminatedBy === "abstained";
      // 4. The strategy's own outcome overrides the pass relay.
      const own = end.outcome !== undefined
        ? outcomeRelay(end.outcome, envelopeMeta.verificationWarning, (end.output ?? "").trim().length > 0)
        : undefined;
      const rawTerminatedBy = own?.rawTerminatedBy ?? relayTb?.rawTerminatedBy;
      const abstention = own?.abstention ?? (passAbstained ? end.basedOn?.state.meta.abstention : undefined);
      // 5. The claim: an honest abstention wins; otherwise `final_answer` iff
      //    the capped status is `completed`, so goalAchieved and success never
      //    contradict.
      const claim = {
        terminatedBy: own?.abstention !== undefined || passAbstained
          ? "abstained"
          : capped.status === "completed" ? "final_answer" : "end_turn",
        ...(rawTerminatedBy !== undefined ? { rawTerminatedBy } : {}),
        ...(abstention !== undefined ? { abstention } : {}),
      };
      const relay: Record<string, unknown> = end.basedOn !== undefined
        ? kernelTerminalMetadata(end.basedOn.state, ledger, sumActOrAnswerTally(actOrAnswerTallies))
        : { runLedger: ledger, ...(actOrAnswerTallies.length > 0 ? { extensions: { actOrAnswer: sumActOrAnswerTally(actOrAnswerTallies) } } : {}) };
      const relayExtensions = relay.extensions;
      return finalizeStrategyResult({
        strategy: spec.strategy,
        steps,
        output: end.output,
        status: capped.status,
        ...(end.error !== undefined ? { error: end.error } : {}),
        ...totals(),
        ...terminalInput(ledger),
        ...(end.kernelMeta !== undefined ? { kernelMeta: end.kernelMeta } : {}),
        ...(end.delivery !== undefined ? { delivery: end.delivery } : {}),
        extraMetadata: {
          ...end.extraMetadata,
          // A strategy-computed Result with no answering pass (plan-execute)
          // still relays the run's act-or-answer sum when any pass ran.
          ...relay,
          ...claim,
          ...envelopeMeta,
          ...own?.markers,
          // The relay's `extensions` replaced the strategy's own above: join them, plus the final plan.
          ...joinedExtensions(end.extraMetadata?.extensions, relayExtensions, end.corePlan),
          ...(capped.cap !== undefined ? { statusCap: capped.cap } : {}),
          llmCalls: spend.llmCalls,
        },
      });
    };

    const isPaused = (err: E): err is Extract<E, StrategyPaused> => err instanceof StrategyPaused;
    const isBodyError = (err: Unpaused<E>): err is Extract<Unpaused<E>, ExecutionError> =>
      typeof err === "object" && err !== null && (err as { readonly _tag?: unknown })._tag === "ExecutionError";

    // A failed body (audit G2, 2026-11-18) ends on the one shared terminal,
    // like every other run: a failed result minted with the run's steps, spend and ledger
    // so far, the cause on `error` (same text the runtime used to build from
    // the escaped error), and a `terminal_decision` with authority
    // `strategy-error`. Before this the error escaped with none of them.
    const bodyFailed = (err: ExecutionError) =>
      settledLedger.pipe(Effect.flatMap((ledger) => terminal({
        _tag: "Result",
        output: "",
        status: "failed",
        error: `Strategy execution failed (${spec.strategy}): ${err.message.split("\n")[0]?.trim() ?? ""}`,
        outcome: { _tag: "StrategyError" },
      }, ledger)));

    // Recorded tool evidence joins the ledger unless its call is already there
    // (a direct dispatch through `ledgerSink` recorded it). It carries no
    // kernel iteration, so it is labelled 0.
    const settledLedger = Effect.gen(function* () {
      const ledger = yield* Ref.get(ledgerRef);
      const known = new Set(ledger.flatMap((e) => ("toolCallId" in e && e.toolCallId !== undefined ? [e.toolCallId] : [])));
      const fresh = recordedEvidence.filter((s) => {
        const id = s.metadata?.toolCallId ?? s.metadata?.toolCall?.id;
        return id === undefined || !known.has(id);
      });
      if (fresh.length === 0) return ledger;
      const { eventBus } = yield* resolveStrategyServices;
      return yield* growRunLedger(ledger, fresh, 0, ledgerSinkTarget(eventBus, taskId, spec.agentId, `${spec.logSite}:announce-ledger`));
    });

    return yield* body(run).pipe(
      Effect.flatMap((end) => settledLedger.pipe(Effect.flatMap((ledger) => terminal(end, ledger)))),
      Effect.catchIf(isPaused, (p) => paused(p.pause)),
      Effect.catchIf(isBodyError, bodyFailed),
      Effect.map((result) => withKernelIterations(result, kernelIterations)),
    );
  }).pipe(
    // A strategy run is a run: called directly (not through ReasoningService),
    // it opens its own run scope, so its passes and direct dispatch still share
    // one run state (e.g. the `maxCallsPerTool` count). Inside a run: no-op.
    ensureRunScope(() => rootContext(spec.taskId ?? spec.strategy, spec.agentId ?? "reasoning")),
  );
}
