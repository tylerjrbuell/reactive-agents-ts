/**
 * The decluttered chat composer bar: a short row of chips for what was changed from the
 * defaults, plus one Config popover that groups every setting. Pure, so ChatQuickBar and
 * tests share the rules. The chips come from `quickBarChips` (`chat-quickbar-chips.ts`);
 * each row opens the same slash picker its chip always did.
 */
import type { QuickBarChip, QuickBarChipContext } from "./chat-quickbar-chips.js";
import { CHAT_DEFAULT_MAX_ITERATIONS, disclosureChoice, disclosureLabel, effectiveIterations, selectedTools } from "./chat-quickbar.js";
import { approvalPolicyFrom, approvalSummary } from "./approval-policy.js";
import type { IconName } from "./icons.js";

type Cfg = Record<string, unknown>;

/** Strategy a chat turn runs when the session stores none (server `buildChatAgentParams`). */
export const CHAT_DEFAULT_STRATEGY = "reactive";

/** Most chips the bar shows beside the Config button; the rest wait in the popover. */
export const MAX_BAR_CHIPS = 4;

/** Whether a chip belongs on the bar: the model always, then only settings that differ from the defaults. */
export function chipOnBar(chip: QuickBarChip, cfg: Cfg, ctx: Pick<QuickBarChipContext, "thinkingChoice" | "modelThinking">): boolean {
  switch (chip.cmd) {
    case "/model ":
      return true;
    case "/provider ":
    case "/skill ":
      return false;
    case "/thinking ":
      return ctx.thinkingChoice !== "auto" && ctx.modelThinking !== false;
    case "/strategy ":
      return (typeof cfg.strategy === "string" && cfg.strategy !== "" ? cfg.strategy : CHAT_DEFAULT_STRATEGY) !== CHAT_DEFAULT_STRATEGY;
    case "/iterations ":
      return effectiveIterations(cfg) !== CHAT_DEFAULT_MAX_ITERATIONS;
    default:
      return chip.on === true;
  }
}

/** The bar: chips to show (capped) and how many more changed settings the Config button holds. */
export function composerBar(
  chips: readonly QuickBarChip[],
  cfg: Cfg,
  ctx: Pick<QuickBarChipContext, "thinkingChoice" | "modelThinking">,
  max: number = MAX_BAR_CHIPS,
): { readonly shown: readonly QuickBarChip[]; readonly hidden: number } {
  const wanted = chips.filter((c) => chipOnBar(c, cfg, ctx));
  return { shown: wanted.slice(0, max), hidden: Math.max(0, wanted.length - max) };
}

/** `Disclosure: index (3 tools): a name index; schemas load on use`, with the plain default spelled out. */
export function disclosureSummary(cfg: Cfg): { readonly text: string; readonly explain: string } {
  const mode = disclosureChoice({ rawConfig: cfg.rawConfig });
  const n = selectedTools(cfg).length;
  const tools = n > 0 ? ` (${n} tool${n === 1 ? "" : "s"} picked)` : "";
  const explain =
    "Disclosure is how the permitted tools are shown to the model. It never changes which tools are permitted. " +
    "all: every tool's full schema. index: a list of names, schemas load when a tool is used. discover: only through discover-tools. " +
    "Tier default lets the framework choose by model size.";
  return mode === undefined
    ? { text: `Disclosure: tier default${tools}`, explain }
    : { text: `Disclosure: ${mode}${tools}, ${disclosureLabel[mode]}`, explain };
}

/** One row of the Config popover: the setting, its value now, and the slash picker it opens. */
export interface ConfigRow {
  readonly label: string;
  readonly value: string;
  readonly cmd: string;
  readonly icon: IconName;
  /** The setting differs from the default (drawn as on). */
  readonly on: boolean;
}

/** A popover section. */
export interface ConfigGroup {
  readonly title: string;
  readonly rows: readonly ConfigRow[];
}

/** Chips by command, so a row reads the same text the chip shows. */
const byCmd = (chips: readonly QuickBarChip[], cmd: string): QuickBarChip | undefined => chips.find((c) => c.cmd === cmd);

/**
 * The Config popover's content: Model, Reasoning, Tools, Workspace, Limits. A row
 * exists even when its chip does not (no documents yet, no MCP server), so every
 * setting is one click away. Empty when no provider is chosen (nothing to configure).
 */
export function configGroups(chips: readonly QuickBarChip[], cfg: Cfg, ctx: Pick<QuickBarChipContext, "thinkingChoice" | "modelThinking" | "provider">): ConfigGroup[] {
  if (ctx.provider === "") return [];
  const row = (label: string, cmd: string, icon: IconName, fallback: string, on: (c: QuickBarChip | undefined) => boolean = (c) => c?.on === true): ConfigRow => {
    const c = byCmd(chips, cmd);
    return { label, value: c?.text ?? fallback, cmd, icon, on: on(c) };
  };
  const mcp = Array.isArray(cfg.mcpServerIds) ? cfg.mcpServerIds.length : 0;
  const policy = approvalPolicyFrom(cfg);
  const disclosure = disclosureSummary(cfg);
  const onBar = (c: QuickBarChip | undefined) => (c ? chipOnBar(c, cfg, ctx) : false);
  return [
    {
      title: "Model",
      rows: [
        row("Provider", "/provider ", "cloud", ctx.provider, () => false),
        row("Model", "/model ", "model", "default model", () => false),
        row("Thinking", "/thinking ", "think", "Thinking auto", onBar),
      ],
    },
    {
      title: "Reasoning",
      rows: [
        row("Strategy", "/strategy ", "strategy", CHAT_DEFAULT_STRATEGY, onBar),
        row("Skills", "/skills ", "bolt", "None pinned", (c) => c?.on === true),
        row("Agent control", "/agent ", "agents", "Off"),
      ],
    },
    {
      title: "Tools",
      rows: [
        row("Tools", "/tools ", "tool", "No tools"),
        row("Shell", "/terminal ", "shell", "Shell off"),
        { label: "MCP servers", value: mcp > 0 ? `${mcp} on` : "None on", cmd: "/mcp ", icon: "server", on: mcp > 0 },
        { label: "Tool disclosure", value: disclosure.text.replace(/^Disclosure: /, ""), cmd: "/tools disclosure", icon: "eye", on: disclosureChoice({ rawConfig: cfg.rawConfig }) !== undefined },
        { label: "Approvals", value: approvalSummary(policy), cmd: "/approvals ", icon: "pause", on: approvalSummary(policy) !== "off" },
      ],
    },
    {
      title: "Workspace",
      rows: [row("Directory", "/workspace ", "folder", "No workspace"), row("Documents", "/docs ", "book", "None")],
    },
    { title: "Limits", rows: [row("Steps per turn", "/iterations ", "steps", `${CHAT_DEFAULT_MAX_ITERATIONS} steps`, onBar)] },
  ];
}
