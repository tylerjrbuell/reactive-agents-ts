/**
 * The one command surface of the chat composer (pure; `ChatPanel.svelte` and
 * `ChatSlashMenu.svelte` render it).
 *
 * Typing `/` and pressing the Config button open the SAME list, anchored to the
 * composer: every slash command (`CHAT_COMMANDS`), the settings among them shown with
 * their current value. A command with a panel (`/model`, `/tools`, `/agent`, …) drills
 * into it in place under a Back row; a command without one runs at once. The place the
 * user is at lives in the composer text, so there is no second state to keep in sync:
 * `/` or `/mod` is the root (filtered by what follows the slash), `/model ` is that
 * command's panel. Back and Escape go up one level, then close.
 *
 * The Config rows (`configGroups`, `chat-composer-bar.ts`) are the same entries seen
 * through their current values: {@link settingEntries} joins them to the commands by
 * alias, so the registry has one source (`chat-commands.ts`).
 */
import type { ConfigGroup } from "./chat-composer-bar.js";
import { CHAT_COMMANDS, matchCommands, resolveCommand, type ChatCommand, type ParsedSlash } from "./chat-commands.js";

/** A setting's current state as the root list shows it next to its slash alias. */
export interface EntryState {
  /** The Config row's name, e.g. "Agent control" (also matched when filtering). */
  readonly label: string;
  /** Current value, e.g. "ollama" or "risky tools". */
  readonly value: string;
  /** Differs from the default. */
  readonly on: boolean;
}

/** `"/tools disclosure"` → `"tools"`: the command a Config row's slash alias belongs to. */
export function commandNameOf(cmd: string): string {
  return cmd.trim().replace(/^\//, "").split(/\s+/)[0] ?? "";
}

/**
 * Current state per command name, from the Config rows. A command with several rows
 * (`/tools` has Tools and Tool disclosure) is described by its first.
 */
export function settingEntries(groups: readonly ConfigGroup[]): ReadonlyMap<string, EntryState> {
  const out = new Map<string, EntryState>();
  for (const g of groups) {
    for (const r of g.rows) {
      const name = commandNameOf(r.cmd);
      if (!out.has(name)) out.set(name, { label: r.label, value: r.value, on: r.on });
    }
  }
  return out;
}

/**
 * Commands for the root list: those whose name matches the text after the slash
 * (`matchCommands`), then settings whose Config name matches (`/control` finds
 * `/agent`). Empty text lists every command.
 */
export function matchEntries(query: string, settings: ReadonlyMap<string, EntryState>): readonly ChatCommand[] {
  const byName = matchCommands(query);
  if (query === "") return byName;
  const seen = new Set(byName.map((c) => c.name));
  const byLabel = CHAT_COMMANDS.filter((c) => !seen.has(c.name) && (settings.get(c.name)?.label.toLowerCase().replace(/\s+/g, "-").includes(query) ?? false));
  return [...byName, ...byLabel];
}

/** Where the user is on the surface. */
export type SurfaceView =
  | { readonly kind: "closed" }
  | { readonly kind: "root"; readonly query: string }
  | { readonly kind: "panel"; readonly command: ChatCommand };

/** The level the composer text points at: no slash, the root list, or one command's panel. */
export function surfaceView(slash: ParsedSlash | null): SurfaceView {
  if (slash === null) return { kind: "closed" };
  if (!slash.hasArg) return { kind: "root", query: slash.query };
  const command = resolveCommand(slash);
  return command?.picker ? { kind: "panel", command } : { kind: "closed" };
}

/**
 * Back / Escape: the composer text of the level above (`/` from a panel, the unfiltered
 * root), or `null` when there is none and the surface should close.
 */
export function surfaceBack(view: SurfaceView): string | null {
  return view.kind === "panel" ? "/" : null;
}

/** Title of a panel's Back row: the setting's name when it has one (`Agent control`), else the alias. */
export function panelTitle(command: ChatCommand, settings: ReadonlyMap<string, EntryState>): string {
  return settings.get(command.name)?.label ?? `/${command.name}`;
}
