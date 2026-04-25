// packages/testing/src/gate/registry.ts
//
// Auto-discovery of ScenarioModules via filesystem glob. Spec §6.5.1:
// adding/removing a scenario must be a single-file drop-in, never a
// registry edit.
//
// The discovery happens once per process (lazy + cached) so repeated
// `bun run gate:check` invocations don't re-glob.

import { readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScenarioModule } from "./types.js";

const SCENARIOS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "scenarios",
);

let cached: readonly ScenarioModule[] | null = null;

/**
 * Discover and load every scenario module from the gate's scenarios
 * directory. Modules must:
 *   1. Live at `scenarios/<id>.ts`
 *   2. Export a `scenario: ScenarioModule` whose `id` matches the filename
 *
 * Filename / id mismatch surfaces as a thrown error at gate-load time so
 * health tracking can attribute regressions correctly across renames.
 */
export async function discoverScenarios(): Promise<readonly ScenarioModule[]> {
  if (cached !== null) return cached;

  const files = readdirSync(SCENARIOS_DIR).filter(
    (f) =>
      f.endsWith(".ts") &&
      !f.endsWith(".d.ts") &&
      !f.endsWith(".test.ts") &&
      // Scaffolds emitted by `gate:propose --emit` aren't real scenarios — they
      // live in the tree as TODO reminders. Excluded from discovery so the
      // baseline stays clean until a developer fills one in and renames it.
      !f.startsWith("cf-TODO-"),
  );

  const scenarios: ScenarioModule[] = [];
  for (const file of files) {
    const idFromFile = basename(file, ".ts");
    const mod = (await import(join(SCENARIOS_DIR, file))) as {
      readonly scenario?: ScenarioModule;
    };
    if (!mod.scenario) {
      throw new Error(
        `Gate scenario file ${file} does not export \`scenario: ScenarioModule\`. ` +
          `Every file in scenarios/ must export this binding.`,
      );
    }
    if (mod.scenario.id !== idFromFile) {
      throw new Error(
        `Gate scenario id/filename mismatch: file=${file} declares id=${mod.scenario.id}. ` +
          `Rename the file or change the \`id\` field so they match — health tracking ` +
          `relies on this to attribute regressions correctly.`,
      );
    }
    scenarios.push(mod.scenario);
  }

  // Sort by id so deterministic ordering across all reads — JSON diffs stay stable.
  scenarios.sort((a, b) => a.id.localeCompare(b.id));
  cached = scenarios;
  return scenarios;
}

/**
 * Validate that no two scenarios target the same weakness. Multiple
 * scenarios per weakness suggest redundancy worth consolidating; absence
 * of coverage for a weakness in `loop-state.json` suggests new scenarios
 * are needed. Both signals surface during harness-improvement-loop
 * sessions via `bun run gate:health`.
 */
export function summarizeCoverage(
  scenarios: readonly ScenarioModule[],
): { coverage: Record<string, readonly string[]>; redundancy: readonly string[] } {
  const byWeakness: Record<string, string[]> = {};
  for (const s of scenarios) {
    (byWeakness[s.targetedWeakness] ??= []).push(s.id);
  }
  const redundancy = Object.entries(byWeakness)
    .filter(([, ids]) => ids.length > 1)
    .map(([weakness]) => weakness);
  return { coverage: byWeakness, redundancy };
}
