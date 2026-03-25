import { readFile } from "fs/promises";

export type HarnessSkillConfig =
  | boolean
  | string
  | { frontier?: boolean | string; local?: boolean | string };

/** Resolve harness skill config to the final string content to inject. */
export async function resolveHarnessSkill(
  config: HarnessSkillConfig | undefined,
  modelTier: "frontier" | "local",
): Promise<string | null> {
  if (config === false) return null;
  if (config === undefined || config === true) {
    return loadSeedAsset(modelTier);
  }

  if (typeof config === "object") {
    const tierConfig = modelTier === "frontier" ? config.frontier : config.local;
    if (tierConfig === false) return null;
    if (tierConfig === undefined || tierConfig === true) return loadSeedAsset(modelTier);
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

async function loadSeedAsset(modelTier: "frontier" | "local"): Promise<string | null> {
  const filename =
    modelTier === "frontier" ? "harness.skill.md" : "harness.skill.condensed.md";
  try {
    const assetUrl = new URL(`../assets/${filename}`, import.meta.url);
    return await readFile(assetUrl, "utf8");
  } catch {
    return null;
  }
}
