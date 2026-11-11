/**
 * Rows of the chat slash menu, built from the session config and catalogs.
 *
 * Pure: every side effect (PATCH, toast, draft swap) arrives as a callback on the
 * context. `ctx.cfg` is read both when the rows are built and again when a row runs,
 * so the component passes it as a getter: a queued multi-row toggle must compute its
 * patch from the config the previous toggle left behind (chat-menu.ts createToggleQueue).
 */
import type { ChatCommand, ParsedSlash } from "./chat-commands.js";
import { matchCommands } from "./chat-commands.js";
import type { MenuItem } from "./chat-menu.js";
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
  type TerminalChoice,
} from "./chat-quickbar.js";
import type { QuickbarCatalog } from "./chat-quickbar-data.js";
import { addDocumentPatch, removeDocumentPatch, toggleSkillPatch, type DiscoveredSkill } from "./chat-config-patch.js";
import { shellOffDetail, shellOffLabel } from "./shell-from-picks.js";
import { workspaceLabel, workspaceSourceLabel, workspaceSuggestions } from "./workspace-api.js";
import type { UiModelOption } from "./framework-models.js";

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
  readonly docs: readonly { source: string }[];
  /** Apply a single choice and close the menu. */
  readonly apply: (what: string, patch: Patch) => void | Promise<void>;
  readonly setProvider: (provider: string) => void | Promise<void>;
  /** Toggle a multi row in place (queued). */
  readonly toggle: (what: string, patch: () => Patch) => void | Promise<void>;
  readonly swapDraft: (next: string) => void;
  /** Close the menu and open the workspace folder browser. */
  readonly browseWorkspace: () => void;
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
    case "provider":
      return ctx.providers.filter((p) => has(p)).map((p) =>
        configRow(p, "cloud", p, () => ctx.setProvider(p), { active: p === provider, ...(p === provider ? { hint: "current" } : {}) }),
      );
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
    case "model": {
      const rows = models.filter((m) => has(m.value, m.label)).map((m) =>
        configRow(m.value, "model", m.label || m.value, () => ctx.apply(`Model ${m.value}`, { model: m.value }), { active: m.value === model, ...(m.thinking ? { badge: "think", hint: "thinking model" } : {}), ...(m.label !== m.value ? { detail: m.value } : {}) }),
      );
      const typed = slash.arg.trim();
      if (typed && !models.some((m) => m.value === typed)) {
        rows.push(configRow(`use:${typed}`, "edit", `Use "${typed}"`, () => ctx.apply(`Model ${typed}`, { model: typed }), { detail: "custom model id" }));
      }
      return rows;
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
    case "skill":
      return (ctx.skills ?? []).filter((s) => has(s.name, s.description)).map((s) =>
        multiRow(s.name, "bolt", s.name, `Pin ${s.name}`, () => toggleSkillPatch(ctx.cfg, s), {
          active: pinned.includes(s.name),
          hint: pinned.includes(s.name) ? "pinned" : "",
          detail: s.description,
        }),
      );
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

/** Inputs for the plain `/` menu: matching commands, then skills to queue for the next message. */
export interface CommandMenuContext {
  readonly slash: ParsedSlash | null;
  readonly skills: readonly DiscoveredSkill[] | null;
  readonly queuedSkills: readonly string[];
  readonly pinned: readonly string[];
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
      hint: ctx.queuedSkills.includes(sk.name) ? "queued" : ctx.pinned.includes(sk.name) ? "pinned" : "skill",
      detail: sk.description,
      active: ctx.queuedSkills.includes(sk.name) || ctx.pinned.includes(sk.name),
      run: () => ctx.toggleQueuedSkill(sk.name),
      complete: () => ctx.toggleQueuedSkill(sk.name),
    }));
}

/** The plain `/` menu: commands matching the query, then skill rows. */
export function commandMenuItems(ctx: CommandMenuContext): MenuItem[] {
  const { slash } = ctx;
  return slash && !slash.hasArg
    ? [...matchCommands(slash.query).map((cmd): MenuItem => ({
        key: cmd.name,
        icon: cmd.icon,
        label: `/${cmd.name}`,
        ...(cmd.arg ? { hint: cmd.arg } : {}),
        detail: cmd.summary,
        run: () => ctx.runCommand(cmd),
        complete: () => ctx.completeCommand(cmd),
      })), ...skillMenuItems(ctx)]
    : [];
}
