/**
 * Session capabilities: the ONE table of what the `session-control` tool may propose beyond the
 * original model / skill / doc / goal / loop actions, and the Settings switches that gate it.
 *
 * Per action the registry knows its switch group, its argument aliases, how to validate against
 * live values (tools from the registry, MCP servers already configured, strategies the framework
 * registers, a workspace that exists), the before -> after diff the user sees, whether the change
 * tightens or loosens the agent, and the effect to run on Apply as DATA ({@link CapabilityPlan}).
 * The proposal service executes plans through the same paths the Config menu uses
 * (`updateSessionConfig`, compact / fork / rewind / to-do), so there is no second config path.
 *
 * Safety (do not weaken): a proposal only ever applies after a human Apply, except a TIGHTENING
 * change whose group the user listed in `agentControlAutoApply` (see `canAutoApply`). A loosening
 * change can never auto-apply, whatever the switches say. Pure of I/O.
 */
import {
  bad,
  clip,
  good,
  matchOne,
  num,
  text,
  type ActionContext,
  type ActionValidation,
  type ProposalDiffRow,
} from "./session-action-kit.js";

/** A switch group in Settings: "Let the agent change: ...". */
export interface CapabilityGroup {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

/** Every group. `basics` is on whenever Agent control is on (the original behaviour); the rest are off until enabled. */
export const CAPABILITY_GROUPS = [
  { id: "basics", label: "Model, skills, goals and loops", detail: "Switch model or thinking, pin a skill, add a document, propose goals, loops and schedules. On with Agent control." },
  { id: "tools", label: "Tools", detail: "Add or remove a tool or toolset; enable an MCP server you already configured." },
  { id: "limits", label: "Limits and strategy", detail: "Max steps, reasoning strategy, context budget." },
  { id: "memory", label: "Memory", detail: "Turn the working, episodic or semantic memory tier on or off." },
  { id: "prompt", label: "System prompt", detail: "Propose new system prompt text." },
  { id: "approvals", label: "Approvals", detail: "Ask-before-risky-tools. Stricter can auto-apply when you allow it; looser always needs your Apply." },
  { id: "workspace", label: "Workspace folder", detail: "Point file tools and the shell at another existing folder." },
  { id: "conversation", label: "Conversation", detail: "Edit the to-do list; compact, fork or rewind the chat." },
] as const satisfies readonly CapabilityGroup[];

/** A switch group id. */
export type CapabilityGroupId = (typeof CAPABILITY_GROUPS)[number]["id"];

/** Group ids as a plain list (config validation). */
export const CAPABILITY_GROUP_IDS: readonly string[] = CAPABILITY_GROUPS.map((g) => g.id);

/** Actions this registry validates (the rest live in `session-actions.ts`). */
export const CAPABILITY_ACTIONS = [
  "add-tool",
  "remove-tool",
  "enable-mcp-server",
  "set-max-iterations",
  "set-strategy",
  "set-context-budget",
  "set-memory",
  "set-system-prompt",
  "set-approval-policy",
  "set-workspace",
  "set-todo",
  "compact",
  "fork",
  "rewind",
] as const;

/** An action of this registry. */
export type CapabilityAction = (typeof CAPABILITY_ACTIONS)[number];

const GROUP_OF: Readonly<Record<string, CapabilityGroupId>> = {
  "add-tool": "tools",
  "remove-tool": "tools",
  "enable-mcp-server": "tools",
  "set-max-iterations": "limits",
  "set-strategy": "limits",
  "set-context-budget": "limits",
  "set-memory": "memory",
  "set-system-prompt": "prompt",
  "set-approval-policy": "approvals",
  "set-workspace": "workspace",
  "set-todo": "conversation",
  compact: "conversation",
  fork: "conversation",
  rewind: "conversation",
};

/** The switch group an action belongs to; every original action is `basics`. */
export const groupOf = (action: string): CapabilityGroupId => GROUP_OF[action] ?? "basics";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Groups the user has enabled for this session (`agentControlGroups`); `basics` rides Agent control itself. */
export function enabledGroups(config: Readonly<Record<string, unknown>>): ReadonlySet<CapabilityGroupId> {
  const on = new Set<CapabilityGroupId>(["basics"]);
  for (const g of strings(config.agentControlGroups)) if (CAPABILITY_GROUP_IDS.includes(g)) on.add(g as CapabilityGroupId);
  return on;
}

/** Message naming the missing switch when `action`'s group is off, else null. */
export function groupRefusal(action: string, config: Readonly<Record<string, unknown>>): string | null {
  const g = groupOf(action);
  if (enabledGroups(config).has(g)) return null;
  const meta = CAPABILITY_GROUPS.find((x) => x.id === g);
  return `the user has not let the agent change "${meta?.label ?? g}"; ask them to enable it in Config > Agent control`;
}

/** Groups whose TIGHTENING proposals the user let apply without a click (`agentControlAutoApply`). */
export function autoApplyGroups(config: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const enabled = enabledGroups(config);
  return new Set(strings(config.agentControlAutoApply).filter((g) => enabled.has(g as CapabilityGroupId)));
}

/**
 * May this proposal apply without a human click? Only a tightening change, in a group the user
 * allowed, with no injection-risk flag. Everything else needs Apply.
 */
export function canAutoApply(
  action: string,
  direction: "tighten" | "loosen" | "neutral" | undefined,
  flag: string | undefined,
  config: Readonly<Record<string, unknown>>,
): boolean {
  return direction === "tighten" && flag === undefined && autoApplyGroups(config).has(groupOf(action));
}

const EXTERNAL_TOOL = /web|http|fetch|scrap|crawl|brows|search|rss|mail|url/i;

/**
 * What in this session lets outside text reach the model (web tools, MCP servers, added documents).
 * Any of them means a proposal might be steered by a page or document, so the card says so.
 * Returns a flag sentence, or undefined when nothing external is wired in.
 */
export function externalContentFlag(config: Readonly<Record<string, unknown>>): string | undefined {
  const sources = [
    ...strings(config.tools).filter((t) => EXTERNAL_TOOL.test(t)),
    ...(strings(config.mcpServerIds).length > 0 ? ["MCP servers"] : []),
    ...(Array.isArray(config.documents) && config.documents.length > 0 ? ["added documents"] : []),
  ];
  if (sources.length === 0) return undefined;
  return `This chat reads outside content (${[...new Set(sources)].slice(0, 4).join(", ")}). A page or document may have steered this proposal: read it before you apply.`;
}

/** Closed alias table: spoken action name -> canonical. */
export const CAPABILITY_ACTION_ALIASES: Readonly<Record<string, string>> = {
  "enable-tool": "add-tool",
  "use-tool": "add-tool",
  "disable-tool": "remove-tool",
  "drop-tool": "remove-tool",
  mcp: "enable-mcp-server",
  "enable-mcp": "enable-mcp-server",
  "max-steps": "set-max-iterations",
  "max-iterations": "set-max-iterations",
  "set-max-steps": "set-max-iterations",
  strategy: "set-strategy",
  "context-budget": "set-context-budget",
  "set-num-ctx": "set-context-budget",
  memory: "set-memory",
  "system-prompt": "set-system-prompt",
  prompt: "set-system-prompt",
  approvals: "set-approval-policy",
  "approval-policy": "set-approval-policy",
  workspace: "set-workspace",
  folder: "set-workspace",
  todo: "set-todo",
  "set-todos": "set-todo",
  summarize: "compact",
  "fork-chat": "fork",
  "rewind-chat": "rewind",
};

/** Per action: canonical argument -> accepted alternates. */
export const CAPABILITY_PARAM_ALIASES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  "add-tool": { value: ["tool", "name", "toolset", "tool_name"] },
  "remove-tool": { value: ["tool", "name", "toolset", "tool_name"] },
  "enable-mcp-server": { value: ["server", "name", "id", "mcp", "serverId"] },
  "set-max-iterations": { value: ["max", "steps", "maxSteps", "maxIterations", "limit"] },
  "set-strategy": { value: ["strategy", "name"] },
  "set-context-budget": { value: ["tokens", "numCtx", "budget", "size"] },
  "set-memory": { tier: ["type", "memory", "layer"], value: ["enabled", "state", "on", "mode"] },
  "set-system-prompt": { value: ["prompt", "text", "systemPrompt", "system_prompt"] },
  "set-approval-policy": { value: ["policy", "mode", "approvals", "ask"] },
  "set-workspace": { value: ["path", "folder", "dir", "directory", "workspace"] },
  "set-todo": { value: ["items", "todo", "list", "tasks"] },
  compact: { keepLast: ["keep", "keep_last"] },
  fork: { atTurnId: ["turn", "turnId", "at"] },
  rewind: { turnId: ["turn", "id", "value", "at"] },
};

/** What Apply does, as data: the service runs it through the existing session paths. */
export type CapabilityPlan =
  | { readonly kind: "patch"; readonly patch: Record<string, unknown> }
  | { readonly kind: "compact"; readonly keepLast?: number }
  | { readonly kind: "fork"; readonly atTurnId?: number }
  | { readonly kind: "rewind"; readonly turnId: number }
  | { readonly kind: "todo"; readonly titles: readonly string[] };

const MAX_PROMPT_CHARS = 4000;
const MAX_TODO_ITEMS = 30;
const MAX_TODO_TITLE = 200;
const TIERS = ["working", "episodic", "semantic"] as const;
type Tier = (typeof TIERS)[number];
const ON = new Set(["on", "true", "yes", "enable", "enabled", "1"]);
const OFF = new Set(["off", "false", "no", "disable", "disabled", "0"]);
const ASK = new Set(["ask", "on", "true", "yes", "stricter", "strict"]);
const AUTO = new Set(["auto", "off", "false", "no", "never", "allow", "looser"]);

const row = (label: string, before: string, after: string): ProposalDiffRow => ({ label, before, after });
const listOf = (v: readonly string[]): string => (v.length === 0 ? "none" : clip(v.join(", "), 80));
const posInt = (n: number | undefined): n is number => n !== undefined && Number.isInteger(n) && n > 0;

/** Validate one registry action. Never throws; failure messages name the valid options. */
export async function validateCapability(
  action: CapabilityAction,
  a: Readonly<Record<string, unknown>>,
  ctx: ActionContext,
): Promise<ActionValidation> {
  const cfg = ctx.config;
  switch (action) {
    case "add-tool": {
      const value = text(a.value);
      if (!value) return bad(`add-tool needs value (a tool or toolset name)`);
      const m = matchOne(value, ctx.toolNames, "tool");
      if (!m.ok) return bad(m.message);
      if (m.value === "shell-execute") return bad(`the full host shell cannot be enabled by the agent; the user turns it on with /terminal. A shell toolset (for example git) is allowed`);
      const cur = strings(cfg.tools);
      if (cur.includes(m.value)) return bad(`tool already selected: ${m.value}`);
      return good("add-tool", { value: m.value }, `add tool ${m.value}`, {
        diff: [row("Tools", listOf(cur), listOf([...cur, m.value]))],
        direction: "loosen",
      });
    }
    case "remove-tool": {
      const value = text(a.value);
      const cur = strings(cfg.tools);
      if (!value) return bad(`remove-tool needs value; selected: ${listOf(cur)}`);
      const m = matchOne(value, cur, "selected tool");
      if (!m.ok) return bad(m.message);
      return good("remove-tool", { value: m.value }, `remove tool ${m.value}`, {
        diff: [row("Tools", listOf(cur), listOf(cur.filter((t) => t !== m.value)))],
        direction: "tighten",
      });
    }
    case "enable-mcp-server": {
      const value = text(a.value);
      if (!value) return bad(`enable-mcp-server needs value (one of: ${ctx.mcpServers.map((s) => s.name).join(", ") || "none configured"})`);
      const names = ctx.mcpServers.flatMap((s) => [s.id, s.name]);
      const m = matchOne(value, names, "MCP server");
      if (!m.ok) return bad(`${m.message}. The agent can only enable a server the user already configured`);
      const server = ctx.mcpServers.find((s) => s.id === m.value || s.name === m.value);
      if (!server) return bad(`unknown MCP server "${value}"`);
      const cur = strings(cfg.mcpServerIds);
      if (cur.includes(server.id)) return bad(`MCP server already enabled: ${server.name}`);
      return good("enable-mcp-server", { value: server.id }, `enable MCP server ${server.name}`, {
        diff: [row("MCP servers", `${cur.length} enabled`, `${cur.length + 1} enabled (+ ${server.name})`)],
        direction: "loosen",
      });
    }
    case "set-max-iterations": {
      const n = num(a.value);
      if (!posInt(n) || n > 100) return bad(`set-max-iterations needs value: a whole number from 1 to 100`);
      const before = typeof cfg.maxIterations === "number" ? cfg.maxIterations : undefined;
      return good("set-max-iterations", { value: n }, `limit the agent to ${n} steps per turn`, {
        diff: [row("Max steps", before === undefined ? "default" : String(before), String(n))],
        direction: before === undefined || n === before ? "neutral" : n < before ? "tighten" : "loosen",
      });
    }
    case "set-strategy": {
      const value = text(a.value);
      if (!value) return bad(`set-strategy needs value (one of: ${ctx.strategies.join(", ")})`);
      const m = matchOne(value, ctx.strategies, "strategy");
      if (!m.ok) return bad(m.message);
      return good("set-strategy", { value: m.value }, `use the ${m.value} reasoning strategy`, {
        diff: [row("Strategy", text(cfg.strategy) || "default", m.value)],
        direction: "neutral",
      });
    }
    case "set-context-budget": {
      const n = num(a.value);
      if (!posInt(n) || n < 512 || n > 1_048_576) return bad(`set-context-budget needs value: a whole number of tokens from 512 to 1048576`);
      const before = typeof cfg.numCtx === "number" ? cfg.numCtx : undefined;
      return good("set-context-budget", { value: n }, `set the context budget to ${n} tokens`, {
        diff: [row("Context budget", before === undefined ? "default" : `${before} tokens`, `${n} tokens`)],
        direction: before === undefined || n === before ? "neutral" : n < before ? "tighten" : "loosen",
      });
    }
    case "set-memory": {
      const tier = matchOne(text(a.tier).toLowerCase(), TIERS, "memory tier");
      if (!tier.ok) return bad(tier.message);
      const raw = text(a.value).toLowerCase();
      const want = ON.has(raw) ? true : OFF.has(raw) ? false : undefined;
      if (want === undefined) return bad(`set-memory needs value: on or off (got "${raw}")`);
      const mem = (cfg.memory && typeof cfg.memory === "object" ? cfg.memory : {}) as Record<string, unknown>;
      const before = mem[tier.value] === true;
      if (before === want) return bad(`${tier.value} memory is already ${want ? "on" : "off"}`);
      return good("set-memory", { tier: tier.value, value: want ? "on" : "off" }, `turn ${tier.value} memory ${want ? "on" : "off"}`, {
        diff: [row(`${tier.value} memory`, before ? "on" : "off", want ? "on" : "off")],
        direction: want ? "loosen" : "tighten",
      });
    }
    case "set-system-prompt": {
      const value = typeof a.value === "string" ? a.value.trim() : "";
      if (!value) return bad(`set-system-prompt needs value: the new system prompt text`);
      if (value.length > MAX_PROMPT_CHARS) return bad(`the system prompt is capped at ${MAX_PROMPT_CHARS} characters for proposals (got ${value.length})`);
      const before = text(cfg.systemPrompt);
      if (before === value) return bad(`the system prompt already has this text`);
      return good("set-system-prompt", { value }, `replace the system prompt (${value.length} characters)`, {
        diff: [row("System prompt", before ? clip(before, 120) : "default", clip(value, 120))],
        direction: "neutral",
      });
    }
    case "set-approval-policy": {
      const raw = text(a.value).toLowerCase();
      const want = ASK.has(raw) ? "ask" : AUTO.has(raw) ? "auto" : undefined;
      if (want === undefined) return bad(`set-approval-policy needs value: ask (ask before risky tools) or auto (do not ask) (got "${raw}")`);
      const now = cfg.askBeforeRiskyTools === false ? "auto" : "ask";
      if (now === want) return bad(`approvals are already set to ${want}`);
      return good("set-approval-policy", { value: want }, want === "ask" ? "ask before risky tools" : "stop asking before risky tools", {
        diff: [row("Risky tools", now === "ask" ? "ask first" : "run without asking", want === "ask" ? "ask first" : "run without asking")],
        direction: want === "ask" ? "tighten" : "loosen",
      });
    }
    case "set-workspace": {
      const value = text(a.value);
      if (!value) return bad(`set-workspace needs value: an absolute path to an existing folder`);
      const checked = ctx.checkWorkspace(value);
      if (!checked.ok) return bad(checked.error);
      const before = text(cfg.workspace);
      if (before === checked.path) return bad(`workspace is already ${checked.path}`);
      return good("set-workspace", { value: checked.path }, `use ${clip(checked.path, 80)} as the workspace`, {
        diff: [row("Workspace", before || "none", checked.path)],
        direction: "loosen",
      });
    }
    case "set-todo": {
      const items = text(a.value)
        .split(/\r?\n|;/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (items.length === 0) return bad(`set-todo needs value: items separated by new lines or semicolons`);
      if (items.length > MAX_TODO_ITEMS) return bad(`a to-do list holds at most ${MAX_TODO_ITEMS} items (got ${items.length})`);
      if (items.some((s) => s.length > MAX_TODO_TITLE)) return bad(`each to-do item is capped at ${MAX_TODO_TITLE} characters`);
      return good("set-todo", { value: items.join("\n") }, `replace the to-do list with ${items.length} item${items.length === 1 ? "" : "s"}`, {
        diff: [row("To-do", `${ctx.todo.length} item${ctx.todo.length === 1 ? "" : "s"}`, clip(items.join(" | "), 120))],
        direction: "neutral",
      });
    }
    case "compact": {
      const keepLast = num(a.keepLast);
      if (keepLast !== undefined && (!Number.isInteger(keepLast) || keepLast < 0 || keepLast > 20)) return bad(`compact keepLast must be a whole number from 0 to 20`);
      return good("compact", keepLast === undefined ? {} : { keepLast }, `compact the conversation${keepLast === undefined ? "" : `, keeping the last ${keepLast} exchanges`}`, {
        diff: [row("History", "full", "older messages summarised")],
        direction: "neutral",
      });
    }
    case "fork": {
      const at = num(a.atTurnId);
      if (at !== undefined && !posInt(at)) return bad(`fork atTurnId must be a turn id from the chat`);
      return good("fork", at === undefined ? {} : { atTurnId: at }, at === undefined ? "fork this chat into a new one" : `fork a new chat from turn ${at}`, {
        diff: [row("Chats", "this chat", "this chat + a new fork")],
        direction: "neutral",
      });
    }
    case "rewind": {
      const turn = num(a.turnId);
      if (!posInt(turn)) return bad(`rewind needs turnId: the id of the message to rewind to`);
      return good("rewind", { turnId: turn }, `rewind the chat to turn ${turn} (that message and everything after it is removed)`, {
        diff: [row("History", "through the latest message", `removed from turn ${turn} on`)],
        direction: "neutral",
      });
    }
  }
}

/**
 * Turn a validated registry action into its effect. `null` for an action this registry does not
 * own. The patches use the same keys the Config menu PATCHes.
 */
export function planCapability(action: string, a: Readonly<Record<string, unknown>>, ctx: ActionContext): CapabilityPlan | null {
  const cfg = ctx.config;
  switch (action) {
    case "add-tool":
      return { kind: "patch", patch: { tools: [...new Set([...strings(cfg.tools), text(a.value)])] } };
    case "remove-tool":
      return { kind: "patch", patch: { tools: strings(cfg.tools).filter((t) => t !== text(a.value)) } };
    case "enable-mcp-server":
      return { kind: "patch", patch: { mcpServerIds: [...new Set([...strings(cfg.mcpServerIds), text(a.value)])] } };
    case "set-max-iterations":
      return { kind: "patch", patch: { maxIterations: num(a.value) } };
    case "set-strategy":
      return { kind: "patch", patch: { strategy: text(a.value) } };
    case "set-context-budget":
      return { kind: "patch", patch: { numCtx: num(a.value) } };
    case "set-memory": {
      const mem = (cfg.memory && typeof cfg.memory === "object" ? cfg.memory : {}) as Record<string, unknown>;
      return { kind: "patch", patch: { memory: { ...mem, [text(a.tier) as Tier]: text(a.value) === "on" } } };
    }
    case "set-system-prompt":
      return { kind: "patch", patch: { systemPrompt: typeof a.value === "string" ? a.value.trim() : "" } };
    case "set-approval-policy":
      return { kind: "patch", patch: { askBeforeRiskyTools: text(a.value) === "ask" } };
    case "set-workspace":
      return { kind: "patch", patch: { workspace: text(a.value) } };
    case "set-todo":
      return { kind: "todo", titles: text(a.value).split("\n").filter((s) => s.length > 0) };
    case "compact": {
      const keepLast = num(a.keepLast);
      return keepLast === undefined ? { kind: "compact" } : { kind: "compact", keepLast };
    }
    case "fork": {
      const at = num(a.atTurnId);
      return at === undefined ? { kind: "fork" } : { kind: "fork", atTurnId: at };
    }
    case "rewind": {
      const turn = num(a.turnId);
      return turn === undefined ? null : { kind: "rewind", turnId: turn };
    }
    default:
      return null;
  }
}

/** The effective session configuration, one fact per line, for the agent's `describe-session` action. */
export function describeSession(ctx: ActionContext): string {
  const c = ctx.config;
  const mem = (c.memory && typeof c.memory === "object" ? c.memory : {}) as Record<string, unknown>;
  const memOn = TIERS.filter((t) => mem[t] === true);
  const on = [...enabledGroups(c)];
  const auto = [...autoApplyGroups(c)];
  const thinking = typeof c.thinking === "boolean" ? (c.thinking ? "on" : "off") : "auto";
  const g = ctx.goal?.goal;
  return [
    `provider: ${text(c.provider) || "anthropic"}`,
    `model: ${text(c.model) || "default"}`,
    `thinking: ${thinking}`,
    `strategy: ${text(c.strategy) || "default"}`,
    `max steps: ${typeof c.maxIterations === "number" ? c.maxIterations : "default"}`,
    `context budget: ${typeof c.numCtx === "number" ? `${c.numCtx} tokens` : "default"}`,
    `tools: ${listOf(strings(c.tools))}`,
    `mcp servers enabled: ${listOf(strings(c.mcpServerIds))}`,
    `memory tiers on: ${listOf(memOn)}`,
    `approvals: ${c.askBeforeRiskyTools === false ? "risky tools run without asking" : "ask before risky tools"}`,
    `workspace: ${text(c.workspace) || "none"}`,
    `system prompt: ${text(c.systemPrompt) ? clip(text(c.systemPrompt), 160) : "default"}`,
    `skills pinned: ${listOf(strings((c.skills as { activate?: unknown } | undefined)?.activate))}`,
    `goal: ${g ? `${g.status} "${clip(g.objective, 40)}"` : "none"}`,
    `to-do items: ${ctx.todo.length}`,
    `you may propose changes in: ${on.join(", ")}`,
    `changes that apply without a click (tightening only): ${auto.length ? auto.join(", ") : "none"}`,
  ].join("\n");
}
