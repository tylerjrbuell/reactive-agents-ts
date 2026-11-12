/**
 * Multimodal task input.
 *
 * `agent.run` / `runStream` / `chat` accept {@link TaskInput}: a plain string or
 * typed core content parts (text, image, audio, file). Text-only input keeps its
 * exact string form so text-only runs are byte-identical (replay hashes).
 *
 * `Task.input` carries `{ question, parts? }`. `question` is always the text
 * projection (every text-only consumer reads it); `parts` is present only when
 * a non-text part exists.
 */
import { Effect } from "effect";
import {
  contentParts,
  contentText,
  normalizeContent,
  type ContentPart,
  type MessageContent,
} from "@reactive-agents/core";
import { resolveCapability, type Capability } from "@reactive-agents/llm-provider";
import { UnsupportedModalityError } from "../errors.js";
/** A task prompt: plain text, or typed content parts (text, image, audio, file). */
export type TaskInput = string | readonly ContentPart[];

/** The `Task.input` payload shape the runtime writes. */
export interface TaskInputPayload {
  readonly question: string;
  readonly parts?: readonly ContentPart[];
}

/** The text of a task input; non-text parts contribute nothing. */
export const taskInputText = (input: TaskInput): string =>
  typeof input === "string" ? input : contentText(input);

/** The parts of a task input (a string becomes one text part, none if empty). */
export const taskInputParts = (input: TaskInput): readonly ContentPart[] =>
  contentParts(input);

/** True when the input carries at least one non-text part. */
export const taskInputHasMedia = (input: TaskInput): boolean =>
  typeof input !== "string" && input.some((p) => p.type !== "text");

/** Canonical form: all-text parts collapse to one string. */
export const normalizeTaskInput = (input: TaskInput): TaskInput =>
  typeof input === "string" ? input : (normalizeContent(input) as TaskInput);

/** Build the `Task.input` payload. `parts` only when a non-text part exists. */
export const toTaskInputPayload = (input: TaskInput): TaskInputPayload =>
  taskInputHasMedia(input)
    ? { question: taskInputText(input), parts: input as readonly ContentPart[] }
    : { question: taskInputText(input) };

/** Parts carried by a `Task.input` payload, when it has any non-text part. */
export const payloadParts = (taskInput: unknown): readonly ContentPart[] | undefined => {
  if (typeof taskInput !== "object" || taskInput === null) return undefined;
  const parts = (taskInput as { parts?: unknown }).parts;
  return Array.isArray(parts) && parts.length > 0 ? (parts as readonly ContentPart[]) : undefined;
};

/**
 * The seed user-message content for a task. Text-only task: a plain string
 * (`text` when given, else the question). With media: the media parts are kept
 * and text parts are replaced by `text` when given (continuation prompts).
 */
export const taskSeedContent = (taskInput: unknown, text: string): MessageContent => {
  const parts = payloadParts(taskInput);
  if (parts === undefined) return text;
  return normalizeContent([
    { type: "text", text },
    ...parts.filter((p) => p.type !== "text"),
  ]);
};

/**
 * The task seed content, original text order preserved (first-pass seed).
 * Falls back to the plain question text for text-only payloads.
 */
export const taskOriginalContent = (taskInput: unknown, question: string): MessageContent => {
  const parts = payloadParts(taskInput);
  return parts === undefined ? question : normalizeContent(parts);
};

/** Prepend text (history block) to a task input without dropping media parts. */
export const prependTaskText = (input: TaskInput, prefix: (text: string) => string): TaskInput => {
  if (typeof input === "string") return prefix(input);
  const idx = input.findIndex((p) => p.type === "text");
  if (idx === -1) return normalizeTaskInput([{ type: "text", text: prefix("") }, ...input]);
  return normalizeTaskInput(
    input.map((p, i) => (i === idx && p.type === "text" ? { ...p, text: prefix(p.text) } : p)),
  );
};

/** Append text (schema steering) to a task input without dropping media parts. */
export const appendTaskText = (input: TaskInput, suffix: string): TaskInput => {
  if (typeof input === "string") return `${input}${suffix}`;
  const last = [...input].reverse().findIndex((p) => p.type === "text");
  if (last === -1) return normalizeTaskInput([...input, { type: "text", text: suffix }]);
  const idx = input.length - 1 - last;
  return normalizeTaskInput(
    input.map((p, i) => (i === idx && p.type === "text" ? { ...p, text: `${p.text}${suffix}` } : p)),
  );
};

// ─── Modality preflight ───

/** What a model accepts as input, from its resolved capability. */
export interface ModelInputCapabilities {
  /** True when the model accepts image input. */
  readonly vision: boolean;
  /** True/false when known; absent when not known to accept audio. */
  readonly audioIn?: boolean;
  /** True when the answer comes from a probe or the static table (not a guess). */
  readonly authoritative: boolean;
}

const isAuthoritative = (cap: Pick<Capability, "source">): boolean =>
  cap.source === "probe" || cap.source === "static-table";

/**
 * Input modalities a (provider, model) accepts. `authoritative: false` means the
 * capability row is a guess (fallback/inferred/user): the runtime then sends the
 * part and lets a real provider refusal surface.
 */
export const modelInputCapabilities = (provider: string, model: string): ModelInputCapabilities => {
  const cap = resolveCapability(provider, model);
  return {
    vision: cap.supportsVision,
    ...(cap.supportsAudioIn !== undefined ? { audioIn: cap.supportsAudioIn } : {}),
    authoritative: isAuthoritative(cap),
  };
};

/**
 * Fail fast with {@link UnsupportedModalityError} when an image part meets an
 * authoritative no-vision model, or an audio part meets an authoritative
 * model whose `supportsAudioIn` is explicitly false. Text-only input and unknown
 * models pass. File parts pass through to the provider layer.
 */
export const checkTaskInputModality = (
  input: TaskInput,
  provider: unknown,
  model: unknown,
): UnsupportedModalityError | undefined => {
  if (!taskInputHasMedia(input) || typeof provider !== "string" || typeof model !== "string") {
    return undefined;
  }
  if (provider.length === 0 || model.length === 0) return undefined;
  const cap = resolveCapability(provider, model);
  if (!isAuthoritative(cap)) return undefined;
  const parts = input as readonly ContentPart[];
  if (!cap.supportsVision && parts.some((p) => p.type === "image")) {
    return new UnsupportedModalityError({
      message: `Model "${model}" does not accept image input. Use a vision-capable model or remove the image part.`,
      partType: "image",
      model,
    });
  }
  if (cap.supportsAudioIn === false && parts.some((p) => p.type === "audio")) {
    return new UnsupportedModalityError({
      message: `Model "${model}" does not accept audio input. Use an audio-capable model or send the transcript as text.`,
      partType: "audio",
      model,
    });
  }
  return undefined;
};

/** {@link checkTaskInputModality} as an Effect that fails with the typed error. */
export const preflightTaskInput = (
  input: TaskInput,
  provider: unknown,
  model: unknown,
): Effect.Effect<void, UnsupportedModalityError> => {
  const err = checkTaskInputModality(input, provider, model);
  return err === undefined ? Effect.void : Effect.fail(err);
};
