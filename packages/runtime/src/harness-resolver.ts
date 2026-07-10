/**
 * Harness-skill resolution — the prompt text that teaches the model its
 * meta-tools.
 *
 * Until 2026-07-10 this loaded STATIC assets (harness.skill.md /
 * harness.skill.condensed.md) that unconditionally documented brief, find,
 * pulse, and recall. When the default meta-tool set became conditional
 * (brief/pulse opt-in; find only with documents), a static asset would teach
 * tools the model cannot call — the exact defect measured live the same week,
 * where a recovery hint naming an unexposed tool sent claude-haiku-4-5 into a
 * "Tool call used unavailable name(s)" retry loop until max_iterations.
 *
 * The skill is now GENERATED from the enabled set. A custom string / file-path
 * config still overrides wholesale (the caller owns consistency then).
 */

import { readFile } from "fs/promises";

export type HarnessSkillConfig =
  | boolean
  | string
  | { frontier?: boolean | string; local?: boolean | string };

/** Which meta-tools are actually registered for this run. */
export interface EnabledMetaTools {
  readonly brief?: boolean;
  readonly find?: boolean;
  readonly pulse?: boolean;
  readonly recall?: boolean;
  readonly todo?: boolean;
}

/** Resolve harness skill config to the final string content to inject. */
export async function resolveHarnessSkill(
  config: HarnessSkillConfig | undefined,
  modelTier: "frontier" | "local",
  enabled: EnabledMetaTools = {},
): Promise<string | null> {
  if (config === false) return null;
  if (config === undefined || config === true) {
    return buildHarnessSkill(modelTier, enabled);
  }

  if (typeof config === "object") {
    const tierConfig = modelTier === "frontier" ? config.frontier : config.local;
    if (tierConfig === false) return null;
    if (tierConfig === undefined || tierConfig === true) {
      return buildHarnessSkill(modelTier, enabled);
    }
    return resolveStringConfig(tierConfig);
  }

  return resolveStringConfig(config);
}

async function resolveStringConfig(value: string): Promise<string> {
  if (value.startsWith(".") || value.startsWith("/") || value.startsWith("~")) {
    try {
      return await readFile(value, "utf8");
    } catch {
      // treat as inline content
    }
  }
  return value;
}

/**
 * Emit skill text that documents ONLY the tools the model can call.
 * No enabled meta-tools → no skill text at all: an empty reference block is
 * prompt noise, not guidance.
 */
export function buildHarnessSkill(
  modelTier: "frontier" | "local",
  enabled: EnabledMetaTools,
): string | null {
  const lines: string[] = [];

  if (enabled.brief) {
    lines.push("- `brief()` — see all tools, documents, context budget, signal grade");
  }
  if (enabled.find) {
    lines.push(
      "- `find(query)` — search your indexed documents (falls back to web if nothing matches)",
    );
  }
  if (enabled.pulse) {
    lines.push('- `pulse()` — check progress; `pulse("am I ready?")` before calling final-answer');
  }
  if (enabled.recall) {
    lines.push(
      "- `recall(key, content)` to store notes · `recall(key)` to retrieve · `recall(query=...)` to search notes",
    );
  }
  if (enabled.todo) {
    lines.push("- `todo(...)` — maintain a working task list across steps");
  }

  if (lines.length === 0) return null;

  const header = "# Meta-Tools Quick Reference";
  if (modelTier === "local") {
    // Condensed form: local models get the reference only.
    return [header, ...lines].join("\n");
  }

  // Frontier form: reference + the usage patterns carried over from the old
  // static skill, each emitted only when its tool is present.
  const patterns: string[] = [];
  if (enabled.recall) {
    patterns.push("- Want to preserve a finding for later → `recall(key, content)` to store it.");
  }
  if (enabled.pulse) {
    patterns.push("- Same tool called 3+ times with no progress → `pulse()` to diagnose.");
  }
  if (enabled.brief) {
    patterns.push("- Complex new task → `brief()` first.");
  }
  if (enabled.find) {
    patterns.push("- Unsure which source to search → `find(query)` with default scope.");
  }

  return [header, ...lines, "", "## Key Patterns", ...patterns].join("\n");
}
