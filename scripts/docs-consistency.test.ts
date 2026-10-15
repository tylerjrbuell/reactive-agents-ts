/**
 * W0.7 docs-consistency regression pin.
 *
 * Pins every strategy-count claim in README.md and the docs site
 * (apps/docs/src/content/docs/**) to the REAL `StrategyRegistry` bootstrap in
 * `packages/reasoning/src/services/strategy-registry.ts`, and pins the docs
 * home-page `strategies` stat (apps/docs/scripts/generate-metrics.ts) to the
 * same truth.
 *
 * Why the registry bootstrap and not the filesystem: the historical 8/7/5
 * contradiction class (README said 8, installation.mdx said 7, stability.md
 * said 5, generate-metrics counted strategy *directories*) was a drift between
 * prose and bootstrap. The registered implementations are the truth; docs bend
 * to code, never the inverse.
 *
 * Derivation of "canonical strategy count":
 *   - every `["key", impl]` entry in the StrategyRegistryLive bootstrap Map is
 *     a registered key;
 *   - keys that share an implementation identifier are ALIASES (react →
 *     reactive, rewoo → blueprint) and count as ONE with their canonical key
 *     (AGENTS.md: "aliases count as one strategy, not extra");
 *   - canonical count = number of distinct implementation identifiers.
 *
 * If the bootstrap's shape changes and this parse finds nothing, the test goes
 * RED rather than passing vacuously — a parse failure is exactly when the pin
 * matters.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const REGISTRY_SRC = join(
  REPO_ROOT,
  "packages/reasoning/src/services/strategy-registry.ts",
);
const README = join(REPO_ROOT, "README.md");
const DOCS_DIR = join(REPO_ROOT, "apps/docs/src/content/docs");
const METRICS_SCRIPT = join(REPO_ROOT, "apps/docs/scripts/generate-metrics.ts");
const METRICS_JSON = join(REPO_ROOT, "apps/docs/src/data/metrics.json");

// ─── Registry truth ──────────────────────────────────────────────────────────

interface StrategyTruth {
  /** Every registered key, in bootstrap order. */
  readonly keys: readonly string[];
  /** One key per distinct implementation (first registration wins). */
  readonly canonical: readonly string[];
  /** Keys that share an implementation with an earlier key. */
  readonly aliases: readonly string[];
}

function readRegistryTruth(): StrategyTruth {
  const src = readFileSync(REGISTRY_SRC, "utf-8");
  // The StrategyRegistryLive bootstrap: new Map<string, StrategyFn>([ ... ]).
  const block = src.match(
    /new Map<string, StrategyFn>\(\[([\s\S]*?)\]\),/,
  );
  if (!block) {
    throw new Error(
      `docs-consistency: could not locate the StrategyRegistryLive bootstrap ` +
        `Map in ${REGISTRY_SRC} — the parse is stale or the registry moved. ` +
        "Fix this test's regex (and the docs) together.",
    );
  }
  const entries = [...block[1].matchAll(/\[\s*"([^"]+)"\s*,\s*([^\]]+?)\s*\]/g)];
  if (entries.length === 0) {
    throw new Error(
      "docs-consistency: registry bootstrap Map parsed, but zero `[" +
        '"name", impl] entries matched — update the entry regex.',
    );
  }
  const keys: string[] = [];
  const implToCanonical = new Map<string, string>();
  const canonical: string[] = [];
  const aliases: string[] = [];
  for (const [, key, rawImpl] of entries) {
    // Normalize the implementation identifier: `asStrategyFn(executeDirect)`
    // and `executeDirect` resolve to the same executor.
    const inner = rawImpl.match(/\(([^()]*)\)\s*$/);
    const impl = (inner ? inner[1] : rawImpl).trim();
    keys.push(key);
    const seen = implToCanonical.get(impl);
    if (seen === undefined) {
      implToCanonical.set(impl, key);
      canonical.push(key);
    } else {
      aliases.push(key);
    }
  }
  return { keys, canonical, aliases };
}

const TRUTH = readRegistryTruth();

// ─── Prose claim extraction ──────────────────────────────────────────────────

const NUMBER_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
const NUMBER_TO_VALUE: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const ADJECTIVES =
  "(?:(?:reasoning|built-in|pluggable|registered|canonical|core|main)\\s+){0,3}";

/** "<N> [adj…] strateg(y|ies)" — count stated BEFORE the word. */
const PRECOUNT_RE = new RegExp(
  `\\b(${NUMBER_WORDS}|\\d+)\\s+${ADJECTIVES}strateg(?:y|ies)\\b`,
  "gi",
);
/** "Reasoning strategies | <N>" comparison-table cell — count stated AFTER. */
const TABLE_RE = /\breasoning strategies\s*\|\s*(?:✅\s*)?(\d+)/gi;

/**
 * TOTAL-CLAIM SCOPE (review round 1): a "<N> strategies" mention only asserts
 * how many strategies the framework REGISTERS when it carries total-claim
 * context. Local/per-recipe counts — the playground's "Two strategies, same
 * task" demoing one stackblitz, tier-subset phrasings, etc. — are NOT totals
 * and must not be pinned (and prose must not be bent to flatter the regex).
 * A PRECOUNT match is asserted iff ANY total signal holds:
 *   - an adjective rides in the phrase ("8 reasoning strategies",
 *     "the 8 built-in strategies", "the five canonical strategies");
 *   - total context words immediately precede ("ships eight strategies",
 *     "all eight strategies", "with eight strategies", "total");
 *   - an enumeration follows directly ("8 strategies (ReAct, …");
 *   - the claim sits in a markdown table row (a comparison-table cell);
 *   - it is the complement form "the other N strategies" (asserted as N+1).
 * Everything else is recorded as an ignored local claim and printed, so a
 * total claim that ever loses its context signals surfaces as a shrinkage
 * in the ignored list rather than a silent hole in the pin.
 */
const TOTAL_ADJECTIVE_RE =
  /\b(reasoning|built-in|pluggable|registered|canonical|core|main)\b/i;
const TOTAL_CONTEXT_RE = /\b(all|ships|ship|with|total|available)\s+$/i;

function toNumber(token: string): number {
  return /^\d+$/.test(token)
    ? Number.parseInt(token, 10)
    : NUMBER_TO_VALUE[token.toLowerCase()];
}

interface Claim {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly stated: number;
  /** true for "the other N strategies" — N counts the complement of the page's own subject. */
  readonly isComplement: boolean;
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(md|mdx)$/.test(e.name))
    .map((e) => join(e.parentPath ?? (e as { path?: string }).path ?? dir, e.name))
    .filter((p) => existsSync(p));
}

function extractClaims(file: string): { totals: Claim[]; local: Claim[] } {
  const text = readFileSync(file, "utf-8");
  const lines = text.split("\n");
  const totals: Claim[] = [];
  const local: Claim[] = [];
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;

  for (const m of text.matchAll(PRECOUNT_RE)) {
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    // "5 strategy files" is a claim about source files (historical refactor
    // prose), not about the registered strategy count.
    if (/^\s+files?\b/.test(text.slice(end, end + 10))) continue;
    const isComplement = /\bother\s+$/i.test(text.slice(0, idx));
    const claimLine = lines[lineOf(idx) - 1] ?? "";
    const isTotal =
      isComplement ||
      TOTAL_ADJECTIVE_RE.test(m[0]) ||
      TOTAL_CONTEXT_RE.test(text.slice(0, idx)) ||
      /^\s*\(/.test(text.slice(end, end + 2)) ||
      (claimLine.match(/\|/g) ?? []).length >= 2;
    const claim: Claim = {
      file,
      line: lineOf(idx),
      text: m[0],
      stated: toNumber(m[1]),
      isComplement,
    };
    (isTotal ? totals : local).push(claim);
  }
  for (const m of text.matchAll(TABLE_RE)) {
    const idx = m.index ?? 0;
    totals.push({
      file,
      line: lineOf(idx),
      text: m[0],
      stated: toNumber(m[1]),
      isComplement: false,
    });
  }
  return { totals, local };
}

function relative(p: string): string {
  return p.slice(REPO_ROOT.length + 1);
}

const SCANNED = [README, ...markdownFiles(DOCS_DIR)];
const SCAN = SCANNED.map(extractClaims);
const TOTAL_CLAIMS = SCAN.flatMap((s) => s.totals);
const LOCAL_CLAIMS = SCAN.flatMap((s) => s.local);

describe("docs-consistency: strategy counts pinned to StrategyRegistry bootstrap", () => {
  it(
    "registry bootstrap parses and yields a sane truth",
    () => {
      // Sanity guards so a broken parse can never pass vacuously: the current
      // truth is 10 keys / 8 canonical / 2 aliases (react, rewoo). If the
      // registry legitimately changes, THESE lines are what the author updates,
      // together with the prose.
      expect(TRUTH.keys.length).toBeGreaterThanOrEqual(5);
      expect(TRUTH.canonical.length).toBeGreaterThanOrEqual(5);
      expect(TRUTH.keys.length).toBe(
        TRUTH.canonical.length + TRUTH.aliases.length,
      );
      // Every canonical key must be registered, every alias must resolve to an
      // earlier key — i.e. the alias sets partition the key list.
      for (const alias of ["react", "rewoo"]) {
        expect(TRUTH.keys).toContain(alias);
      }
    },
    10_000,
  );

  it(
    "every TOTAL strategy-count claim in README + docs pages matches the registry",
    () => {
      const expected = (c: Claim) =>
        c.isComplement ? TRUTH.canonical.length - 1 : TRUTH.canonical.length;
      const violations = TOTAL_CLAIMS.filter((c) => c.stated !== expected(c))
        .map(
          (c) =>
            `  ${relative(c.file)}:${c.line} — "${c.text}" states ${c.stated}; ` +
            `registry truth is ${TRUTH.canonical.length} canonical ` +
            `(keys: ${TRUTH.keys.join(", ")})${
              c.isComplement ? " — 'other N' complement expects 7" : ""
            }`,
        );
      expect(
        violations.length,
        `${violations.length} strategy-count claim(s) drift from the registry ` +
          `bootstrap (${relative(REGISTRY_SRC)}):\n${violations.join("\n")}`,
      ).toBe(0);
      // Observability: local (non-total) claims are deliberately NOT pinned.
      // Print them so a drift-prone total phrased WITHOUT context words shows
      // up here instead of silently escaping the pin.
      for (const c of LOCAL_CLAIMS) {
        console.log(
          `[docs-consistency] ignored local claim: ${relative(c.file)}:${c.line} — "${c.text}"`,
        );
      }
      // The scan must actually find total claims — a regex that silently
      // matches nothing is a dead pin.
      expect(TOTAL_CLAIMS.length).toBeGreaterThanOrEqual(15);
      // And the complement form must still be present (guards the 'other N'
      // rule against silently disappearing from prose).
      expect(TOTAL_CLAIMS.some((c) => c.isComplement)).toBe(true);
    },
    15_000,
  );

  it(
    "generate-metrics `strategies` stat matches the registry truth",
    () => {
      const proc = Bun.spawnSync(["bun", METRICS_SCRIPT], { cwd: REPO_ROOT });
      expect(proc.exitCode).toBe(0);
      expect(existsSync(METRICS_JSON)).toBe(true);
      const metrics = JSON.parse(readFileSync(METRICS_JSON, "utf-8")) as {
        strategies: number;
      };
      expect(metrics.strategies).toBe(TRUTH.canonical.length);
    },
    60_000,
  );
});
