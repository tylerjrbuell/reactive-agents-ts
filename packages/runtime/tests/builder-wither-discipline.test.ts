/**
 * Builder wither discipline gate — CORRECTION 1+2 (2026-05-29).
 *
 * **Value-subtraction reverted 2026-05-29; anti-mission #3 amended —
 * count is not the failure mode, redundancy/no-canonical-path is.**
 *
 * History: WS-2 Phase 3 marked 48 builder methods `@deprecated alias
 * for HarnessProfile.X / .compose(...)` to drop the "effective" wither
 * count below an arbitrary ≤24 ceiling. That was metric-gaming: the
 * methods still existed and functioned; the tag only relabelled them.
 * `@deprecated` causes IDE strikethrough + doc-generator deprecation
 * warnings + lint noise in USER code — it tells consumers to abandon
 * the documented happy path (`.withReasoning()`, `.withCortex()`,
 * `.withMemory()`, `.withTools()`, `.withVerification()`, …). That is
 * value subtraction, which the project owner rejected.
 *
 * Corrected intent: the composable API (`compose`, `withProfile`,
 * `HarnessProfile.*`) offers ADDITIONAL ways to use Reactive Agents —
 * it does not take away value we already have. The fluent wither
 * methods ARE a first-class supported path.
 *
 * What this gate now asserts (the things that actually matter):
 *   - The documented capability methods EXIST and are NOT
 *     `@deprecated` — locking in that the happy path stays first-class
 *     (the inverse of the old ceiling gate).
 *   - The additive composable surface (`compose`, `withProfile`)
 *     EXISTS alongside the withers.
 *
 * What this gate no longer asserts:
 *   - No raw `@deprecated`-count floor (≥20) — removed.
 *   - No "effective surface ≤ 24" ceiling — removed. A large, clear,
 *     non-redundant wither surface is not a failure; silent
 *     redundancy / a missing canonical path would be.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUILDER_PATH = resolve(
  import.meta.dir,
  "..",
  "src",
  "builder.ts",
);

const SOURCE = readFileSync(BUILDER_PATH, "utf-8");
const LINES = SOURCE.split("\n");

/**
 * True when the line is a wither signature (overload, impl, or
 * single-form). Overloads count too — they surface in IDE
 * intellisense and inflate the user-facing API.
 */
function isWitherSignatureLine(line: string): boolean {
  return /^\s*public\s+with[A-Z]|^\s*with[A-Z].*\(.*\):/.test(line);
}

/**
 * For a wither signature at `lineIdx`, scan backward for the nearest
 * JSDoc block that immediately precedes it. Allows blank lines and
 * sibling overload signatures (so overloads inherit the same JSDoc
 * verdict). Stops at any non-JSDoc / non-blank / non-overload line.
 * Returns the block text or null when there is no preceding JSDoc.
 */
function precedingJsdoc(lineIdx: number): string | null {
  let end = lineIdx - 1;
  // Skip sibling overload signatures sharing the same JSDoc (e.g.
  // `withModel(string): this`, `withModel(params): this`, `withModel(arg) {`).
  while (end >= 0 && isWitherSignatureLine(LINES[end] ?? "")) {
    end--;
  }
  // Skip immediate blank lines.
  while (end >= 0 && (LINES[end] ?? "").trim() === "") {
    end--;
  }
  if (end < 0) return null;
  const closing = (LINES[end] ?? "").trim();
  if (!closing.endsWith("*/")) return null;
  // Walk up to the opening "/**".
  let start = end;
  while (start >= 0 && !(LINES[start] ?? "").trim().startsWith("/**")) {
    start--;
  }
  if (start < 0) return null;
  return LINES.slice(start, end + 1).join("\n");
}

interface WitherClassification {
  readonly lineIdx: number;
  readonly source: string;
  readonly deprecated: boolean;
}

function classifyWithers(): readonly WitherClassification[] {
  const result: WitherClassification[] = [];
  for (let i = 0; i < LINES.length; i++) {
    const line = LINES[i] ?? "";
    if (!isWitherSignatureLine(line)) continue;
    const jsdoc = precedingJsdoc(i);
    const deprecated = jsdoc !== null && /@deprecated/.test(jsdoc);
    result.push({ lineIdx: i, source: line.trim(), deprecated });
  }
  return result;
}

describe("builder.ts wither discipline (CORRECTION 1+2 — happy path stays first-class)", () => {
  it("the additive composable surface (compose, withProfile) exists alongside the withers", () => {
    const withers = classifyWithers();
    const compose = withers.find((w) => /^\s*compose\(/.test(w.source));
    const withProfile = withers.find((w) => /^\s*withProfile\(/.test(w.source));
    // `compose` is declared without the `with` prefix; scan the source directly.
    const hasCompose =
      compose !== undefined || /^\s*compose\(/m.test(SOURCE);
    expect(hasCompose, "compose() must exist as the additive composable entry").toBe(
      true,
    );
    expect(withProfile, "withProfile() must exist as the additive preset entry").toBeDefined();
    expect(withProfile?.deprecated, "withProfile() must NOT be @deprecated").toBe(
      false,
    );
  });

  it("documented capability methods exist and are NOT @deprecated (happy path stays first-class)", () => {
    // The documented happy path the README + docs teach. Each method
    // delivers a working, documented capability — un-deprecating these
    // is the whole point of CORRECTION 1+2. If a future change marks
    // one `@deprecated`, this gate fails: that would tell users to
    // abandon what the docs teach (value subtraction).
    const documentedHappyPath = [
      // Identity / model essentials
      "withName",
      "withModel",
      "withProvider",
      // Core capabilities
      "withReasoning",
      "withMemory",
      "withTools",
      "withVerification",
      "withGuardrails",
      "withReactiveIntelligence",
      "withCortex",
      "withObservability",
      "withSkills",
      "withLearning",
      "withSkillPersistence",
      // Execution controls
      "withMaxIterations",
      "withBudget",
      "withTimeout",
    ];
    const withers = classifyWithers();
    for (const name of documentedHappyPath) {
      const match = withers.find((w) =>
        new RegExp(`^\\s*${name}\\(`).test(w.source),
      );
      expect(match, `${name}() must be present`).toBeDefined();
      expect(
        match?.deprecated,
        `${name}() must NOT be @deprecated — it is a documented, working ` +
          `capability on the happy path. The composable API is additive, ` +
          `not a replacement (CORRECTION 1+2, 2026-05-29).`,
      ).toBe(false);
    }
  });
});
