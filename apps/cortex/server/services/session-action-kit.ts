/**
 * Shared vocabulary of the session-control validators: the context snapshot they read, the
 * normalized action they return, and the small parsing helpers. Pure; no I/O. Split out so
 * `session-actions.ts` (the original actions) and `session-capabilities.ts` (the capability
 * registry) share one definition without importing each other.
 */
import { closestValid, healEnumArg } from "@reactive-agents/tools";
import type { ChatSchedule } from "./chat-schedule-service.js";
import type { ChatGoalRecord } from "./chat-goal-service.js";

/** Flat, JSON-safe action arguments (the persisted and wire shape). */
export type ProposalArgs = Record<string, string | number | boolean>;

/** Whether a change reduces the agent's reach (`tighten`), widens it (`loosen`) or is neither. */
export type ProposalDirection = "tighten" | "loosen" | "neutral";

/** One human-readable before -> after row of a proposal. */
export interface ProposalDiffRow {
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

/** Enough of the session for validation; resolved by the caller (never cached here). */
export interface ActionContext {
  readonly config: Readonly<Record<string, unknown>>;
  readonly schedules: readonly ChatSchedule[];
  readonly goal: ChatGoalRecord | null;
  readonly now: number;
  /** Provider ids Cortex can run. */
  readonly providers: readonly string[];
  /** Model ids for a provider (live discovery merged with presets), or `[]` when none are known. */
  readonly models: (provider: string) => Promise<readonly string[]>;
  /** Names of the skills Cortex can find on disk. */
  readonly skillNames: readonly string[];
  /** Tool names and shell toolset names the agent may be given (the live registry). */
  readonly toolNames: readonly string[];
  /** MCP servers already configured in Cortex (enabling one never creates it). */
  readonly mcpServers: readonly { readonly id: string; readonly name: string }[];
  /** Reasoning strategy names and aliases the framework registers. */
  readonly strategies: readonly string[];
  /** Check a workspace directory; returns the normalized path or the refusal. */
  readonly checkWorkspace: (path: string) => { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: string };
  /** The conversation's to-do list titles with their status. */
  readonly todo: readonly { readonly title: string; readonly status: string }[];
}

/** A validated, normalized action ready to persist and later apply. */
export interface ValidatedAction {
  readonly action: string;
  readonly args: ProposalArgs;
  /** One line shown on the proposal card and in the tool result. */
  readonly summary: string;
  /** Before -> after rows; empty for goals, loops and other non-config actions. */
  readonly diff?: readonly ProposalDiffRow[];
  /** Defaults to `neutral`. Only `tighten` can ever auto-apply. */
  readonly direction?: ProposalDirection;
}

/** Outcome of validation; `message` names valid options on failure. */
export type ActionValidation =
  | { readonly ok: true; readonly value: ValidatedAction }
  | { readonly ok: false; readonly message: string };

/** A failed validation carrying `message`. */
export const bad = (message: string): { readonly ok: false; readonly message: string } => ({ ok: false, message });

/** A passed validation. */
export const good = (
  action: string,
  args: ProposalArgs,
  summary: string,
  extra: { readonly diff?: readonly ProposalDiffRow[]; readonly direction?: ProposalDirection } = {},
): ActionValidation => ({ ok: true, value: { action, args, summary, ...extra } });

/** Trimmed string from a string, number or boolean; `""` for anything else. */
export const text = (v: unknown): string =>
  typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

/** Finite number from a number or numeric string; `undefined` when absent, `NaN` when unusable. */
export const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : Number.NaN;
};

/** Shorten `s` to `n` characters with an ellipsis. */
export const clip = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Match `raw` against `valid` (healing near misses); failure names the closest and the valid set. */
export const matchOne = (
  raw: string,
  valid: readonly string[],
  noun: string,
): { ok: true; value: string } | { ok: false; message: string } => {
  const hit = healEnumArg(raw, valid).value;
  if (valid.includes(hit)) return { ok: true, value: hit };
  const shown = valid.slice(0, 12).join(", ") + (valid.length > 12 ? `, … (${valid.length} total)` : "");
  const hint = raw && valid.length > 0 ? ` Closest: "${closestValid(raw, valid)}".` : "";
  return { ok: false, message: `unknown ${noun} "${raw}".${hint} Valid: ${shown || "(none known)"}` };
};
