/**
 * Slash commands for the chat input. Pure data + parsing so the menu and the
 * executor share one source of truth and the rules are unit-testable.
 */
import type { IconName } from "./icons.js";

export type ChatCommandName =
  | "clear" | "compact" | "fork" | "rerun" | "rewind" | "copy" | "export" | "rename" | "help"
  | "model" | "provider" | "thinking" | "skill" | "skills" | "docs"
  | "strategy" | "tools" | "terminal" | "workspace" | "iterations" | "approvals"
  | "durable" | "goal" | "plan" | "execute" | "go" | "loop" | "schedule" | "agent" | "mcp" | "btw";

/** What `/cmd <partial>` offers as second-level choices. */
export type ChatPicker = "model" | "thinking" | "skill" | "skill-once" | "doc" | "strategy" | "tools" | "terminal" | "workspace" | "iterations" | "approvals" | "durable" | "mcp" | "agent";

export interface ChatCommand {
  readonly name: ChatCommandName;
  /** Kit icon (`lib/icons.ts`); a name outside the set is a type error. */
  readonly icon: IconName;
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
  { name: "clear", icon: "trash", summary: "Clear the conversation context", needsTurns: true },
  { name: "fork", icon: "fork", summary: "Fork this chat into a new session", needsTurns: true },
  { name: "rerun", icon: "retry", summary: "Regenerate the last answer", needsTurns: true },
  { name: "rewind", icon: "undo", summary: "Drop the last exchange and put your message back in the input", needsTurns: true },
  { name: "copy", icon: "copy", summary: "Copy the whole conversation", needsTurns: true },
  { name: "export", icon: "download", summary: "Download the conversation as Markdown, JSON or JSONL traces", arg: "[md|json|jsonl]", needsTurns: true },
  { name: "model", icon: "model", summary: "Switch the provider and model for this chat", arg: "[provider | model]", needsTurns: false, picker: "model" },
  { name: "provider", icon: "cloud", summary: "Switch the provider and model for this chat (same picker as /model)", arg: "[provider | model]", needsTurns: false, picker: "model" },
  { name: "thinking", icon: "think", summary: "Turn model thinking on, off or auto", arg: "[on|off|auto]", needsTurns: false, picker: "thinking" },
  { name: "skill", icon: "bolt", summary: "Use a workspace skill for your next message only", arg: "[skill]", needsTurns: false, picker: "skill-once" },
  { name: "skills", icon: "bolt", summary: "Pin workspace skills for every turn of this chat", arg: "[skill]", needsTurns: false, picker: "skill" },
  { name: "docs", icon: "book", summary: "Give the agent documents to search (RAG)", arg: "[add <path|url>]", needsTurns: false, picker: "doc" },
  { name: "strategy", icon: "strategy", summary: "Switch the reasoning strategy", arg: "[strategy]", needsTurns: false, picker: "strategy" },
  { name: "tools", icon: "tool", summary: "Choose tools: toolsets, single tools, MCP servers, saved agents, how tools are shown", arg: "[tool]", needsTurns: false, picker: "tools" },
  { name: "terminal", icon: "shell", summary: "Turn the shell off, on this machine, or in a Docker sandbox", arg: "[off|host|docker]", needsTurns: false, picker: "terminal" },
  { name: "mcp", icon: "server", summary: "Turn an MCP server on for this chat, or add one from a command or URL", arg: "[server | add <command|URL>]", needsTurns: false, picker: "mcp" },
  { name: "btw", icon: "info", summary: "Ask a side question about this run; it never changes the run", arg: "<question>", needsTurns: false },
  { name: "workspace", icon: "folder", summary: "Set the directory file tools and the shell work in", arg: "[/absolute/path]", needsTurns: false, picker: "workspace" },
  { name: "iterations", icon: "steps", summary: "Cap the steps one turn may take", arg: "[number]", needsTurns: false, picker: "iterations" },
  { name: "approvals", icon: "pause", summary: "Choose which tools and shell commands wait for your approval", arg: "[add <command>]", needsTurns: false, picker: "approvals" },
  { name: "durable", icon: "retry", summary: "Make this chat resumable: Stop and Pause can be continued; approvals and questions pause durably", arg: "[on|off]", needsTurns: false, picker: "durable" },
  { name: "goal", icon: "goal", summary: "Pursue an objective across several turns (propose, then accept)", arg: "<objective|pause|resume|cancel|status>", needsTurns: false },
  { name: "plan", icon: "checklist", summary: "Plan mode: reasoning only, no tools, until you /execute (or show / hide the to-do dock)", arg: "[task | show | hide]", needsTurns: false },
  { name: "execute", icon: "play", summary: "Execute mode: the agent may use its tools again", arg: "[message]", needsTurns: false },
  { name: "go", icon: "play", summary: "Alias of /execute", arg: "[message]", needsTurns: false },
  { name: "loop", icon: "retry", summary: "Re-run a prompt on an interval (5m, 1h, 1d)", arg: "<5m|1h|1d> <prompt> | stop", needsTurns: false },
  { name: "schedule", icon: "clock", summary: "Run a prompt on a cron schedule", arg: '"<cron>" <prompt> | list | rm <id>', needsTurns: false },
  { name: "agent", icon: "agents", summary: "Let the agent manage this chat: it proposes, you approve each change (off by default)", arg: "[on|off]", needsTurns: false, picker: "agent" },
  { name: "rename", icon: "edit", summary: "Rename this chat", arg: "<name>", needsTurns: false },
  { name: "help", icon: "info", summary: "List slash commands", needsTurns: false },
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

/** Commands matching the typed text: exact name first, then prefix matches, then substring, each in registry order. */
export function matchCommands(query: string): readonly ChatCommand[] {
  if (query === "") return CHAT_COMMANDS;
  const exact = CHAT_COMMANDS.filter((c) => c.name === query);
  const prefix = CHAT_COMMANDS.filter((c) => c.name !== query && c.name.startsWith(query));
  const rest = CHAT_COMMANDS.filter((c) => !c.name.startsWith(query) && c.name.includes(query));
  return [...exact, ...prefix, ...rest];
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

/** `/export json` → "json"; no arg → "md"; anything else → undefined (rejected with a hint). */
export function parseExportFormat(arg: string): "md" | "json" | "jsonl" | undefined {
  const a = arg.trim().toLowerCase();
  if (a === "") return "md";
  return a === "md" || a === "json" || a === "jsonl" ? a : undefined;
}
