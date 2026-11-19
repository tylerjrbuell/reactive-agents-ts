// File: src/kernel/capabilities/attend/recall-read.ts
/**
 * A `recall(key, full: true)` read is the model asking for stored evidence in
 * full. Cortex trace 01M7TERZAVP2RS489WEBJ3HY7H (2048-token window): the read
 * came back as a 324-char "[recall result — compressed preview]" (the recall
 * JSON compressed like any tool result and re-stored as a new
 * `_tool_result_N`), the duplicate guard replayed that preview, and the model
 * spent 36 recall calls and the run's budget never seeing the content.
 *
 * This module shapes a full recall read instead of compressing it:
 * - the content fits the remaining context: it is returned in full, as plain
 *   text under a one-line header (no JSON escaping, never re-stored);
 * - it does not fit: the header says so (total size, how much fits) and shows
 *   the first section, then names the call that reads the next section
 *   (`recall(key, full: true, start: N)`). The kernel reads `start` from the
 *   model's own call, so a section read works even though the tool's
 *   advertised schema carries only `key`/`content`/`query`/`full`.
 *
 * The content comes from the run's scratchpad (the stored value is complete,
 * past the tool's own `fullReturnCapChars`), else from the tool result's
 * `content` field. Pure: no I/O beyond `resolveScratchpadValue` (spill reads).
 */
import { resolveScratchpadValue } from "@reactive-agents/tools";

/** Rough chars-per-token ratio used to turn a token window into a char budget. */
const CHARS_PER_TOKEN = 4;
/** Share of the window kept for the system prompt and the model's reply. */
const RESERVED_WINDOW_SHARE = 0.25;
/** Window assumed when the profile carries none (matches the tier profiles' 32K floor). */
const DEFAULT_WINDOW_TOKENS = 32_768;
/**
 * Smallest section a read returns when almost nothing fits, so a read always
 * makes progress. The header still states the true fit.
 */
export const MIN_RECALL_SECTION_CHARS = 1000;

/** A full (or sectioned) recall read: `recall(key, full: true[, start: N])`. */
export interface RecallReadRequest {
  readonly key: string;
  readonly start: number;
}

/**
 * The read request when `args` is a full or sectioned recall READ (a key, no
 * `content` to write, no in-entry `query`), else undefined. Pure.
 */
export function recallReadRequest(args: unknown): RecallReadRequest | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const a = args as Record<string, unknown>;
  if (typeof a.key !== "string" || a.key.length === 0) return undefined;
  if (a.content !== undefined && a.content !== null) return undefined;
  if (typeof a.query === "string" && a.query.length > 0) return undefined;
  const start = typeof a.start === "number" && Number.isFinite(a.start) ? Math.max(0, Math.floor(a.start)) : undefined;
  const full = a.full === true || a.full === "true";
  if (!full && start === undefined) return undefined;
  return { key: a.key, start: start ?? 0 };
}

/**
 * Characters the conversation already holds: string message content, other
 * content serialized. An estimate (the projection may compact older turns),
 * so it errs toward less room, never more. Pure.
 */
export function conversationChars(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages as readonly unknown[]) {
    const content = typeof m === "object" && m !== null ? (m as { content?: unknown }).content : undefined;
    if (typeof content === "string") total += content.length;
    else if (content !== undefined) total += JSON.stringify(content)?.length ?? 0;
  }
  return total;
}

/**
 * Characters still free in the context window: the window (chars) minus the
 * reserved share (system prompt + reply) minus what the conversation holds.
 * Never negative. Pure.
 */
export function remainingContextChars(windowTokens: number | undefined, usedChars: number): number {
  const window = windowTokens !== undefined && windowTokens > 0 ? windowTokens : DEFAULT_WINDOW_TOKENS;
  const free = Math.floor(window * CHARS_PER_TOKEN * (1 - RESERVED_WINDOW_SHARE)) - Math.max(0, usedChars);
  return Math.max(0, free);
}

/** The stored text a read returns: the scratchpad's complete value, else the tool result's `content`. */
function readSource(key: string, toolResult: string, scratchpad?: ReadonlyMap<string, string>): string | undefined {
  const stored = scratchpad?.get(key);
  if (typeof stored === "string") return resolveScratchpadValue(stored);
  try {
    const parsed: unknown = JSON.parse(toolResult);
    if (typeof parsed === "object" && parsed !== null) {
      const content = (parsed as Record<string, unknown>).content;
      if (typeof content === "string") return content;
    }
  } catch {
    // Not JSON: the tool result is no recall read record.
  }
  return undefined;
}

/**
 * The text a full recall read returns to the model, or undefined when `args`
 * is not a full/sectioned read or the key holds nothing (the ordinary tool
 * result then stands, e.g. `{ found: false }`). Pure.
 */
export function shapeRecallRead(args: {
  readonly toolArgs: unknown;
  /** The recall tool's stringified result. */
  readonly toolResult: string;
  readonly scratchpad?: ReadonlyMap<string, string>;
  /** The run's effective context window, in tokens. */
  readonly windowTokens?: number;
  /** Characters the conversation already holds ({@link conversationChars}). */
  readonly usedChars?: number;
}): string | undefined {
  const request = recallReadRequest(args.toolArgs);
  if (request === undefined) return undefined;
  const text = readSource(request.key, args.toolResult, args.scratchpad);
  if (text === undefined) return undefined;
  const { key, start } = request;
  const total = text.length;
  if (start >= total) {
    return `[recall "${key}": ${total} chars; start ${start} is past the end. Nothing more to read.]`;
  }
  const rest = total - start;
  const fits = remainingContextChars(args.windowTokens, args.usedChars ?? 0);
  // The minimum section can reach the end on its own: that is the rest, in full.
  if (rest <= Math.max(fits, MIN_RECALL_SECTION_CHARS)) {
    const range = start === 0 ? `full content, ${total} chars` : `chars ${start}-${total} of ${total} (the rest of it)`;
    return `[recall "${key}": ${range}]\n${text.slice(start)}`;
  }
  const end = start + Math.max(fits, MIN_RECALL_SECTION_CHARS);
  return (
    `[recall "${key}": ${total} chars; about ${fits} chars fit in the remaining context, ` +
    `so this is chars ${start}-${end} of ${total}. Read the next section with ` +
    `recall("${key}", full: true, start: ${end}).]\n${text.slice(start, end)}`
  );
}
