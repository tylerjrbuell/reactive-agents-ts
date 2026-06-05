# Meta-Agent Buildout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the `apps/meta-agent` Community Growth Agent into a credible flagship dogfood: grounded competitive analysis, an anti-astroturf quality gate on every draft, Cortex visibility, and production hardening.

**Architecture:** Push deterministic work to code, leave judgment to the LLM. Two new pure/Effect modules — `src/analysis` (harvest real competitor evidence → typed `EvidenceItem[]` with confidence) and `src/grounding` (verify draft links resolve + score astroturf risk) — expose tools/gates the agent must route through, so scorecards cite real evidence and drafts can't ship dead links or spam. Then wire `.withCortex()` and harden the runtime in `index.ts`.

**Tech Stack:** TypeScript + Bun + Effect-TS (^3.10) + bun:test. Patterns: `Schema.Struct` for data, `Data.TaggedError` for errors, `Effect.tryPromise` for async, `.js` extensions on relative imports, no `any`/`let`/`await`/`throw`/`interface`.

**Mandatory context for every task:**
- Read `apps/meta-agent/src/ingest/normalize.ts` and `gather.ts` first — match their defensive-reader + injectable-`fetchImpl` style exactly.
- Run tests as: `bun test ./apps/meta-agent/tests/<file>.test.ts --timeout 15000` (from repo root).
- Anti-pattern gate before each commit: `grep -rnE "\b(let|await)\b|throw new|as any" apps/meta-agent/src/<dir>` must be empty; `grep -rn "^interface " apps/meta-agent/src/<dir>` must be empty.
- Never `git add -A`. Stage only the task's files.

**Parallelism:** Task 1 (`src/analysis`) and Task 2 (`src/grounding`) are independent new directories — run in parallel. Task 3 and Task 4 both edit `src/index.ts` — run them serially, after 1 & 2 merge.

---

## Task 1: Deep-Research Analysis Engine (`src/analysis`)

Harvest recent competitor activity (GitHub releases) into typed evidence with real URLs and a deterministic confidence level, exposed as a `competitive-intel` tool. The LLM narrates scorecards citing this evidence instead of inventing links.

**Files:**
- Create: `apps/meta-agent/src/analysis/types.ts`
- Create: `apps/meta-agent/src/analysis/github-releases.ts`
- Create: `apps/meta-agent/src/analysis/confidence.ts`
- Create: `apps/meta-agent/src/analysis/intel.ts`
- Modify: `apps/meta-agent/src/index.ts` is NOT touched here (tool registration happens in Task 3 wiring to avoid index.ts conflicts) — instead create the tool file:
- Create: `apps/meta-agent/src/tools/competitive-intel.ts`
- Test: `apps/meta-agent/tests/analysis.test.ts`

- [ ] **Step 1: Write `src/analysis/types.ts`**

```typescript
// apps/meta-agent/src/analysis/types.ts
import { Schema } from "effect";

export const ConfidenceSchema = Schema.Literal("high", "medium", "low");
export type Confidence = Schema.Schema.Type<typeof ConfidenceSchema>;

/** A single piece of competitor evidence with a real, citable source URL. */
export const EvidenceItemSchema = Schema.Struct({
  id: Schema.String, // e.g. "release:mastra-ai/mastra#v0.5.0"
  competitor: Schema.String, // "mastra", "langchainjs", ...
  source: Schema.Literal("release", "discussion"),
  summary: Schema.String,
  url: Schema.String,
  capturedAt: Schema.String, // ISO
  confidence: ConfidenceSchema,
});
export type EvidenceItem = Schema.Schema.Type<typeof EvidenceItemSchema>;

export type IntelConfig = {
  readonly repos: readonly string[]; // "owner/repo"
  readonly perRepo: number;
};
export type IntelDeps = {
  readonly fetchImpl: typeof fetch;
};
```

- [ ] **Step 2: Write the failing test for release normalization + confidence**

```typescript
// apps/meta-agent/tests/analysis.test.ts
// Run: bun test ./apps/meta-agent/tests/analysis.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { normalizeReleases } from "../src/analysis/github-releases.js";
import { assignConfidence } from "../src/analysis/confidence.js";
import { gatherCompetitiveEvidence } from "../src/analysis/intel.js";

describe("normalizeReleases", () => {
  it("maps GitHub releases JSON to EvidenceItem[]", () => {
    const json = [
      { html_url: "https://github.com/mastra-ai/mastra/releases/tag/v0.5.0", tag_name: "v0.5.0", name: "v0.5.0", published_at: "2026-05-30T00:00:00Z", body: "new workflows" },
      { draft: true, tag_name: "v0.6.0-rc", html_url: "x", published_at: "2026-06-01T00:00:00Z" },
    ];
    const out = normalizeReleases("mastra-ai/mastra", json);
    expect(out).toHaveLength(1); // draft skipped
    expect(out[0]!.id).toBe("release:mastra-ai/mastra#v0.5.0");
    expect(out[0]!.competitor).toBe("mastra");
    expect(out[0]!.source).toBe("release");
    expect(out[0]!.url).toContain("releases/tag/v0.5.0");
  });
});

describe("assignConfidence", () => {
  it("high when recent and corroborated", () => {
    expect(assignConfidence(5, 2)).toBe("high");
  });
  it("low when old and uncorroborated", () => {
    expect(assignConfidence(200, 0)).toBe("low");
  });
});

describe("gatherCompetitiveEvidence", () => {
  it("fetches releases per repo, resilient to a failing repo, sorted by confidence", async () => {
    const fetchImpl = ((url: string | URL | Request): Promise<Response> => {
      const u = String(url);
      if (u.includes("mastra-ai/mastra")) {
        return Promise.resolve(new Response(JSON.stringify([
          { html_url: "https://github.com/mastra-ai/mastra/releases/tag/v1", tag_name: "v1", name: "v1", published_at: new Date().toISOString(), body: "x" },
        ]), { status: 200 }));
      }
      return Promise.reject(new Error("rate limited"));
    }) as typeof fetch;

    const out = await Effect.runPromise(
      gatherCompetitiveEvidence({ repos: ["mastra-ai/mastra", "langchain-ai/langchainjs"], perRepo: 5 }, { fetchImpl }),
    );
    expect(out.map((e) => e.id)).toContain("release:mastra-ai/mastra#v1");
    expect(out.every((e) => ["high", "medium", "low"].includes(e.confidence))).toBe(true);
  });
});
```

- [ ] **Step 3: Run it — confirm RED** (`Cannot find module '../src/analysis/github-releases.js'`).

- [ ] **Step 4: Write `src/analysis/github-releases.ts`**

```typescript
// apps/meta-agent/src/analysis/github-releases.ts
import type { EvidenceItem } from "./types.js";

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const bool = (v: unknown): boolean => v === true;

/** GitHub `/repos/{owner}/{repo}/releases` JSON → EvidenceItem[] (confidence filled later). */
export const normalizeReleases = (repo: string, json: unknown): EvidenceItem[] => {
  const competitor = (repo.split("/")[1] ?? repo).toLowerCase();
  const items = Array.isArray(json) ? json : [];
  return items.flatMap((r): EvidenceItem[] => {
    const o = rec(r);
    if (bool(o.draft)) return [];
    const tag = str(o.tag_name);
    const url = str(o.html_url);
    if (tag === undefined || url === undefined) return [];
    return [
      {
        id: `release:${repo}#${tag}`,
        competitor,
        source: "release",
        summary: str(o.name) ?? tag,
        url,
        capturedAt: str(o.published_at) ?? new Date().toISOString(),
        confidence: "low", // replaced by cross-reference pass
      },
    ];
  });
};
```

- [ ] **Step 5: Write `src/analysis/confidence.ts`**

```typescript
// apps/meta-agent/src/analysis/confidence.ts
import type { Confidence } from "./types.js";

/** Heuristic confidence from recency (days) and corroborating-source count. */
export const assignConfidence = (recencyDays: number, corroboration: number): Confidence => {
  if (recencyDays <= 30 && corroboration >= 2) return "high";
  if (recencyDays <= 90 || corroboration >= 1) return "medium";
  return "low";
};
```

- [ ] **Step 6: Write `src/analysis/intel.ts`**

```typescript
// apps/meta-agent/src/analysis/intel.ts
import { Effect } from "effect";
import type { EvidenceItem, IntelConfig, IntelDeps } from "./types.js";
import { normalizeReleases } from "./github-releases.js";
import { assignConfidence } from "./confidence.js";

const fetchJson = (fetchImpl: typeof fetch, url: string): Effect.Effect<unknown> =>
  Effect.tryPromise(() => fetchImpl(url).then((r) => r.json() as Promise<unknown>)).pipe(
    Effect.catchAll(() => Effect.succeed<unknown>(null)),
  );

/** Harvest recent releases across competitor repos, cross-reference for corroboration,
 *  assign confidence, and sort high→low. Resilient: a failing repo yields no items. */
export const gatherCompetitiveEvidence = (
  config: IntelConfig,
  deps: IntelDeps,
): Effect.Effect<EvidenceItem[]> =>
  Effect.gen(function* () {
    const raw = yield* Effect.all(
      config.repos.map((repo) =>
        fetchJson(
          deps.fetchImpl,
          `https://api.github.com/repos/${repo}/releases?per_page=${config.perRepo}`,
        ).pipe(Effect.map((json) => normalizeReleases(repo, json))),
      ),
      { concurrency: 4 },
    );
    const items = raw.flat();

    const perCompetitor = new Map<string, number>();
    for (const it of items) {
      perCompetitor.set(it.competitor, (perCompetitor.get(it.competitor) ?? 0) + 1);
    }

    const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
    return items
      .map((it) => {
        const recencyDays = (Date.now() - Date.parse(it.capturedAt)) / 86_400_000;
        const corroboration = (perCompetitor.get(it.competitor) ?? 1) - 1;
        const confidence = assignConfidence(
          Number.isFinite(recencyDays) ? recencyDays : 999,
          corroboration,
        );
        return { ...it, confidence };
      })
      .sort((a, b) => rank[b.confidence]! - rank[a.confidence]!);
  });
```

- [ ] **Step 7: Run the test — confirm GREEN.**

- [ ] **Step 8: Write `src/tools/competitive-intel.ts`** (mirror `community-monitor.ts` structure)

```typescript
// apps/meta-agent/src/tools/competitive-intel.ts
import { Effect } from "effect";
import type { ToolDefinition } from "reactive-agents/tools";
import { gatherCompetitiveEvidence } from "../analysis/intel.js";

export const competitiveIntelTool: ToolDefinition = {
  name: "competitive-intel",
  description:
    "Harvest recent competitor activity (GitHub releases) as cited evidence with confidence " +
    "levels. Returns real source URLs you MUST cite in scorecards — never invent evidence links.",
  parameters: [
    { name: "repos", type: "array", description: "owner/repo list to check. Defaults to known competitors.", required: false },
  ],
  returnType: "{ evidence: Array<{ id, competitor, source, summary, url, capturedAt, confidence }>, instruction: string }",
  category: "search",
  riskLevel: "low",
  timeoutMs: 20_000,
  requiresApproval: false,
  source: "function",
};

const DEFAULT_REPOS = [
  "langchain-ai/langchainjs",
  "langchain-ai/langgraphjs",
  "mastra-ai/mastra",
  "VoltAgent/voltagent",
  "crewAIInc/crewAI",
];

export const competitiveIntelHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown> => {
  const repos = (args.repos as string[] | undefined) ?? DEFAULT_REPOS;
  return gatherCompetitiveEvidence(
    { repos, perRepo: 5 },
    { fetchImpl: globalThis.fetch },
  ).pipe(
    Effect.map((evidence) => ({
      evidence,
      instruction:
        "Cite ONLY these urls as evidence in the scorecard, with the given confidence level. " +
        "If a claim has no evidence item here, mark it 'unverified' rather than inventing a link.",
    })),
  );
};
```

- [ ] **Step 9: Anti-pattern gate + commit**

```bash
grep -rnE "\b(let|await)\b|throw new|as any" apps/meta-agent/src/analysis apps/meta-agent/src/tools/competitive-intel.ts
grep -rn "^interface " apps/meta-agent/src/analysis
bun test ./apps/meta-agent/tests/analysis.test.ts --timeout 15000
git add apps/meta-agent/src/analysis apps/meta-agent/src/tools/competitive-intel.ts apps/meta-agent/tests/analysis.test.ts
git commit -m "feat(meta-agent): add competitive evidence harvesting (analysis engine)"
```

---

## Task 2: Draft Grounding / Quality Gate (`src/grounding`)

Before any draft is saved, verify its URLs resolve and score its astroturf risk. Block on dead links or blatant self-promotion; return issues so the agent revises.

**Files:**
- Create: `apps/meta-agent/src/grounding/types.ts`
- Create: `apps/meta-agent/src/grounding/links.ts`
- Create: `apps/meta-agent/src/grounding/astroturf.ts`
- Create: `apps/meta-agent/src/grounding/grade.ts`
- Modify: `apps/meta-agent/src/tools/draft-writer.ts` (run the gate before writing)
- Test: `apps/meta-agent/tests/grounding.test.ts`

- [ ] **Step 1: Write `src/grounding/types.ts`**

```typescript
// apps/meta-agent/src/grounding/types.ts
export type DraftGrade = {
  readonly pass: boolean;
  readonly issues: readonly string[];
  readonly deadLinks: readonly string[];
};
export type GradeDeps = { readonly fetchImpl: typeof fetch };
```

- [ ] **Step 2: Write the failing test**

```typescript
// apps/meta-agent/tests/grounding.test.ts
// Run: bun test ./apps/meta-agent/tests/grounding.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { extractUrls } from "../src/grounding/links.js";
import { astroturfIssues } from "../src/grounding/astroturf.js";
import { gradeDraft } from "../src/grounding/grade.js";

describe("extractUrls", () => {
  it("pulls http(s) urls from markdown", () => {
    const urls = extractUrls("see [x](https://a.com/p) and https://b.org/q done");
    expect(urls).toContain("https://a.com/p");
    expect(urls).toContain("https://b.org/q");
  });
});

describe("astroturfIssues", () => {
  it("flags banned promo phrases", () => {
    const issues = astroturfIssues("You should use reactive-agents, it's a game-changer!");
    expect(issues.length).toBeGreaterThan(0);
  });
  it("passes a value-first reply with one contextual mention", () => {
    const text = "Your loop never terminates because the arbitrator isn't the only exit path. " +
      "Add a single termination owner. (reactive-agents handles this with a terminate helper, fwiw.)";
    expect(astroturfIssues(text)).toHaveLength(0);
  });
});

describe("gradeDraft", () => {
  it("fails on a dead link", async () => {
    const fetchImpl = (() => Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;
    const grade = await Effect.runPromise(
      gradeDraft("Helpful context here. See https://dead.example/x for more.", { fetchImpl }),
    );
    expect(grade.pass).toBe(false);
    expect(grade.deadLinks).toContain("https://dead.example/x");
  });

  it("passes a grounded, value-first draft with a live link", async () => {
    const fetchImpl = (() => Promise.resolve(new Response("", { status: 200 }))) as typeof fetch;
    const text = "The issue is your tool calls aren't deduped across heartbeats. Persist seen ids. " +
      "Background: https://example.com/post explains the pattern well.";
    const grade = await Effect.runPromise(gradeDraft(text, { fetchImpl }));
    expect(grade.pass).toBe(true);
    expect(grade.issues).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run it — confirm RED.**

- [ ] **Step 4: Write `src/grounding/links.ts`**

```typescript
// apps/meta-agent/src/grounding/links.ts
import { Effect } from "effect";

const URL_RE = /https?:\/\/[^\s)\]>"']+/g;

export const extractUrls = (text: string): string[] => {
  const matches = text.match(URL_RE);
  return matches === null ? [] : [...new Set(matches)];
};

/** Returns the subset of urls that do NOT resolve (network error or status >= 400). */
export const findDeadLinks = (
  urls: readonly string[],
  fetchImpl: typeof fetch,
): Effect.Effect<string[]> =>
  Effect.all(
    urls.map((u) =>
      Effect.tryPromise(() => fetchImpl(u).then((r) => r.status < 400))
        .pipe(Effect.catchAll(() => Effect.succeed(false)))
        .pipe(Effect.map((ok) => ({ u, ok }))),
    ),
    { concurrency: 4 },
  ).pipe(Effect.map((rs) => rs.filter((r) => !r.ok).map((r) => r.u)));
```

- [ ] **Step 5: Write `src/grounding/astroturf.ts`**

```typescript
// apps/meta-agent/src/grounding/astroturf.ts
const BANNED = [
  "you should use reactive-agents",
  "check out reactive-agents",
  "game-changer",
  "game changer",
  "revolutionary",
  "best framework",
  "must-try",
];

/** Heuristic anti-astroturf checks. Empty array = clean. */
export const astroturfIssues = (text: string): string[] => {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length > 0).length;
  const issues: string[] = [];

  for (const phrase of BANNED) {
    if (lower.includes(phrase)) issues.push(`banned promotional phrase: "${phrase}"`);
  }

  const mentions = (lower.match(/reactive-agents/g) ?? []).length;
  if (words > 0 && mentions / words > 0.05) issues.push("over-promotional: too many self-mentions");

  const firstMention = lower.indexOf("reactive-agents");
  if (firstMention >= 0 && firstMention < 60) issues.push("leads with promotion (mention before value)");

  return issues;
};
```

- [ ] **Step 6: Write `src/grounding/grade.ts`**

```typescript
// apps/meta-agent/src/grounding/grade.ts
import { Effect } from "effect";
import type { DraftGrade, GradeDeps } from "./types.js";
import { extractUrls, findDeadLinks } from "./links.js";
import { astroturfIssues } from "./astroturf.js";

const MIN_LEN = 80;

export const gradeDraft = (
  draft: string,
  deps: GradeDeps,
): Effect.Effect<DraftGrade> =>
  Effect.gen(function* () {
    const deadLinks = yield* findDeadLinks(extractUrls(draft), deps.fetchImpl);
    const issues = [
      ...astroturfIssues(draft),
      ...(draft.trim().length < MIN_LEN ? ["draft too short to add real value"] : []),
      ...(deadLinks.length > 0 ? [`${deadLinks.length} dead link(s)`] : []),
    ];
    return { pass: issues.length === 0, issues, deadLinks };
  });
```

- [ ] **Step 7: Run the test — confirm GREEN.**

- [ ] **Step 8: Wire the gate into `src/tools/draft-writer.ts`**

Replace the `draftWriterHandler` body so it grades before writing. Keep the existing `draftWriterTool` definition and the frontmatter/file-writing logic, but (a) convert the handler to `Effect.gen`, (b) run `gradeDraft` on `content` first, (c) if `!grade.pass`, return `{ saved: false, issues, deadLinks, message }` WITHOUT writing, (d) if pass, write as before and include `quality: pass` in frontmatter.

```typescript
// apps/meta-agent/src/tools/draft-writer.ts — new handler (imports added at top)
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import type { ToolDefinition } from "reactive-agents/tools";
import { gradeDraft } from "../grounding/grade.js";

const DRAFTS_DIR = join(import.meta.dirname, "../../drafts");

// ... keep draftWriterTool definition unchanged ...

export const draftWriterHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown> =>
  Effect.gen(function* () {
    const type = args.type as string;
    const title = args.title as string;
    const content = args.content as string;
    const platform = args.platform as string | undefined;
    const threadUrl = args.threadUrl as string | undefined;
    const context = args.context as string | undefined;

    const grade = yield* gradeDraft(content, { fetchImpl: globalThis.fetch });
    if (!grade.pass) {
      return {
        saved: false,
        issues: grade.issues,
        deadLinks: grade.deadLinks,
        message:
          "Draft NOT saved — quality gate failed. Revise to fix these issues (lead with value, " +
          "remove dead links/promo) and call draft-writer again.",
      };
    }

    return yield* Effect.try({
      try: () => {
        mkdirSync(DRAFTS_DIR, { recursive: true });
        const timestamp = new Date().toISOString().split("T")[0];
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
        const filename = `${timestamp}-${type}-${slug}.md`;
        const filepath = join(DRAFTS_DIR, filename);
        const frontmatter = [
          "---",
          `type: ${type}`,
          `title: "${title.replace(/"/g, '\\"')}"`,
          platform ? `platform: ${platform}` : null,
          threadUrl ? `thread_url: ${threadUrl}` : null,
          `created: ${new Date().toISOString()}`,
          `quality: pass`,
          `status: draft`,
          "---",
          "",
        ].filter((l): l is string => l !== null).join("\n");
        const body = [
          context ? `> **Context:** ${context}\n` : null,
          threadUrl ? `> **Thread:** ${threadUrl}\n` : null,
          content,
        ].filter((l): l is string => l !== null).join("\n");
        writeFileSync(filepath, frontmatter + body, "utf-8");
        return { saved: true, path: filepath, filename, message: `Draft saved to drafts/${filename}. Review and post manually.` };
      },
      catch: (e) => new Error(String(e)),
    }).pipe(Effect.catchAll((e) => Effect.succeed({ saved: false, error: e.message })));
  });
```

- [ ] **Step 9: Anti-pattern gate + commit**

```bash
grep -rnE "\b(let|await)\b|throw new|as any" apps/meta-agent/src/grounding apps/meta-agent/src/tools/draft-writer.ts
bun test ./apps/meta-agent/tests/grounding.test.ts --timeout 15000
git add apps/meta-agent/src/grounding apps/meta-agent/src/tools/draft-writer.ts apps/meta-agent/tests/grounding.test.ts
git commit -m "feat(meta-agent): add draft grounding + anti-astroturf quality gate"
```

---

## Task 3: Register new tools + Cortex visibility (`src/index.ts`)

Serial — edits `index.ts`. Do after Tasks 1 & 2.

**Files:**
- Modify: `apps/meta-agent/src/index.ts`
- Modify: `apps/meta-agent/README.md` (document `CORTEX_URL`)

- [ ] **Step 1: Register the `competitive-intel` tool.** In `index.ts`, add the import and add it to the `.withTools({ tools: [...] })` array next to `community-monitor` and `draft-writer`:

```typescript
import { competitiveIntelTool, competitiveIntelHandler } from "./tools/competitive-intel.js";
// ...
  .withTools({
    tools: [
      { definition: communityMonitorTool, handler: communityMonitorHandler },
      { definition: draftWriterTool, handler: draftWriterHandler },
      { definition: competitiveIntelTool, handler: competitiveIntelHandler },
    ],
  })
```

- [ ] **Step 2: Update the scorecard crons to use the evidence tool.** In the hourly + 12h sweep cron instructions, append: `"Use competitive-intel to fetch cited release evidence; cite ONLY those urls with their confidence levels."`

- [ ] **Step 3: Wire Cortex conditionally.** After the gateway builder chain (before `.build()` selection), add Cortex only when `CORTEX_URL` is set, so deployed instances without a studio don't log connection noise:

```typescript
const cortexUrl = process.env.CORTEX_URL?.trim();
// ... in the builder chain, after .withReasoning(...):
  // Cortex live studio — opt-in via CORTEX_URL (the self-referential demo surface)
```
Apply as: `const agentBuilder = (cortexUrl ? baseBuilder.withCortex(cortexUrl) : baseBuilder)` — i.e. split the current `const agentBuilder = ReactiveAgents.create()...` chain so the `.withCortex` is conditionally appended. Keep all existing `.withX` calls.

- [ ] **Step 4: Validate config builds**

```bash
cd apps/meta-agent && env OLLAMA_ENDPOINT= ANTHROPIC_API_KEY= bun run src/index.ts --dry-run 2>&1 | tail -6
```
Expected: `✅ Config valid.` and no deprecation warnings.

- [ ] **Step 5: Document `CORTEX_URL` in `README.md`** under Setup (one line: `CORTEX_URL=ws://localhost:4000 enables live Cortex studio streaming`).

- [ ] **Step 6: Commit**

```bash
git add apps/meta-agent/src/index.ts apps/meta-agent/README.md
git commit -m "feat(meta-agent): register competitive-intel tool + opt-in Cortex visibility"
```

---

## Task 4: Production Hardening (`src/index.ts`)

Serial — edits `index.ts` after Task 3.

**Files:**
- Modify: `apps/meta-agent/src/index.ts`

- [ ] **Step 1: Use context-window-aware model config for local provider.** Replace the string `.withModel(model)` call with a conditional that passes `{ model, numCtx }` for ollama (local models need an explicit window) and the string form otherwise:

```typescript
// where the builder sets the model:
  .withModel(provider === "ollama" ? { model, numCtx: 12_000 } : model)
```

- [ ] **Step 2: Add runtime resilience.** Add `.withTimeout(120_000)` and `.withRetryPolicy({ maxRetries: 2 })` to the builder chain (verify exact method names against `packages/runtime/src/builder.ts` first; if a method differs, use the documented equivalent). These bound hung heartbeats and transient provider errors.

- [ ] **Step 3: Confirm budgets present.** Verify the gateway `policies` block still sets `dailyTokenBudget` and `maxActionsPerHour` (already present) — leave as is.

- [ ] **Step 4: Validate**

```bash
cd apps/meta-agent && env OLLAMA_ENDPOINT= ANTHROPIC_API_KEY= bun run src/index.ts --dry-run 2>&1 | tail -6
```
Expected: `✅ Config valid.`

- [ ] **Step 5: Commit**

```bash
git add apps/meta-agent/src/index.ts
git commit -m "feat(meta-agent): production hardening (local ctx window, timeout, retry)"
```

---

## Task 5: Growth Compose-Harness — robust custom logic (`src/harness`)

User requirement (2026-06-04): use the **Compose API** to build robust custom control into the agent. Two pieces: (a) a reusable `.withHarness` module of custom tag-handlers (hard invariants + observability), (b) `.compose(killswitch(...))` safety bounds wired in `index.ts` (folded into Task 3). New dir `src/harness` is parallel-safe.

**Compose API facts (verified against this repo):**
- `.withHarness((h: Harness) => void)` registers tag handlers; multiple calls compose additively.
- `h.on(tag, fn)` = transform (returns new payload); `h.tap(tag, fn)` = side-effect observer.
- LIVE tags (v0.11+): `prompt.system` (payload `string`), `message.tool-result`, `lifecycle.failure` (payload `{ reason, attemptNumber, failureStreak, ... }`), `nudge.loop-detected`. `ctx` has `.iteration`.
- Killswitches are `(harness)=>void` factories from `@reactive-agents/compose`: `budgetLimit({maxTokens,maxCostUSD,onTrigger})`, `timeoutAfter({wallClock,onTrigger})`, `maxIterations(n|{max,onTrigger})`, `watchdog({noProgressFor,onTrigger})`, `requireApprovalFor({...})`. Applied via `.compose(budgetLimit({...}))`.
- `Harness` type: `import type { Harness } from "reactive-agents/core"`.

**Files:**
- Modify: `apps/meta-agent/package.json` (add `@reactive-agents/compose` dep)
- Create: `apps/meta-agent/src/harness/growth-harness.ts`
- Test: `apps/meta-agent/tests/harness.test.ts`

- [ ] **Step 1: Add the compose dep.** In `apps/meta-agent/package.json` `dependencies`, add `"@reactive-agents/compose": "workspace:*"` next to `"reactive-agents"`. Then `bun install` from repo root.

- [ ] **Step 2: Write the failing test `tests/harness.test.ts`**

```typescript
// apps/meta-agent/tests/harness.test.ts
// Run: bun test ./apps/meta-agent/tests/harness.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import type { Harness } from "reactive-agents/core";
import { growthInvariants, growthObservability } from "../src/harness/growth-harness.js";

type Reg = { tag: string; fn: (...a: unknown[]) => unknown };
const mockHarness = () => {
  const regs: Reg[] = [];
  const h = {
    on: (tag: string, fn: (...a: unknown[]) => unknown) => { regs.push({ tag, fn }); return h; },
    tap: (tag: string, fn: (...a: unknown[]) => unknown) => { regs.push({ tag, fn }); return h; },
    before: () => h, after: () => h, emit: () => {}, use: () => h,
  };
  return { h: h as unknown as Harness, regs };
};

describe("growthInvariants", () => {
  it("prepends invariants to the system prompt and preserves the original", () => {
    const { h, regs } = mockHarness();
    growthInvariants(h);
    const reg = regs.find((r) => r.tag === "prompt.system")!;
    const out = reg.fn("ORIGINAL_PROMPT", { iteration: 1 }) as string;
    expect(out).toContain("INVARIANTS");
    expect(out).toContain("ORIGINAL_PROMPT");
    expect(out.indexOf("INVARIANTS")).toBeLessThan(out.indexOf("ORIGINAL_PROMPT"));
  });
});

describe("growthObservability", () => {
  it("taps tool-result, failure, and loop tags and logs tool name", () => {
    const { h, regs } = mockHarness();
    const logs: string[] = [];
    growthObservability((s) => logs.push(s))(h);
    const tags = regs.map((r) => r.tag);
    expect(tags).toContain("message.tool-result");
    expect(tags).toContain("lifecycle.failure");
    expect(tags).toContain("nudge.loop-detected");
    regs.find((r) => r.tag === "message.tool-result")!.fn({ toolName: "community-monitor" }, { iteration: 2 });
    expect(logs.some((l) => l.includes("community-monitor"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run it — confirm RED.**

- [ ] **Step 4: Write `src/harness/growth-harness.ts`**

```typescript
// apps/meta-agent/src/harness/growth-harness.ts
import type { Harness } from "reactive-agents/core";

const INVARIANTS = [
  "GROWTH-AGENT INVARIANTS (non-negotiable):",
  "1. NEVER claim to have posted anything — you only save drafts for human review.",
  "2. Lead with genuine value; mention reactive-agents only when it truly helps the person.",
  "3. In competitive scorecards, cite ONLY evidence urls returned by competitive-intel, each with its confidence level. Never invent links.",
  "4. Skip any thread where mentioning the framework would be spammy.",
  "",
].join("\n");

/** Hard guardrails injected into the system prompt every iteration (persona-independent,
 *  so other context can't dilute them). Uses the live `prompt.system` transform chokepoint. */
export const growthInvariants = (h: Harness): void => {
  h.on("prompt.system", (system) => INVARIANTS + (system ?? ""));
};

/** Observability taps for the Cortex demo + debugging. Defaults to console logging. */
export const growthObservability =
  (log: (s: string) => void = (s) => console.log(s)) =>
  (h: Harness): void => {
    h.tap("message.tool-result", (msg, ctx) => {
      const name = (msg as Record<string, unknown>)["toolName"] ?? "unknown";
      log(`[meta-agent] tool-result ${String(name)} iter=${ctx.iteration}`);
    });
    h.tap("lifecycle.failure", (payload, ctx) => {
      log(`[meta-agent] failure reason=${payload.reason} streak=${payload.failureStreak} iter=${ctx.iteration}`);
    });
    h.tap("nudge.loop-detected", (_nudge, ctx) => {
      log(`[meta-agent] loop-detected iter=${ctx.iteration}`);
    });
  };
```

- [ ] **Step 5: Run the test — confirm GREEN.**

- [ ] **Step 6: Verify + commit**

```bash
grep -rnE "\b(let|await)\b|throw new|as any" apps/meta-agent/src/harness   # must be empty
bun test ./apps/meta-agent/tests/harness.test.ts --timeout 15000
git add apps/meta-agent/src/harness apps/meta-agent/tests/harness.test.ts apps/meta-agent/package.json
git commit -m "feat(meta-agent): add growth compose-harness (invariants + observability)"
```

---

## Task 3 AMENDMENT — wire Compose API into `index.ts`

In addition to registering `competitive-intel` and Cortex (original Task 3 steps), the integration must apply the Compose API. Add to the builder chain in `index.ts`:

```typescript
import { budgetLimit, timeoutAfter, maxIterations, watchdog } from "@reactive-agents/compose";
import { growthInvariants, growthObservability } from "./harness/growth-harness.js";
// ... in the builder chain (after .withReasoning(...), before .withGateway(...)):
  // Compose API — robust custom control:
  // hard invariants + observability taps via .withHarness, safety bounds via killswitches.
  .withHarness(growthInvariants)
  .withHarness(growthObservability())
  .compose(maxIterations({ max: 20, onTrigger: "stop" }))
  .compose(budgetLimit({ maxTokens: 60_000, onTrigger: "stop" }))
  .compose(timeoutAfter({ wallClock: "5m", onTrigger: "stop" }))
  .compose(watchdog({ noProgressFor: "90s", onTrigger: "stop" }))
```

Then re-run the dry-run gate (`✅ Config valid.`, no deprecation warnings) before committing.

---

## Self-Review Notes

- **Spec coverage:** Task 1 = analysis engine (#1); Task 2 = grounding/quality gate (#2); Task 3 = Cortex visibility (#3) + tool registration; Task 4 = production hardening (#4). All four increments covered.
- **Type consistency:** `EvidenceItem`/`Confidence` defined in Task 1 `types.ts`, consumed by `intel.ts` + the tool. `DraftGrade`/`GradeDeps` defined in Task 2 `types.ts`, consumed by `grade.ts` + `draft-writer`. `gradeDraft(draft, deps)` signature identical across test + impl + caller. `gatherCompetitiveEvidence(config, deps)` identical across test + impl + tool.
- **Open verification for executor:** Task 4 Step 2 — `.withTimeout` / `.withRetryPolicy` names must be confirmed against the current builder before use (the builder grep in this session showed `withMaxIterations`, `withModel`, etc.; confirm these two exist or substitute the documented hardening methods).
