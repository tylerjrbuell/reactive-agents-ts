/**
 * Chat proposals: agent-suggested session changes that only a human click can apply.
 *
 * The `session-control` tool calls {@link ChatProposalService.propose}, which validates the
 * action with the shared validator ({@link validateSessionAction}) and INSERTs a `chat_proposals`
 * row. It never touches config, goals or schedules. `apply` (the UI's Apply button, via REST)
 * re-validates against current state, claims the row atomically (so a repeat can never apply
 * twice), then dispatches to the same services the slash commands use.
 */
import type { Database } from "bun:sqlite";
import { generateTaskId } from "@reactive-agents/core";
import type { ChatScheduleService, ChatSchedule } from "./chat-schedule-service.js";
import type { ChatGoalService } from "./chat-goal-service.js";
import { parseDocumentSpecs } from "./cortex-agent-config.js";
import {
  asMutating,
  healAction,
  isMutating,
  renderSessionStatus,
  validateSessionAction,
  type ActionContext,
  type MutatingAction,
  type ProposalArgs,
  type ProposalDiffRow,
  type ProposalDirection,
} from "./session-actions.js";
import { canAutoApply, describeSession, externalContentFlag, groupRefusal, planCapability, type CapabilityPlan } from "./session-capabilities.js";
import { deleteProposal } from "../db/chat-proposal-queries.js";

/** Lifecycle of a proposal. Only `proposed` can transition; `applied` and `dismissed` are final. */
export type ProposalStatus = "proposed" | "applied" | "dismissed";

/** A persisted proposal, exactly as the REST API returns it. */
export interface ChatProposal {
  readonly id: string;
  readonly action: MutatingAction;
  readonly args: ProposalArgs;
  readonly summary: string;
  readonly status: ProposalStatus;
  readonly createdAt: number;
  /** Why the last Apply failed; the proposal stays `proposed` so the user can retry or dismiss. */
  readonly error?: string;
  /** Human-readable before -> after rows (config-changing actions). */
  readonly diff?: readonly ProposalDiffRow[];
  /** `tighten` (less reach), `loosen` (more reach) or `neutral`. */
  readonly direction?: ProposalDirection;
  /** Set when outside content may have steered this proposal; such a proposal never auto-applies. */
  readonly flag?: string;
  /** Who applied it: the `user` (Apply click) or `auto` (a tightening change the user allowed). */
  readonly appliedBy?: "user" | "auto";
}

/** How long an identical applied proposal still counts as "the same one" (a repeat is collapsed). */
export const APPLIED_DUPLICATE_WINDOW_MS = 2 * 60_000;

/** Most un-actioned proposals a session may hold; stops a runaway or injected agent flooding the UI. */
export const MAX_PENDING_PROPOSALS = 8;

/** Everything the proposal service needs from the rest of Cortex (injected; no hidden globals). */
export interface ProposalHost {
  /** The session's stored agent config, or null when the session does not exist. */
  getConfig(sessionId: string): Record<string, unknown> | null;
  /** Merge `patch` into the session config (evicts the cached agent). */
  patchConfig(sessionId: string, patch: Record<string, unknown>): Promise<void>;
  /** True while a chat turn is in flight (config changes would tear the agent down mid-turn). */
  isBusy(sessionId: string): boolean;
  readonly schedules: Pick<ChatScheduleService, "list" | "create" | "remove">;
  readonly goals: Pick<ChatGoalService, "get" | "propose" | "cancel">;
  /** Provider ids Cortex can run. */
  providers(): readonly string[];
  /** Model ids for a provider: live discovery, falling back to the static list when offline. */
  models(provider: string): Promise<readonly string[]>;
  /** Names of the skills this session's agent can load (framework discovery at its workspace). */
  skills(sessionId: string): { readonly names: readonly string[] };
  /** Tool and shell-toolset names the agent may be given. */
  tools?(): readonly string[];
  /** MCP servers already configured in Cortex. */
  mcpServers?(): readonly { readonly id: string; readonly name: string }[];
  /** Reasoning strategy names and aliases. */
  strategies?(): readonly string[];
  /** Validate a workspace directory. */
  checkWorkspace?(path: string): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: string };
  /** The conversation's to-do list. */
  todo?(sessionId: string): readonly { readonly title: string; readonly status: string }[];
  /** History operations Apply may run (the same services the slash commands use). */
  readonly history?: {
    setTodo(sessionId: string, titles: readonly string[]): Promise<void>;
    compact(sessionId: string, keepLast?: number): Promise<void>;
    fork(sessionId: string, atTurnId?: number): Promise<void>;
    rewind(sessionId: string, turnId: number): Promise<void>;
  };
  now?(): number;
}

/** Result of {@link ChatProposalService.propose}. */
export type ProposeOutcome =
  | {
      readonly ok: true;
      readonly proposal: ChatProposal;
      /** An identical proposal already existed (pending, or applied moments ago); nothing new was recorded. */
      readonly duplicate?: boolean;
      /** The change was a tightening one the user allowed to apply without a click, and it did. */
      readonly autoApplied?: boolean;
    }
  | { readonly ok: false; readonly message: string };

/** Result of apply / dismiss. `failed` keeps the proposal `proposed` with `error` set. */
export type ProposalResult =
  | { readonly ok: true; readonly proposal: ChatProposal }
  | { readonly ok: false; readonly code: "not-found" | "conflict" | "failed"; readonly message: string; readonly proposal?: ChatProposal };

type Row = {
  id: string;
  session_id: string;
  action: string;
  args_json: string;
  summary: string;
  status: string;
  created_at: number;
  error: string | null;
  diff_json: string | null;
  direction: string | null;
  flag: string | null;
  applied_by: string | null;
};

const parseDiff = (json: string | null): ProposalDiffRow[] | undefined => {
  if (!json) return undefined;
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return undefined;
    const rows = v.flatMap((r): ProposalDiffRow[] => {
      const o = r as Partial<ProposalDiffRow> | null;
      return o && typeof o.label === "string" && typeof o.before === "string" && typeof o.after === "string"
        ? [{ label: o.label, before: o.before, after: o.after }]
        : [];
    });
    return rows.length > 0 ? rows : undefined;
  } catch {
    return undefined;
  }
};

const parseArgs = (json: string): ProposalArgs => {
  try {
    const v: unknown = JSON.parse(json);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    const out: ProposalArgs = {};
    for (const [k, x] of Object.entries(v)) if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") out[k] = x;
    return out;
  } catch {
    return {};
  }
};

const toProposal = (r: Row): ChatProposal => ({
  id: r.id,
  action: r.action as MutatingAction,
  args: parseArgs(r.args_json),
  summary: r.summary,
  status: r.status === "applied" || r.status === "dismissed" ? r.status : "proposed",
  createdAt: r.created_at,
  ...(r.error ? { error: r.error } : {}),
  ...(parseDiff(r.diff_json) ? { diff: parseDiff(r.diff_json)! } : {}),
  ...(r.direction === "tighten" || r.direction === "loosen" || r.direction === "neutral" ? { direction: r.direction } : {}),
  ...(r.flag ? { flag: r.flag } : {}),
  ...(r.applied_by === "user" || r.applied_by === "auto" ? { appliedBy: r.applied_by } : {}),
});

type Effect = { readonly ok: true } | { readonly ok: false; readonly message: string };
const ok: Effect = { ok: true };
const no = (message: string): Effect => ({ ok: false, message });

const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined ? "" : String(v));
const optNum = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** Persists proposals and applies them through the existing session / goal / schedule services. */
export class ChatProposalService {
  constructor(
    private readonly db: Database,
    private readonly host: ProposalHost,
  ) {}

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  private context(sessionId: string): ActionContext | null {
    const config = this.host.getConfig(sessionId);
    if (!config) return null;
    const skills = this.host.skills(sessionId);
    return {
      config,
      schedules: this.host.schedules.list(sessionId),
      goal: this.host.goals.get(sessionId),
      now: this.now(),
      providers: this.host.providers(),
      models: (p) => this.host.models(p),
      skillNames: skills.names,
      toolNames: this.host.tools?.() ?? [],
      mcpServers: this.host.mcpServers?.() ?? [],
      strategies: this.host.strategies?.() ?? [],
      checkWorkspace: this.host.checkWorkspace ?? (() => ({ ok: false, error: "workspace changes are not available here" })),
      todo: this.host.todo?.(sessionId) ?? [],
    };
  }

  /** Proposals of a session, oldest first. Unknown sessions have none. */
  list(sessionId: string): ChatProposal[] {
    return (
      this.db
        .prepare("SELECT * FROM chat_proposals WHERE session_id = ? ORDER BY created_at ASC, rowid ASC")
        .all(sessionId) as Row[]
    ).map(toProposal);
  }

  private row(sessionId: string, id: string): Row | undefined {
    return this.db.prepare("SELECT * FROM chat_proposals WHERE id = ? AND session_id = ?").get(id, sessionId) as Row | undefined;
  }

  /**
   * Validate and record a proposal. Writes ONLY a `chat_proposals` row. An identical pending
   * proposal is returned instead of duplicated. Never throws; failures carry a message naming valid options.
   */
  async propose(sessionId: string, action: string, args: Readonly<Record<string, unknown>>): Promise<ProposeOutcome> {
    const ctx = this.context(sessionId);
    if (!ctx) return { ok: false, message: "chat session not found" };
    // The switch comes first: an action in a group the user has not enabled is refused outright.
    const named = healAction(action);
    if (named.ok && isMutating(named.action)) {
      const refusal = groupRefusal(named.action, ctx.config);
      if (refusal) return { ok: false, message: refusal };
    }
    const v = await validateSessionAction(action, args, ctx);
    if (!v.ok) return { ok: false, message: v.message };
    const argsJson = JSON.stringify(v.value.args);
    const all = this.list(sessionId);
    const pending = all.filter((p) => p.status === "proposed");
    const same = (p: ChatProposal): boolean => p.action === v.value.action && JSON.stringify(p.args) === argsJson;
    const dup =
      pending.find(same) ??
      all.find((p) => p.status === "applied" && same(p) && this.now() - p.createdAt < APPLIED_DUPLICATE_WINDOW_MS);
    if (dup) return { ok: true, proposal: dup, duplicate: true };
    if (pending.length >= MAX_PENDING_PROPOSALS) {
      return { ok: false, message: `${pending.length} proposals are already waiting; the user must Apply or Dismiss some first` };
    }
    const id = generateTaskId();
    const flag = externalContentFlag(ctx.config);
    this.db
      .prepare(
        `INSERT INTO chat_proposals (id, session_id, action, args_json, summary, status, created_at, diff_json, direction, flag)
         VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`,
      )
      .run(
        id,
        sessionId,
        v.value.action,
        argsJson,
        v.value.summary,
        this.now(),
        v.value.diff && v.value.diff.length > 0 ? JSON.stringify(v.value.diff) : null,
        v.value.direction ?? "neutral",
        flag ?? null,
      );
    const row = this.row(sessionId, id);
    if (!row) return { ok: false, message: "proposal vanished after insert" };
    // The only path to a change without a click: a tightening change in a group the user allowed,
    // with no outside-content flag. A loosening or neutral change always waits for Apply.
    if (canAutoApply(v.value.action, v.value.direction, flag, ctx.config)) {
      const applied = await this.apply(sessionId, id, "auto");
      if (applied.ok) return { ok: true, proposal: applied.proposal, autoApplied: true };
    }
    return { ok: true, proposal: toProposal(this.row(sessionId, id) ?? row) };
  }

  /** One-line view of the session for the agent's `status` action. */
  status(sessionId: string): string {
    const ctx = this.context(sessionId);
    return ctx ? renderSessionStatus(ctx) : "chat session not found";
  }

  /** Effective configuration, one fact per line, for the agent's `describe-session` action. */
  describe(sessionId: string): string {
    const ctx = this.context(sessionId);
    return ctx ? describeSession(ctx) : "chat session not found";
  }

  /** Remove a proposal from the thread (settled banners the user no longer wants; a pending one counts as dismissed). */
  remove(sessionId: string, id: string): ProposalResult {
    const row = this.row(sessionId, id);
    if (!row) return { ok: false, code: "not-found", message: "proposal not found" };
    deleteProposal(this.db, sessionId, id);
    return { ok: true, proposal: { ...toProposal(row), status: row.status === "proposed" ? "dismissed" : toProposal(row).status } };
  }

  /** Active schedules, one per line, for the agent's `list-schedules` action. */
  listSchedules(sessionId: string): string {
    const t = this.now();
    const live = this.host.schedules.list(sessionId).filter((s: ChatSchedule) => s.enabled && s.expiresAt > t);
    if (live.length === 0) return "no active schedules";
    return live.map((s) => `${s.id.slice(0, 8)} ${s.kind === "loop" ? "every" : "cron"} ${s.spec}: ${s.prompt}`).join("\n");
  }

  /** Dismiss a pending proposal. */
  dismiss(sessionId: string, id: string): ProposalResult {
    const row = this.row(sessionId, id);
    if (!row) return { ok: false, code: "not-found", message: "proposal not found" };
    const claimed = this.db
      .prepare("UPDATE chat_proposals SET status = 'dismissed', error = NULL WHERE id = ? AND status = 'proposed'")
      .run(id).changes;
    const after = this.row(sessionId, id)!;
    return claimed === 1
      ? { ok: true, proposal: toProposal(after) }
      : { ok: false, code: "conflict", message: `proposal is already ${after.status}`, proposal: toProposal(after) };
  }

  /**
   * Apply a pending proposal. The row is claimed (`proposed` -> `applied`) in one atomic UPDATE
   * before anything runs, so concurrent or repeated Applies never double-apply. If re-validation
   * or the effect fails, the row returns to `proposed` with `error` set.
   */
  async apply(sessionId: string, id: string, by: "user" | "auto" = "user"): Promise<ProposalResult> {
    const row = this.row(sessionId, id);
    if (!row) return { ok: false, code: "not-found", message: "proposal not found" };
    // Defence in depth: the no-click path may only ever carry a tightening change.
    if (by === "auto" && row.direction !== "tighten") {
      return { ok: false, code: "conflict", message: "only a tightening change can apply without a click", proposal: toProposal(row) };
    }
    const claimed = this.db
      .prepare("UPDATE chat_proposals SET status = 'applied', applied_by = ?, error = NULL WHERE id = ? AND status = 'proposed'")
      .run(by, id).changes;
    if (claimed !== 1) {
      const cur = this.row(sessionId, id)!;
      return { ok: false, code: "conflict", message: `proposal is already ${cur.status}`, proposal: toProposal(cur) };
    }
    const outcome = await this.run(sessionId, row, by);
    // A rewind removes the turns (and so the proposals) this one came from, itself included.
    if (outcome.ok) return { ok: true, proposal: toProposal(this.row(sessionId, id) ?? { ...row, status: "applied", applied_by: by, error: null }) };
    this.db.prepare("UPDATE chat_proposals SET status = 'proposed', applied_by = NULL, error = ? WHERE id = ?").run(outcome.message, id);
    return { ok: false, code: "failed", message: outcome.message, proposal: toProposal(this.row(sessionId, id) ?? { ...row, error: outcome.message }) };
  }

  private async run(sessionId: string, row: Row, by: "user" | "auto"): Promise<Effect> {
    try {
      const ctx = this.context(sessionId);
      if (!ctx) return no("chat session not found");
      const v = await validateSessionAction(row.action, parseArgs(row.args_json), ctx);
      if (!v.ok) return no(v.message);
      if (by === "auto") {
        // Raised from inside the agent's own turn, so the busy guard cannot apply (the change takes
        // effect on the next turn, like any mid-turn config change). Config patches only.
        const plan = planCapability(v.value.action, v.value.args, ctx);
        if (plan?.kind !== "patch") return no("only a configuration change can apply without a click");
        await this.host.patchConfig(sessionId, plan.patch);
        return ok;
      }
      const action = asMutating(v.value.action);
      if (!action) return no(`unknown action ${v.value.action}`);
      return await this.effect(sessionId, action, v.value.args, ctx);
    } catch (e) {
      return no(e instanceof Error ? e.message : String(e));
    }
  }

  private async patch(sessionId: string, patch: Record<string, unknown>): Promise<Effect> {
    if (this.host.isBusy(sessionId)) return no("session is busy with a turn; try again when it finishes");
    await this.host.patchConfig(sessionId, patch);
    return ok;
  }

  private async effect(sessionId: string, action: MutatingAction, a: ProposalArgs, ctx: ActionContext): Promise<Effect> {
    switch (action) {
      case "set-model":
        return this.patch(sessionId, { model: str(a.value) });
      case "set-provider":
        // No model given means "the provider's default": clear the old provider's model id.
        return this.patch(sessionId, { provider: str(a.value), model: a.model !== undefined ? str(a.model) : "" });
      case "set-thinking":
        return this.patch(sessionId, { thinking: typeof a.value === "boolean" ? a.value : null });
      case "pin-skill": {
        const cur = (ctx.config.skills ?? {}) as { paths?: unknown; activate?: unknown };
        const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : []);
        // A pin is a name: the chat agent discovers its workspace skills itself (workspace-skills.ts).
        const activate = [...new Set([...strings(cur.activate), str(a.value)])];
        return this.patch(sessionId, { skills: { ...cur, paths: strings(cur.paths), activate } });
      }
      case "add-doc":
        return this.patch(sessionId, { documents: [...(parseDocumentSpecs(ctx.config.documents) ?? []), { source: str(a.value) }] });
      case "start-goal": {
        const maxSegments = optNum(a.maxSegments);
        const maxCostUsd = optNum(a.maxCostUsd);
        const r = this.host.goals.propose(sessionId, {
          objective: str(a.objective),
          ...(maxSegments !== undefined || maxCostUsd !== undefined
            ? { budget: { ...(maxSegments !== undefined ? { maxSegments } : {}), ...(maxCostUsd !== undefined ? { maxCostUsd } : {}) } }
            : {}),
        });
        return r.ok ? ok : no(r.message);
      }
      case "set-loop":
      case "set-schedule": {
        const ttlHours = optNum(a.ttlHours);
        const maxCostUsd = optNum(a.maxCostUsd);
        const r = this.host.schedules.create({
          sessionId,
          kind: action === "set-loop" ? "loop" : "cron",
          spec: str(action === "set-loop" ? a.interval : a.cron),
          prompt: str(a.prompt),
          ...(ttlHours !== undefined ? { ttlMs: ttlHours * 3_600_000 } : {}),
          ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
        });
        return r.ok ? ok : no(r.message);
      }
      case "stop-loop":
        return this.host.schedules.remove(sessionId, str(a.id)) ? ok : no("schedule not found (already stopped?)");
      case "cancel-goal": {
        const r = this.host.goals.cancel(sessionId);
        return r.ok ? ok : no(r.message);
      }
      default: {
        const plan = planCapability(action, a, ctx);
        return plan ? this.runPlan(sessionId, plan) : no(`${action} cannot be applied here`);
      }
    }
  }

  /** Run a capability plan through the same services the Config menu and slash commands use. */
  private async runPlan(sessionId: string, plan: CapabilityPlan): Promise<Effect> {
    if (plan.kind === "patch") return this.patch(sessionId, plan.patch);
    const h = this.host.history;
    if (!h) return no("history changes are not available here");
    if (this.host.isBusy(sessionId)) return no("session is busy with a turn; try again when it finishes");
    switch (plan.kind) {
      case "todo":
        await h.setTodo(sessionId, plan.titles);
        return ok;
      case "compact":
        await h.compact(sessionId, plan.keepLast);
        return ok;
      case "fork":
        await h.fork(sessionId, plan.atTurnId);
        return ok;
      case "rewind":
        await h.rewind(sessionId, plan.turnId);
        return ok;
    }
  }
}

/** What the `session-control` tool needs; satisfied by {@link ChatProposalService}. */
export interface SessionControlPort {
  propose(sessionId: string, action: string, args: Readonly<Record<string, unknown>>): Promise<ProposeOutcome>;
  status(sessionId: string): string;
  /** Effective configuration for `describe-session`. */
  describe(sessionId: string): string;
  listSchedules(sessionId: string): string;
}
