import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression test for the ErrorSwallowed wiring (Phase 0 S0.2).
 *
 * Rather than hardcoding a KNOWN_SWALLOW_SITES constant (which would rot
 * quickly across the ~200 migrated sites), this test scans production
 * source files for `site: "..."` tags embedded in `emitErrorSwallowed` calls
 * and enforces the conventions that make the wiring debuggable in telemetry:
 *
 *   1. Every `emitErrorSwallowed` call has a `site` field.
 *   2. Every site string is non-empty.
 *   3. Every site string is unique across the codebase (no two catch-all
 *      sites share an identifier — otherwise telemetry cannot locate the
 *      failing call).
 *   4. Site strings follow one of the expected formats:
 *      - `<package>/<relative-path>:<line-or-anchor>`
 *
 * New `emitErrorSwallowed` call sites that violate any of these rules
 * fail the test until the site string is corrected.
 */

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");
const SCAN_ROOTS = ["packages", "apps"];
const SRC_DIR_SEGMENT = "/src/";

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".d.ts") &&
      full.includes(SRC_DIR_SEGMENT)
    ) {
      out.push(full);
    }
  }
}

function collectSiteStrings(): readonly { file: string; site: string }[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const rootDir = join(PROJECT_ROOT, root);
    try {
      if (statSync(rootDir).isDirectory()) walk(rootDir, files);
    } catch {
      /* root missing, skip */
    }
  }

  const results: { file: string; site: string }[] = [];
  const callPattern = /emitErrorSwallowed\s*\(\s*\{[\s\S]*?site:\s*"([^"]+)"/g;

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    let match: RegExpExecArray | null;
    while ((match = callPattern.exec(content)) !== null) {
      results.push({ file, site: match[1]! });
    }
  }
  return results;
}

describe("ErrorSwallowed wiring — site conventions (P0 S0.2)", () => {
  const occurrences = collectSiteStrings();

  it("finds at least 20 emitErrorSwallowed call sites in production code", () => {
    // Sanity check — if the P0 S0.2 migration is in place, we expect many
    // sites. A sudden drop below 20 means a large chunk of the migration
    // was reverted or the regex broke.
    expect(occurrences.length).toBeGreaterThanOrEqual(20);
  });

  it("every emitErrorSwallowed call has a non-empty site string", () => {
    const empty = occurrences.filter((o) => o.site.trim().length === 0);
    expect(empty).toEqual([]);
  });

  it("every site string is unique (no collisions across the codebase)", () => {
    const counts = new Map<string, string[]>();
    for (const { file, site } of occurrences) {
      const prior = counts.get(site) ?? [];
      prior.push(file);
      counts.set(site, prior);
    }
    const duplicates = [...counts.entries()].filter(([, files]) => files.length > 1);
    // Duplicates break telemetry: two different catch-all failures publish
    // the same `site` tag and cannot be distinguished. Rename one of them.
    expect(duplicates.map(([site, files]) => ({ site, files }))).toEqual([]);
  });

  it("every site string follows the <package>/<path>:<line-or-anchor> convention", () => {
    // Format: one or more path segments ending in `<file>.ts:<line-or-identifier>`.
    // Examples of valid shapes (from actual migrated code):
    //   "memory/src/services/memory-service.ts:107"
    //   "reasoning/src/kernel/capabilities/act/tool-execution.ts:storeToolObservationSemantic"
    //   "runtime/src/builder.ts:4182"
    // The fixture strings "test-site" and "no-bus" used inside the
    // error-swallowed.test.ts are allowed and excluded here.
    const allowedFixtures = new Set(["test-site", "no-bus"]);
    const pathShape = /^[a-z0-9_-]+\/[^:]+\.ts:[A-Za-z0-9_-]+$/;

    const invalid = occurrences.filter(
      (o) => !allowedFixtures.has(o.site) && !pathShape.test(o.site),
    );
    expect(invalid.map((o) => ({ site: o.site, file: o.file }))).toEqual([]);
  });
});
