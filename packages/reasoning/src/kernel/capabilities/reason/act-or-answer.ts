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
 * FC array (see check-domain-only-fc.sh); it is scoped to forced requests.
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
 *
 * Proactive mode (`actOrAnswer: "proactive"`): the retry costs a full extra LLM
 * call per rescue. When the turn is known BEFORE the call to expect an action,
 * its first request is forced instead ({@link planProactiveActOrAnswer}): same
 * forced shape as the retry, no prose turn spent. Gates (all deterministic):
 * native-FC, tools not withheld, a domain tool on the wire, tool work
 * outstanding, not latched, not pressure-critical, not plan posture, and:
 *  - not right after a failed tool call: the model may need to change approach
 *    in prose; that turn runs unforced and the retry stays its fallback;
 *  - not on Anthropic with a thinking-capable model: Anthropic turns extended
 *    thinking off under a forced `tool_choice` (llm-provider
 *    `anthropicThinkingPreference`). The kernel cannot see the provider's
 *    `thinking` config, only the capability (`profile.thinkingModel`), so it
 *    skips on the capability: a paid tier never loses reasoning to forcing.
 *    Ollama forces through structured decoding, which runs its own thinking
 *    resolution (local.ts `resolveStructuredThinking`, the completeStructured
 *    precedent); local tokens are free, so local forces.
 * A forced reply with no call falls back to the retry; a forced request that
 * fails (other than context overflow) is re-sent unforced, so forcing can
 * never turn into an `llm_error` the unforced turn would not have had. Its
 * record carries `mode: "proactive"`; a fallback retry under this mode carries
 * `mode: "retry"`. Retry-mode (`true`) records and requests are unchanged.
 *
 * Plan-execute steps: a step sub-kernel that declared tools (`stepTools`, from
 * the step's `toolHints`) and has called none of them has outstanding work
 * ({@link outstandingToolWork}), so both modes cover step passes.
 *
 * Tally (act-or-answer-tally.ts): every mode, off included, counts unforced
 * tool-work turns and their no-call stalls ({@link isNoCallStall}; a forced
 * request is neither), forced requests, and forced replies with a
 * domain call on `state.meta.actOrAnswerTally`; calibration learns
 * `actOrAnswer` from the run summary. `"auto"` resolves at run start; one that
 * reaches this module unresolved acts as off ({@link effectiveActOrAnswerMode}).
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
import type { ActOrAnswerMode, ResolvedHarness } from "../../../harness-config.js";
import type { ContextProfile } from "../../../context/context-profile.js";
import { isFailedToolObservation } from "../../utils/observation-helpers.js";
import { resolveAssistantTurn, type AssistantTurnMeta } from "./assistant-turn.js";
import { prepareThinkGatewayCall, type PrepareThinkGatewayCallParams } from "./prepare-think-gateway-call.js";
import { consumeThinkStream } from "./consume-think-stream.js";
import { callThinkWithOverflowRetry, contextOverflowOf, type ThinkCallParams } from "./context-overflow-retry.js";
import { provenanceBySanitizedName } from "./wire-facts.js";
import { addActOrAnswerTally, type ActOrAnswerTallyDelta } from "./act-or-answer-tally.js";

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

/**
 * The mode the kernel acts on. An unresolved `"auto"` (it resolves at run
 * start, harness-config.ts `resolveRunStartHarness`) never forces anything.
 */
export function effectiveActOrAnswerMode(h: Pick<ResolvedHarness, "actOrAnswer">): ActOrAnswerMode {
  return h.actOrAnswer === "auto" ? false : h.actOrAnswer;
}

/** The facts that make a reply a no-call stall ({@link isNoCallStall}). */
export interface NoCallStallFacts {
  readonly nativeFC: boolean;
  readonly toolsWithheld: boolean;
  readonly disposition: AssistantTurnMeta["disposition"];
  readonly stopReason: string;
  /** Domain tools on this turn's wire (native-FC `llmTools`). */
  readonly domainToolsOnWire: number;
  readonly outstanding: readonly string[];
}

/**
 * True when a reply is a no-call stall: native FC, tools offered, a prose
 * reply (not cut off at `max_tokens`) while tool work is outstanding. Counted
 * in every mode, on unforced replies only (act-or-answer-tally.ts). Pure.
 */
export function isNoCallStall(t: NoCallStallFacts): boolean {
  return (
    t.nativeFC &&
    !t.toolsWithheld &&
    t.disposition === "prose" &&
    t.stopReason !== "max_tokens" &&
    t.domainToolsOnWire > 0 &&
    t.outstanding.length > 0
  );
}

/** The deterministic facts {@link shouldActOrAnswer} decides from. */
export interface ActOrAnswerTrigger extends NoCallStallFacts {
  readonly enabled: boolean;
  readonly latched: boolean;
  readonly pressureCritical: boolean;
  readonly planPosture: boolean;
}

/** True when the forced retry should run: a stall the switch may answer. Pure. */
export function shouldActOrAnswer(t: ActOrAnswerTrigger): boolean {
  return t.enabled && isNoCallStall(t) && !t.latched && !t.pressureCritical && !t.planPosture;
}

/**
 * Tool work still outstanding, read from existing state only: required tools
 * the evidence has not credited (permanently failed ones excluded, as every
 * nudge excludes them), then delivery conditions only a tool can satisfy
 * (`ToolCalled`, `ArtifactProduced`, `SideEffectLanded`, and `InputRead` under
 * the `inputCoverage` switch: each unread listed input, by name) that are unmet.
 * `OutputContains` is left out: the answer text satisfies it, not a tool.
 * Last, a plan step's declared tools (`input.stepTools`) when none of them
 * has been called in this sub-kernel yet.
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
      const item =
        c.kind === "ToolCalled" ? c.tool
        : c.kind === "ArtifactProduced" ? `artifact:${c.path}`
        : c.kind === "InputRead" ? `input:${c.entity}`
        : "side-effect";
      if (!out.includes(item)) out.push(item);
    }
  }
  // A step tool already listed (missing required, unmet condition) says it once.
  const stepTools = input.stepTools ?? [];
  if (stepTools.length > 0 && !stepTools.some((t) => state.toolsUsed.has(t) || out.includes(t))) {
    out.push(`step tool (${stepTools.join(" | ")})`);
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

const finalAnswerWire = sanitizeToolName(FINAL_ANSWER);

/** How a forced reply came out, read off its tool calls. */
const resultOf = (calls: readonly { readonly name: string }[]): ActOrAnswerResult =>
  calls.length === 0 ? "no-call" : calls.every((c) => c.name === finalAnswerWire) ? "answered" : "called";

/** Call ids of a forced reply's domain calls (the tally's success check reads them). */
const domainCallIds = (calls: readonly { readonly id: string; readonly name: string }[]): readonly string[] =>
  calls.filter((c) => c.name !== finalAnswerWire).map((c) => c.id);

/** `stream` with `delta` added to its state's tally. */
const tallied = <T extends { readonly state: KernelState }>(stream: T, delta: ActOrAnswerTallyDelta): T => {
  const state = addActOrAnswerTally(stream.state, delta);
  return state === stream.state ? stream : { ...stream, state };
};

/** The turn facts both modes read (think.ts passes them once). */
export interface ActOrAnswerSurface {
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

/** A forced request: what it offers, the tool line it carries, its gateway inputs. */
export interface ForcedRequest {
  readonly schemas: readonly ToolSchema[];
  readonly toolLine: string;
  readonly prepare: PrepareThinkGatewayCallParams;
}

/**
 * The one forced shape both modes send: the callable wire set plus
 * `final-answer` when the turn offers it, the compact tool line on the request
 * tail, `toolChoice: "required"`. Pure.
 */
export function forcedRequest(
  base: PrepareThinkGatewayCallParams,
  surface: ActOrAnswerSurface,
  outstanding: readonly string[],
  state: KernelState,
): ForcedRequest {
  const finalAnswer = surface.gatedToolSchemas.find((s) => s.name === FINAL_ANSWER);
  const schemas = finalAnswer !== undefined && !surface.wireToolSchemas.some((s) => s.name === FINAL_ANSWER)
    ? [...surface.wireToolSchemas, finalAnswer]
    : surface.wireToolSchemas;
  const toolLine = forcedToolLine(schemas, outstanding);
  return {
    schemas,
    toolLine,
    prepare: {
      ...base,
      state,
      llmTools: schemas.map(surface.toWireTool),
      messagesForRequest: withRequestTail(base.messagesForRequest, toolLine),
      toolProvenance: provenanceBySanitizedName(schemas),
      toolChoice: "required",
    },
  };
}

/**
 * True when the last tool result before this turn failed: scanning back, a
 * failed tool observation comes before any thought (no turn has answered it
 * yet). A tool-gate refusal is not a failure (the call never ran).
 */
export function lastToolCallFailed(steps: readonly ReasoningStep[]): boolean {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step === undefined) continue;
    if (step.type === "thought") return false;
    if (step.type === "observation" && step.metadata?.observationResult !== undefined) return isFailedToolObservation(step);
  }
  return false;
}

/**
 * True when a forced call would turn off thinking the request could otherwise
 * run: Anthropic rejects forced `tool_choice` with extended thinking, so the
 * provider drops thinking (llm-provider `anthropicThinkingPreference`). The
 * kernel sees the capability, not the provider's `thinking` config, so a
 * thinking-capable Anthropic model counts. Pure.
 */
export function forcingDropsThinking(providerName: string | undefined, profile: Pick<ContextProfile, "thinkingModel">): boolean {
  return providerName === "anthropic" && profile.thinkingModel === true;
}

/** The deterministic facts {@link shouldForceFirstRequest} decides from. */
export interface ProactiveTrigger {
  readonly mode: ActOrAnswerMode;
  readonly nativeFC: boolean;
  readonly toolsWithheld: boolean;
  readonly domainToolsOnWire: number;
  readonly outstanding: readonly string[];
  readonly latched: boolean;
  readonly pressureCritical: boolean;
  readonly planPosture: boolean;
  readonly afterFailedCall: boolean;
  readonly dropsThinking: boolean;
}

/** True when the turn's FIRST request should be forced. Pure. */
export function shouldForceFirstRequest(t: ProactiveTrigger): boolean {
  return (
    t.mode === "proactive" &&
    t.nativeFC &&
    !t.toolsWithheld &&
    t.domainToolsOnWire > 0 &&
    t.outstanding.length > 0 &&
    !t.latched &&
    !t.pressureCritical &&
    !t.planPosture &&
    !t.afterFailedCall &&
    !t.dropsThinking
  );
}

/** A turn whose first request is forced: the request plus the work it was forced for. */
export interface ProactiveForce {
  readonly forced: ForcedRequest;
  readonly outstanding: readonly string[];
}

/**
 * Decide, before the call, whether this turn's first request is forced
 * (proactive mode). `undefined` = send the turn's request unchanged.
 */
export function planProactiveActOrAnswer(
  prepare: PrepareThinkGatewayCallParams,
  surface: ActOrAnswerSurface,
): ProactiveForce | undefined {
  const { context, state } = prepare;
  // Cheap gates first: the delivery check runs only in proactive mode on native FC.
  const mode = effectiveActOrAnswerMode(surface.h);
  if (mode !== "proactive" || context.toolCallingDriver.mode !== "native-fc") return undefined;
  const outstanding = outstandingToolWork(state, context.input);
  const fire = shouldForceFirstRequest({
    mode,
    nativeFC: true,
    toolsWithheld: surface.toolsWithheld,
    domainToolsOnWire: prepare.llmTools.length,
    outstanding,
    latched: actOrAnswerLatched(state.steps),
    pressureCritical: surface.pressureCritical,
    planPosture: isPlanPosture(context.input),
    afterFailedCall: lastToolCallFailed(state.steps),
    dropsThinking: forcingDropsThinking(context.input.providerName, context.profile),
  });
  return fire ? { forced: forcedRequest(prepare, surface, outstanding, state), outstanding } : undefined;
}

/**
 * The turn's first call. Unforced: exactly `callThinkWithOverflowRetry`.
 * Forced: the forced request (its tool line rides the overflow retry's tail
 * too); a forced request that fails for any reason but context overflow is
 * re-sent unforced, and `proactive` comes back absent so the turn settles as
 * an unforced one. Either way the forced request is counted in the tally.
 */
export function callThinkActOrAnswer(call: ThinkCallParams, force: ProactiveForce | undefined) {
  return Effect.gen(function* () {
    if (force === undefined) return { stream: yield* callThinkWithOverflowRetry(call), proactive: undefined };
    const forcedStream = yield* callThinkWithOverflowRetry({
      prepare: force.forced.prepare,
      reproject: call.reproject,
      requestTail: withRequestTail(call.requestTail, force.forced.toolLine),
    });
    const stream = tallied(forcedStream, { forced: 1 });
    if (stream._tag !== "failed" || contextOverflowOf(stream.cause) !== undefined) return { stream, proactive: force };
    const { state } = call.prepare;
    yield* emitGuardFired({
      taskId: state.taskId,
      iteration: state.iteration,
      guard: ACT_OR_ANSWER_ACTOR,
      outcome: "pass",
      reason: "no-call",
      metadata: { mode: "proactive", result: "no-call", tools: [], offered: force.forced.schemas.map((s) => s.name), outstanding: force.outstanding, forcedFailed: true },
    });
    // The unforced re-send starts from the turn's state: carry the forced count onto it.
    return { stream: tallied(yield* callThinkWithOverflowRetry(call), { forced: 1 }), proactive: undefined };
  });
}

/** Inputs of {@link settleActOrAnswer}: the first call's record plus what a retry needs. */
export interface ActOrAnswerParams extends ActOrAnswerSurface {
  readonly first: ConsumedThinkStream;
  /** The turn's unforced gateway preflight inputs (the retry reuses them). */
  readonly prepare: PrepareThinkGatewayCallParams;
  /** Set when the first request was forced (proactive mode). */
  readonly proactive?: ProactiveForce;
}

/**
 * Return the stream record the turn proceeds with. Proactive (first request
 * forced): the first record plus its act-or-answer record; when it made no
 * call, the retry below runs as the fallback. Otherwise the retry: the first
 * record unchanged when its trigger does not hold, else the forced retry's
 * when it made a call, else the first one. Token usage of every call is kept.
 */
export function settleActOrAnswer(params: ActOrAnswerParams) {
  return Effect.gen(function* () {
    const { first, proactive } = params;
    if (proactive === undefined) return yield* retryActOrAnswer(params, first, actOrAnswerLatched(first.state.steps), true);
    const { state } = first;
    const result = resultOf(first.accumulatedToolCalls);
    const toolNames = first.accumulatedToolCalls.map((c) => c.name);
    const { outstanding } = proactive;
    yield* emitGuardFired({
      taskId: state.taskId,
      iteration: state.iteration,
      guard: ACT_OR_ANSWER_ACTOR,
      outcome: result === "no-call" ? "pass" : "redirect",
      reason: result,
      metadata: { mode: "proactive", result, tools: toolNames, offered: proactive.forced.schemas.map((s) => s.name), outstanding },
    });
    const record = makeStep(
      "harness_signal",
      `act-or-answer: tool work outstanding (${outstanding.join(", ")}); first request forced, ${result}`,
      {
        intervention: {
          actor: ACT_OR_ANSWER_ACTOR,
          authorityClass: authorityOf(ACT_OR_ANSWER_ACTOR),
          evidence: `outstanding before the call: ${outstanding.join(", ")}`,
          whatChanged:
            result === "no-call"
              ? "first request sent with a required tool call; no call came back"
              : `first request sent with a required tool call; turn proceeds with ${toolNames.join(", ")}`,
          iter: state.iteration,
        },
      },
    );
    // Tally: the forced reply's domain calls (the forced request itself was
    // counted when it was sent). A forced turn is neither a stall nor an
    // unforced opportunity: the stall rate is measured on unforced turns only.
    const recorded = tallied(
      { ...first, state: transitionState(state, { steps: [...state.steps, record] }) },
      { forcedCallIds: domainCallIds(first.accumulatedToolCalls) },
    );
    // Proactive fires only when not latched, so the fallback keeps its one retry.
    return result === "no-call" ? yield* retryActOrAnswer(params, recorded, false, false) : recorded;
  });
}

/**
 * The forced retry after a no-call reply (retry mode, and proactive's
 * fallback). Also where an unforced reply is counted, in every mode
 * (`unforced`; false on proactive's fallback, whose request was forced): an
 * unforced tool-work opportunity, and a stall when it made no call.
 */
function retryActOrAnswer(params: ActOrAnswerParams, first: ConsumedThinkStream, latched: boolean, unforced: boolean) {
  return Effect.gen(function* () {
    const { prepare, h } = params;
    const { context } = prepare;
    const { input } = context;
    const state = first.state;
    const mode = effectiveActOrAnswerMode(h);
    const called = first.accumulatedToolCalls.length > 0;
    // Cheap gates first: the delivery check runs only on native FC, and only
    // when there is an unforced reply to count or a retry to send.
    if ((!mode && !unforced) || context.toolCallingDriver.mode !== "native-fc" || (called && !unforced)) {
      return first;
    }
    const outstanding = outstandingToolWork(state, input);
    const opportunity = unforced && !params.toolsWithheld && prepare.llmTools.length > 0 && outstanding.length > 0;
    if (called) return tallied(first, { unforcedToolWork: opportunity });
    const turn = yield* resolveAssistantTurn({
      resolver: input.toolCallResolver,
      nativeCalls: [],
      content: first.accumulatedContent,
      stopReason: first.accumulatedStopReason,
      surface: params.universe,
      thought: first.accumulatedContent,
    });
    const facts: NoCallStallFacts = {
      nativeFC: true,
      toolsWithheld: params.toolsWithheld,
      disposition: turn.meta.disposition,
      stopReason: first.accumulatedStopReason,
      domainToolsOnWire: prepare.llmTools.length,
      outstanding,
    };
    const stall = unforced && isNoCallStall(facts);
    const fire = shouldActOrAnswer({
      ...facts,
      enabled: mode !== false,
      latched,
      pressureCritical: params.pressureCritical,
      planPosture: isPlanPosture(input),
    });
    if (!fire) return tallied(first, { stall, unforcedToolWork: opportunity });

    const { schemas: forcedSchemas, prepare: forcedPrepare } = forcedRequest(prepare, params, outstanding, state);
    const prepared = yield* prepareThinkGatewayCall(forcedPrepare);
    const forced = yield* consumeThinkStream({ state: prepared.state, llmStreamEffect: prepared.llmStreamEffect, context });
    const calls = forced._tag === "consumed" ? forced.accumulatedToolCalls : [];
    const result = resultOf(calls);
    const toolNames = calls.map((c) => c.name);

    yield* emitGuardFired({
      taskId: state.taskId,
      iteration: state.iteration,
      guard: ACT_OR_ANSWER_ACTOR,
      outcome: result === "no-call" ? "pass" : "redirect",
      reason: result,
      metadata: {
        ...(mode === "proactive" ? { mode: "retry" } : {}),
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
    return tallied(
      {
        ...chosen,
        // Both calls were paid for: the turn bills their sum whichever reply it keeps.
        accumulatedUsage: forced._tag === "consumed" ? sumUsage(first.accumulatedUsage, forced.accumulatedUsage) : first.accumulatedUsage,
        state: transitionState(chosen.state, { steps: [...chosen.state.steps, record] }),
      },
      { stall, unforcedToolWork: opportunity, forced: 1, forcedCallIds: domainCallIds(calls) },
    );
  });
}
