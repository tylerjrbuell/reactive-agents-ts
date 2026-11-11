/**
 * The chat quick bar's chip row (beside the composer): one chip per commonly changed
 * setting, each opening its slash picker. Pure, so ChatQuickBar and tests share it.
 */
import { agentControlEnabled } from "./proposal-view.js";
import { effectiveIterations, selectedTools, terminalChoice, terminalLabel, toolsetSummary } from "./chat-quickbar.js";
import { workspaceLabel } from "./workspace-api.js";
import { shellOffLabel, shellPickReason, shellState, type ShellPresets } from "./shell-from-picks.js";
import type { IconName } from "./icons.js";

/** One quick-bar chip; clicking it puts `cmd` in the composer. `on` marks a setting that is switched on (a workspace set, tools picked). */
export type QuickBarChip = { text: string; icon: IconName; cmd: string; title?: string; on?: boolean };

/** Values the panel already derives that the chips display. */
export type QuickBarChipContext = {
  provider: string;
  model: string;
  /** `false` when the selected model has no thinking mode; `null` when unknown. */
  modelThinking: boolean | null;
  thinkingChoice: "on" | "off" | "auto";
  strategyLabel: string;
  pinnedSkillCount: number;
  documentCount: number;
  /** Shell toolsets → programs (`GET /api/tools/shell-presets`); a picked one brings `shell-execute`. */
  shellPresets?: ShellPresets;
};

/** Shell chip, same three states as the builder checkbox: off, toolset-only (`Shell: git · gh only`), or the full shell's choice. */
function shellChip(cfg: Record<string, unknown>, presets: ShellPresets): QuickBarChip {
  const choice = terminalChoice(cfg);
  const tools = selectedTools(cfg);
  if (shellState(choice !== "off", tools, presets) !== "toolset") {
    return { text: terminalLabel[choice], icon: "shell", cmd: "/terminal ", title: "Shell: off, this machine, or Docker sandbox", on: choice !== "off" };
  }
  return {
    text: shellOffLabel(tools, presets),
    icon: "shell",
    on: true,
    cmd: "/terminal ",
    title: `shell-execute ${shellPickReason(tools, presets) ?? ""}; /terminal turns on the full shell`,
  };
}

/** Chips for a session config, in display order. No provider ⇒ only the skill / agent / doc chips. */
export function quickBarChips(cfg: Record<string, unknown>, ctx: QuickBarChipContext): QuickBarChip[] {
  const { provider, model } = ctx;
  const toolNames = selectedTools(cfg);
  const workspace = typeof cfg.workspace === "string" ? cfg.workspace : "";
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [
    ...(provider
      ? [
          { text: provider, icon: "cloud", cmd: "/provider ", title: "Change provider" },
          { text: model || "default model", icon: "model", cmd: "/model ", title: "Change model" },
        ] satisfies QuickBarChip[]
      : []),
    ...(provider && model
      ? [{ text: ctx.modelThinking === false ? "No thinking mode" : `Thinking ${ctx.thinkingChoice}`, icon: "think", cmd: "/thinking " } satisfies QuickBarChip]
      : []),
    ...(provider
      ? [
          { text: ctx.strategyLabel, icon: "strategy", cmd: "/strategy ", title: "Change the reasoning strategy" },
          { text: toolsetSummary(cfg), icon: "tool", cmd: "/tools ", title: toolNames.length > 0 ? `Tools: ${toolNames.join(", ")}` : "Choose tools", on: toolNames.length > 0 },
          shellChip(cfg, ctx.shellPresets ?? {}),
          {
            text: workspace ? workspaceLabel(workspace) : "No workspace",
            icon: "folder",
            cmd: "/workspace ",
            title: workspace || "Set the directory file tools and the shell work in",
            on: workspace !== "",
          },
          { text: `${effectiveIterations(cfg)} steps`, icon: "steps", cmd: "/iterations ", title: "Most steps one turn may take" },
        ] satisfies QuickBarChip[]
      : []),
    ...(ctx.pinnedSkillCount > 0 ? [{ text: `${plural(ctx.pinnedSkillCount, "skill")} pinned`, icon: "bolt", cmd: "/skills ", on: true } satisfies QuickBarChip] : []),
    ...(agentControlEnabled(cfg)
      ? [{ text: "Agent control", icon: "agents", cmd: "/agent ", title: "The agent may propose changes to this chat; nothing applies until you click Apply", on: true } satisfies QuickBarChip]
      : []),
    ...(ctx.documentCount > 0 ? [{ text: plural(ctx.documentCount, "document"), icon: "book", cmd: "/docs ", on: true } satisfies QuickBarChip] : []),
  ];
}
