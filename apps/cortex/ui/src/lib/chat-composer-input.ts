/**
 * What the chat composer does with its text on send, and how a skill pick changes the
 * text. Pure; ChatPanel wires it. Token grammar: `chat-inline-commands.ts`.
 */
import { parseSlash, resolveCommand, type ChatCommand, type ParsedSlash } from "./chat-commands.js";
import {
  inlineActivations,
  insertAtCaret,
  parseInlineCommands,
  promptWithoutCommands,
  removeSkillTokens,
  type InlineTrigger,
} from "./chat-inline-commands.js";

/** How one piece of composer input is handled. */
export type ComposerRoute =
  /** A slash command that owns the whole message (`/clear`, `/plan task`, or an unknown `/word`). */
  | { readonly kind: "command"; readonly parsed: ParsedSlash; readonly command: ChatCommand | undefined }
  /** A chat message, its recognized skill tokens stripped from `prompt`. */
  | { readonly kind: "message"; readonly prompt: string; readonly turnSkills: readonly string[]; readonly sessionSkills: readonly string[] }
  /** Only skill tokens, no message: nothing to send yet. */
  | { readonly kind: "skills-only"; readonly skills: readonly string[] };

/**
 * Route the composer text. A leading command other than `/skill` / `/skills` keeps
 * the whole message (as before). Otherwise recognized skill tokens anywhere in the
 * text are activated and removed from the prompt; a leading `/word` that is neither a
 * command nor a skill stays a command (the "Unknown command" hint).
 */
export function routeComposerInput(text: string, skills: readonly string[]): ComposerRoute {
  const parsed = parseSlash(text);
  const command = parsed ? resolveCommand(parsed) : undefined;
  if (parsed && command && command.name !== "skill" && command.name !== "skills") return { kind: "command", parsed, command };
  const segments = parseInlineCommands(text, skills);
  const { turn, session } = inlineActivations(segments);
  const prompt = promptWithoutCommands(segments);
  if (turn.length + session.length > 0) {
    return prompt === "" ? { kind: "skills-only", skills: [...turn, ...session] } : { kind: "message", prompt, turnSkills: turn, sessionSkills: session };
  }
  if (parsed) return { kind: "command", parsed, command };
  return { kind: "message", prompt, turnSkills: [], sessionSkills: [] };
}

/** Recognized skills in a draft (for the quick bar's "next message" chips and the menu's check marks). */
export function draftSkills(text: string, skills: readonly string[]): string[] {
  const { turn, session } = inlineActivations(parseInlineCommands(text, skills));
  return [...new Set([...turn, ...session])];
}

/** Where the skill menu was opened from, and the draft it must keep. */
export interface SkillPickSource {
  /** Composer text now. */
  readonly message: string;
  /** The partial `/word` at the caret (inline menu), if that is what opened the menu. */
  readonly trigger: InlineTrigger | null;
  /** A quick-bar chip replaced the draft with its command; this is the draft (may be empty). */
  readonly chipStash: string | null;
  /** Caret in the draft when the chip was clicked. */
  readonly chipCaret: number | null;
  readonly chipActive: boolean;
}

/**
 * A skill row was picked. The draft is never replaced:
 * - inline menu: the typed `/partial` becomes `/<skill> `;
 * - quick-bar chip: back to the draft with `/<skill> ` at its caret, or that skill's
 *   tokens removed when it is already there (the row is a toggle);
 * - a leading `/partial` or `/skill partial` that is the whole composer: `/<skill> `.
 */
export function pickSkill(src: SkillPickSource, skills: readonly string[], skill: string): { text: string; caret: number } {
  const token = `/${skill}`;
  if (src.trigger !== null) return insertAtCaret(src.message, src.trigger.start, src.trigger.end, token, { sep: "", trailingSpace: true });
  if (src.chipActive) {
    const draft = src.chipStash ?? "";
    if (draftSkills(draft, skills).includes(skill)) {
      const text = removeSkillTokens(draft, skills, skill);
      return { text, caret: Math.min(src.chipCaret ?? text.length, text.length) };
    }
    const at = src.chipCaret ?? draft.length;
    return insertAtCaret(draft, at, at, token, { trailingSpace: true });
  }
  return insertAtCaret("", 0, 0, token, { trailingSpace: true });
}
