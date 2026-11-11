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
 */
import { Effect, Option } from "effect";
import { REQUEST_USER_INPUT_TOOL_NAME, type ToolCallSpec } from "@reactive-agents/tools";
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
}

/**
 * The host's reply. `answered: false` means nobody answered (timeout, dismissed,
 * no channel); `reason` reaches the model verbatim so it knows why.
 */
export type AskUserOutcome =
  | { readonly answered: true; readonly value: unknown }
  | { readonly answered: false; readonly reason: string };

/**
 * Live ask-user rail. Put on `RunEnvelope.rails.askUser` by the host (the
 * runtime wires its HumanGate here). Never fails: a defect in the rail is read
 * as an unanswered question, so the run continues instead of crashing.
 */
export type AskUserRail = (request: AskUserRequest) => Effect.Effect<AskUserOutcome, never>;

const INTERACTION_KINDS: ReadonlySet<string> = new Set(["form", "choice", "confirmation"]);

/** Read the tool call's arguments into a request; an unknown `kind` reads as a confirmation. */
function requestOf(call: ToolCallSpec, interactionId: string): AskUserRequest {
  const args = call.arguments as { kind?: unknown; prompt?: unknown; schema?: unknown };
  return {
    interactionId,
    kind: typeof args.kind === "string" && INTERACTION_KINDS.has(args.kind)
      ? (args.kind as UserInteractionKind)
      : "confirmation",
    prompt: typeof args.prompt === "string" ? args.prompt : "",
    schema: args.schema ?? {},
  };
}

/** The tool-result text the model reads for an answered or unanswered question. */
export function interactionObservation(outcome: AskUserOutcome): string {
  return outcome.answered
    ? `The user responded: ${JSON.stringify(outcome.value ?? null)}`
    : `The user did not answer: ${outcome.reason}`;
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
    const askUser = Option.getOrUndefined(yield* Effect.serviceOption(RunEnvelope))?.rails.askUser;

    if (!askUser) {
      const args = call.arguments as { kind?: string; prompt?: string; schema?: unknown };
      const paused = transitionState(state, {
        meta: {
          ...state.meta,
          awaitingInteractionFor: {
            interactionId,
            kind: typeof args.kind === "string" ? args.kind : "confirmation",
            prompt: typeof args.prompt === "string" ? args.prompt : "",
            schemaJson: JSON.stringify(args.schema ?? {}),
          },
        },
      });
      return { kind: "pause", state: paused } satisfies UserInteractionStep;
    }

    const outcome = yield* askUser(requestOf(call, interactionId)).pipe(
      Effect.catchAllDefect(() =>
        Effect.succeed<AskUserOutcome>({ answered: false, reason: "the ask-user handler failed" }),
      ),
    );
    const observation = interactionObservation(outcome);
    const argsJson = JSON.stringify(call.arguments);
    const actionStep = makeStep("action", `${call.name}(${argsJson})`, {
      toolCall: { id: call.id, name: call.name, arguments: call.arguments },
      toolUsed: call.name,
    });
    const obsStep = makeStep("observation", observation, {
      toolCallId: call.id,
      observationResult: makeObservationResult(call.name, outcome.answered, observation),
    });
    const { hooks } = context;
    yield* hooks.onAction(state, call.name, argsJson, { callId: call.id, rationale: call.rationale });
    yield* hooks.onObservation(
      transitionState(state, { steps: [...state.steps, actionStep] }),
      observation,
      outcome.answered,
    );
    const answered = transitionState(state, {
      status: "thinking",
      steps: [...state.steps, actionStep, obsStep],
      messages: [...state.messages, ...interactionExchange(call.id, call.arguments as Record<string, unknown>, observation)],
      toolsUsed: new Set([...state.toolsUsed, call.name]),
      iteration: state.iteration + 1,
      meta: { ...state.meta, pendingNativeToolCalls: undefined, lastThought: undefined, lastThinking: undefined },
    });
    return { kind: "answered", state: answered } satisfies UserInteractionStep;
  });
}
