// File: src/strategies/substrate/strategy-run.ts
/**
 * Strategy run substrate: one trajectory per strategy run.
 *
 * A strategy run is a trajectory (steps, spend, the last kernel pass, a pause)
 * plus control flow (what to do next). `runStrategy` owns the trajectory and
 * the one terminal every strategy shares; the strategy body owns only its
 * control flow. Before this, every strategy re-implemented the accounting
 * (`totalTokens +=`, `llmCalls +=`), the pause short-circuit and the
 * kernel-terminal relay (terminatedBy, abstention, honesty markers), and each
 * harness fix had to be wired into each copy.
 *
 * Spec: wiki/Architecture/Design-Specs/2026-11-04-strategy-run-substrate.md
 */
import { Data, Effect } from "effect";
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
  honestPartialMetadata,
  resolveCompletionStatus,
} from "../../kernel/state/completion-status.js";
import { tallySignals } from "../../kernel/state/signal-ledger.js";
import type { KernelInput, KernelRunOptions, KernelState, ThoughtKernel } from "../../kernel/state/kernel-state.js";
import type { RunLedger } from "../../kernel/ledger/run-ledger.js";
import { makeStrategyEmitLog } from "../../kernel/utils/service-utils.js";

/** What a strategy run has spent so far, across kernel passes and direct calls. */
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
  /** Spend so far. */
  readonly spend: () => StrategySpend;
  /** Ledger of the most recent kernel pass (empty before the first). */
  readonly ledger: () => RunLedger;
  /**
   * Run one kernel pass: records its steps, accounts its spend and calls, and
   * remembers it as the latest pass. A paused pass fails with StrategyPaused.
   */
  readonly pass: (
    kernel: ThoughtKernel,
    input: KernelInput,
    options: KernelRunOptions,
  ) => Effect.Effect<PassResult, StrategyPaused, LLMService>;
  /**
   * One direct model call (expand, score, critique, plan), accounted like a
   * kernel pass. A provider failure becomes an ExecutionError carrying
   * `onError`.
   */
  readonly call: (
    intent: LlmCallIntent,
    request: GatewayRequest,
    onError: { readonly message: string; readonly step?: number },
  ) => Effect.Effect<CompletionResponse, ExecutionError, LLMService>;
  /** Record strategy-authored steps (control notes, scored candidates). */
  readonly record: (...steps: readonly ReasoningStep[]) => void;
}

/**
 * How a strategy run ends.
 *
 * - `KernelTerminal`: the last kernel pass is the answer. Output, status,
 *   terminatedBy, abstention and the honesty markers are relayed from it by
 *   one rule (the rule reactive has always used).
 * - `Result`: the strategy computed its own output and status (a critique
 *   loop, a plan solve). The shared mint still judges it.
 */
export type StrategyEnd =
  | {
      readonly _tag: "KernelTerminal";
      readonly pass: PassResult;
      readonly extraMetadata?: Record<string, unknown>;
    }
  | ({
      readonly _tag: "Result";
      readonly output: string | null;
      readonly status: "completed" | "partial" | "failed";
      readonly error?: string | null;
      readonly kernelMeta?: KernelState["meta"];
      readonly extraMetadata?: Record<string, unknown>;
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
 * The metadata every kernel-backed terminal relays across the result boundary:
 * the closed terminatedBy plus its raw channel, the run ledger, honesty
 * markers, the abstention descriptor, the signal tally, the final-answer
 * capture, the last dialect and the uncompressed tool-result store. One
 * derivation for every strategy, so a new field reaches all of them.
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
 * Run a strategy body against one trajectory and close it with the shared
 * terminal: the paused result for a StrategyPaused, otherwise the judged mint
 * (`finalizeStrategyResult`) with the accumulated spend, steps and ledger.
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
    let lastLedger: RunLedger = [];

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
      ledger: () => lastLedger,
      pass: (kernel, input, options) =>
        Effect.gen(function* () {
          const result = yield* runPass(kernel, input, options);
          steps.push(...result.steps);
          add({
            tokens: result.tokens,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            cost: result.cost,
            llmCalls: result.state.llmCalls ?? 0,
          });
          lastLedger = result.state.ledger ?? [];
          const pause = kernelPause(result.state);
          if (pause !== undefined) return yield* Effect.fail(new StrategyPaused({ pause }));
          return result;
        }),
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

    const isPaused = (err: E): err is Extract<E, StrategyPaused> => err instanceof StrategyPaused;

    return yield* body(run).pipe(
      Effect.flatMap((end) =>
          end._tag === "KernelTerminal"
            ? finalizeStrategyResult({
                strategy: spec.strategy,
                taskId,
                steps,
                output: end.pass.output,
                status: resolveCompletionStatus(end.pass.state),
                error: end.pass.state.error,
                ...totals(),
                ...judgment,
                runLedger: lastLedger,
                kernelMeta: end.pass.state.meta,
                extraMetadata: {
                  ...kernelTerminalMetadata(end.pass.state, lastLedger),
                  llmCalls: spend.llmCalls,
                  ...end.extraMetadata,
                },
              })
            : finalizeStrategyResult({
                strategy: spec.strategy,
                taskId,
                steps,
                output: end.output,
                status: end.status,
                ...(end.error !== undefined ? { error: end.error } : {}),
                ...totals(),
                ...judgment,
                runLedger: lastLedger,
                ...(end.kernelMeta !== undefined ? { kernelMeta: end.kernelMeta } : {}),
                ...(end.runContract !== undefined ? { runContract: end.runContract } : {}),
                ...(end.strategyDecision !== undefined ? { strategyDecision: end.strategyDecision } : {}),
                extraMetadata: { llmCalls: spend.llmCalls, runLedger: lastLedger, ...end.extraMetadata },
              }),
      ),
      Effect.catchIf(isPaused, (paused) =>
        finalizePausedStrategyResult({
          strategy: spec.strategy,
          steps,
          pause: paused.pause,
          ...totals(),
          ...judgment,
          runLedger: lastLedger,
          extraMetadata: { llmCalls: spend.llmCalls, runLedger: lastLedger },
        }),
      ),
    );
  });
}
