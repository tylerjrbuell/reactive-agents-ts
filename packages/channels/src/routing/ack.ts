import { Effect, Option, Schedule } from "effect";
import type { RouteSpec } from "./types.js";

/** Default delay before the acknowledgement message. */
export const DEFAULT_ACK_AFTER_MS = 4000;
/** Default acknowledgement message. */
export const DEFAULT_ACK_TEXT = "On it...";
/** Platforms expire a typing pulse after about 5 seconds; refresh a little sooner. */
export const TYPING_REFRESH_MS = 4000;
/** Default bound on the session's `acknowledge` port. */
export const DEFAULT_ACK_MODEL_TIMEOUT_MS = 3000;
/** Longest model-written ack, in characters. */
export const MAX_MODEL_ACK_CHARS = 300;

/** A route's `ack` with defaults applied. */
export interface ResolvedAck {
  readonly afterMs: number;
  readonly texts: readonly string[];
  readonly typing: boolean;
  readonly source: "canned" | "model";
  readonly modelTimeoutMs: number;
}

/** Apply defaults. Absent or `false` is off: no typing, no message. */
export const resolveAck = (ack: RouteSpec["ack"]): ResolvedAck | undefined => {
  if (!ack) return undefined;
  const given = ack.text === undefined ? [DEFAULT_ACK_TEXT] : typeof ack.text === "string" ? [ack.text] : ack.text;
  return {
    afterMs: ack.afterMs ?? DEFAULT_ACK_AFTER_MS,
    texts: given.length > 0 ? given : [DEFAULT_ACK_TEXT],
    typing: ack.typing ?? true,
    source: ack.source ?? "canned",
    modelTimeoutMs: ack.modelTimeoutMs ?? DEFAULT_ACK_MODEL_TIMEOUT_MS,
  };
};

/** Deterministic pick: the same message id always gets the same text. */
export const pickAckText = (texts: readonly string[], seed: string): string => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return texts[h % texts.length] ?? DEFAULT_ACK_TEXT;
};

/**
 * Make model text safe to send as one plain chat message: drop code fences and markdown markers
 * (the ack goes out as plain text), keep link labels, collapse all whitespace to single spaces and
 * cap at {@link MAX_MODEL_ACK_CHARS}. Returns `undefined` when nothing readable is left.
 */
export const sanitizeAckText = (raw: string): string | undefined => {
  const text = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+])\s+/gm, "")
    .replace(/[`*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return undefined;
  return text.length > MAX_MODEL_ACK_CHARS ? `${text.slice(0, MAX_MODEL_ACK_CHARS - 1).trimEnd()}…` : text;
};

/** The chosen ack message and where it came from. */
export interface ChosenAck {
  readonly text: string;
  readonly source: "canned" | "narration" | "model";
}

/**
 * Pick the ack text. `canned` source: the canned text. `model` source, in order: the turn's own
 * narration (latest pushed so far), then the session's `acknowledge` port bounded by
 * `ack.modelTimeoutMs`, then the canned text. A port failure, timeout, defect or empty answer
 * falls through to canned; this never fails.
 */
export const chooseAckText = (plan: {
  readonly ack: ResolvedAck;
  readonly canned: string;
  readonly narration: () => string | undefined;
  readonly acknowledge: (() => Effect.Effect<string, never> | undefined) | undefined;
}): Effect.Effect<ChosenAck> =>
  Effect.gen(function* () {
    const canned: ChosenAck = { text: plan.canned, source: "canned" };
    if (plan.ack.source !== "model") return canned;
    const narrated = plan.narration();
    const narratedText = narrated === undefined ? undefined : sanitizeAckText(narrated);
    if (narratedText !== undefined) return { text: narratedText, source: "narration" } as const;
    const port = plan.acknowledge?.();
    if (port === undefined) return canned;
    const answer = yield* port.pipe(
      Effect.timeoutOption(plan.ack.modelTimeoutMs),
      Effect.catchAllCause(() => Effect.succeed(Option.none<string>())),
    );
    const modelText = Option.isSome(answer) ? sanitizeAckText(answer.value) : undefined;
    return modelText === undefined ? canned : ({ text: modelText, source: "model" } as const);
  });

/**
 * Run `turn` while two scoped helper fibers act on the chat: a typing pulse every
 * {@link TYPING_REFRESH_MS} from the start, and one acknowledgement after `afterMs`. Both are
 * interrupted (and awaited) when the turn ends, so an ack never lands after the final reply and a
 * quick turn is never acknowledged. `pulse` / `sendAck` must not fail; the caller swallows errors.
 */
export const withTurnAck = <A, E, R>(
  turn: Effect.Effect<A, E, R>,
  plan: {
    readonly ack: ResolvedAck;
    readonly pulse: Effect.Effect<void> | undefined;
    readonly sendAck: Effect.Effect<void>;
  },
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.gen(function* () {
      if (plan.ack.typing && plan.pulse) {
        yield* Effect.forkScoped(Effect.repeat(plan.pulse, Schedule.spaced(TYPING_REFRESH_MS)));
      }
      yield* Effect.forkScoped(Effect.zipRight(Effect.sleep(plan.ack.afterMs), plan.sendAck));
      return yield* turn;
    }),
  );
