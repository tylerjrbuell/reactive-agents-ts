/**
 * act/user-interaction.ts — the `request_user_input` rail, live or durable.
 *
 * When the model calls `request_user_input` (offered only when
 * `metaTools.userInteraction` is on), the act phase handles it here, BEFORE any
 * other call in the round runs. Two paths:
 *
 *   - LIVE — the ambient `RunEnvelope.rails.askUser` is present. The question
 *     goes to the host inline; the answer (or an honest "no answer") becomes the
 *     call's tool result, and the run goes back to thinking. No durable run, no
 *     checkpoint.
 *   - DURABLE — no `askUser` rail. act.ts ends the run (`awaiting-interaction`)
 *     with the request on `meta.awaitingInteractionFor`; the runner's resume re-entry
 *     (`loop/runner-resume-reentry.ts`) injects the stored answer later.
 *
 * Both paths drop the round's other calls, so the conversation pairs exactly one
 * call with one result; the model re-issues what it still needs on the next turn.
 * Both paths render the answer through {@link interactionExchange}, so the model
 * reads the same tool result whichever path the host chose.
 *
 * Structured calls (`questions` present): the request is parsed with
 * `parseRequest`, the answer map is checked with `validateAnswers`, and the
 * observation is the typed `StructuredAnswer` JSON. A malformed request or
 * invalid answers return a tool-result error and the run goes on, so the model
 * can ask again. Legacy `{ kind, prompt, schema }` calls render exactly as before.
 */
import { Effect, Either, Option } from "effect";
import {
  REQUEST_USER_INPUT_TOOL_NAME,
  formatAnswerErrors,
  parseRequest,
  timeoutAnswer,
  validateAnswers,
  type Question,
  type StructuredRequest,
  type ToolCallSpec,
} from "@reactive-agents/tools";
import {
  transitionState,
  type KernelContext,
  type KernelMessage,
  type KernelState,
} from "../../state/kernel-state.js";
import { makeStep } from "../sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import { RunEnvelope } from "../../envelope/run-envelope.js";

/** The input shapes `request_user_input` can ask for. */
export type UserInteractionKind = "form" | "choice" | "confirmation";

/** One question the model put to the user, as the host's `askUser` rail receives it. */
export interface AskUserRequest {
  /** Fresh id for this request; the host may use it to correlate UI state. */
  readonly interactionId: string;
  readonly kind: UserInteractionKind;
  /** The question shown to the user. */
  readonly prompt: string;
  /** Kind-specific payload from the model (`{ options }` for a choice, `{ fields }` for a form). */
  readonly schema: unknown;
  /**
   * The request as typed questions. Always present: a structured call carries
   * the model's `questions`; a legacy `{ kind, prompt, schema }` call is
   * normalized (form -> one per field, choice -> single-choice, confirmation ->
   * boolean, else text). A host answers a structured call with an id-keyed map.
   */
  readonly questions: readonly Question[];
  /** True when the model sent `questions`: the answer is validated and returned typed. */
  readonly structured: boolean;
}

/**
 * The host's reply. `answered: false` means nobody answered (timeout, dismissed,
 * no channel); `reason` reaches the model verbatim so it knows why. `timedOut`
 * marks a timeout explicitly; a reason containing "timed out" reads the same.
 */
export type AskUserOutcome =
  | { readonly answered: true; readonly value: unknown }
  | { readonly answered: false; readonly reason: string; readonly timedOut?: boolean };

/**
 * Live ask-user rail. Put on `RunEnvelope.rails.askUser` by the host (the
 * runtime wires its HumanGate here). Never fails: a defect in the rail is read
 * as an unanswered question, so the run continues instead of crashing.
 */
export type AskUserRail = (request: AskUserRequest) => Effect.Effect<AskUserOutcome, never>;

const INTERACTION_KINDS: ReadonlySet<string> = new Set(["form", "choice", "confirmation"]);

/** True when the model sent the structured `questions` form. */
const isStructuredCall = (args: unknown): boolean =>
  typeof args === "object" && args !== null && (args as { questions?: unknown }).questions !== undefined;

/** Read the tool call's arguments into a request; an unknown `kind` reads as a confirmation. */
function requestOf(call: ToolCallSpec, interactionId: string, questions: readonly Question[]): AskUserRequest {
  const args = call.arguments as { kind?: unknown; prompt?: unknown; schema?: unknown };
  return {
    interactionId,
    kind: typeof args.kind === "string" && INTERACTION_KINDS.has(args.kind)
      ? (args.kind as UserInteractionKind)
      : "confirmation",
    prompt: typeof args.prompt === "string" ? args.prompt : "",
    schema: args.schema ?? {},
    questions,
    structured: isStructuredCall(call.arguments),
  };
}

/** The tool-result text the model reads for an answered or unanswered question. */
export function interactionObservation(outcome: AskUserOutcome): string {
  return outcome.answered
    ? `The user responded: ${JSON.stringify(outcome.value ?? null)}`
    : `The user did not answer: ${outcome.reason}`;
}

/** What the model reads for a malformed structured request. */
export function rejectedRequestObservation(problem: string): string {
  return `The request was rejected: ${problem}. Ask again with corrected questions.`;
}

/**
 * Validate the answers to a structured request. The observation is the typed
 * `StructuredAnswer` JSON; invalid answers read as an error the model can fix by
 * asking again. `value` may be the id-keyed map or its JSON text. Shared by the
 * live path and the durable resume re-entry.
 */
export function structuredObservation(
  request: StructuredRequest,
  value: unknown,
): { readonly observation: string; readonly success: boolean } {
  let answers = value;
  if (typeof value === "string") {
    try {
      answers = JSON.parse(value);
    } catch {
      answers = undefined;
    }
  }
  const checked = validateAnswers(request, answers);
  return Either.isRight(checked)
    ? { observation: JSON.stringify(checked.right), success: true }
    : { observation: formatAnswerErrors(checked.left), success: false };
}

/**
 * The assistant-call + tool-result pair that records a `request_user_input`
 * exchange in `state.messages` (the prompt is assembled from messages, not
 * steps). Shared by the live path and the durable resume re-entry.
 */
export function interactionExchange(
  callId: string,
  args: Record<string, unknown>,
  observation: string,
): readonly [KernelMessage, KernelMessage] {
  return [
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: callId, name: REQUEST_USER_INPUT_TOOL_NAME, arguments: args }],
    },
    {
      role: "tool_result",
      toolCallId: callId,
      toolName: REQUEST_USER_INPUT_TOOL_NAME,
      content: observation,
    },
  ];
}

/**
 * What the act phase does with this round's `request_user_input` call:
 * `answered` — continue from `state` (the answer is in it);
 * `pause` — end the run as `awaiting-interaction` from `state` (act.ts calls
 * `terminate()`; this module never ends a run itself).
 */
export type UserInteractionStep =
  | { readonly kind: "answered"; readonly state: KernelState }
  | { readonly kind: "pause"; readonly state: KernelState };

/**
 * Handle a `request_user_input` call in this round, if there is one. Returns
 * `undefined` when the round has no such call or the feature is off — the act
 * phase then runs as usual.
 */
export function handleUserInteraction(
  state: KernelState,
  context: KernelContext,
  calls: readonly ToolCallSpec[],
): Effect.Effect<UserInteractionStep | undefined, never> {
  return Effect.gen(function* () {
    if (context.input.metaTools?.userInteraction !== true) return undefined;
    const call = calls.find((c) => c.name === REQUEST_USER_INPUT_TOOL_NAME);
    if (!call) return undefined;
    const interactionId = crypto.randomUUID();

    const parsed = parseRequest(call.arguments);
    if (Either.isLeft(parsed)) {
      const next = yield* recordAnswer(state, context, call, rejectedRequestObservation(parsed.left), false);
      return { kind: "answered", state: next } satisfies UserInteractionStep;
    }
    const request = parsed.right;
    const structured = isStructuredCall(call.arguments);
    const askUser = Option.getOrUndefined(yield* Effect.serviceOption(RunEnvelope))?.rails.askUser;

    if (!askUser) {
      const args = call.arguments as { kind?: string; prompt?: string; schema?: unknown };
      const awaiting = structured
        ? {
            interactionId,
            kind: "structured",
            prompt: request.questions.map((q) => q.prompt).join(" / "),
            schemaJson: JSON.stringify({ questions: request.questions }),
          }
        : {
            interactionId,
            kind: typeof args.kind === "string" ? args.kind : "confirmation",
            prompt: typeof args.prompt === "string" ? args.prompt : "",
            schemaJson: JSON.stringify(args.schema ?? {}),
          };
      const paused = transitionState(state, { meta: { ...state.meta, awaitingInteractionFor: awaiting } });
      return { kind: "pause", state: paused } satisfies UserInteractionStep;
    }

    const outcome = yield* askUser(requestOf(call, interactionId, request.questions)).pipe(
      Effect.catchAllDefect(() =>
        Effect.succeed<AskUserOutcome>({ answered: false, reason: "the ask-user handler failed" }),
      ),
    );
    let observation = interactionObservation(outcome);
    let success = outcome.answered;
    if (structured) {
      if (outcome.answered) {
        ({ observation, success } = structuredObservation(request, outcome.value));
      } else if (outcome.timedOut === true || /timed out/i.test(outcome.reason)) {
        observation = JSON.stringify(timeoutAnswer(request));
      }
    }
    const next = yield* recordAnswer(state, context, call, observation, success);
    return { kind: "answered", state: next } satisfies UserInteractionStep;
  });
}

/** Record one answered (or rejected) `request_user_input` exchange; the run goes back to thinking. */
function recordAnswer(
  state: KernelState,
  context: KernelContext,
  call: ToolCallSpec,
  observation: string,
  success: boolean,
): Effect.Effect<KernelState, never> {
  return Effect.gen(function* () {
    const argsJson = JSON.stringify(call.arguments);
    const actionStep = makeStep("action", `${call.name}(${argsJson})`, {
      toolCall: { id: call.id, name: call.name, arguments: call.arguments },
      toolUsed: call.name,
    });
    const obsStep = makeStep("observation", observation, {
      toolCallId: call.id,
      observationResult: makeObservationResult(call.name, success, observation),
    });
    const { hooks } = context;
    yield* hooks.onAction(state, call.name, argsJson, { callId: call.id, rationale: call.rationale });
    yield* hooks.onObservation(
      transitionState(state, { steps: [...state.steps, actionStep] }),
      observation,
      success,
    );
    return transitionState(state, {
      status: "thinking",
      steps: [...state.steps, actionStep, obsStep],
      messages: [...state.messages, ...interactionExchange(call.id, call.arguments as Record<string, unknown>, observation)],
      toolsUsed: new Set([...state.toolsUsed, call.name]),
      iteration: state.iteration + 1,
      meta: { ...state.meta, pendingNativeToolCalls: undefined, lastThought: undefined, lastThinking: undefined },
    });
  });
}
