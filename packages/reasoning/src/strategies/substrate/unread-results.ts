// File: src/strategies/substrate/unread-results.ts
/**
 * Final-pass unread tool results: one shared synthesis at the strategy terminal.
 *
 * A strategy's answering pass can end with tool results no think ever read:
 * the pass-cap batch the pending-batch rule drains (`kernel/loop/pending-batch.ts`,
 * one act, no think), or a pass whose loop stopped right after acting. The run
 * then shipped the draft written BEFORE those results (trace
 * 01M7T84BKRW64TD0HQA6E8GHSP: a reflexion improve pass ran 4 market-trend
 * searches and the run still answered "The EV market is large."). The research
 * was fetched and ignored.
 *
 * The rule (deterministic, every strategy through `runStrategy`):
 *   - unread = non-error, non-meta tool results after the pass's last assistant
 *     turn, unless that turn called `final-answer` (the model answered with the batch);
 *     a result identical to one the run already read (same tool, same text) is not new;
 *   - stale = the output to ship was authored before that last assistant turn
 *     (an earlier assistant turn of the pass, or an earlier pass's output). An
 *     answer written in the batch's own turn, or rendered after the results
 *     (a terminal synthesis), is not stale;
 *   - both hold: ONE terminal synthesis (`enforceQualityGate` force) over the
 *     task, the pass's tool results and the draft. Never otherwise.
 *   - the run's token/cost budget is spent (run limits vs run spend, or the
 *     pass stopped on its budget): skip, and record why.
 *
 * Not per-strategy: a strategy whose output is its own harvest (plan-execute's
 * synthesis, no answering pass) never matches the stale test.
 */
import { Effect, FiberRef } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import { contentText } from "@reactive-agents/core";
import type { ReasoningStep } from "../../types/index.js";
import type { KernelMessage } from "../../kernel/state/kernel-state.js";
import type { PassResult } from "../../kernel/loop/run-pass.js";
import { META_TOOLS } from "../../kernel/state/kernel-constants.js";
import { collectToolData, enforceQualityGate } from "../../kernel/loop/finalize.js";
import { CurrentRunBudgetLimits, type TokenSpend } from "../../kernel/run-budget.js";
import { makeStep } from "../../kernel/capabilities/sense/step-utils.js";
import { authorityOf } from "../../kernel/capabilities/decide/authority.js";
import { isBudgetExhausted, type BudgetSpend } from "../budget/remaining-budget.js";
import { passEndedInLlmError } from "./answer-pass-error.js";

/** The intervention actor this rule records under. */
export const UNREAD_RESULTS_ACTOR = "unread-results-synthesis";

/** Where the pass's last assistant turn sits and what came after it. */
interface PassTail {
  /** Text of the last assistant turn ("" when it only called tools). */
  readonly lastTurn: string;
  /** Texts of the assistant turns before it. */
  readonly earlierTurns: readonly string[];
  /** Domain tool results after the last assistant turn that no think read. */
  readonly unread: readonly Extract<KernelMessage, { readonly role: "tool_result" }>[];
}

/** A tool result's identity for "already read": the tool and its exact text. */
const resultKey = (m: KernelMessage): string | undefined =>
  m.role === "tool_result" ? `${m.toolName}\n${contentText(m.content).trim()}` : undefined;

/**
 * Split a pass's thread at its last assistant turn. A result identical to one
 * read earlier (before that turn, or in `alreadyRead`: earlier passes' threads)
 * carries nothing new, so it is not unread.
 */
export function passTail(messages: readonly KernelMessage[], alreadyRead: readonly KernelMessage[] = []): PassTail {
  let last = -1;
  messages.forEach((m, i) => {
    if (m.role === "assistant") last = i;
  });
  if (last < 0) return { lastTurn: "", earlierTurns: [], unread: [] };
  const turn = messages[last];
  const answeredWithBatch = turn?.role === "assistant" && (turn.toolCalls ?? []).some((c) => c.name === "final-answer");
  const read = new Set([...alreadyRead, ...messages.slice(0, last)].flatMap((m) => resultKey(m) ?? []));
  const unread = answeredWithBatch
    ? []
    : messages.slice(last + 1).flatMap((m) =>
        m.role === "tool_result" && m.isError !== true && !META_TOOLS.has(m.toolName) && !read.has(resultKey(m) ?? "") ? [m] : [],
      );
  const earlierTurns = messages.slice(0, last).flatMap((m) => (m.role === "assistant" ? [contentText(m.content)] : []));
  return { lastTurn: turn === undefined ? "" : contentText(turn.content), earlierTurns, unread };
}

/** What the rule decided for one terminal. */
export type UnreadResultsDecision =
  | { readonly _tag: "None" }
  | { readonly _tag: "Skip"; readonly reason: "budget-exhausted"; readonly tools: readonly string[] }
  | { readonly _tag: "Synthesize"; readonly draft: string; readonly toolData: string; readonly tools: readonly string[] };

/**
 * Pure decision. `messages` is the answering pass's thread; `output` what the
 * run is about to ship; `earlierPassOutputs` the outputs of the passes that ran
 * before it; `budgetSpent` whether the run's budget is exhausted.
 */
export function decideUnreadResults(input: {
  readonly messages: readonly KernelMessage[];
  readonly output: string | null;
  readonly earlierPassOutputs: readonly (string | null)[];
  /** The threads of the passes before this one (results they read are not new). */
  readonly earlierPassMessages?: readonly KernelMessage[];
  readonly budgetSpent: boolean;
}): UnreadResultsDecision {
  const draft = (input.output ?? "").trim();
  if (draft === "") return { _tag: "None" };
  const tail = passTail(input.messages, input.earlierPassMessages);
  if (tail.unread.length === 0) return { _tag: "None" };
  // Written with (or after) the batch: the model's own answer for it.
  if (tail.lastTurn.includes(draft)) return { _tag: "None" };
  const authoredBefore = [...tail.earlierTurns, ...input.earlierPassOutputs.map((o) => o ?? "")];
  if (!authoredBefore.some((t) => t.trim() !== "" && t.includes(draft))) return { _tag: "None" };
  const tools = tail.unread.map((m) => m.toolName);
  if (input.budgetSpent) return { _tag: "Skip", reason: "budget-exhausted", tools };
  const toolData = collectToolData(input.messages, META_TOOLS);
  return {
    _tag: "Synthesize",
    draft,
    toolData: `${toolData}\n\n[draft answer written before the last tool results arrived]\n${draft}`,
    tools,
  };
}

/** The applied rule: the output to ship, its spend, and what to record. */
export type UnreadResultsOutcome = TokenSpend & {
  /** Replacement output; `undefined` keeps the strategy's. */
  readonly output?: string;
  readonly llmCalls: number;
  readonly step?: ReasoningStep;
  /** `metadata.unreadResultsSynthesis` (absent when the rule did not apply). */
  readonly record?: Readonly<Record<string, unknown>>;
};

const NONE: UnreadResultsOutcome = { tokens: 0, cost: 0, llmCalls: 0 };

/**
 * Apply the rule at the strategy terminal: decide, then (at most) one shared
 * terminal synthesis. Never fails: a failed or empty synthesis keeps the draft
 * (`enforceQualityGate`'s fallback), recorded as such.
 */
export function synthesizeUnreadResults(input: {
  readonly llm: LLMService["Type"];
  readonly taskDescription: string;
  readonly taskId: string;
  readonly pass: PassResult;
  readonly output: string | null;
  /** The passes of the run before `pass`, in order. */
  readonly earlierPasses: readonly PassResult[];
  readonly runSpend: BudgetSpend;
}): Effect.Effect<UnreadResultsOutcome> {
  return Effect.gen(function* () {
    // A failed answering pass (a provider error) is the error terminal's (answer-pass-error.ts), not a draft to refresh.
    if (passEndedInLlmError(input.pass)) return NONE;
    const limits = yield* FiberRef.get(CurrentRunBudgetLimits);
    const decision = decideUnreadResults({
      messages: input.pass.messages,
      output: input.output,
      earlierPassOutputs: input.earlierPasses.map((p) => p.output),
      earlierPassMessages: input.earlierPasses.flatMap((p) => p.messages),
      // The run's limits against the run's spend, or the pass itself stopped on its budget.
      budgetSpent: isBudgetExhausted(limits ?? undefined, input.runSpend) || input.pass.state.meta.budgetTerminalPartial === true,
    });
    if (decision._tag === "None") return NONE;
    const iter = input.pass.state.iteration;
    const step = (whatChanged: string) =>
      makeStep("harness_signal", `final pass ended with ${decision.tools.length} unread tool result(s): ${whatChanged}`, {
        intervention: {
          actor: UNREAD_RESULTS_ACTOR,
          authorityClass: authorityOf(UNREAD_RESULTS_ACTOR),
          evidence: `unread: ${decision.tools.join(", ")}`.slice(0, 200),
          whatChanged: `${UNREAD_RESULTS_ACTOR}: ${whatChanged}`,
          iter,
        },
      });
    if (decision._tag === "Skip") {
      const what = "synthesis skipped (run budget exhausted); the earlier draft ships";
      return { ...NONE, step: step(what), record: { unread: decision.tools.length, tools: decision.tools, outcome: "skipped", reason: decision.reason } };
    }
    const gated = yield* enforceQualityGate({
      llm: input.llm,
      taskDescription: input.taskDescription,
      output: decision.draft,
      toolData: decision.toolData,
      force: true,
      traceContext: { taskId: input.taskId, iteration: iter },
    });
    const synthesized = gated.output !== decision.draft;
    const what = synthesized
      ? "answer synthesized over the task, the pass's tool results and the draft"
      : "synthesis returned nothing usable; the earlier draft ships";
    const { output: _rendered, ...spend } = gated;
    return {
      ...spend,
      llmCalls: 1,
      ...(synthesized ? { output: gated.output } : {}),
      step: step(what),
      record: { unread: decision.tools.length, tools: decision.tools, outcome: synthesized ? "synthesized" : "draft-kept" },
    };
  });
}
