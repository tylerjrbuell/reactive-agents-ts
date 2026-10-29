/**
 * Session actions: the ONE deterministic validator for changes the chat agent may propose
 * (and the user may Apply) on a chat session.
 *
 * Pure of side effects: `validateSessionAction` reads a {@link ActionContext} snapshot and
 * returns either a normalized, human-summarised action or a message that names the valid
 * options. It heals drifted action / argument names with the framework healers. Limits come
 * from the existing services (`validateScheduleFields`, `validateGoalBudget`, the schedule
 * cap, the goal defaults); nothing here is LLM-judged.
 */
import { closestValid, healEnumArg, healParamNames } from "@reactive-agents/tools";
import { isHttpUrl } from "@reactive-agents/runtime";
import {
  DEFAULT_SCHEDULE_MAX_COST_USD,
  DEFAULT_SCHEDULE_TTL_MS,
  MAX_SCHEDULES_PER_SESSION,
  countLiveSchedules,
  validateScheduleFields,
  type ChatSchedule,
} from "./chat-schedule-service.js";
import { DEFAULT_GOAL_BUDGET, validateGoalBudget, type ChatGoalRecord } from "./chat-goal-service.js";
import { parseDocumentSpecs } from "./cortex-agent-config.js";

/** Actions that propose a change (persisted as proposals, applied only by the user). */
export const MUTATING_ACTIONS = [
  "set-model",
  "set-provider",
  "set-thinking",
  "pin-skill",
  "add-doc",
  "start-goal",
  "set-loop",
  "set-schedule",
  "stop-loop",
  "cancel-goal",
] as const;

/** Read-only actions: answered immediately, never persisted. */
export const READ_ONLY_ACTIONS = ["status", "list-schedules"] as const;

/** Every action name the `session-control` tool accepts. */
export const SESSION_ACTIONS = [...READ_ONLY_ACTIONS, ...MUTATING_ACTIONS] as const;

/** A proposable (state-changing) action. */
export type MutatingAction = (typeof MUTATING_ACTIONS)[number];
/** Any `session-control` action. */
export type SessionAction = (typeof SESSION_ACTIONS)[number];

/** Flat, JSON-safe action arguments (the persisted and wire shape). */
export type ProposalArgs = Record<string, string | number | boolean>;

/** Most documents a session may carry; the agent cannot grow context without bound. */
export const MAX_SESSION_DOCS = 10;

/** Closed alias table: spoken action name -> canonical. */
const ACTION_ALIASES: Readonly<Record<string, string>> = {
  model: "set-model",
  "switch-model": "set-model",
  "change-model": "set-model",
  setmodel: "set-model",
  provider: "set-provider",
  "switch-provider": "set-provider",
  thinking: "set-thinking",
  think: "set-thinking",
  skill: "pin-skill",
  "use-skill": "pin-skill",
  doc: "add-doc",
  docs: "add-doc",
  "add-document": "add-doc",
  goal: "start-goal",
  "new-goal": "start-goal",
  loop: "set-loop",
  repeat: "set-loop",
  every: "set-loop",
  cron: "set-schedule",
  schedule: "set-schedule",
  "stop-schedule": "stop-loop",
  "cancel-loop": "stop-loop",
  "remove-loop": "stop-loop",
  "stop-goal": "cancel-goal",
  schedules: "list-schedules",
  "list-loops": "list-schedules",
  config: "status",
  info: "status",
};

/** Per action: canonical argument -> accepted alternates. */
const PARAM_ALIASES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  "set-model": { value: ["model", "name", "model_name", "modelName", "id"] },
  "set-provider": { value: ["provider", "name", "id"] },
  "set-thinking": { value: ["enabled", "thinking", "mode", "state", "on"] },
  "pin-skill": { value: ["skill", "name", "skillName", "skill_name"] },
  "add-doc": { value: ["url", "link", "source", "doc", "document"] },
  "start-goal": { objective: ["goal", "task", "text", "description", "value"] },
  "set-loop": {
    interval: ["every", "frequency", "period", "spec", "value"],
    prompt: ["task", "message", "command", "text"],
  },
  "set-schedule": {
    cron: ["expression", "spec", "schedule", "value"],
    prompt: ["task", "message", "command", "text"],
  },
  "stop-loop": { id: ["schedule", "scheduleId", "schedule_id", "value"] },
};

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
}

/** A validated, normalized action ready to persist and later apply. */
export interface ValidatedAction {
  readonly action: MutatingAction;
  readonly args: ProposalArgs;
  /** One line shown on the proposal card and in the tool result. */
  readonly summary: string;
}

/** Outcome of {@link validateSessionAction}; `message` names valid options on failure. */
export type ActionValidation =
  | { readonly ok: true; readonly value: ValidatedAction }
  | { readonly ok: false; readonly message: string };

const bad = (message: string): ActionValidation => ({ ok: false, message });
const good = (action: MutatingAction, args: ProposalArgs, summary: string): ActionValidation => ({
  ok: true,
  value: { action, args, summary },
});

/** True for a state-changing action. */
export const isMutating = (a: SessionAction): a is MutatingAction => (MUTATING_ACTIONS as readonly string[]).includes(a);

/** Healed action name, or the failure naming the valid actions. */
export function healAction(raw: string): { readonly ok: true; readonly action: SessionAction } | { readonly ok: false; readonly message: string } {
  const healed = healEnumArg(raw, SESSION_ACTIONS, ACTION_ALIASES).value;
  if ((SESSION_ACTIONS as readonly string[]).includes(healed)) return { ok: true, action: healed as SessionAction };
  const hint = raw.trim() ? ` Did you mean "${closestValid(raw, SESSION_ACTIONS)}"?` : "";
  return { ok: false, message: `unknown action "${raw}".${hint} Valid actions: ${SESSION_ACTIONS.join(", ")}` };
}

/**
 * Rename drifted argument names to canonical ones for `action` (closed alias table). Exposed so the
 * tool can heal BEFORE its schema decode, which would otherwise drop unknown keys.
 */
export function healActionArgs(action: string, args: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return healParamNames(args, PARAM_ALIASES[action] ?? {}).args;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

/** Positive finite number from a number or numeric string; `undefined` when absent, `NaN` when unusable. */
const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : Number.NaN;
};

const THINKING_VALUES: Readonly<Record<string, boolean | "auto">> = {
  on: true, true: true, yes: true, enable: true, enabled: true, "1": true,
  off: false, false: false, no: false, disable: false, disabled: false, "0": false,
  auto: "auto", default: "auto", reset: "auto",
};

const clip = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const fmtDuration = (ms: number): string => {
  const h = ms / 3_600_000;
  return h >= 24 ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`;
};

const matchOne = (raw: string, valid: readonly string[], noun: string): { ok: true; value: string } | { ok: false; message: string } => {
  const hit = healEnumArg(raw, valid).value;
  if (valid.includes(hit)) return { ok: true, value: hit };
  const shown = valid.slice(0, 12).join(", ") + (valid.length > 12 ? `, … (${valid.length} total)` : "");
  const hint = raw && valid.length > 0 ? ` Closest: "${closestValid(raw, valid)}".` : "";
  return { ok: false, message: `unknown ${noun} "${raw}".${hint} Valid: ${shown || "(none known)"}` };
};

/**
 * Validate one mutating action. `rawAction` and `rawArgs` may be drifted (aliases, numeric
 * strings); the result carries canonical args only. Never throws.
 */
export async function validateSessionAction(
  rawAction: string,
  rawArgs: Readonly<Record<string, unknown>>,
  ctx: ActionContext,
): Promise<ActionValidation> {
  const healed = healAction(rawAction);
  if (!healed.ok) return bad(healed.message);
  const action = healed.action;
  if (!isMutating(action)) return bad(`"${action}" is read-only and changes nothing; it needs no proposal`);
  const a = healActionArgs(action, rawArgs);

  switch (action) {
    case "set-model": {
      const provider = text(ctx.config.provider) || "anthropic";
      const value = text(a.value);
      if (!value) return bad(`set-model needs value (a model id for provider "${provider}")`);
      const m = matchOne(value, await ctx.models(provider), `model for provider "${provider}"`);
      return m.ok ? good("set-model", { value: m.value }, `switch model to ${m.value}`) : bad(m.message);
    }
    case "set-provider": {
      const value = text(a.value);
      if (!value) return bad(`set-provider needs value (one of: ${ctx.providers.join(", ")})`);
      const p = matchOne(value, ctx.providers, "provider");
      if (!p.ok) return bad(p.message);
      const model = text(a.model);
      if (!model) return good("set-provider", { value: p.value }, `switch provider to ${p.value} (provider default model)`);
      const m = matchOne(model, await ctx.models(p.value), `model for provider "${p.value}"`);
      return m.ok
        ? good("set-provider", { value: p.value, model: m.value }, `switch provider to ${p.value} with model ${m.value}`)
        : bad(m.message);
    }
    case "set-thinking": {
      const raw = text(a.value).toLowerCase();
      const v = Object.prototype.hasOwnProperty.call(THINKING_VALUES, raw) ? THINKING_VALUES[raw] : undefined;
      if (v === undefined) return bad(`set-thinking needs value: on, off or auto (got "${raw}")`);
      return good("set-thinking", { value: v }, `set thinking ${v === "auto" ? "to auto" : v ? "on" : "off"}`);
    }
    case "pin-skill": {
      const value = text(a.value);
      if (!value) return bad(`pin-skill needs value (a skill name)`);
      const s = matchOne(value, ctx.skillNames, "skill");
      return s.ok ? good("pin-skill", { value: s.value }, `pin skill ${s.value}`) : bad(s.message);
    }
    case "add-doc": {
      const value = text(a.value);
      if (!isHttpUrl(value)) return bad(`add-doc needs value: an http(s) URL (got "${clip(value, 40)}")`);
      const existing = parseDocumentSpecs(ctx.config.documents) ?? [];
      if (existing.some((d) => d.source === value)) return bad(`document already added: ${value}`);
      if (existing.length >= MAX_SESSION_DOCS) return bad(`session already has ${MAX_SESSION_DOCS} documents (the maximum)`);
      return good("add-doc", { value }, `add document ${clip(value, 80)}`);
    }
    case "start-goal": {
      const objective = text(a.objective);
      if (!objective) return bad(`start-goal needs objective`);
      if (ctx.goal && ["active", "paused"].includes(ctx.goal.goal.status)) {
        return bad(`session already has a ${ctx.goal.goal.status} goal: "${clip(ctx.goal.goal.objective)}"`);
      }
      const maxSegments = num(a.maxSegments);
      const maxCostUsd = num(a.maxCostUsd);
      const budget = {
        ...DEFAULT_GOAL_BUDGET,
        ...(maxSegments !== undefined ? { maxSegments } : {}),
        ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
      };
      const err = validateGoalBudget(budget);
      if (err) return bad(err);
      // The agent may only tighten the default budget; widening is the user's call.
      if (budget.maxSegments > DEFAULT_GOAL_BUDGET.maxSegments) return bad(`maxSegments is capped at ${DEFAULT_GOAL_BUDGET.maxSegments} for proposals`);
      if ((budget.maxCostUsd ?? 0) > (DEFAULT_GOAL_BUDGET.maxCostUsd ?? 0)) return bad(`maxCostUsd is capped at ${DEFAULT_GOAL_BUDGET.maxCostUsd} for proposals`);
      const args: ProposalArgs = {
        objective,
        ...(maxSegments !== undefined ? { maxSegments } : {}),
        ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
      };
      return good(
        "start-goal",
        args,
        `propose goal "${clip(objective)}" (up to ${budget.maxSegments} segments, $${budget.maxCostUsd} cap; you still Accept it)`,
      );
    }
    case "set-loop":
    case "set-schedule": {
      const kind = action === "set-loop" ? "loop" : "cron";
      const spec = text(kind === "loop" ? a.interval : a.cron);
      if (!spec) return bad(kind === "loop" ? `set-loop needs interval (e.g. 5m, 1h) and prompt` : `set-schedule needs cron (5 fields) and prompt`);
      const prompt = text(a.prompt);
      const ttlHours = num(a.ttlHours);
      const maxCostUsd = num(a.maxCostUsd);
      if (Number.isNaN(ttlHours) || Number.isNaN(maxCostUsd)) return bad(`ttlHours and maxCostUsd must be numbers`);
      const ttlMs = ttlHours !== undefined ? ttlHours * 3_600_000 : undefined;
      const invalid = validateScheduleFields({ kind, spec, prompt, ...(ttlMs !== undefined ? { ttlMs } : {}), ...(maxCostUsd !== undefined ? { maxCostUsd } : {}) });
      if (invalid) return bad(invalid.message);
      // The agent may only tighten the defaults; widening is the user's call (slash command).
      if ((ttlMs ?? 0) > DEFAULT_SCHEDULE_TTL_MS) return bad(`ttlHours is capped at ${DEFAULT_SCHEDULE_TTL_MS / 3_600_000} for proposals`);
      if ((maxCostUsd ?? 0) > DEFAULT_SCHEDULE_MAX_COST_USD) return bad(`maxCostUsd is capped at ${DEFAULT_SCHEDULE_MAX_COST_USD} per run for proposals`);
      if (countLiveSchedules(ctx.schedules, ctx.now) >= MAX_SCHEDULES_PER_SESSION) {
        return bad(`session already has ${MAX_SCHEDULES_PER_SESSION} active schedules; stop one first (stop-loop)`);
      }
      const args: ProposalArgs = {
        [kind === "loop" ? "interval" : "cron"]: spec,
        prompt,
        ...(ttlHours !== undefined ? { ttlHours } : {}),
        ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
      };
      const cost = maxCostUsd ?? DEFAULT_SCHEDULE_MAX_COST_USD;
      const expiry = fmtDuration(ttlMs ?? DEFAULT_SCHEDULE_TTL_MS);
      return good(action, args, `${kind === "loop" ? `run every ${spec}` : `run on cron "${spec}"`}: "${clip(prompt)}" (expires ${expiry}, up to $${cost}/run)`);
    }
    case "stop-loop": {
      const live = ctx.schedules.filter((s) => s.enabled);
      const raw = text(a.id);
      if (!raw) return bad(`stop-loop needs id; active: ${live.map((s) => s.id.slice(0, 8)).join(", ") || "(none)"}`);
      const hits = live.filter((s) => s.id === raw || s.id.startsWith(raw));
      if (hits.length !== 1) {
        return bad(hits.length === 0 ? `no active schedule matches "${raw}"; active: ${live.map((s) => s.id.slice(0, 8)).join(", ") || "(none)"}` : `"${raw}" matches ${hits.length} schedules; use more characters`);
      }
      const s = hits[0]!;
      return good("stop-loop", { id: s.id }, `stop ${s.kind === "loop" ? "loop" : "schedule"} ${s.id.slice(0, 8)} (${s.spec}: "${clip(s.prompt, 40)}")`);
    }
    case "cancel-goal": {
      const g = ctx.goal?.goal;
      if (!g || ["achieved", "stalled", "blocked", "budget-exhausted", "cancelled"].includes(g.status)) {
        return bad(`no goal to cancel (${g ? `goal is ${g.status}` : "session has no goal"})`);
      }
      return good("cancel-goal", {}, `cancel goal "${clip(g.objective)}"`);
    }
  }
}

/** Compact, stable one-line view of the session the agent can ground proposals on. */
export function renderSessionStatus(ctx: ActionContext): string {
  const c = ctx.config;
  const thinking = typeof c.thinking === "boolean" ? (c.thinking ? "on" : "off") : "auto";
  const skills = Array.isArray((c.skills as { activate?: unknown } | undefined)?.activate)
    ? ((c.skills as { activate: unknown[] }).activate.filter((x): x is string => typeof x === "string"))
    : [];
  const live = ctx.schedules.filter((s) => s.enabled && s.expiresAt > ctx.now);
  const sched = live.length === 0 ? "none" : live.map((s) => `${s.id.slice(0, 8)} ${s.kind === "loop" ? "every " : "cron "}${s.spec} "${clip(s.prompt, 30)}"`).join("; ");
  const g = ctx.goal?.goal;
  return [
    `provider=${text(c.provider) || "anthropic"}`,
    `model=${text(c.model) || "default"}`,
    `thinking=${thinking}`,
    `goal=${g ? `${g.status} "${clip(g.objective, 40)}"` : "none"}`,
    `schedules=${sched}`,
    `skills=${skills.length ? skills.join(",") : "none"}`,
    `docs=${(parseDocumentSpecs(c.documents) ?? []).length}`,
  ].join(" | ");
}
