/**
 * Text and turn rules voice features share: the transcript as one reading, and how a
 * chat turn finishing, failing or waiting maps to a voice-mode event. Pure.
 */
import type { VoiceModeEvent, VoiceWaitingOn } from "@reactive-agents/ui-core";
import { voiceQuestionSpec } from "./voice-answer.js";
import type { VoiceQuestion } from "./voice-question.js";
import { questionsOf, type StructuredAnswerValue } from "../structured-questions.js";
import { nextVoiceStep } from "./voice-structured.js";

/** What the Settings Test buttons read aloud. */
export const VOICE_TEST_TEXT = "Cortex voice test. This is how replies will sound.";

/** The slice of a chat turn these rules read. */
export interface VoiceTurnLike {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly streaming?: boolean | undefined;
  readonly cancelled?: boolean | undefined;
  readonly runFailed?: unknown;
  readonly liveApproval?: unknown;
  readonly awaitingApproval?: boolean | undefined;
  readonly liveInteraction?: unknown;
}

/**
 * The whole conversation as one text to read aloud: "You said" / "Agent replied"
 * before each turn so a listener can tell who is speaking. Empty turns are skipped.
 */
export function transcriptMarkdown(turns: readonly VoiceTurnLike[]): string {
  return turns
    .filter((t) => t.content.trim() !== "" && t.streaming !== true)
    .map((t) => `${t.role === "user" ? "You said." : "The agent replied."}\n\n${t.content.trim()}`)
    .join("\n\n");
}

/** What the streaming (or latest) assistant turn is blocked on. */
export function waitingOf(turns: readonly VoiceTurnLike[]): VoiceWaitingOn {
  const last = [...turns].reverse().find((t) => t.role === "assistant");
  if (last === undefined) return null;
  if (last.liveInteraction !== undefined && last.liveInteraction !== null) return "question";
  if ((last.liveApproval !== undefined && last.liveApproval !== null) || last.awaitingApproval === true) return "approval";
  return null;
}

/**
 * The live question the latest assistant turn is blocked on, in the shape the voice
 * question flow takes, or `null` (no question, or the turn is not streaming).
 * An approval is never a question here: it always needs a click.
 *
 * A structured ask (typed `questions`) yields its next unanswered REQUIRED question,
 * given the answers `collected` for it so far (`voice-structured.ts`); `null` once none
 * is left, while {@link liveQuestionOpen} still says the ask is open.
 */
export function voiceQuestionOf(
  turns: readonly VoiceTurnLike[],
  collected: (interactionId: string) => Readonly<Record<string, StructuredAnswerValue>> = () => ({}),
): VoiceQuestion | null {
  const last = [...turns].reverse().find((t) => t.role === "assistant");
  const q = last?.liveInteraction;
  if (last === undefined || last.streaming !== true || typeof q !== "object" || q === null) return null;
  const o = q as Record<string, unknown>;
  if (typeof o.interactionId !== "string" || typeof o.prompt !== "string" || typeof o.kind !== "string" || o.prompt.trim() === "") return null;
  if (questionsOf(o).length > 0) return nextVoiceStep({ interactionId: o.interactionId, questions: o.questions, schema: o.schema }, collected(o.interactionId));
  return { id: o.interactionId, prompt: o.prompt, spec: voiceQuestionSpec({ kind: o.kind, schema: o.schema }) };
}

/** Whether the latest assistant turn is streaming and holds a live question (answered or not). */
export function liveQuestionOpen(turns: readonly VoiceTurnLike[]): boolean {
  const last = [...turns].reverse().find((t) => t.role === "assistant");
  return last !== undefined && last.streaming === true && typeof last.liveInteraction === "object" && last.liveInteraction !== null;
}

/** Chat state before and after an update. */
export interface ChatSnapshot {
  readonly sending: boolean;
  readonly turns: readonly VoiceTurnLike[];
  /** The store's error text, when the turn failed outright. */
  readonly error?: string | null | undefined;
}

/**
 * The voice-mode event a chat update implies, or `null`: a reply when a run that was
 * sending has finished with an answer, a failure when it ended in one. A stopped
 * turn gives nothing (the person stopped it; voice mode handled that).
 */
export function replyEventOf(prev: ChatSnapshot, next: ChatSnapshot): VoiceModeEvent | null {
  if (!prev.sending || next.sending) return null;
  const last = [...next.turns].reverse().find((t) => t.role === "assistant");
  if (last === undefined) return next.error ? { type: "reply-failed", message: next.error } : null;
  if (last.cancelled === true) return null;
  if (next.error) return { type: "reply-failed", message: next.error };
  if (last.runFailed !== undefined && last.runFailed !== null) return { type: "reply-failed", message: "The agent could not finish that request." };
  const text = last.content.trim();
  return { type: "reply", text: text !== "" ? text : "The agent finished." };
}
