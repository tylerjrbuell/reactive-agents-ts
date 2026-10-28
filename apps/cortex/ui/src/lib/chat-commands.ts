/**
 * Slash commands for the chat input. Pure data + parsing so the menu and the
 * executor share one source of truth and the rules are unit-testable.
 */

export type ChatCommandName =
  | "clear" | "compact" | "fork" | "rerun" | "rewind" | "copy" | "rename" | "help"
  | "model" | "provider" | "thinking" | "skills" | "docs";

/** What `/cmd <partial>` offers as second-level choices. */
export type ChatPicker = "model" | "provider" | "thinking" | "skill" | "doc";

export interface ChatCommand {
  readonly name: ChatCommandName;
  readonly icon: string;
  readonly summary: string;
  /** Argument hint shown in the menu, e.g. `<name>`. Absent = takes none. */
  readonly arg?: string;
  /** Needs at least one message in the chat. */
  readonly needsTurns: boolean;
  /** Second-level choices shown after the command and a space. */
  readonly picker?: ChatPicker;
}

export const CHAT_COMMANDS: readonly ChatCommand[] = [
  { name: "compact", icon: "compress", summary: "Summarise older messages to shrink context", arg: "[keep-last]", needsTurns: true },
  { name: "clear", icon: "delete_sweep", summary: "Clear the conversation context", needsTurns: true },
  { name: "fork", icon: "call_split", summary: "Fork this chat into a new session", needsTurns: true },
  { name: "rerun", icon: "refresh", summary: "Regenerate the last answer", needsTurns: true },
  { name: "rewind", icon: "undo", summary: "Drop the last exchange and put your message back in the input", needsTurns: true },
  { name: "copy", icon: "content_copy", summary: "Copy the whole conversation", needsTurns: true },
  { name: "model", icon: "memory", summary: "Switch the model for this chat", arg: "[model]", needsTurns: false, picker: "model" },
  { name: "provider", icon: "cloud", summary: "Switch the provider for this chat", arg: "[provider]", needsTurns: false, picker: "provider" },
  { name: "thinking", icon: "psychology", summary: "Turn model thinking on, off or auto", arg: "[on|off|auto]", needsTurns: false, picker: "thinking" },
  { name: "skills", icon: "bolt", summary: "Pin skills for every run (pick a skill from / to use it once)", arg: "[skill]", needsTurns: false, picker: "skill" },
  { name: "docs", icon: "menu_book", summary: "Give the agent documents to search (RAG)", arg: "[add <path|url>]", needsTurns: false, picker: "doc" },
  { name: "rename", icon: "edit", summary: "Rename this chat", arg: "<name>", needsTurns: false },
  { name: "help", icon: "help", summary: "List slash commands", needsTurns: false },
];

export interface ParsedSlash {
  /** Text after the `/` up to the first space. */
  readonly query: string;
  /** Everything after the first space, trimmed. */
  readonly arg: string;
  /** True once the user typed a space: they are past picking a command. */
  readonly hasArg: boolean;
}

/**
 * A slash input is a single line that starts with `/` followed by a command-shaped word
 * (letters and dashes). Anything else, such as `/usr/bin/env` or `/ 5 apples`, is an
 * ordinary message and must be sent as typed.
 */
export function parseSlash(input: string): ParsedSlash | null {
  if (!input.startsWith("/") || input.includes("\n")) return null;
  const body = input.slice(1);
  const space = body.search(/\s/);
  const word = (space === -1 ? body : body.slice(0, space)).toLowerCase();
  if (!/^[a-z-]*$/.test(word)) return null;
  if (space === -1) return { query: word, arg: "", hasArg: false };
  if (word === "") return null;
  return { query: word, arg: body.slice(space + 1).trim(), hasArg: true };
}

/** Commands matching the typed prefix (prefix matches first, then substring), in registry order. */
export function matchCommands(query: string): readonly ChatCommand[] {
  if (query === "") return CHAT_COMMANDS;
  const prefix = CHAT_COMMANDS.filter((c) => c.name.startsWith(query));
  const rest = CHAT_COMMANDS.filter((c) => !c.name.startsWith(query) && c.name.includes(query));
  return [...prefix, ...rest];
}

/** The exact command named by the input, if any (what Enter executes). */
export function resolveCommand(parsed: ParsedSlash): ChatCommand | undefined {
  return CHAT_COMMANDS.find((c) => c.name === parsed.query);
}

/** `/compact 3` → 3; missing or invalid → undefined (server default). */
export function parseKeepLast(arg: string): number | undefined {
  if (arg === "") return undefined;
  const n = Number(arg);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}
