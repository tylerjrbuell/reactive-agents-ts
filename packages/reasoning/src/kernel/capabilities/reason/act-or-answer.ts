/**
 * Think phase — act-or-answer (harness switch `actOrAnswer`, default OFF).
 *
 * Small models end about a third of mid-run turns with tools offered and no
 * call (spike 2026-11-06, wiki/Research/Harness-Reports/2026-11-06-canonical-
 * failure-modes.md). The harness answers that with prose guidance the model
 * ignores. Replaying such turns with constrained decoding gave a valid call
 * almost every time. So: when a native-FC turn returns plain prose while tool
 * work is still outstanding, ask once more in the same turn with
 * `toolChoice: "required"` over the turn's callable tools. A call it returns
 * becomes the turn's call (normal act path, nothing downstream changes);
 * otherwise the ORIGINAL reply is handled exactly as before.
 *
 * Trigger (all deterministic):
 *  - the switch is on, the driver is native-FC, tools were not withheld;
 *  - the turn resolved as `prose` (no native call, nothing text-extractable,
 *    not an unresolved call shape) and did not stop on `max_tokens`;
 *  - at least one domain tool is on the wire;
 *  - tool work is outstanding ({@link outstandingToolWork}). Each item is one
 *    the exit gate lists for any answer, so a prose reply here is never a
 *    deliverable the gate would accept;
 *  - not pressure-critical, not plan posture;
 *  - not latched ({@link actOrAnswerLatched}): one retry per no-call stall.
 *
 * `final-answer` joins the forced set when the turn offers it. Under forcing,
 * the no-call shape cannot signal "done" any more, so the answer tool is the
 * model's honest way out. That is the one place a meta tool reaches a native
 * FC array (see check-domain-only-fc.sh); it is scoped to this retry.
 *
 * Ollama forces through format-constrained decoding and sends no `tools`
 * param, and the native-FC prompt carries no tool reference
 * (build-think-provider-request.ts skips it). The model would see tool names
 * only through the grammar, so the forced request carries a compact tool line
 * (name + first sentence) on the request tail. It is request-only.
 *
 * Record: a `harness_signal` step with a typed `intervention` (the latch reads
 * it; the receipt aggregates it) and one `guard-fired` event
 * (`guard: "act-or-answer"`, `metadata.result`: called | answered | no-call).
 */
import { Effect } from "effect";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import { emitGuardFired } from "../../utils/diagnostics.js";
import { makeStep } from "../sense/step-utils.js";
import { sanitizeToolName } from "../attend/context-utils.js";
import { effectiveMissingRequired } from "../verify/requirement-state.js";
import { verifyDelivery } from "../verify/delivery-authority.js";
import { deliveryConditions } from "../../contract/declared-deliverables.js";
import { isPlanPosture } from "../../policy/run-posture.js";
import { authorityOf } from "../decide/authority.js";
import { transitionState, type KernelContext, type KernelState } from "../../state/kernel-state.js";
import type { ReasoningStep } from "../../../types/index.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import type { ResolvedHarness } from "../../../harness-config.js";
import { resolveAssistantTurn, type AssistantTurnMeta } from "./assistant-turn.js";
import { prepareThinkGatewayCall, type PrepareThinkGatewayCallParams } from "./prepare-think-gateway-call.js";
import { consumeThinkStream } from "./consume-think-stream.js";
import { provenanceBySanitizedName } from "./wire-facts.js";

/** Actor / guard name on every act-or-answer record. */
export const ACT_OR_ANSWER_ACTOR = "act-or-answer";

const FINAL_ANSWER = "final-answer";

/** How the forced retry came out. */
export type ActOrAnswerResult = "called" | "answered" | "no-call";

/** The consumed-stream shape `consumeThinkStream` returns on success. */
export type ConsumedThinkStream = Extract<
  Effect.Effect.Success<ReturnType<typeof consumeThinkStream>>,
  { readonly _tag: "consumed" }
>;

/** One wire tool, as think.ts maps it for the FC `tools` array. */
export type WireTool = PrepareThinkGatewayCallParams["llmTools"][number];

/** The deterministic facts {@link shouldActOrAnswer} decides from. */
export interface ActOrAnswerTrigger {
  readonly enabled: boolean;
  readonly nativeFC: boolean;
  readonly toolsWithheld: boolean;
  readonly disposition: AssistantTurnMeta["disposition"];
  readonly stopReason: string;
  /** Domain tools on this turn's wire (native-FC `llmTools`). */
  readonly domainToolsOnWire: number;
  readonly outstanding: readonly string[];
  readonly latched: boolean;
  readonly pressureCritical: boolean;
  readonly planPosture: boolean;
}

/** True when the forced retry should run. Pure. */
export function shouldActOrAnswer(t: ActOrAnswerTrigger): boolean {
  return (
    t.enabled &&
    t.nativeFC &&
    !t.toolsWithheld &&
    t.disposition === "prose" &&
    t.stopReason !== "max_tokens" &&
    t.domainToolsOnWire > 0 &&
    t.outstanding.length > 0 &&
    !t.latched &&
    !t.pressureCritical &&
    !t.planPosture
  );
}

/**
 * Tool work still outstanding, read from existing state only: required tools
 * the evidence has not credited (permanently failed ones excluded, as every
 * nudge excludes them), then delivery conditions only a tool can satisfy
 * (`ToolCalled`, `ArtifactProduced`, `SideEffectLanded`) that are unmet.
 * `OutputContains` is left out: the answer text satisfies it, not a tool.
 */
export function outstandingToolWork(
  state: KernelState,
  input: KernelContext["input"],
): readonly string[] {
  const out = [...effectiveMissingRequired(state.evidence, input.requiredTools ?? [], input.requiredToolQuantities)];
  const toolConditions = (deliveryConditions(state.meta) ?? []).filter((c) => c.kind !== "OutputContains");
  if (toolConditions.length > 0) {
    const { unmet } = verifyDelivery(toolConditions, { steps: state.steps, output: "", ledger: state.ledger });
    for (const c of unmet) {
      const item = c.kind === "ToolCalled" ? c.tool : c.kind === "ArtifactProduced" ? `artifact:${c.path}` : "side-effect";
      if (!out.includes(item)) out.push(item);
    }
  }
  return out;
}

/**
 * True when this no-call stall already had its retry: an act-or-answer record
 * sits after the last tool observation. A tool observation (a call ran) clears it.
 */
export function actOrAnswerLatched(steps: readonly ReasoningStep[]): boolean {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step === undefined) continue;
    if (step.type === "observation") return false;
    if (step.type === "harness_signal" && step.metadata?.intervention?.actor === ACT_OR_ANSWER_ACTOR) return true;
  }
  return false;
}

/** First sentence of a description, for the compact tool line. */
const firstSentence = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = flat.search(/[.!?](\s|$)/);
  return end >= 0 ? flat.slice(0, end + 1) : flat;
};

/** The request-only instruction the forced retry carries. */
export function forcedToolLine(schemas: readonly ToolSchema[], outstanding: readonly string[]): string {
  const lines = schemas.map((s) => {
    const about = firstSentence(s.description ?? "");
    return `- ${sanitizeToolName(s.name)}${about.length > 0 ? `: ${about}` : ""}`;
  });
  return [
    `[Harness] Work is still outstanding (${outstanding.join(", ")}). Reply with one tool call.`,
    "Tools:",
    ...lines,
  ].join("\n");
}

/** Append `text` to the request tail: into a trailing user string message, else as a new user message. */
function withRequestTail(messages: readonly LLMMessage[], text: string): LLMMessage[] {
  const last = messages[messages.length - 1];
  if (last !== undefined && last.role === "user" && typeof last.content === "string") {
    return [...messages.slice(0, -1), { ...last, content: `${last.content}\n\n${text}` }];
  }
  return [...messages, { role: "user", content: text }];
}

const sumUsage = (
  a: ConsumedThinkStream["accumulatedUsage"],
  b: ConsumedThinkStream["accumulatedUsage"],
): ConsumedThinkStream["accumulatedUsage"] => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  totalTokens: a.totalTokens + b.totalTokens,
  estimatedCost: a.estimatedCost + b.estimatedCost,
});

/** Inputs of {@link settleActOrAnswer}: the first call's record plus what a retry needs. */
export interface ActOrAnswerParams {
  readonly first: ConsumedThinkStream;
  /** The first call's gateway preflight inputs (the retry reuses them). */
  readonly prepare: PrepareThinkGatewayCallParams;
  readonly h: ResolvedHarness;
  readonly toolsWithheld: boolean;
  readonly pressureCritical: boolean;
  /** The turn's tool universe (what the resolver may resolve against). */
  readonly universe: readonly ToolSchema[];
  /** The canonical schemas behind this turn's wire tools. */
  readonly wireToolSchemas: readonly ToolSchema[];
  /** The turn's callable set after the recall gate (`final-answer` is read from here). */
  readonly gatedToolSchemas: readonly ToolSchema[];
  /** think.ts's wire mapping (one definition of a wire tool). */
  readonly toWireTool: (ts: ToolSchema) => WireTool;
}

/**
 * Return the stream record the turn proceeds with: the first one unchanged
 * when the trigger does not hold; otherwise the forced retry's when it made a
 * call, else the first one. Token usage of both calls is kept either way.
 */
export function settleActOrAnswer(params: ActOrAnswerParams) {
  return Effect.gen(function* () {
    const { first, prepare, h } = params;
    const { context } = prepare;
    const { input } = context;
    const state = first.state;
    // Cheap gates first: the resolver and the delivery check run only when on.
    if (!h.actOrAnswer || context.toolCallingDriver.mode !== "native-fc" || first.accumulatedToolCalls.length > 0) {
      return first;
    }
    const turn = yield* resolveAssistantTurn({
      resolver: input.toolCallResolver,
      nativeCalls: [],
      content: first.accumulatedContent,
      stopReason: first.accumulatedStopReason,
      surface: params.universe,
      thought: first.accumulatedContent,
    });
    const outstanding = outstandingToolWork(state, input);
    const fire = shouldActOrAnswer({
      enabled: h.actOrAnswer,
      nativeFC: true,
      toolsWithheld: params.toolsWithheld,
      disposition: turn.meta.disposition,
      stopReason: first.accumulatedStopReason,
      domainToolsOnWire: prepare.llmTools.length,
      outstanding,
      latched: actOrAnswerLatched(state.steps),
      pressureCritical: params.pressureCritical,
      planPosture: isPlanPosture(input),
    });
    if (!fire) return first;

    const finalAnswer = params.gatedToolSchemas.find((s) => s.name === FINAL_ANSWER);
    const forcedSchemas = finalAnswer !== undefined && !params.wireToolSchemas.some((s) => s.name === FINAL_ANSWER)
      ? [...params.wireToolSchemas, finalAnswer]
      : params.wireToolSchemas;
    const prepared = yield* prepareThinkGatewayCall({
      ...prepare,
      state,
      llmTools: forcedSchemas.map(params.toWireTool),
      messagesForRequest: withRequestTail(prepare.messagesForRequest, forcedToolLine(forcedSchemas, outstanding)),
      toolProvenance: provenanceBySanitizedName(forcedSchemas),
      toolChoice: "required",
    });
    const forced = yield* consumeThinkStream({ state: prepared.state, llmStreamEffect: prepared.llmStreamEffect, context });
    const calls = forced._tag === "consumed" ? forced.accumulatedToolCalls : [];
    const finalAnswerWire = sanitizeToolName(FINAL_ANSWER);
    const result: ActOrAnswerResult =
      calls.length === 0 ? "no-call" : calls.every((c) => c.name === finalAnswerWire) ? "answered" : "called";
    const toolNames = calls.map((c) => c.name);

    yield* emitGuardFired({
      taskId: state.taskId,
      iteration: state.iteration,
      guard: ACT_OR_ANSWER_ACTOR,
      outcome: result === "no-call" ? "pass" : "redirect",
      reason: result,
      metadata: {
        result,
        tools: toolNames,
        offered: forcedSchemas.map((s) => s.name),
        outstanding,
        ...(forced._tag === "failed" ? { retryFailed: true } : {}),
      },
    });

    const chosen = forced._tag === "consumed" && calls.length > 0 ? forced : first;
    const record = makeStep(
      "harness_signal",
      `act-or-answer: no tool call while work was outstanding (${outstanding.join(", ")}); forced retry ${result}`,
      {
        intervention: {
          actor: ACT_OR_ANSWER_ACTOR,
          authorityClass: authorityOf(ACT_OR_ANSWER_ACTOR),
          evidence: `prose turn, outstanding: ${outstanding.join(", ")}`,
          whatChanged:
            result === "no-call"
              ? "re-asked with a required tool call; no call came back, original reply kept"
              : `re-asked with a required tool call; turn proceeds with ${toolNames.join(", ")}`,
          iter: state.iteration,
        },
      },
    );
    return {
      ...chosen,
      // Both calls were paid for: the turn bills their sum whichever reply it keeps.
      accumulatedUsage: forced._tag === "consumed" ? sumUsage(first.accumulatedUsage, forced.accumulatedUsage) : first.accumulatedUsage,
      state: transitionState(chosen.state, { steps: [...chosen.state.steps, record] }),
    };
  });
}
