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
import type { ReasoningStep } from "../../types/index.js";
import { gatewayComplete, type GatewayRequest, type LlmCallIntent } from "../../kernel/llm-gateway.js";
import { runPass, type PassResult } from "../../kernel/loop/run-pass.js";
import { deriveTerminatedBy } from "../../kernel/loop/react-kernel.js";
import { kernelPause, type KernelPause } from "../../kernel/capabilities/sense/step-utils.js";
import {
  finalizePausedStrategyResult,
  finalizeStrategyResult,
  type FinalizeExtras,
  type JudgedReasoningResult,
} from "../../kernel/capabilities/sense/finalize-result.js";
import { RunEnvelope } from "../../kernel/envelope/run-envelope.js";
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
import type { KernelInput, KernelRunOptions, KernelState, ThoughtKernel } from "../../kernel/state/kernel-state.js";
import type { LedgerEntry, RunLedger } from "../../kernel/ledger/run-ledger.js";
import type { RunContract } from "../../kernel/contract/run-contract.js";
import "../../kernel/state/pass-seed.js";
import { makeStrategyEmitLog } from "../../kernel/utils/service-utils.js";
import { resolveRunSpend } from "../budget/run-budget-spend.js";
import type { BudgetSpend } from "../budget/remaining-budget.js";

/** What a strategy run has spent so far, across kernel passes, direct calls and accounted work. */
export interface StrategySpend {
  readonly tokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
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
  /** Account work that did not go through `pass` or `call` (a 0-LLM worker, a sandbox). */
  readonly account: (spend: Partial<StrategySpend>) => void;
  /** Record strategy-authored steps (control notes, scored candidates). */
  readonly record: (...steps: readonly ReasoningStep[]) => void;
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
 *   Becomes `budgetTerminalPartial` + `harnessAuthoredOutput`, `warning`
 *   appended to the run's verification warning, and `rawTerminatedBy: rawReason`
 *   (e.g. `budget-limit:tokens:1200/1000`).
 */
export type StrategyOutcome =
  | { readonly _tag: "Abstained"; readonly reason: string; readonly missing: readonly string[] }
  | { readonly _tag: "BudgetStopped"; readonly rawReason: string; readonly warning: string };

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
    } & Pick<FinalizeExtras, "runContract" | "strategyDecision">);

/** A registered strategy name, as the result mint records it. */
export type StrategyName = Parameters<typeof finalizeStrategyResult>[0]["strategy"];

/** Per-run settings the shared terminal needs. */
export interface StrategyRunSpec {
  readonly strategy: StrategyName;
  readonly taskId?: string;
  /** Required tools for the terminal grounding verdict. */
  readonly requiredTools?: readonly string[];
  /** Repair capabilities this strategy has. Default: per-iteration repair (kernel-backed). */
  readonly repairCapabilities?: FinalizeExtras["repairCapabilities"];
  /** Source-site tag for the strategy's log emitter. */
  readonly logSite: string;
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
 */
export function kernelTerminalMetadata(
  state: KernelState,
  runLedger: RunLedger,
): Record<string, unknown> {
  // The canonical narrowing whitelist (react-kernel.ts): a harness give-up is
  // never relabeled `final_answer`.
  const { terminatedBy, rawTerminatedBy } = deriveTerminatedBy(state);
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
    extensions: { signalTally: tallySignals(state.signalLedger ?? []) },
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
  const { inputTokens, outputTokens } = child.metadata;
  const metadata = {
    ...child.metadata,
    ...end.extraMetadata,
    duration: Date.now() - start,
    tokensUsed: child.metadata.tokensUsed + spend.tokens,
    cost: child.metadata.cost + spend.cost,
    ...(inputTokens !== undefined || spend.inputTokens > 0 ? { inputTokens: (inputTokens ?? 0) + spend.inputTokens } : {}),
    ...(outputTokens !== undefined || spend.outputTokens > 0 ? { outputTokens: (outputTokens ?? 0) + spend.outputTokens } : {}),
    stepsCount: relayedSteps.length,
    llmCalls: childCalls + spend.llmCalls,
  };
  return { ...child, strategy, steps: relayedSteps, metadata };
}

/** One contributing pass's envelope, remembered with its pass for exclusion. */
interface PassEnvelope {
  readonly pass: PassResult;
  readonly envelope: CompletionEnvelope;
}

/**
 * Run a strategy body against one trajectory and close it with the shared
 * terminal: the paused result for a pause, otherwise the judged mint
 * (`finalizeStrategyResult`) with the accumulated spend, steps, run ledger and
 * the worst-of envelope cap.
 */
export function runStrategy<E, R>(
  spec: StrategyRunSpec,
  body: (run: StrategyRun) => Effect.Effect<StrategyEnd, E, R>,
): Effect.Effect<JudgedReasoningResult, Exclude<E, Extract<E, StrategyPaused>>, R | LLMService | RunEnvelope> {
  return Effect.gen(function* () {
    const llm = yield* LLMService;
    const taskId = spec.taskId ?? spec.strategy;
    const start = Date.now();
    const steps: ReasoningStep[] = [];
    let spend: StrategySpend = { tokens: 0, inputTokens: 0, outputTokens: 0, cost: 0, llmCalls: 0 };
    const ledgerRef = yield* Ref.make<RunLedger>([]);
    // The run contract: compiled by the first pass, adopted by every continuing pass.
    let runContract: RunContract | undefined;
    const envelopes: PassEnvelope[] = [];
    let pendingPause: KernelPause | undefined;

    const add = (s: Partial<StrategySpend>): void => {
      spend = {
        tokens: spend.tokens + (s.tokens ?? 0),
        inputTokens: spend.inputTokens + (s.inputTokens ?? 0),
        outputTokens: spend.outputTokens + (s.outputTokens ?? 0),
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
      pass: (kernel, input, options, passOptions) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(ledgerRef);
          const seed = passOptions?.continues === true && current.length > 0 ? current : undefined;
          const seeded: KernelInput = passOptions?.continues !== true ? input : {
            ...input,
            ...(runContract !== undefined && input.seedRunContract === undefined ? { seedRunContract: runContract } : {}),
            ...(seed !== undefined && input.seedRunLedger === undefined ? { seedRunLedger: seed } : {}),
          };
          const result = yield* runPass(kernel, seeded, options);
          runContract = runContract ?? result.state.meta.runContract;
          steps.push(...(passOptions?.record === "evidence" ? result.steps.filter(isToolEvidence) : result.steps));
          add({
            tokens: result.tokens,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            cost: result.cost,
            llmCalls: result.state.llmCalls ?? 0,
          });
          yield* Ref.update(ledgerRef, (l) => absorbPassLedger(l, passLedgerAfterSeed(result.state.ledger, seeded.seedRunLedger)));
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
            Effect.sync(() =>
              add({
                tokens: response.usage.totalTokens,
                inputTokens: response.usage.inputTokens,
                outputTokens: response.usage.outputTokens,
                cost: response.usage.estimatedCost,
                llmCalls: 1,
              }),
            ),
          ),
        ),
      account: (more) => add(more),
      record: (...more) => {
        steps.push(...more);
      },
    };

    const judgment = {
      requiredTools: spec.requiredTools ?? [],
      repairCapabilities: spec.repairCapabilities ?? { perIteration: true },
    };
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
        ...judgment,
        runLedger: ledger,
        extraMetadata: { llmCalls: spend.llmCalls, runLedger: ledger },
      })));

    const terminal = (end: StrategyEnd, ledger: RunLedger): Effect.Effect<JudgedReasoningResult, never, RunEnvelope> => {
      if (pendingPause !== undefined) return paused(pendingPause);
      if (end._tag === "Delegated") return Effect.succeed(relayDelegated(spec.strategy, start, steps, spend, end));
      if (end._tag === "KernelTerminal") {
        // The answering pass's own status law, capped by every OTHER
        // contributing pass (single-pass strategies: unchanged).
        const status = capStatusToEnvelope(resolveCompletionStatus(end.pass.state), joined(end.pass));
        return finalizeStrategyResult({
          strategy: spec.strategy,
          taskId,
          steps,
          output: end.pass.output,
          status,
          error: end.pass.state.error,
          ...totals(),
          ...judgment,
          runLedger: ledger,
          kernelMeta: end.pass.state.meta,
          extraMetadata: {
            ...end.extraMetadata,
            ...kernelTerminalMetadata(end.pass.state, ledger),
            llmCalls: spend.llmCalls,
          },
        });
      }
      const envelope = joined();
      const outcome = end.outcome;
      // A strategy-decided abstention or budget stop is an honest non-success:
      // it is judged without the cap machinery (nothing to waive) at `partial`.
      const capped: { readonly status: "completed" | "partial" | "failed"; readonly cap?: StatusCapRecord } =
        outcome !== undefined
          ? { status: end.status === "failed" ? "failed" : "partial" }
          : end.verdict !== undefined
            ? capStatusUnderVerdict(end.status, envelope, end.verdict)
            : { status: capStatusToEnvelope(end.status, envelope) };
      const waived = capped.cap?.capped === false;
      // The strategy's own verdict owns the positive claim: `final_answer` iff
      // the capped status is `completed`, so goalAchieved and success never
      // contradict. An honest abstention (the strategy's, or the answering
      // pass's) still wins.
      const basedOnTb = end.basedOn !== undefined ? deriveTerminatedBy(end.basedOn.state) : undefined;
      // Without an answering pass, the last contributing pass's raw reason
      // (e.g. a step kernel's budget-limit string) still reaches the receipt.
      const lastPass = envelopes[envelopes.length - 1]?.pass;
      const rawRelay = basedOnTb?.rawTerminatedBy
        ?? (end.basedOn === undefined && lastPass !== undefined ? deriveTerminatedBy(lastPass.state).rawTerminatedBy : undefined);
      const passAbstained = basedOnTb?.terminatedBy === "abstained";
      const abstained = passAbstained || outcome?._tag === "Abstained";
      const rawTerminatedBy = outcome?._tag === "Abstained" ? "abstained"
        : outcome?._tag === "BudgetStopped" ? outcome.rawReason
        : rawRelay;
      const abstention = outcome?._tag === "Abstained"
        ? { reason: outcome.reason, missing: outcome.missing }
        : passAbstained ? end.basedOn?.state.meta.abstention : undefined;
      const claim = {
        terminatedBy: abstained ? "abstained" : capped.status === "completed" ? "final_answer" : "end_turn",
        ...(rawTerminatedBy !== undefined ? { rawTerminatedBy } : {}),
        ...(abstention !== undefined ? { abstention } : {}),
      };
      const envelopeMeta = !waived ? honestEnvelopeMetadata(envelope) : {};
      // A budget stop marks the output harness-authored and appends (never
      // clobbers) its warning to a contributing pass's own warning.
      const budgetMeta = outcome?._tag === "BudgetStopped"
        ? {
            budgetTerminalPartial: true,
            harnessAuthoredOutput: true,
            verificationWarning: [envelopeMeta.verificationWarning, outcome.warning]
              .filter((w): w is string => typeof w === "string" && w.length > 0)
              .join(" | "),
          }
        : {};
      return finalizeStrategyResult({
        strategy: spec.strategy,
        taskId,
        steps,
        output: end.output,
        status: capped.status,
        ...(end.error !== undefined ? { error: end.error } : {}),
        ...totals(),
        ...judgment,
        runLedger: ledger,
        ...(end.kernelMeta !== undefined ? { kernelMeta: end.kernelMeta } : {}),
        ...(end.runContract !== undefined ? { runContract: end.runContract } : {}),
        ...(end.strategyDecision !== undefined ? { strategyDecision: end.strategyDecision } : {}),
        extraMetadata: {
          ...end.extraMetadata,
          ...(end.basedOn !== undefined ? kernelTerminalMetadata(end.basedOn.state, ledger) : { runLedger: ledger }),
          ...claim,
          ...envelopeMeta,
          ...budgetMeta,
          ...(capped.cap !== undefined ? { statusCap: capped.cap } : {}),
          llmCalls: spend.llmCalls,
        },
      });
    };

    const isPaused = (err: E): err is Extract<E, StrategyPaused> => err instanceof StrategyPaused;

    return yield* body(run).pipe(
      Effect.flatMap((end) => Ref.get(ledgerRef).pipe(Effect.flatMap((ledger) => terminal(end, ledger)))),
      Effect.catchIf(isPaused, (p) => paused(p.pause)),
    );
  });
}
