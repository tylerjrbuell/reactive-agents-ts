/**
 * Lab · Channels (the channel hub): the route a person edits and the rules the editor applies to it.
 * Pure (no fetch, no DOM). The server is the authority (`/api/channels` runs the framework's
 * `validateRoutes` and `wideningChanges`); these rules only give the person an answer before the
 * request, and name the risk in words when a change widens who can reach the agent.
 *
 * A route is edited as a flat `RouteDraft` (inputs are strings) and sent as the framework's
 * `RouteSpecInput` shape, so a field the editor does not own (priority, `groups`, `deniedReply`)
 * is left exactly as saved: `routeFromDraft(draft, saved)` starts from the saved route.
 */
import { normalizeSender, senderProblem } from "./channel-access.js";
import { channelKindCopy } from "./channel-kind-copy.js";
import { routeCapabilities } from "./channel-route-capabilities.js";
import { resetDraftFromWire, resetProblems, resetWireFromDraft, type ResetDraft } from "./channel-reset-commands.js";
import { batchingDraftFromWire, batchingProblems, batchingWireFromDraft, type BatchingDraft, type MidRunMode } from "./channel-batching.js";
import { pacingDraftFromWire, pacingProblems, pacingWireFromDraft, type PacingDraft } from "./channel-pacing.js";
import { turnLimitDraftFromWire, turnLimitProblems, turnLimitWireFromDraft, type TurnLimitDraft } from "./channel-turn-limits.js";

/** What non-owner senders may do, as the framework's tagged union. */
export type SenderToolsWire = { _tag: "ReadOnly" } | { _tag: "AgentDefault" } | { _tag: "Allowlist"; tools: string[] };

/** Turn acknowledgement as saved (`RouteAck`). */
export interface AckWire {
  afterMs?: number;
  text?: string | string[];
  typing?: boolean;
  source?: "canned" | "model";
  modelTimeoutMs?: number;
}

/** A route as `GET /api/channels` returns it (the framework's encoded `RouteSpec`; defaults may be absent). */
export interface HubRouteWire {
  id: string;
  enabled?: boolean;
  priority?: number;
  match: {
    channelId: string;
    conversation?: "dm" | "group";
    conversationIds?: string[];
    when?: { _tag: "Mention" } | { _tag: "Command"; name: string } | { _tag: "Keyword"; patterns: string[] };
  };
  target: { agentId: string };
  session?: "per-conversation" | "stateless";
  allow?: string[];
  deny?: string[];
  owners?: string[];
  open?: boolean;
  senderTools?: SenderToolsWire;
  deniedReply?: string;
  groups?: "mention-only" | "off";
  maxIterations?: number;
  turnTimeoutMs?: number;
  /** Tell the sender when a turn fails (framework default: on). See `channel-turn-limits.ts`. */
  failureNotice?: boolean;
  /** Join one sender's burst into one turn (ms, 0 to 30 000). See `channel-batching.ts`. */
  batchWindowMs?: number;
  /** What a message that arrives during a running turn does (framework default: queue). */
  midRun?: MidRunMode;
  /** Least gap (ms, 0 to 60 000) between two messages sent into one conversation. See `channel-pacing.ts`. */
  minGapMs?: number;
  maxTurnsPerSenderPerHour?: number;
  maxTurnsPerHour?: number;
  maxCostPerDayUsd?: number;
  ack?: AckWire | false;
  /** Owner messages that clear the conversation (default `/new`, `/reset`; `[]` = none). See `channel-reset-commands.ts`. */
  resetCommands?: string[];
  /** Set by the server on a route imported from an agent's own channel config. */
  migratedFrom?: string | null;
}

/** The framework's per-sender default when a non-open route sets none (shown, not hidden). */
export const DEFAULT_PER_SENDER_PER_HOUR = 6;
/** The acknowledgement defaults the router applies (shown as placeholders). */
export const ACK_DEFAULTS = { afterMs: 4000, text: "On it...", modelTimeoutMs: 12_000 } as const;
/** `ack.modelTimeoutMs` bounds the framework enforces. */
export const MODEL_TIMEOUT_RANGE = { min: 1, max: 30_000 } as const;

/** How the match narrows a conversation. */
export type MatchWhen = "any" | "mention" | "command" | "keyword";

/** The editor's flat form of a route. Numbers are strings while typed. */
export interface RouteDraft extends ResetDraft, TurnLimitDraft, BatchingDraft, PacingDraft {
  id: string;
  enabled: boolean;
  channelId: string;
  agentId: string;
  conversation: "any" | "dm" | "group";
  when: MatchWhen;
  /** Command name, or keyword patterns (one per line), for `when`. */
  whenValue: string;
  session: "per-conversation" | "stateless";
  owners: string[];
  allow: string[];
  deny: string[];
  open: boolean;
  senderTools: "ReadOnly" | "AgentDefault" | "Allowlist";
  senderToolList: string[];
  maxCostPerDayUsd: string;
  maxTurnsPerHour: string;
  maxTurnsPerSenderPerHour: string;
  maxIterations: string;
  ackOn: boolean;
  ackAfterMs: string;
  ackText: string;
  ackTyping: boolean;
  ackSource: "canned" | "model";
  ackModelTimeoutMs: string;
}

/**
 * A fresh draft: access closed, read-only senders. Acknowledgement is off, except on a Telegram channel
 * where it starts on with the model as the source (the server applies the same default to a route created
 * without an `ack`: `services/channel-ack-default.ts`).
 */
export function newDraft(channelId = "", agentId = "", platform?: string): RouteDraft {
  const telegram = platform === "telegram";
  return {
    id: "",
    enabled: true,
    channelId,
    agentId,
    conversation: "any",
    when: "any",
    whenValue: "",
    session: "per-conversation",
    owners: [],
    allow: [],
    deny: [],
    open: false,
    senderTools: "ReadOnly",
    senderToolList: [],
    maxCostPerDayUsd: "",
    maxTurnsPerHour: "",
    maxTurnsPerSenderPerHour: "",
    maxIterations: "",
    ackOn: telegram,
    ackAfterMs: "",
    ackText: "",
    ackTyping: true,
    ackSource: telegram ? "model" : "canned",
    ackModelTimeoutMs: "",
    ...resetDraftFromWire(undefined),
    ...turnLimitDraftFromWire({}),
    ...batchingDraftFromWire({}),
    ...pacingDraftFromWire({}),
  };
}

const num = (n: number | undefined): string => (n === undefined ? "" : String(n));

/** The draft a saved route opens as. */
export function draftFromRoute(r: HubRouteWire): RouteDraft {
  const when = r.match.when;
  const ack = r.ack && typeof r.ack === "object" ? r.ack : undefined;
  const text = ack?.text;
  return {
    id: r.id,
    enabled: r.enabled !== false,
    channelId: r.match.channelId,
    agentId: r.target.agentId,
    conversation: r.match.conversation ?? "any",
    when: !when ? "any" : when._tag === "Mention" ? "mention" : when._tag === "Command" ? "command" : "keyword",
    whenValue: !when ? "" : when._tag === "Command" ? when.name : when._tag === "Keyword" ? when.patterns.join("\n") : "",
    session: r.session ?? "per-conversation",
    owners: [...(r.owners ?? [])],
    allow: [...(r.allow ?? [])],
    deny: [...(r.deny ?? [])],
    open: r.open === true,
    senderTools: r.senderTools?._tag ?? "ReadOnly",
    senderToolList: r.senderTools?._tag === "Allowlist" ? [...r.senderTools.tools] : [],
    maxCostPerDayUsd: num(r.maxCostPerDayUsd),
    maxTurnsPerHour: num(r.maxTurnsPerHour),
    maxTurnsPerSenderPerHour: num(r.maxTurnsPerSenderPerHour),
    maxIterations: num(r.maxIterations),
    ackOn: !!ack,
    ackAfterMs: num(ack?.afterMs),
    ackText: Array.isArray(text) ? text.join("\n") : (text ?? ""),
    ackTyping: ack?.typing !== false,
    ackSource: ack?.source ?? "canned",
    ackModelTimeoutMs: num(ack?.modelTimeoutMs),
    ...resetDraftFromWire(r.resetCommands),
    ...turnLimitDraftFromWire(r),
    ...batchingDraftFromWire(r),
    ...pacingDraftFromWire(r),
  };
}

const toNum = (s: string): number | undefined => {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
};

const lines = (s: string): string[] => s.split("\n").map((l) => l.trim()).filter((l) => l !== "");

/**
 * The wire route for a draft. `saved` keeps the fields the editor does not own. On a webhook channel
 * (`platform`) access is the signing secret, so the framework refuses `senderTools` and `ack` at all:
 * they are left out, not sent as defaults.
 */
export function routeFromDraft(d: RouteDraft, saved?: HubRouteWire, platform?: string): HubRouteWire {
  const wire = routeWithAll(d, saved);
  const caps = routeCapabilities(platform);
  const { senderTools, ack, batchWindowMs, midRun, minGapMs, resetCommands, failureNotice, turnTimeoutMs, maxTurnsPerSenderPerHour, match, ...rest } = wire;
  const { conversation, when, ...matchRest } = match;
  return {
    ...rest,
    match: { ...matchRest, ...(caps.conversation && conversation ? { conversation } : {}), ...(caps.trigger && when ? { when } : {}) },
    ...(caps.senderAccess ? {} : { owners: [], allow: [], deny: [], open: false }),
    ...(caps.senderAccess && senderTools ? { senderTools } : {}),
    ...(caps.ack && ack !== undefined ? { ack } : {}),
    ...(caps.batching && batchWindowMs !== undefined ? { batchWindowMs } : {}),
    ...(caps.batching && midRun !== undefined ? { midRun } : {}),
    ...(caps.batching && minGapMs !== undefined ? { minGapMs } : {}),
    ...(caps.reset && resetCommands !== undefined ? { resetCommands } : {}),
    ...(caps.failureNotice && failureNotice !== undefined ? { failureNotice } : {}),
    ...(caps.turnLimit && turnTimeoutMs !== undefined ? { turnTimeoutMs } : {}),
    ...(caps.perSenderCap && maxTurnsPerSenderPerHour !== undefined ? { maxTurnsPerSenderPerHour } : {}),
  };
}

function routeWithAll(d: RouteDraft, saved?: HubRouteWire): HubRouteWire {
  const { migratedFrom: _m, ...base } = saved ?? ({ id: d.id } as HubRouteWire);
  const when: HubRouteWire["match"]["when"] =
    d.when === "mention" ? { _tag: "Mention" } : d.when === "command" ? { _tag: "Command", name: d.whenValue.trim() } : d.when === "keyword" ? { _tag: "Keyword", patterns: lines(d.whenValue) } : undefined;
  const match: HubRouteWire["match"] = {
    channelId: d.channelId,
    ...(d.conversation !== "any" ? { conversation: d.conversation } : {}),
    ...(saved?.match.conversationIds ? { conversationIds: saved.match.conversationIds } : {}),
    ...(when ? { when } : {}),
  };
  const senderTools: SenderToolsWire =
    d.senderTools === "AgentDefault" ? { _tag: "AgentDefault" } : d.senderTools === "Allowlist" ? { _tag: "Allowlist", tools: d.senderToolList } : { _tag: "ReadOnly" };
  const opt = (key: "maxCostPerDayUsd" | "maxTurnsPerHour" | "maxTurnsPerSenderPerHour" | "maxIterations", v: string) => {
    const n = toNum(v);
    return n === undefined ? {} : { [key]: n };
  };
  const ackText = lines(d.ackText);
  const ack: AckWire | false = d.ackOn
    ? {
        ...(toNum(d.ackAfterMs) !== undefined ? { afterMs: toNum(d.ackAfterMs) } : {}),
        ...(ackText.length === 1 ? { text: ackText[0] } : ackText.length > 1 ? { text: ackText } : {}),
        typing: d.ackTyping,
        source: d.ackSource,
        ...(d.ackSource === "model" && toNum(d.ackModelTimeoutMs) !== undefined ? { modelTimeoutMs: toNum(d.ackModelTimeoutMs) } : {}),
      }
    : false;
  const {
    maxCostPerDayUsd: _c,
    maxTurnsPerHour: _t,
    maxTurnsPerSenderPerHour: _s,
    maxIterations: _i,
    resetCommands: _r,
    turnTimeoutMs: _tt,
    failureNotice: _fn,
    batchWindowMs: _bw,
    midRun: _mr,
    minGapMs: _mg,
    ...rest
  } = base;
  const resetCommands = resetWireFromDraft(d);
  return {
    ...rest,
    id: d.id.trim(),
    enabled: d.enabled,
    match,
    target: { agentId: d.agentId },
    session: d.session,
    owners: d.owners,
    allow: d.allow,
    deny: d.deny,
    open: d.open,
    senderTools,
    ...opt("maxCostPerDayUsd", d.maxCostPerDayUsd),
    ...opt("maxTurnsPerHour", d.maxTurnsPerHour),
    ...opt("maxTurnsPerSenderPerHour", d.maxTurnsPerSenderPerHour),
    ...opt("maxIterations", d.maxIterations),
    ack,
    ...(resetCommands ? { resetCommands } : {}),
    ...turnLimitWireFromDraft(d),
    ...batchingWireFromDraft(d),
    ...pacingWireFromDraft(d),
  };
}

/** Problems that would make the server refuse the draft, in plain words. Empty = looks savable. */
export function draftProblems(d: RouteDraft, creating: boolean, platform?: string): string[] {
  const caps = routeCapabilities(platform);
  const copy = channelKindCopy(platform);
  const out: string[] = [];
  if (creating && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(d.id.trim())) out.push("Give the route an id: letters, digits, dot, dash or underscore.");
  if (!d.channelId) out.push("Pick the channel this route listens on.");
  if (!d.agentId) out.push(copy.agentRequired);
  if (caps.trigger && d.when === "command" && d.whenValue.trim() === "") out.push("Name the command (for example start).");
  if (caps.trigger && d.when === "keyword" && lines(d.whenValue).length === 0) out.push("Add at least one keyword.");
  for (const list of caps.senderAccess ? [d.owners, d.allow, d.deny] : []) {
    for (const e of list) {
      const p = senderProblem(e);
      if (p) out.push(p);
    }
  }
  const positive = (label: string, s: string, required: boolean) => {
    const n = toNum(s);
    if (n === undefined) {
      if (required) out.push(`${label} is required for an open route.`);
    } else if (!(n > 0)) out.push(`${label} must be a number above zero.`);
  };
  const open = caps.senderAccess && d.open;
  positive("Cost per day", d.maxCostPerDayUsd, open);
  positive(copy.turnsPerHourLabel, d.maxTurnsPerHour, open);
  if (caps.perSenderCap) positive("Turns per sender per hour", d.maxTurnsPerSenderPerHour, open);
  positive("Max iterations", d.maxIterations, false);
  if (caps.senderAccess && d.senderTools === "AgentDefault" && d.owners.length === 0) out.push("Full agent tools for senders needs at least one owner, who approves risky tools.");
  if (caps.reset) out.push(...resetProblems(d));
  if (caps.turnLimit) out.push(...turnLimitProblems(d, copy.turnLimitMin));
  if (caps.batching) {
    out.push(...batchingProblems(d));
    out.push(...pacingProblems(d));
  }
  if (caps.ack && d.ackOn) {
    const after = toNum(d.ackAfterMs);
    if (after !== undefined && !(after >= 0)) out.push("Acknowledge after must be zero or more milliseconds.");
    if (d.ackSource === "model") {
      const t = toNum(d.ackModelTimeoutMs);
      if (t !== undefined && !(t >= MODEL_TIMEOUT_RANGE.min && t <= MODEL_TIMEOUT_RANGE.max)) {
        out.push(`Model wait must be between ${MODEL_TIMEOUT_RANGE.min} and ${MODEL_TIMEOUT_RANGE.max} milliseconds.`);
      }
    }
  }
  return out;
}

/** Add typed or pasted senders to a chip list: normalised, deduped; the rest are reported. */
export function addSenderChips(list: readonly string[], text: string): { list: string[]; problems: string[] } {
  const next = [...list];
  const problems: string[] = [];
  for (const raw of text.split(/[\s,;]+/).filter((s) => s !== "")) {
    const p = senderProblem(raw);
    if (p) problems.push(p);
    else {
      const key = normalizeSender(raw);
      if (!next.includes(key)) next.push(key);
    }
  }
  return { list: next, problems };
}

/** Confirm tokens a save needs, mirroring the framework's `wideningChanges` (the server decides). */
export function wideningTokens(saved: HubRouteWire | undefined, next: HubRouteWire): string[] {
  const out: string[] = [];
  if ((next.owners ?? []).some((o) => !(saved?.owners ?? []).includes(o))) out.push(`owners:${next.id}`);
  if (next.open === true && saved?.open !== true) out.push(`open:${next.id}`);
  if (next.senderTools?._tag === "AgentDefault" && saved?.senderTools?._tag !== "AgentDefault") out.push(`agent-default:${next.id}`);
  return out;
}

/** The risk each confirm token names, for the audited confirm dialog. */
export function riskSentence(token: string): string {
  const kind = token.slice(0, token.indexOf(":"));
  if (kind === "owners") return "Owners can run every tool the agent has and approve risky ones from a chat message.";
  if (kind === "open") return "Open means anyone who finds the account can talk to the agent, and every message can spend money. The cost and turn caps are the only limit.";
  if (kind === "agent-default") return "Full agent tools means the senders get everything the agent was built with, not the read-only set.";
  return "This change widens who can reach the agent.";
}

/** Title and message of the confirm dialog for a widening save. */
export function widenConfirmCopy(routeId: string, tokens: readonly string[]): { title: string; message: string } {
  return {
    title: `Widen access on ${routeId}?`,
    message: `${tokens.map(riskSentence).join(" ")} Cortex records this change with the time and what was confirmed.`,
  };
}

/** One line of what a route does, for the list. */
export function routeLine(r: HubRouteWire, platform?: string): string {
  if (!routeCapabilities(platform).conversation) return channelKindCopy(platform).routeScope;
  const m = r.match;
  const where = m.conversation === "dm" ? "direct messages" : m.conversation === "group" ? "groups" : "any conversation";
  const when = !m.when ? "" : m.when._tag === "Mention" ? ", when mentioned" : m.when._tag === "Command" ? `, /${m.when.name}` : `, keywords: ${m.when.patterns.join(", ")}`;
  return `${where}${when}`;
}

/** Who may talk through a route, in one clause. */
export function accessClause(r: HubRouteWire, platform?: string): string {
  if (!routeCapabilities(platform).senderAccess) return "the signing secret";
  if (r.open) return "anyone";
  const n = (r.allow ?? []).length + (r.owners ?? []).length;
  return n === 0 ? "nobody yet" : `${n} sender${n === 1 ? "" : "s"}`;
}

/** Routes that reach `agentId`, in priority order (lower first), for the Agent page summary. */
export function routesToAgent(agentId: string, routes: readonly HubRouteWire[]): HubRouteWire[] {
  return routes.filter((r) => r.target.agentId === agentId).sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

/** The result of "Send test message": what `simulate` did, what `explain` says would happen. */
export interface ProbeView {
  readonly headline: string;
  readonly tone: "ok" | "warn" | "bad" | "neutral";
  readonly lines: readonly string[];
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Read the `explain` answer into the words the panel shows (route, role, tools, why). */
export function explainView(explain: unknown): ProbeView {
  if (!isRec(explain)) return { headline: "No answer", tone: "neutral", lines: [] };
  const decision = str(explain.decision);
  const lines: string[] = [];
  if (str(explain.routeId)) lines.push(`Route: ${str(explain.routeId)}`);
  if (str(explain.role)) lines.push(`Role: ${str(explain.role)}`);
  const tools = explain.toolExposure;
  if (isRec(tools) && str(tools._tag)) {
    const tag = str(tools._tag);
    lines.push(`Tools: ${tag === "ReadOnly" ? "read-only" : tag === "AgentDefault" ? "the agent's full tools" : Array.isArray(tools.tools) && tools.tools.length > 0 ? `only ${tools.tools.join(", ")}` : "none"}`);
  }
  if (str(explain.reason)) lines.push(`Why: ${str(explain.reason)}`);
  const headline =
    decision === "allowed" ? "This message would be answered" : decision === "denied" ? "This sender would be refused" : decision === "dropped-group" ? "This group message would be ignored" : "No route matches this message";
  return { headline, tone: decision === "allowed" ? "ok" : decision === "denied" ? "bad" : "warn", lines };
}

/** A failed turn's router reason in plain words (unknown reasons pass through). */
export function failureReasonLine(reason: string | undefined): string | undefined {
  if (reason === "turn_timeout") return "The turn ran past the route's turn limit and was stopped.";
  if (reason === "turn_failed") return "The agent failed while answering.";
  if (reason === "resolve_failed") return "The agent for this route could not be opened.";
  return reason;
}

/** Read the `simulate` outcome (a real run through the real path, nothing sent). */
export function simulateView(sim: unknown): ProbeView {
  if (!isRec(sim)) return { headline: "No answer", tone: "neutral", lines: [] };
  const outcome = str(sim.outcome);
  if (outcome === "answered") return { headline: "The agent answered", tone: "ok", lines: [str(sim.text) ?? ""].filter((l) => l !== "") };
  if (outcome === "failed") return { headline: "The turn failed", tone: "bad", lines: [failureReasonLine(str(sim.reason)), str(sim.detail)].filter((l): l is string => !!l) };
  if (outcome === "denied") return { headline: "Refused", tone: "bad", lines: [str(sim.reason)].filter((l): l is string => !!l) };
  if (outcome === "dropped") return { headline: "Dropped", tone: "warn", lines: [str(sim.reason)].filter((l): l is string => !!l) };
  if (outcome === "unrouted") return { headline: "No route matches", tone: "warn", lines: [] };
  if (outcome === "duplicate") return { headline: "Seen before (duplicate)", tone: "warn", lines: [] };
  return { headline: "Unexpected answer", tone: "neutral", lines: [] };
}
