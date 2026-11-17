/**
 * Stale public-claim guard (docs adoption readiness, Phase 0).
 *
 * Fails on claims the project has shipped wrong before:
 *   - a Discord invite other than the canonical one (a dead invite shipped to npm),
 *   - "Node.js support is on the roadmap" (Node 22.5+ is supported via runtime-shim),
 *   - "requires Bun" / "Bun ... required" with no Node mention (Bun is recommended, never required),
 *   - "zero any" / "no any" absolutes (falsifiable; the repo has an `as any` ceiling gate, not zero).
 *
 * Pure functions here so the test can feed strings; `scanRepo` walks the public surface.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { LONG_PAGE_WORDS, splitFrontmatter, wordCount } from "./ia-inventory";

export const CANONICAL_DISCORD_CODE = "Mp99vQam3Q";

export interface StaleClaim {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly text: string;
}

const NEGATION = /\b(not|never|no longer|isn't|aren't|nor)\b|n't\b/i;

/** The counts in `src/data/metrics.json` that prose may quote. */
export interface MetricCounts {
  readonly tests: number;
  readonly packages: number;
  readonly packagesTotal: number;
}

/**
 * Files whose counts are historical by design (release notes) or generated data;
 * the count rule skips them.
 */
const COUNT_RULE_SKIP = /whats-new|CHANGELOG|src\/data\/|apps\/docs\/scripts\//; // scripts/ holds example numbers in comments

/**
 * Docs IA mission (2026-11-17) rules, all line-based:
 *   - `node-old-floor`:     "Node 18+", "Node.js >= 20", "Node >= 20". The floor is Node 22.5.
 *   - `bun-old-floor`:      "Bun >= 1.0", "Bun 1.0+", "Bun](...) >= 1.0". The floor is Bun 1.1.0.
 *   - `stable-since-0-9`:   "stable since 0.9", "API is stable since", "v0.9.0 -> v0.10.6" What's New range.
 *   - `switching-default-on`: strategy switching described as on by default or
 *     `enableStrategySwitching` defaulting to true. It is opt-in since 2026-11-05.
 *     Lines that also say opt-in, off by default, superseded or "was" are history, not claims.
 *   - `count-mismatch` (needs `metrics`): "N tests" must be within 10% of metrics.tests
 *     ("N+" is a floor: N <= tests and N >= 85%); "N packages" (20-99) must equal metrics.packages
 *     or metrics.packagesTotal. Skipped in release notes and generated data.
 */
function scanDocsIaRules(
  file: string,
  raw: string,
  push: (rule: string, m: string) => void,
  metrics: MetricCounts | undefined,
): void {
  const nodeOld =
    raw.match(/\bNode(?:\.js)?\s*(?:v)?\s*(?:18|20)\s*\+/i) ??
    raw.match(/\bNode(?:\.js)?\s*(?:≥|>=)\s*(?:18|20)(?![.\d])/i);
  if (nodeOld) push("node-old-floor", nodeOld[0]);

  const bunOld =
    raw.match(/\bBun\b[^\n]{0,40}?(?:≥|>=)\s*1\.0(?![.\d])/i) ?? raw.match(/\bBun\s+1\.0\+/i);
  if (bunOld) push("bun-old-floor", bunOld[0]);

  const since =
    raw.match(/\bstable since v?0\.9\b/i) ?? raw.match(/v0\.9\.0\s*(?:→|->|-|to)\s*v0\.10\.6/i);
  if (since) push("stable-since-0-9", since[0]);

  if (!/opt-in|off by default|superseded|\bwas\b|\bdefaulted\b|historical/i.test(raw)) {
    const sw =
      raw.match(/enableStrategySwitching`?\s+(?:now\s+)?defaults?\s+to\s+`?true/i) ??
      raw.match(/strategy switching[^.\n]{0,40}\b(?:on by default|enabled by default|default-on)/i);
    if (sw) push("switching-default-on", sw[0]);
  }

  if (metrics && !COUNT_RULE_SKIP.test(file)) {
    for (const m of raw.matchAll(/\b(\d[\d,]*)(\+)?\s+tests\b/g)) {
      const n = Number((m[1] ?? "").replace(/,/g, ""));
      if (n < 1000) continue;
      const ok = m[2]
        ? n <= metrics.tests && n >= metrics.tests * 0.85
        : Math.abs(n - metrics.tests) <= metrics.tests * 0.1;
      if (!ok) push("count-mismatch", `${m[0]} (metrics.json: ${metrics.tests})`);
    }
    for (const m of raw.matchAll(/\b(\d{2})\s+(?:published |public |npm )?packages\b/g)) {
      const n = Number(m[1]);
      if (n < 20) continue;
      if (n !== metrics.packages && n !== metrics.packagesTotal) {
        push("count-mismatch", `${m[0]} (metrics.json: ${metrics.packages} public / ${metrics.packagesTotal} total)`);
      }
    }
  }
}

/**
 * One home per fact (Docs IA stage 1): the reasoning-strategies cluster has ONE canonical page.
 * Any other docs page that carries a table with a row per strategy (5+ distinct built-in
 * strategies in the first two cells of its rows) is a second copy of the strategy table and
 * drifts from it. Summarize in prose and link instead.
 * Exempt: the canonical page, release notes (history), the consumer SKILL.md files and the npm
 * README (`packages/reactive-agents/README.md`, owned by runtime-warden; its strategy table is a
 * tracked follow-up). The root README.md collapsed its table (stage 2) and is governed.
 */
export const STRATEGY_HOME = "guides/choosing-strategies.mdx";
const STRATEGY_TABLE_EXEMPT =
  /guides\/choosing-strategies\.mdx$|whats-new|CHANGELOG|SKILL\.md$|packages\/reactive-agents\/README\.md$/;

/**
 * One home per fact, stage 2 (tools and MCP, memory, cost). Each cluster has ONE canonical page
 * that owns the option-level config. A line that restates an option-level snippet only that page
 * should carry means a second copy exists; summarize and link instead. Patterns are deliberately
 * narrow code forms (an option key with its value) so prose that names a method does not trip them.
 * Exempt everywhere: release notes (history), CHANGELOG, consumer SKILL.md files and `reference/`
 * (the API reference tables list every option by design).
 */
export interface HomeGuard {
  readonly rule: string;
  /** Canonical page, relative to the content root. */
  readonly home: string;
  readonly patterns: readonly RegExp[];
  readonly homeFile: RegExp;
}
const HOME_GUARD_EXEMPT = /whats-new|CHANGELOG|SKILL\.md$|(?:^|\/)reference\//;
export const HOME_GUARDS: readonly HomeGuard[] = [
  {
    rule: "tools-mcp-duplicate",
    home: "guides/tools.mdx hub and its children guides/tools/*.mdx (mcp-tools owns OAuth, execution-and-results owns compression)",
    homeFile: /guides\/tools(?:\.mdx|\/[a-z-]+\.mdx)$/,
    // result-compression options; MCP OAuth grant config
    patterns: [/\bpreviewItems\s*:/, /\btype:\s*["'](?:client_credentials|authorization_code)["']/],
  },
  {
    rule: "memory-duplicate",
    home: "guides/memory.mdx",
    homeFile: /guides\/memory\.mdx$/,
    // consolidation thresholds; experience-learning and consolidation enable snippets
    patterns: [/\b(?:decayFactor|pruneThreshold)\s*:/, /\b(?:experienceLearning|memoryConsolidation)\s*:\s*true/],
  },
  {
    rule: "cost-duplicate",
    home: "features/cost-tracking.md",
    homeFile: /features\/cost-tracking\.md$/,
    // routing tier map, cost layer budget config, budget error handling
    patterns: [/\btierModels\s*:/, /\bcreateCostLayer\(/, /\binstanceof\s+BudgetExceededError\b/],
  },
  {
    rule: "gateway-duplicate",
    home: "features/gateway.md (channels: guides/messaging-channels.mdx hub and guides/messaging-channels/*.mdx, contract: guides/channel-adapters.mdx)",
    // the gateway-and-channels pages (channels hub and its children) and the landing-page teaser own gateway option snippets
    homeFile: /(?:features\/gateway\.md|guides\/messaging-channels(?:\.mdx|\/[a-z-]+\.mdx)|guides\/channel-adapters\.mdx|docs\/index\.mdx)$/,
    // cron and webhook arrays, policy rate limit, adapter registration and construction
    patterns: [
      /\bcrons\s*:\s*\[/,
      /\bwebhooks\s*:\s*\[/,
      /\bmaxActionsPerHour\s*:/,
      /^\s*\.withChannels\(\{/,
      /\bnew (?:Signal|Telegram|Webhook)ChannelAdapter\(/,
    ],
  },
  {
    rule: "config-env-duplicate",
    home: "reference/configuration.md (environment variables)",
    homeFile: /reference\/configuration\.md$/,
    // the LLM tuning variables in a .env block; a second .env copy goes stale
    patterns: [/^\s*(?:LLM_DEFAULT_TEMPERATURE|LLM_MAX_RETRIES|LLM_TIMEOUT_MS)\s*=/],
  },
  {
    rule: "durable-runs-duplicate",
    home: "guides/durable-execution.mdx (approval: guides/durable-hitl.md, handle: features/process-model.md)",
    homeFile: /(?:guides\/durable-execution\.mdx|guides\/durable-hitl\.md|features\/process-model\.md)$/,
    // a code line that configures durable runs or an approval policy, or answers a run
    patterns: [
      /^\s*\.with(?:DurableRuns|ApprovalPolicy)\(\{/,
      /^\s*(?:void |await |const \w+ = await )?\w+\.(?:approveRun|denyRun|resumeRun|respondToInteraction)\(/,
    ],
  },
];

/** Findings for the stage-2 one-home guards on one file. */
export function findHomeDuplicates(file: string, text: string): StaleClaim[] {
  if (!/\.mdx?$/.test(file) || HOME_GUARD_EXEMPT.test(file)) return [];
  const out: StaleClaim[] = [];
  for (const g of HOME_GUARDS) {
    if (g.homeFile.test(file)) continue;
    text.split("\n").forEach((line, i) => {
      if (g.patterns.some((p) => p.test(line))) {
        out.push({
          file,
          line: i + 1,
          rule: g.rule,
          text: `option-level snippet duplicated; canonical home is ${g.home}, link to it instead`,
        });
      }
    });
  }
  return out;
}
const STRATEGY_NAME =
  /^(react|reactive|reflexion|plan-execute(?:-reflect)?|tree-of-thought|tot|adaptive|blueprint|rewoo|direct|code-action)\b/;

function strategyOfCell(cell: string): string | undefined {
  const t = cell
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*`"']/g, "")
    .trim()
    .toLowerCase();
  const m = STRATEGY_NAME.exec(t);
  return m ? (m[1] === "react" ? "reactive" : m[1]) : undefined;
}

/** 1-based line numbers where a table re-lists 5+ built-in strategies, one per row. */
export function findStrategyTables(text: string): number[] {
  const hits: number[] = [];
  const lines = text.split("\n");
  let i = 0;
  let fenced = false;
  while (i < lines.length) {
    const head = (lines[i] ?? "").trimStart();
    if (head.startsWith("```")) fenced = !fenced;
    // Lines inside code fences that start with `|` are TypeScript unions, not tables.
    if (fenced || !head.startsWith("|")) {
      i++;
      continue;
    }
    const start = i;
    const seen = new Set<string>();
    while (i < lines.length && (lines[i] ?? "").trimStart().startsWith("|")) {
      const cells = (lines[i] ?? "").split(/(?<!\\)\|/).slice(1, 3);
      for (const c of cells) {
        const s = strategyOfCell(c);
        if (s) {
          seen.add(s);
          break;
        }
      }
      i++;
    }
    if (seen.size >= 5) hits.push(start + 1);
  }
  return hits;
}

/**
 * Page-size ceiling (docs IA, 2026-11-17). A content page over LONG_PAGE_WORDS (inventory word
 * count: body, code included) is unfindable-within; split it by reader task (see
 * wiki/Reference/Docs-IA-Proposal.md section e). Pages not yet split are listed here with a cap
 * (their size when listed, rounded up to 100). The list may only shrink: a listed page that grows
 * past its cap fails, and a listed page that drops under the ceiling must be removed from the list.
 */
export const OVERSIZE_EXCEPTIONS: Readonly<Record<string, number>> = {};
const CONTENT_PAGE = /apps\/docs\/src\/content\/docs\/(.+)\.mdx?$/;

/** `checkStale` (repo scan only; unit fixtures are tiny) also flags a listed exception that now fits. */
export function findOversizePage(
  file: string,
  text: string,
  checkStale = false,
  exceptions: Readonly<Record<string, number>> = OVERSIZE_EXCEPTIONS,
): StaleClaim[] {
  const m = CONTENT_PAGE.exec(file.replace(/\\/g, "/"));
  if (!m) return [];
  const slug = m[1].replace(/\/index$/, "");
  const words = wordCount(splitFrontmatter(text).body);
  const cap = exceptions[slug];
  const at = (rule: string, msg: string): StaleClaim[] => [{ file, line: 1, rule, text: msg }];
  if (cap === undefined) {
    return words > LONG_PAGE_WORDS
      ? at("page-too-long", `${words} words, limit ${LONG_PAGE_WORDS}: split by reader task into a hub plus child pages`)
      : [];
  }
  if (words > cap) return at("page-too-long", `${words} words, over its exception cap ${cap}: the list may only shrink`);
  if (checkStale && words <= LONG_PAGE_WORDS) return at("oversize-exception-stale", `${words} words, under ${LONG_PAGE_WORDS}: remove ${slug} from OVERSIZE_EXCEPTIONS`);
  return [];
}

/** Scan one file's text. `file` is only used to label findings. Pass `metrics` to enable the count rule. */
export function scanText(file: string, text: string, metrics?: MetricCounts): StaleClaim[] {
  const out: StaleClaim[] = [];
  if (/\.mdx?$/.test(file) && !STRATEGY_TABLE_EXEMPT.test(file)) {
    for (const line of findStrategyTables(text)) {
      out.push({
        file,
        line,
        rule: "strategy-table-duplicate",
        text: `table re-lists the strategies; link to /guides/choosing-strategies/ instead`,
      });
    }
  }
  out.push(...findHomeDuplicates(file, text));
  out.push(...findOversizePage(file, text));
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    // Shields.io badge URLs percent-encode their text; decode the common escapes.
    const raw = line.replace(/%20/g, " ").replace(/%E2%89%A5/gi, "≥").replace(/%7C/gi, "|");
    const push = (rule: string, m: string) =>
      out.push({ file, line: i + 1, rule, text: m.trim().slice(0, 120) });

    for (const m of raw.matchAll(/discord\.gg\/([A-Za-z0-9_-]+)/g)) {
      if (m[1] !== CANONICAL_DISCORD_CODE) push("non-canonical-discord-invite", m[0]);
    }
    const roadmap = raw.match(/Node(?:\.js)?\s+support\s+is\s+on\s+the\s+roadmap/i);
    if (roadmap) push("node-on-roadmap", roadmap[0]);

    // Bun-required claims: skip when the same line also names Node or negates it.
    if (!/\bnode\b/i.test(raw)) {
      const req =
        raw.match(/\brequires?\s+Bun\b[^.\n]{0,40}/i) ??
        raw.match(/\bBun\b(?:[^.\n]|\.\d){0,25}\brequired\b/i);
      if (req && !NEGATION.test(req[0])) push("bun-required", req[0]);
    }

    // Absolutes about `any`. An instruction ("No `any` — use precise types") is fine.
    const abs = raw.match(/\b(?:zero|no)\s+`?any`?(?!\s*[—-]|\s*:)/i);
    if (abs && !/^\s*[-*]?\s*no\s+`?any`?\s*(?:[—-]|$)/i.test(raw)) push("any-absolute", abs[0]);

    scanDocsIaRules(file, raw, push, metrics);
  });
  return out;
}

const SCAN_EXT = /\.(md|mdx|mjs|ts|tsx|astro|json|txt)$/;
const SKIP_DIR = new Set(["node_modules", "dist", ".astro", ".turbo", "tests", ".git"]);
const SKIP_FILE = new Set(["stale-claims.ts", "check-docs-sync.ts", "package-lock.json"]);

function walk(dir: string, acc: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (SCAN_EXT.test(name) && !SKIP_FILE.has(name)) acc.push(p);
  }
}

/** Scan README.md and apps/docs (content, config, skills, public). */
export function scanRepo(repoRoot: string): StaleClaim[] {
  const files = [join(repoRoot, "README.md")];
  walk(join(repoRoot, "apps/docs"), files);
  const metrics = JSON.parse(
    readFileSync(join(repoRoot, "apps/docs/src/data/metrics.json"), "utf8"),
  ) as MetricCounts;
  const out: StaleClaim[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    out.push(...scanText(relative(repoRoot, f), text, metrics));
    out.push(...findOversizePage(relative(repoRoot, f), text, true).filter((c) => c.rule === "oversize-exception-stale"));
  }
  return out;
}
