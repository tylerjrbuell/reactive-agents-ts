/**
 * Turns what a person SAID into the answer to a question the agent asked
 * (`request_user_input`). Pure and deterministic: no model, no network. Used by
 * voice mode's question flow (`voice-question.ts`).
 *
 * The spec mirrors the shapes a question can take: free text, single or multiple
 * choice, yes/no, a number. `voiceQuestionSpec` maps today's wire shape (`kind` +
 * `schema`, see `chat-interactions.ts`) to one; a structured multi-part question
 * plugs in by producing a spec per part.
 *
 * An utterance ending in an explicit confirm phrase ("... send it") comes back with
 * `confirmed: true` and the phrase removed. Everything else is a candidate the
 * person confirms or changes first.
 */
import { choiceOptions } from "../chat-interactions.js";

/** What kind of answer a question wants. */
export type VoiceQuestionSpec =
  | { readonly kind: "text" }
  | { readonly kind: "choice"; readonly options: readonly string[]; readonly multi?: boolean }
  | { readonly kind: "boolean" }
  | { readonly kind: "number"; readonly min?: number; readonly max?: number };

/** An answer value. */
export type VoiceAnswerValue = string | number | boolean | readonly string[];

/** The result of matching an utterance. */
export type VoiceAnswerMatch =
  | {
      readonly type: "answer";
      readonly value: VoiceAnswerValue;
      /** How to say / show it back ("Staging", "yes", "42"). */
      readonly display: string;
      /** The person said an explicit confirm phrase, so it may be sent without asking again. */
      readonly confirmed: boolean;
    }
  | { readonly type: "ambiguous"; readonly candidates: readonly string[] }
  | { readonly type: "none" };

/** The spec for a question of the wire shape the chat carries today (`kind` + `schema`). */
export function voiceQuestionSpec(q: { readonly kind: string; readonly schema: unknown }): VoiceQuestionSpec {
  if (q.kind === "confirmation") return { kind: "boolean" };
  if (q.kind === "choice") {
    const options = choiceOptions(q.schema);
    if (options.length > 0) return { kind: "choice", options };
  }
  return { kind: "text" };
}

/** Lowercase words only: punctuation to spaces, apostrophes dropped, runs collapsed. */
export function normalizeSpoken(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/,/g, " and ")
    .replace(/[^\p{L}\p{N}.\-\s]/gu, " ")
    .replace(/[.\-](?!\p{N})/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CONFIRM_TAIL =
  /(?:^|\s)(?:and\s+)?(?:(?:please\s+)?(?:send|submit)(?:\s+(?:it|that|this|my answer|the answer|answer))?(?:\s+now)?|confirm(?:ed)?|thats it send|that is it send)(?:\s+please)?$/;

/** The utterance without a trailing confirm phrase, and whether there was one. */
export function stripConfirm(normalized: string): { readonly text: string; readonly confirmed: boolean } {
  const m = CONFIRM_TAIL.exec(normalized);
  if (m === null) return { text: normalized, confirmed: false };
  return { text: normalized.slice(0, m.index).replace(/\s+(?:and|then)$/, "").trim(), confirmed: true };
}

/** What a reply to "I heard X" means: confirm it, throw it away, or neither. */
export function confirmIntent(utterance: string): "confirm" | "reject" | "unknown" {
  const u = normalizeSpoken(utterance);
  if (/^(?:yes|yeah|yep|yup|correct|right|thats right|that is right|thats correct|send|send it|send that|submit|confirm|confirmed|okay send it|ok send it|yes send it|yes please|do it)$/.test(u)) return "confirm";
  if (/^(?:no|nope|nah|wrong|change|change it|cancel|again|redo|try again|say again|thats wrong|that is wrong|not that|never mind|nevermind)$/.test(u)) return "reject";
  return "unknown";
}

// ── yes / no ───────────────────────────────────────────────────────────────

const YES = new Set(["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "correct", "affirmative", "true", "right", "absolutely", "definitely", "certainly", "indeed", "please do", "do it", "go ahead", "of course", "sounds good"]);
const NO = new Set(["no", "nope", "nah", "negative", "false", "wrong", "incorrect", "dont", "do not", "never", "absolutely not", "of course not", "no way"]);

function matchBoolean(u: string): VoiceAnswerMatch {
  const words = u.split(" ");
  const phrases = new Set<string>();
  for (let i = 0; i < words.length; i += 1) {
    phrases.add(words[i] ?? "");
    if (i + 1 < words.length) phrases.add(`${words[i]} ${words[i + 1]}`);
  }
  const yes = [...phrases].some((p) => YES.has(p));
  const no = [...phrases].some((p) => NO.has(p));
  if (yes && no) {
    // "absolutely not", "of course not" read as no; any other mix is a contradiction.
    if (/\b(?:absolutely|of course) not\b/.test(u) && !/\b(?:yes|yeah|yep|yup|sure|ok|okay|correct)\b/.test(u)) return { type: "answer", value: false, display: "no", confirmed: false };
    return { type: "ambiguous", candidates: ["yes", "no"] };
  }
  if (yes) return { type: "answer", value: true, display: "yes", confirmed: false };
  if (no) return { type: "answer", value: false, display: "no", confirmed: false };
  return { type: "none" };
}

// ── numbers ────────────────────────────────────────────────────────────────

const UNITS: Readonly<Record<string, number>> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Readonly<Record<string, number>> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** A whole number written in words ("forty two", "a hundred and five", "two thousand"), up to 999,999; `null` otherwise. */
export function wordsToInteger(words: readonly string[]): number | null {
  if (words.length === 0) return null;
  let total = 0;
  let chunk = 0;
  let any = false;
  for (const w of words) {
    if (w === "and" || w === "a") {
      if (w === "a" && !any) {
        any = true; // "a hundred"
        chunk = 1;
      }
      continue;
    }
    if (w in UNITS) {
      chunk += UNITS[w] as number;
    } else if (w in TENS) {
      chunk += TENS[w] as number;
    } else if (w === "hundred") {
      chunk = (chunk === 0 ? 1 : chunk) * 100;
    } else if (w === "thousand") {
      total += (chunk === 0 ? 1 : chunk) * 1000;
      chunk = 0;
    } else {
      return null;
    }
    any = true;
  }
  return any ? total + chunk : null;
}

/** The number in an utterance: digits ("3.5", "-4", "1,000") or words ("minus three point five"), or `null`. */
export function parseSpokenNumber(utterance: string): number | null {
  const u = normalizeSpoken(utterance.replace(/(\d),(?=\d{3}\b)/g, "$1"));
  const digits = /^(?:the number |its |it is |about |around )?(-?\d+(?:\.\d+)?)$/.exec(u);
  if (digits !== null) return Number(digits[1]);
  let words = u.replace(/^(?:the number |its |it is |about |around )/, "").split(" ").filter((w) => w !== "");
  let sign = 1;
  if (words[0] === "minus" || words[0] === "negative") {
    sign = -1;
    words = words.slice(1);
  }
  const pointAt = words.indexOf("point");
  const whole = wordsToInteger(pointAt === -1 ? words : words.slice(0, pointAt));
  if (whole === null) return null;
  if (pointAt === -1) return sign * whole;
  const frac = words.slice(pointAt + 1);
  if (frac.length === 0 || !frac.every((w) => w in UNITS && (UNITS[w] as number) < 10)) return null;
  return sign * Number(`${whole}.${frac.map((w) => UNITS[w]).join("")}`);
}

// ── choices ────────────────────────────────────────────────────────────────

const ORDINALS: Readonly<Record<string, number>> = {
  first: 0, "1st": 0, one: 0, "1": 0,
  second: 1, "2nd": 1, two: 1, "2": 1,
  third: 2, "3rd": 2, three: 2, "3": 2,
  fourth: 3, "4th": 3, four: 3, "4": 3,
  fifth: 4, "5th": 4, five: 4, "5": 4,
  sixth: 5, "6th": 5, six: 5, "6": 5,
  seventh: 6, "7th": 6, seven: 6, "7": 6,
  eighth: 7, "8th": 7, eight: 7, "8": 7,
  ninth: 8, "9th": 8, nine: 8, "9": 8,
  tenth: 9, "10th": 9, ten: 9, "10": 9,
};
const LEAD = /^(?:i\s+(?:would\s+)?(?:pick|choose|select|take|want|like|say)|ill\s+(?:pick|take|go with|have)|lets\s+(?:go with|do|pick|take)|go with|going with|pick|choose|select|take|my answer is|answer is|it is|its|the answer is)\s+/;
const PREFIX_NOISE = /^(?:the|option|choice|number|answer|letter|item|one called|called)\s+/;
const TAIL_NOISE = /\s+(?:one|please|option|choice|thanks|thank you)$/;

/** Words that make a choice answer ambiguous when they are not part of a label ("not staging"). */
const NEGATION = /(?:^|\s)(?:not|dont|never|except|neither|nor|without)(?:\s|$)/;

function stripChoiceNoise(u: string): string {
  let s = u;
  for (let i = 0; i < 3; i += 1) {
    const before = s;
    s = s.replace(LEAD, "").replace(PREFIX_NOISE, "").replace(TAIL_NOISE, "").trim();
    if (s === before) break;
  }
  return s;
}

/** The option an ordinal / letter / number token names, or `null`. */
function indexOfToken(token: string, count: number): number | null {
  if (token === "last") return count - 1;
  if (token in ORDINALS) {
    const i = ORDINALS[token] as number;
    return i < count ? i : null;
  }
  if (/^[a-j]$/.test(token)) {
    const i = token.charCodeAt(0) - 97;
    return i < count ? i : null;
  }
  return null;
}

function matchOne(u: string, options: readonly string[]): { index: number } | { ambiguous: number[] } | null {
  const labels = options.map(normalizeSpoken);
  const exact = labels.map((l, i) => (l === u ? i : -1)).filter((i) => i >= 0);
  if (exact.length === 1) return { index: exact[0] as number };
  if (exact.length > 1) return { ambiguous: exact };
  if (NEGATION.test(u)) return null;

  const core = stripChoiceNoise(u);
  const exactCore = labels.map((l, i) => (l === core ? i : -1)).filter((i) => i >= 0);
  if (exactCore.length === 1) return { index: exactCore[0] as number };

  // "the second one", "option b", "number 2", "last".
  const idx = indexOfToken(core, options.length);
  if (idx !== null) return { index: idx };
  const tail = core.split(" ");
  if (tail.length === 2 && (tail[0] === "the" || tail[0] === "option") && tail[1] !== undefined) {
    const i2 = indexOfToken(tail[1], options.length);
    if (i2 !== null) return { index: i2 };
  }

  // A whole option label said inside a longer sentence: the longest one wins.
  const padded = ` ${core} `;
  const inside = labels.map((l, i) => (l !== "" && padded.includes(` ${l} `) ? i : -1)).filter((i) => i >= 0);
  if (inside.length > 0) {
    const longest = Math.max(...inside.map((i) => (labels[i] as string).length));
    const best = inside.filter((i) => (labels[i] as string).length === longest);
    return best.length === 1 ? { index: best[0] as number } : { ambiguous: best };
  }

  // The start of a label ("prod" for "production"): a unique start is the answer.
  if (core.length >= 2) {
    const starts = labels.map((l, i) => (l.startsWith(core) ? i : -1)).filter((i) => i >= 0);
    if (starts.length === 1) return { index: starts[0] as number };
    if (starts.length > 1) return { ambiguous: starts };
  }
  return null;
}

function matchChoice(u: string, options: readonly string[], multi: boolean): VoiceAnswerMatch | null {
  if (options.length === 0) return null;
  if (multi && /^(?:all|all of them|everything|every one|all of the above|both)$/.test(stripChoiceNoise(u))) {
    const all = [...options];
    return { type: "answer", value: all, display: all.join(", "), confirmed: false };
  }
  // A list ("cheese and olives") is matched part by part; a label that itself
  // contains "and" is taken whole first.
  const wholeLabel = options.some((o) => normalizeSpoken(o) === u);
  const parts = multi && !wholeLabel ? u.split(/\s+(?:and|plus|also|then)\s+/).map((p) => p.trim()).filter((p) => p !== "") : [];
  if (parts.length < 2) {
    const single = matchOne(u, options);
    if (single === null) return null;
    if ("ambiguous" in single) return { type: "ambiguous", candidates: single.ambiguous.map((i) => options[i] as string) };
    const label = options[single.index] as string;
    return { type: "answer", value: multi ? [label] : label, display: label, confirmed: false };
  }
  const picked: number[] = [];
  for (const part of parts) {
    const m = matchOne(part, options);
    if (m === null) return null;
    if ("ambiguous" in m) return { type: "ambiguous", candidates: m.ambiguous.map((i) => options[i] as string) };
    if (!picked.includes(m.index)) picked.push(m.index);
  }
  const labels = picked.sort((a, b) => a - b).map((i) => options[i] as string);
  return { type: "answer", value: labels, display: labels.join(", "), confirmed: false };
}

// ── entry ──────────────────────────────────────────────────────────────────

/**
 * Match one utterance against a question. `answer` carries the value and how to read
 * it back; `ambiguous` lists the options it could be (ask the person to say which);
 * `none` means nothing usable was heard (ask them to repeat).
 */
export function matchSpokenAnswer(utterance: string, spec: VoiceQuestionSpec): VoiceAnswerMatch {
  const normalized = normalizeSpoken(utterance);
  if (normalized === "") return { type: "none" };
  const { text: u, confirmed } = stripConfirm(normalized);
  const withConfirm = (m: VoiceAnswerMatch): VoiceAnswerMatch => (m.type === "answer" ? { ...m, confirmed } : m);

  switch (spec.kind) {
    case "text": {
      // Free text keeps the person's own words, not the normalized form.
      const raw = confirmed ? stripTrailingConfirmRaw(utterance) : utterance.trim();
      return raw === "" ? { type: "none" } : { type: "answer", value: raw, display: raw, confirmed };
    }
    case "boolean": {
      if (u === "") return { type: "none" };
      return withConfirm(matchBoolean(u));
    }
    case "number": {
      const n = parseSpokenNumber(u);
      if (n === null) return { type: "none" };
      if ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max)) return { type: "none" };
      return { type: "answer", value: n, display: String(n), confirmed };
    }
    case "choice": {
      if (u === "") return { type: "none" };
      const m = matchChoice(u, spec.options, spec.multi === true);
      return m === null ? { type: "none" } : withConfirm(m);
    }
  }
}

/** The raw utterance without its trailing confirm phrase (keeps case and punctuation of the rest). */
function stripTrailingConfirmRaw(raw: string): string {
  const stripped = raw.replace(
    /[\s,.;:!-]*(?:and\s+)?(?:(?:please\s+)?(?:send|submit)(?:\s+(?:it|that|this|my answer|the answer|answer))?(?:\s+now)?|confirm(?:ed)?|that['’]?s it,?\s+send(?:\s+it)?)(?:\s+please)?[\s.!]*$/i,
    "",
  );
  return stripped.trim();
}
