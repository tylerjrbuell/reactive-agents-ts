/**
 * Rows of the chat slash menu, built from the session config and catalogs.
 *
 * Pure: every side effect (PATCH, toast, draft swap) arrives as a callback on the
 * context. `ctx.cfg` is read both when the rows are built and again when a row runs,
 * so the component passes it as a getter: a queued multi-row toggle must compute its
 * patch from the config the previous toggle left behind (chat-menu.ts createToggleQueue).
 */
import type { ChatCommand, ParsedSlash } from "./chat-commands.js";
import { isLiveConfigCommand } from "./chat-live-config.js";
import { matchEntries, type EntryState } from "./config-menu-nav.js";
import type { MenuItem } from "./chat-menu.js";
import { DURABLE_RUNS_CHAT_DETAIL, DURABLE_RUNS_CHAT_OFF_DETAIL, durableRunsOn, durableRunsPatch } from "./durable-runs.js";
import { agentControlEnabled } from "./proposal-view.js";
import { AGENT_CONTROL_GROUPS, autoApplyControlGroups, enabledControlGroups, toggleAutoApplyPatch, toggleControlGroupPatch } from "./agent-control.js";
import type { InlineTrigger } from "./chat-inline-commands.js";
import type { IconName } from "./icons.js";
import {
  DISCLOSURE_CHOICES,
  ITERATION_PRESETS,
  disclosureChoice,
  disclosureLabel,
  disclosurePatch,
  effectiveIterations,
  parseIterations,
  presetPatch,
  terminalLabel,
  terminalPatch,
  toggleMcpServerPatch,
  toggleToolPatch,
  toggleToolsetPatch,
  toolsetChoice,
  toolsOn,
  toolsetSummary,
  unlistedTools,
  type TerminalChoice,
} from "./chat-quickbar.js";
import type { QuickbarCatalog } from "./chat-quickbar-data.js";
import { addDocumentPatch, removeDocumentPatch, toggleSkillPatch, type DiscoveredSkill } from "./chat-config-patch.js";
import { skillDetail } from "./chat-skills.js";
import { parseMcpQuickAdd } from "./mcp-quick-add.js";
import { shellOffDetail, shellOffLabel } from "./shell-from-picks.js";
import { workspaceLabel, workspaceSourceLabel, workspaceSuggestions } from "./workspace-api.js";
import type { UiModelOption } from "./framework-models.js";
import {
  APPROVAL_MODE_LABEL,
  addRule,
  approvalPatch,
  approvalPolicyFrom,
  approvalSummary,
  approvalsOffPatch,
  askBeforeRiskyPatch,
  asksBeforeRiskyToolsFrom,
  autoGatedTools,
  gateableTools,
  hasApprovalGate,
  hasFullShell,
  normalizeRule,
  removeRule,
  ruleMatchesNothing,
  toggleGatedTool,
} from "./approval-policy.js";

type Patch = Record<string, unknown>;

/** Everything the second-level pickers read, plus the actions their rows run. */
export interface PickerContext {
  readonly slash: ParsedSlash | null;
  readonly command: ChatCommand | undefined;
  /** Session config; read again when a row runs (pass a getter). */
  readonly cfg: Patch;
  readonly provider: string;
  readonly model: string;
  readonly models: readonly UiModelOption[];
  readonly providers: readonly string[];
  /** Provider id to why it cannot be picked (no key, unreachable); see `chat-provider-pick.ts`. */
  readonly providerBlocks?: Readonly<Record<string, string>>;
  readonly thinkingChoice: "on" | "off" | "auto";
  /** true = the model has a thinking mode, false = it does not, null = not known. */
  readonly modelThinking: boolean | null;
  readonly strategy: string;
  readonly workspace: string;
  readonly shell: TerminalChoice;
  readonly toolNames: readonly string[];
  readonly catalog: QuickbarCatalog;
  readonly skills: readonly DiscoveredSkill[] | null;
  readonly pinned: readonly string[];
  /** Skills pinned for the next message only (`/skill`). */
  readonly queuedSkills?: readonly string[];
  /** Pin or unpin a skill for the next message only. */
  readonly toggleQueuedSkill?: (name: string) => void;
  readonly docs: readonly { source: string }[];
  /** Apply a single choice and close the menu. */
  readonly apply: (what: string, patch: Patch) => void | Promise<void>;
  readonly setProvider: (provider: string) => void | Promise<void>;
  /** Toggle a multi row in place (queued). */
  readonly toggle: (what: string, patch: () => Patch) => void | Promise<void>;
  readonly swapDraft: (next: string) => void;
  /** Close the menu and open the workspace folder browser. */
  readonly browseWorkspace: () => void;
  /** `/mcp add <line>`: save the server, discover its tools and turn it on for this chat. */
  readonly addMcp?: (line: string) => void | Promise<void>;
  readonly info: (title: string, detail?: string) => void;
}

/** One menu row. */
export const configRow = (key: string, icon: IconName, label: string, run: () => void | Promise<void>, extra: Partial<MenuItem> = {}): MenuItem => ({ key, icon, label, run, ...extra });

/** Second-level choices for `/cmd <partial>`; empty unless a picker command has an argument. */
export function pickerItems(ctx: PickerContext): MenuItem[] {
  const { slash, command: slashCmd } = ctx;
  if (!slash?.hasArg || !slashCmd?.picker) return [];
  const q = slash.arg.toLowerCase();
  const has = (...parts: string[]) => q === "" || parts.some((p) => p.toLowerCase().includes(q));
  const multiRow = (key: string, icon: IconName, label: string, what: string, patch: () => Patch, extra: Partial<MenuItem> = {}): MenuItem =>
    configRow(key, icon, label, () => ctx.toggle(what, patch), { multi: true, ...extra });
  const { provider, model, models, catalog, strategy, workspace, shell, toolNames, pinned, docs } = ctx;
  const cfg = ctx.cfg;
  switch (slashCmd.picker) {
    // Provider and model in one list (`/provider` and `/model` both open it, the one you typed first). A provider row
    // switches in place and the model rows reload for it; a model row closes the menu.
    case "model": {
      const providerRows = ctx.providers.filter((p) => has(p)).map((p) => {
        const blocked = p === provider ? undefined : ctx.providerBlocks?.[p];
        const group = "Provider";
        return blocked
          ? configRow(`provider:${p}`, "cloud", p, () => {}, { group, disabled: blocked, hint: blocked })
          : configRow(`provider:${p}`, "cloud", p, () => ctx.setProvider(p), { group, active: p === provider, ...(p === provider ? { hint: "current" } : {}) });
      });
      const group = `Models for ${provider}`;
      const rows = models.filter((m) => has(m.value, m.label)).map((m) =>
        configRow(m.value, "model", m.label || m.value, () => ctx.apply(`Model ${m.value}`, { model: m.value }), { group, active: m.value === model, ...(m.thinking ? { badge: "think", hint: "thinking model" } : {}), ...(m.label !== m.value ? { detail: m.value } : {}) }),
      );
      const typed = slash.arg.trim();
      if (typed && !models.some((m) => m.value === typed)) {
        rows.push(configRow(`use:${typed}`, "edit", `Use "${typed}"`, () => ctx.apply(`Model ${typed}`, { model: typed }), { group, detail: "custom model id" }));
      }
      // The command you opened leads: /provider lists providers first, /model lists models first.
      return slashCmd.name === "provider" ? [...providerRows, ...rows] : [...rows, ...providerRows];
    }
    case "thinking": {
      const note = ctx.modelThinking === false ? "This model has no thinking mode" : ctx.modelThinking === null ? "Support not known for this model" : "";
      return ([["auto", "Auto", "The model's own default"], ["on", "On", "Reason before answering (slower, more tokens)"], ["off", "Off", "Answer directly"]] as const)
        .filter(([v, label]) => has(v, label))
        .map(([v, label, detail]) =>
          configRow(v, "think", label, () => ctx.apply(`Thinking ${v}`, { thinking: v === "auto" ? null : v === "on" }), {
            active: v === ctx.thinkingChoice,
            detail: v === "auto" && note ? `${detail} · ${note}` : detail,
          }),
        );
    }
    case "strategy":
      return catalog.strategies.filter((s) => has(s.value, s.label)).map((s) =>
        configRow(s.value, "strategy", s.label, () => ctx.apply(`Strategy ${s.label}`, { strategy: s.value }), { active: s.value === strategy, detail: s.description }),
      );
    case "terminal":
      return (["off", "host", "docker"] as const satisfies readonly TerminalChoice[])
        .map((c) => [c, c === "off" ? shellOffLabel(toolNames, catalog.shellPresets) : terminalLabel[c]] as const)
        .filter(([c, label]) => has(c, label))
        .map(([c, label]) =>
          configRow(c, "shell", label, () => ctx.apply(label, terminalPatch(ctx.cfg, c)), {
            active: c === shell,
            detail: c === "host" ? "Allowlisted commands on this computer" : c === "docker" ? "Throwaway container, no host files" : shellOffDetail(toolNames, catalog.shellPresets),
          }),
        );
    case "iterations": {
      const current = effectiveIterations(cfg);
      const typed = parseIterations(slash.arg);
      const rows = ITERATION_PRESETS.filter((n) => has(String(n))).map((n) =>
        configRow(String(n), "steps", `${n} steps`, () => ctx.apply(`Up to ${n} steps per turn`, { maxIterations: n }), { active: n === current }),
      );
      if (typed !== undefined && !(ITERATION_PRESETS as readonly number[]).includes(typed)) {
        rows.unshift(configRow(`n:${typed}`, "edit", `${typed} steps`, () => ctx.apply(`Up to ${typed} steps per turn`, { maxIterations: typed }), { active: typed === current }));
      }
      return rows;
    }
    case "workspace": {
      const typed = slash.arg.trim();
      const rows: MenuItem[] = [];
      if (typed.startsWith("/") && typed !== workspace) {
        rows.push(configRow(`use:${typed}`, "folder", `Use ${typed}`, () => ctx.apply(`Workspace ${typed}`, { workspace: typed }), { detail: "checked by the server" }));
      }
      for (const s of workspaceSuggestions(workspace, catalog.workspaces).filter((s) => has(s.path))) {
        rows.push(configRow(s.path, "folder", workspaceLabel(s.path), () => ctx.apply(`Workspace ${s.path}`, { workspace: s.path }), {
          active: s.current,
          ...(s.source ? { hint: workspaceSourceLabel[s.source] } : {}),
          detail: s.path,
        }));
      }
      if (q === "" || "browse".startsWith(q)) {
        rows.push(configRow("browse", "search", "Browse folders…", () => ctx.browseWorkspace(), { detail: "pick any directory on this computer" }));
      }
      if (workspace !== "" && (q === "" || "none".startsWith(q) || "clear".startsWith(q))) {
        rows.push(configRow("clear", "x", "No workspace", () => ctx.apply("Workspace cleared", { workspace: "" }), { detail: "file tools use the server directory; the shell gets a /tmp sandbox" }));
      }
      return rows;
    }
    case "tools": {
      const on = toolsOn(cfg);
      // The on/off row leads only when it matches what was typed, so `/tools research` + Enter picks the toolset.
      const rows: MenuItem[] = has("on", "off", "tools")
        ? [multiRow("power", "power", on ? "Turn tools off" : "Turn tools on", "Tools on/off", () => ({ enableTools: !toolsOn(ctx.cfg) }), { active: on, detail: on ? "chat without tools; the selection is kept" : toolsetSummary({ ...cfg, enableTools: true }) })]
        : [];
      for (const [alias, members] of Object.entries(catalog.toolsets)) {
        if (!has(alias, ...members, ...(catalog.shellPresets[alias] ?? []))) continue;
        const choice = toolsetChoice(alias, members, catalog.shellPresets, toolNames);
        rows.push(multiRow(`set:${alias}`, "tool", `${alias} toolset`, `${alias} toolset`, () => toggleToolsetPatch(ctx.cfg, choice.tokens), { active: choice.active, detail: choice.detail }));
      }
      for (const t of catalog.builtinTools.filter((t) => has(t.name, t.label))) {
        rows.push(multiRow(`tool:${t.name}`, "tool", t.name, t.name, () => toggleToolPatch(ctx.cfg, t.name), { active: toolNames.includes(t.name), hint: "tool" }));
      }
      // Selected names with no row above (an old config's `calculator`): listed so they can be unticked.
      const offTools = new Set((catalog.disabledMcpServers ?? []).flatMap((s) => s.tools));
      for (const name of unlistedTools(cfg, catalog).filter((n) => has(n))) {
        rows.push(
          offTools.has(name)
            ? multiRow(`tool:${name}`, "tool", name, name, () => toggleToolPatch(ctx.cfg, name), { active: true, hint: "server disabled", detail: "Selected in this chat but its MCP server is switched off, so an agent skips it; untick to remove it or enable the server in Lab > Tools" })
            : multiRow(`tool:${name}`, "tool", name, name, () => toggleToolPatch(ctx.cfg, name), { active: true, hint: "not in the catalog", detail: "Selected in this chat but not a tool Cortex lists; untick to remove it" }),
        );
      }
      const mcpIds = Array.isArray(cfg.mcpServerIds) ? (cfg.mcpServerIds as string[]) : [];
      for (const s of catalog.mcpServers.filter((s) => has(s.name, s.serverId))) {
        rows.push(multiRow(`mcp:${s.serverId}`, "server", s.name, s.name, () => toggleMcpServerPatch(ctx.cfg, s.serverId, s.tools), { active: mcpIds.includes(s.serverId), hint: "MCP", detail: `${s.tools.length} tools` }));
      }
      for (const p of catalog.presets.filter((p) => has(p.name))) {
        rows.push(configRow(`preset:${p.name}`, "agents", `Use ${p.name}'s tools`, () => ctx.apply(`Tools from ${p.name}`, presetPatch(p.config)), { hint: "saved agent", detail: toolsetSummary({ ...p.config, enableTools: true }) }));
      }
      const shown = disclosureChoice(cfg);
      for (const c of [...DISCLOSURE_CHOICES, undefined]) {
        if (!has("disclosure", "show", c ?? "default")) continue;
        rows.push(configRow(`disclosure:${c ?? "default"}`, "eye", `Show tools: ${c ?? "tier default"}`, () => ctx.apply(`Tool disclosure: ${c ?? "tier default"}`, disclosurePatch(ctx.cfg, c)), { active: shown === c, hint: "disclosure", detail: c ? disclosureLabel[c] : "the framework picks by model tier" }));
      }
      return rows;
    }
    case "agent": {
      const on = agentControlEnabled(cfg);
      const base = ([[true, "On", "The agent proposes changes to this chat; you approve each one", "Agent may propose changes (you approve each)"], [false, "Off", "The agent cannot change this chat (default)", "Agent control off"]] as const)
        .filter(([, label]) => has(label))
        .map(([want, label, detail, what]) => configRow(want ? "on" : "off", "agents", label, () => ctx.apply(what, { agentControl: want }), { active: want === on, detail }));
      if (!on) return base;
      // "Let the agent change ..." switches: each group is off until ticked; tightening may auto-apply per group.
      const groups = enabledControlGroups(cfg);
      const autos = autoApplyControlGroups(cfg);
      const extra: MenuItem[] = [];
      for (const g of AGENT_CONTROL_GROUPS) {
        if (has(g.label, "let the agent change", g.id)) {
          extra.push(multiRow(`group:${g.id}`, "agents", `Let the agent change: ${g.label}`, `${g.label} proposals`, () => toggleControlGroupPatch(ctx.cfg, g.id), { active: groups.includes(g.id), detail: g.detail }));
        }
        if (g.canAutoApply && groups.includes(g.id) && has(g.label, "automatically", "auto", g.id)) {
          extra.push(multiRow(`auto:${g.id}`, "agents", `Apply stricter ${g.label.toLowerCase()} changes automatically`, `Auto-apply stricter ${g.label.toLowerCase()}`, () => toggleAutoApplyPatch(ctx.cfg, g.id), { active: autos.includes(g.id), detail: "Only changes that reduce what the agent can do; anything looser still needs your Apply" }));
        }
      }
      return [...base, ...extra];
    }
    case "durable": {
      const on = durableRunsOn(cfg);
      return ([[true, "On", "Durable runs on"], [false, "Off", "Durable runs off"]] as const)
        .filter(([, label]) => has(label))
        .map(([want, label, what]) =>
          configRow(want ? "on" : "off", "retry", label, () => ctx.apply(what, durableRunsPatch(ctx.cfg, want)), { active: want === on, detail: want ? DURABLE_RUNS_CHAT_DETAIL : DURABLE_RUNS_CHAT_OFF_DETAIL }),
        );
    }
    case "approvals":
      return approvalRows(ctx, q, multiRow);
    case "mcp":
      return mcpRows(ctx, q, multiRow);
    case "skill":
      return (ctx.skills ?? []).filter((s) => has(s.name, s.description)).map((s) =>
        multiRow(s.name, "bolt", s.name, `Pin ${s.name}`, () => toggleSkillPatch(ctx.cfg, s), {
          active: pinned.includes(s.name),
          hint: pinned.includes(s.name) ? "every turn" : "",
          detail: skillDetail(s),
        }),
      );
    case "skill-once": {
      // `/skill <name>`: the skill is pinned for the next message only (sent with it, never saved).
      const queued = ctx.queuedSkills ?? [];
      const rows = (ctx.skills ?? []).filter((s) => has(s.name, s.description)).map((s) =>
        configRow(`once:${s.name}`, "bolt", s.name, () => ctx.toggleQueuedSkill?.(s.name), {
          active: queued.includes(s.name) || pinned.includes(s.name),
          hint: queued.includes(s.name) ? "next message" : pinned.includes(s.name) ? "every turn" : "",
          detail: skillDetail(s),
        }),
      );
      if (rows.length === 0 && ctx.skills !== null) {
        return [configRow("none", "info", "No skills in this workspace", () => ctx.info("No skills found", "Add <workspace>/.agents/skills/<name>/SKILL.md"), { detail: "the agent finds .agents/skills and .claude/skills in its workspace" })];
      }
      return rows;
    }
    case "doc": {
      if (q.startsWith("add ")) {
        const source = slash.arg.slice(4).trim();
        const patch = addDocumentPatch(cfg, source);
        return source === ""
          ? []
          : [configRow(`add:${source}`, "plus", `Add ${source}`, () => (patch ? ctx.apply(`Added ${source}`, patch) : void ctx.info("Already added", source)), { detail: "path or URL the agent can search" })];
      }
      const rows = docs.filter((d) => has(d.source)).map((d) =>
        multiRow(d.source, "book", d.source, `Remove ${d.source}`, () => removeDocumentPatch(ctx.cfg, d.source), { active: true, hint: "select to remove" }),
      );
      if (q === "" || "add".startsWith(q)) {
        rows.push(configRow("add", "plus", "add <path or URL>", () => ctx.swapDraft("/docs add "), { detail: docs.length === 0 ? "No documents yet" : "Add another", complete: () => ctx.swapDraft("/docs add ") }));
      }
      return rows;
    }
  }
}

/**
 * `/mcp` rows: each saved MCP server (select to turn it on or off for this chat, the
 * `/tools` toggle), then `add <command or URL>`. Typing `add <line>` offers the row that
 * saves it, discovers its tools and turns it on (`ctx.addMcp`, `mcp-quick-add.ts`).
 */
function mcpRows(
  ctx: PickerContext,
  q: string,
  multiRow: (key: string, icon: IconName, label: string, what: string, patch: () => Patch, extra?: Partial<MenuItem>) => MenuItem,
): MenuItem[] {
  if (q.startsWith("add ")) {
    const line = (ctx.slash?.arg ?? "").slice(4).trim();
    if (line === "") return [];
    const parsed = parseMcpQuickAdd(line);
    if (!parsed.ok) return [configRow("add:error", "alert", "Not a command or URL", () => ctx.info("Cannot add this server", parsed.error), { detail: parsed.error })];
    const { body } = parsed;
    return [configRow(`add:${line}`, "plus", `Add ${body.name}`, () => ctx.addMcp?.(line), { detail: "endpoint" in body ? body.endpoint : [body.command, ...(body.args ?? [])].join(" ") })];
  }
  const has = (...parts: string[]) => q === "" || parts.some((p) => p.toLowerCase().includes(q));
  const ids = Array.isArray(ctx.cfg.mcpServerIds) ? (ctx.cfg.mcpServerIds as string[]) : [];
  const rows = ctx.catalog.mcpServers.filter((s) => has(s.name, s.serverId)).map((s) =>
    multiRow(`mcp:${s.serverId}`, "server", s.name, s.name, () => toggleMcpServerPatch(ctx.cfg, s.serverId, s.tools), { active: ids.includes(s.serverId), hint: ids.includes(s.serverId) ? "on for this chat" : "off", detail: `${s.tools.length} tool${s.tools.length === 1 ? "" : "s"}` }),
  );
  if (q === "" || "add".startsWith(q)) {
    rows.push(configRow("add", "plus", "add <command or URL>", () => ctx.swapDraft("/mcp add "), { detail: ctx.catalog.mcpServers.length === 0 ? "No servers yet, e.g. npx -y @scope/server or https://host/mcp" : "Save another server", complete: () => ctx.swapDraft("/mcp add ") }));
  }
  return rows;
}

/**
 * `/approvals` rows: the mode, the tools (auto-gated ones locked on), the command
 * rules (select to remove), `add <command>`, and off. Every row PATCHes the
 * session's top-level `approvalPolicy` (`approvalPatch`).
 */
function approvalRows(
  ctx: PickerContext,
  q: string,
  multiRow: (key: string, icon: IconName, label: string, what: string, patch: () => Patch, extra?: Partial<MenuItem>) => MenuItem,
): MenuItem[] {
  const has = (...parts: string[]) => q === "" || parts.some((p) => p.toLowerCase().includes(q));
  const policy = approvalPolicyFrom(ctx.cfg);
  const asks = asksBeforeRiskyToolsFrom(ctx.cfg);
  if (q.startsWith("add ")) {
    const rule = normalizeRule(ctx.slash?.arg.slice(4) ?? "");
    if (rule === "") return [];
    if (ruleMatchesNothing(rule)) return [configRow("add:none", "alert", `"${rule}" matches nothing`, () => ctx.info("A rule needs at least one word", "A bare * matches nothing"), { detail: "type a command, e.g. git push" })];
    return [configRow(`add:${rule}`, "plus", `Ask before ${rule}`, () => ctx.apply(`Approval needed for ${rule}`, approvalPatch(ctx.cfg, (p) => ({ ...p, commands: addRule(p.commands, rule) }))), {
      detail: `matches commands that start with these words, e.g. ${rule} …`,
    })];
  }
  const rows: MenuItem[] = [];
  for (const m of ["detach", "block"] as const) {
    if (!has("mode", m, APPROVAL_MODE_LABEL[m].label)) continue;
    rows.push(configRow(`mode:${m}`, m === "detach" ? "pause" : "ban", APPROVAL_MODE_LABEL[m].label, () => ctx.apply(`When approval is needed: ${APPROVAL_MODE_LABEL[m].label.toLowerCase()}`, approvalPatch(ctx.cfg, (p) => ({ ...p, mode: m }))), {
      active: policy.mode === m, hint: "mode", detail: APPROVAL_MODE_LABEL[m].detail,
    }));
  }
  const terminal = ctx.cfg.terminalTools === true;
  const locked = autoGatedTools(policy, ctx.toolNames, hasFullShell(ctx.toolNames, terminal), ctx.catalog.approvalRequired, asks);
  for (const t of gateableTools(ctx.toolNames, terminal, ctx.catalog.shellPresets).filter((t) => has(t))) {
    if (locked.includes(t)) {
      rows.push(configRow(`tool:${t}`, "tool", t, () => ctx.info(`${t} always asks`, "The framework marks it as needing approval once any approval is set"), { active: true, hint: "always asks", multi: true }));
      continue;
    }
    rows.push(multiRow(`tool:${t}`, "tool", t, `Approval for ${t}`, () => approvalPatch(ctx.cfg, (p) => ({ ...p, tools: toggleGatedTool(p.tools, t) })), {
      active: policy.tools.includes(t), hint: "tool", ...(t === "shell-execute" ? { detail: "asks before every shell command" } : {}),
    }));
  }
  for (const rule of policy.commands.filter((c) => has(c))) {
    rows.push(multiRow(`rule:${rule}`, "shell", rule, `Remove rule ${rule}`, () => approvalPatch(ctx.cfg, (p) => ({ ...p, commands: removeRule(p.commands, rule) })), { active: true, hint: "select to remove" }));
  }
  if (q === "" || "add".startsWith(q)) {
    rows.push(configRow("add", "plus", "add <command>", () => ctx.swapDraft("/approvals add "), { detail: "e.g. git push: ask before any command that starts with it", complete: () => ctx.swapDraft("/approvals add ") }));
  }
  if ((hasApprovalGate(policy) || asks) && (q === "" || "off".startsWith(q) || "clear".startsWith(q))) {
    rows.push(configRow("off", "x", "Turn approvals off", () => ctx.apply("Approvals off", approvalsOffPatch(ctx.cfg)), { detail: approvalSummary(policy, asks) }));
  }
  if (!asks && (q === "" || "on".startsWith(q) || "ask".startsWith(q) || "risky".startsWith(q))) {
    rows.push(configRow("on", "pause", "Ask before risky tools", () => ctx.apply("Asking before risky tools", askBeforeRiskyPatch(true)), { detail: "file-write, code-execute and the shell wait for you" }));
  }
  return rows;
}

/** Inputs for the plain `/` menu: matching commands, then skills to queue for the next message. */
export interface CommandMenuContext {
  readonly slash: ParsedSlash | null;
  readonly skills: readonly DiscoveredSkill[] | null;
  readonly queuedSkills: readonly string[];
  readonly pinned: readonly string[];
  /** Current state per setting command (`settingEntries`): shown as the entry's hint. */
  readonly settings?: ReadonlyMap<string, EntryState>;
  /** A run is going: only config commands are listed. */
  readonly sending?: boolean;
  readonly runCommand: (cmd: ChatCommand) => void | Promise<void>;
  readonly completeCommand: (cmd: ChatCommand) => void;
  readonly toggleQueuedSkill: (name: string) => void;
}

/** Skill rows of the plain `/` menu (queue a skill for the next message only). */
export function skillMenuItems(ctx: CommandMenuContext): MenuItem[] {
  const { slash } = ctx;
  if (!slash || slash.hasArg) return [];
  const q = slash.query;
  return (ctx.skills ?? [])
    .filter((sk) => q === "" || sk.name.toLowerCase().includes(q) || sk.description.toLowerCase().includes(q))
    .map((sk): MenuItem => ({
      key: `skill:${sk.name}`,
      icon: "bolt",
      label: sk.name,
      hint: ctx.queuedSkills.includes(sk.name) ? "next message" : ctx.pinned.includes(sk.name) ? "every turn" : "skill",
      detail: skillDetail(sk),
      active: ctx.queuedSkills.includes(sk.name) || ctx.pinned.includes(sk.name),
      run: () => ctx.toggleQueuedSkill(sk.name),
      complete: () => ctx.toggleQueuedSkill(sk.name),
    }));
}

/** Inputs for the inline menu: a `/partial` typed mid-message (`chat-inline-commands.ts`). */
export interface InlineMenuContext {
  readonly trigger: InlineTrigger | null;
  readonly skills: readonly DiscoveredSkill[] | null;
  /** Skills pinned for every turn (shown as active). */
  readonly pinned: readonly string[];
  /** Replace the partial with the skill's token. */
  readonly pick: (name: string) => void;
}

/**
 * Inline menu: skills matching the partial at the caret, names that start with it
 * first. Mid-message only skills are offered: they are the commands that act on the
 * message they sit in.
 */
export function inlineMenuItems(ctx: InlineMenuContext): MenuItem[] {
  if (ctx.trigger === null) return [];
  const q = ctx.trigger.query;
  const matches = (ctx.skills ?? []).filter((sk) => q === "" || sk.name.toLowerCase().includes(q) || sk.description.toLowerCase().includes(q));
  const ranked = [...matches.filter((sk) => sk.name.toLowerCase().startsWith(q)), ...matches.filter((sk) => !sk.name.toLowerCase().startsWith(q))];
  return ranked.map((sk): MenuItem => ({
    key: `inline:${sk.name}`,
    icon: "bolt",
    label: `/${sk.name}`,
    hint: ctx.pinned.includes(sk.name) ? "every turn" : "skill for this message",
    detail: skillDetail(sk),
    active: ctx.pinned.includes(sk.name),
    run: () => ctx.pick(sk.name),
    complete: () => ctx.pick(sk.name),
  }));
}

/** The plain `/` menu: commands matching the query, then skill rows. */
export function commandMenuItems(ctx: CommandMenuContext): MenuItem[] {
  const { slash } = ctx;
  const settings = ctx.settings ?? new Map<string, EntryState>();
  // During a run only the config commands apply (history commands wait for it to end).
  const allowed = (cmd: ChatCommand) => !ctx.sending || isLiveConfigCommand(cmd.name);
  return slash && !slash.hasArg
    ? [...matchEntries(slash.query, settings).filter(allowed).map((cmd): MenuItem => ({
        key: cmd.name,
        icon: cmd.icon,
        label: `/${cmd.name}`,
        // A setting shows its current value (the Config row); other commands show the argument they take.
        ...(settings.has(cmd.name) ? { hint: settings.get(cmd.name)!.value, active: settings.get(cmd.name)!.on } : cmd.arg ? { hint: cmd.arg } : {}),
        detail: cmd.summary,
        run: () => ctx.runCommand(cmd),
        complete: () => ctx.completeCommand(cmd),
      })), ...(ctx.sending ? [] : skillMenuItems(ctx))]
    : [];
}
