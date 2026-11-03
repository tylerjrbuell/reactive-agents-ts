// Run: bun test packages/reasoning/tests/enforcement-scripts.test.ts
//
// Program law (wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md §6):
//
//     "Every subsystem: one owner module + one grep-able enforcement script.
//      No script → not done."
//
// The wiring audit (2026-07-09) found that six of the eight scripts were never
// executed by anything. The law had degraded from "the script must pass" to
// "the script must exist".
//
// Execution now lives in ONE place: `bun run repo check --all` (CI step
// "Enforce architectural invariants") runs every script registered in
// tools/repo/checks.json exactly once. This test used to spawn each script a
// second time inside `bun test`; it now pins the other half of the law — a
// `scripts/check-*.sh` that is not in the registry would silently never run,
// so every one on disk must have exactly one registry entry.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

interface RegistryEntry {
  id: string;
  script: string;
}

function registryEntries(): readonly RegistryEntry[] {
  const raw: unknown = JSON.parse(
    readFileSync(join(REPO_ROOT, "tools", "repo", "checks.json"), "utf8"),
  );
  const checks = (raw as { checks?: unknown }).checks;
  if (!Array.isArray(checks)) throw new Error("tools/repo/checks.json: `checks` must be an array");
  return checks as RegistryEntry[];
}

const onDisk = readdirSync(join(REPO_ROOT, "scripts"))
  .filter((f) => f.startsWith("check-") && f.endsWith(".sh"))
  .sort()
  .map((f) => `scripts/${f}`);

describe("enforcement scripts — every invariant script is registered to run", () => {
  it("discovers the enforcement scripts (guards against a vacuously-green suite)", () => {
    expect(onDisk.length).toBeGreaterThanOrEqual(8);
  });

  it("every scripts/check-*.sh has exactly one entry in tools/repo/checks.json", () => {
    const entries = registryEntries();
    for (const script of onDisk) {
      const matches = entries.filter((e) => e.script === script);
      expect(matches.length, `${script} must appear exactly once; add it to tools/repo/checks.json`).toBe(1);
    }
  });

  it("no registry entry points at a script that does not exist", () => {
    const missing = registryEntries()
      .filter((e) => !e.script.startsWith("builtin:") && !onDisk.includes(e.script))
      .map((e) => e.script);
    expect(missing).toEqual([]);
  });
});
