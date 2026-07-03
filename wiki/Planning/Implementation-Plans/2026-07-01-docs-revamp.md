# Docs Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Astro/Starlight docs site with a cleaner IA, unified badge system, GitHub star CTA, expanded Umami tracking, Starlight plugin additions, and a code accuracy audit.

**Architecture:** Seven sequential tasks against `apps/docs/`. Each task produces an independently buildable, deployable state — never leaves the site in a broken build. The badge system replaces the JS-runtime new-page-indicator with a build-time frontmatter pipeline. All tracking additions land in the existing `umami-deep.js` file with no new script tags.

**Tech Stack:** Astro 6.1.2, @astrojs/starlight 0.38.2, Bun, gray-matter, TypeScript, Umami analytics.

## Global Constraints

- All commands run from `apps/docs/` unless specified otherwise
- Build command: `bun run build` — must pass before every commit
- Dev server: `bun run dev` — use for visual verification
- Never add `any` casts to TypeScript files
- Never commit `node_modules/`, `dist/`, or `.astro/` cache
- Plan location override: `wiki/Planning/Implementation-Plans/` not `docs/superpowers/plans/`
- Spec: `wiki/Architecture/Design-Specs/2026-07-01-docs-revamp-design.md`

---

## File Map

| File | Action | Task |
|------|--------|------|
| `astro.config.mjs` | Modify — sidebar IA, remove plugin, add scroll-to-top | 1, 6 |
| `src/content.config.ts` | Modify — add stability/since/lastCommit schema fields | 2 |
| `scripts/sync-page-metadata.ts` | Create — build-time badge + lastCommit frontmatter writer | 2 |
| `package.json` | Modify — prebuild hook, add starlight-scroll-to-top | 2, 6 |
| `src/components/PageTitle.astro` | Modify — replace old indicator JS with lastCommit callout | 3 |
| `src/styles/custom.css` | Modify — callout styles, star CTA styles, numbered steps | 3, 4, 6 |
| `public/new-page-indicator.js` | Delete — replaced by build script | 3 |
| `src/plugins/new-page-indicator.ts` | Delete — replaced by build script | 3 |
| `scripts/fetch-github-stats.ts` | Create — fetch star count from GitHub API at build time | 4 |
| `src/data/github-stats.json` | Create (generated) — star count output | 4 |
| `src/components/PageSidebar.astro` | Modify — add star CTA widget | 4 |
| `src/content/docs/index.mdx` | Modify — add star button to hero | 4 |
| `public/umami-deep.js` | Modify — 8 new event trackers | 5 |
| `src/styles/custom.css` | Modify — numbered steps counter CSS | 6 |

---

## Task 1: IA Restructure

**Files:**
- Modify: `apps/docs/astro.config.mjs` — replace `sidebar` array

**Interfaces:**
- Produces: new sidebar navigation consumed by all subsequent tasks

- [ ] **Step 1: Replace the `sidebar` array in `astro.config.mjs`**

Replace the entire `sidebar:` block inside the `starlight({})` call with:

```js
sidebar: [
  {
    label: "Get Started",
    items: [
      { label: "Introduction", link: "guides/introduction/" },
      { label: "Build AI Agents in TypeScript", link: "guides/build-ai-agents-typescript/" },
      { label: "Installation", link: "guides/installation/" },
      { label: "Quickstart", link: "guides/quickstart/" },
      { label: "Your First Agent", link: "guides/your-first-agent/" },
      { label: "Choosing a Stack", link: "guides/choosing-a-stack/" },
    ],
  },
  {
    label: "Build",
    items: [
      { label: "Reasoning Strategies", link: "guides/reasoning/" },
      { label: "Choosing a Strategy", link: "guides/choosing-strategies/" },
      { label: "Tools", link: "guides/tools/" },
      { label: "Memory", link: "guides/memory/" },
      {
        label: "Typed Structured Output",
        link: "guides/structured-output/",
        badge: { text: "New in v0.12", variant: "success" },
      },
      { label: "Streaming Responses", link: "features/streaming/" },
      { label: "Chat & Sessions", link: "cookbook/chat-and-sessions/" },
      { label: "Lifecycle Hooks", link: "guides/hooks/" },
      { label: "Interaction Modes", link: "guides/interaction-modes/" },
      { label: "Context Engineering", link: "guides/context-engineering/" },
      { label: "Sub-Agents", link: "guides/sub-agents/" },
      { label: "Agent Skills", link: "guides/agent-skills/" },
      { label: "Local Models", link: "guides/local-models/" },
      { label: "Messaging Channels", link: "guides/messaging-channels/" },
      { label: "Web Integration", link: "guides/web-integration/" },
    ],
  },
  {
    label: "Ship to Production",
    items: [
      { label: "Production Checklist", link: "guides/production-checklist/" },
      {
        label: "Durable Execution",
        link: "guides/durable-execution/",
        badge: { text: "New in v0.12", variant: "success" },
      },
      {
        label: "Durable Human-in-the-Loop",
        link: "guides/durable-hitl/",
        badge: { text: "New in v0.12", variant: "success" },
      },
      { label: "Cost Optimization", link: "guides/cost-optimization/" },
      { label: "Guardrails", link: "guides/guardrails/" },
      { label: "Security Hardening", link: "guides/security-hardening/" },
    ],
  },
  {
    label: "How It Works",
    collapsed: true,
    items: [
      { label: "Architecture", link: "concepts/architecture/" },
      { label: "Agent Lifecycle", link: "concepts/agent-lifecycle/" },
      { label: "Composable Kernel", link: "concepts/composable-kernel/" },
      { label: "Layer System", link: "concepts/layer-system/" },
      { label: "Decision Tracing", link: "concepts/decision-tracing/" },
      { label: "Effect-TS", link: "concepts/effect-ts/" },
      { label: "Reactive Intelligence", link: "features/reactive-intelligence/" },
      { label: "Harness Control Flow", link: "features/harness-control-flow/" },
      { label: "Context Synthesis", link: "features/intelligent-context-synthesis/" },
      { label: "Resilience", link: "features/resilience/" },
      { label: "Verification", link: "features/verification/" },
      { label: "Observability", link: "features/observability/" },
      { label: "A2A Protocol", link: "features/a2a-protocol/" },
      { label: "Benchmarks", link: "features/benchmarks/" },
      { label: "Code Action", link: "features/code-action/" },
      { label: "Cortex Studio", link: "features/cortex/" },
      { label: "Cost Tracking", link: "features/cost-tracking/" },
      { label: "Create Reactive Agent", link: "features/create-reactive-agent/" },
      { label: "Debrief Chat", link: "features/debrief-chat/" },
      { label: "Evaluation", link: "features/eval/" },
      { label: "Gateway", link: "features/gateway/" },
      { label: "Identity", link: "features/identity/" },
      { label: "LLM Providers", link: "features/llm-providers/" },
      { label: "Local Model Performance", link: "features/local-model-performance/" },
      { label: "Observe (OTel)", link: "features/observe/" },
      { label: "Orchestration", link: "features/orchestration/" },
      { label: "Prompts", link: "features/prompts/" },
      { label: "Snapshot & Replay", link: "features/snapshot-replay/" },
    ],
  },
  {
    label: "vs. Alternatives",
    collapsed: true,
    items: [
      { label: "Migrating from LangChain", link: "guides/migrating-from-langchain/" },
      { label: "vs. LangGraph", link: "guides/reactive-agents-vs-langgraph/" },
      { label: "vs. Mastra", link: "guides/reactive-agents-vs-mastra/" },
      { label: "vs. Vercel AI SDK", link: "guides/reactive-agents-vs-vercel-ai-sdk/" },
      { label: "vs. Agent SDKs (OpenAI/Claude)", link: "guides/reactive-agents-vs-agent-sdks/" },
    ],
  },
  {
    label: "Cookbook",
    collapsed: true,
    autogenerate: { directory: "cookbook" },
  },
  {
    label: "API Reference",
    collapsed: true,
    autogenerate: { directory: "reference" },
  },
  {
    label: "Rax CLI",
    items: [
      { label: "Meet Rax CLI", link: "guides/cli-artisan/" },
      { label: "Command Reference", link: "reference/cli/" },
    ],
  },
  {
    label: "Help & More",
    items: [
      { label: "FAQ", link: "guides/faq/" },
      { label: "Troubleshooting", link: "guides/troubleshooting/" },
      { label: "Examples Catalog", link: "guides/examples/" },
      { label: "Interactive Playground", link: "guides/playground/" },
      {
        label: "What's New",
        link: "guides/whats-new/",
        badge: { text: "v0.12", variant: "success" },
      },
      { label: "Contributing", link: "guides/contributing/" },
    ],
  },
],
```

- [ ] **Step 2: Verify build passes**

```bash
bun run build
```

Expected: build completes with no broken-link errors from `starlightLinksValidator`. If any links fail, fix them (likely a path that changed during the reorganization).

- [ ] **Step 3: Visual spot-check in dev server**

```bash
bun run dev
```

Open `http://localhost:4321`. Verify:
- "Get Started" section at top
- "Build" section has ~15 items
- "How It Works" is collapsed by default
- "vs. Alternatives" is collapsed by default
- No "Features" or "Concepts" sections remain at top level

- [ ] **Step 4: Commit**

```bash
git add apps/docs/astro.config.mjs
git commit -m "docs(ia): restructure sidebar — Build/Ship/HowItWorks/vsAlternatives"
```

---

## Task 2: Content Schema + Badge Build Script

**Files:**
- Modify: `apps/docs/src/content.config.ts`
- Create: `apps/docs/scripts/sync-page-metadata.ts`
- Modify: `apps/docs/package.json`

**Interfaces:**
- Produces:
  - `entry.data.stability: "stable" | "unstable" | "experimental" | "deprecated" | undefined`
  - `entry.data.since: string | undefined` — e.g. `"v0.12"`
  - `entry.data.lastCommit: { subject: string; hash: string; date: string; daysAgo: number } | undefined`
  - `badge:` frontmatter on pages that qualify (written by build script)

- [ ] **Step 1: Extend the docs schema in `content.config.ts`**

Replace the `extend:` block:

```typescript
schema: docsSchema({
  extend: z.object({
    // Legacy new-page fields — kept for backward compat, replaced by badge system
    isNew: z.boolean().optional(),
    newUntil: z.string().optional(),
    // Badge system fields (written by scripts/sync-page-metadata.ts)
    stability: z.enum(["stable", "unstable", "experimental", "deprecated"]).optional(),
    since: z.string().optional(),
    lastCommit: z
      .object({
        subject: z.string(),
        hash: z.string(),
        date: z.string(),
        daysAgo: z.number(),
      })
      .optional(),
    // Curated Q&A -> Schema.org FAQPage JSON-LD
    faq: z
      .array(z.object({ q: z.string(), a: z.string() }))
      .optional(),
  }),
}),
```

- [ ] **Step 2: Create `apps/docs/scripts/sync-page-metadata.ts`**

```typescript
#!/usr/bin/env bun
/**
 * sync-page-metadata.ts
 *
 * Runs as prebuild. For each .md/.mdx under src/content/docs/:
 *   1. Gets last git commit info (subject, hash, date)
 *   2. Computes days since last change and since first commit
 *   3. Attempts to backfill `since:` from nearest git version tag
 *   4. Sets `badge:` frontmatter based on stability/age rules
 *   5. Sets `lastCommit:` for the "what changed" callout
 *
 * Never overwrites a manually-set `badge:` field.
 * Pass --dry-run to log changes without writing.
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join, relative } from "path";
import matter from "gray-matter";

const DRY_RUN = process.argv.includes("--dry-run");
const DOCS_DIR = join(import.meta.dir, "../src/content/docs");
const REPO_ROOT = join(import.meta.dir, "../../../..");
const NEW_THRESHOLD_DAYS = 14;
const UPDATED_THRESHOLD_DAYS = 7;

// Files whose badge is always set manually — never auto-override
const MANUAL_BADGE_SENTINEL = "__manual__";

interface CommitInfo {
  subject: string;
  hash: string;
  date: string;
}

function git(cmd: string): string {
  try {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function getLastCommit(filePath: string): CommitInfo | null {
  const relPath = relative(REPO_ROOT, filePath);
  const out = git(`git log --follow -1 --pretty="%s|%H|%ad" --date=short -- "${relPath}"`);
  if (!out) return null;
  const [subject, hash, date] = out.split("|");
  if (!subject || !hash || !date) return null;
  return { subject: subject.trim(), hash: hash.trim(), date: date.trim() };
}

function getFirstCommitDate(filePath: string): string | null {
  const relPath = relative(REPO_ROOT, filePath);
  const out = git(`git log --follow --diff-filter=A --pretty="%ad" --date=short -- "${relPath}"`);
  // oldest entry is last line
  return out.split("\n").filter(Boolean).pop() ?? null;
}

function getNearestVersion(filePath: string): string | null {
  const relPath = relative(REPO_ROOT, filePath);
  const firstHash = git(
    `git log --follow --diff-filter=A --pretty="%H" -- "${relPath}"`
  )
    .split("\n")
    .filter(Boolean)
    .pop();
  if (!firstHash) return null;
  const tag = git(`git describe --tags --match "v*" --abbrev=0 "${firstHash}" 2>/dev/null`);
  if (!tag) return null;
  // v0.12.0 → v0.12
  return tag.replace(/\.\d+$/, "");
}

function daysSince(dateStr: string): number {
  const date = new Date(dateStr + "T00:00:00Z");
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function computeBadge(
  stability: string | undefined,
  firstCommitDate: string | null,
  lastCommitDate: string | null,
  since: string | null,
): { text: string; variant: string } | null {
  // Stability takes priority over age
  if (stability === "experimental") return { text: "Experimental", variant: "caution" };
  if (stability === "unstable") return { text: "Unstable", variant: "default" };
  if (stability === "deprecated") return { text: "Deprecated", variant: "danger" };

  const firstAgeDays = firstCommitDate ? daysSince(firstCommitDate) : null;
  const lastAgeDays = lastCommitDate ? daysSince(lastCommitDate) : null;

  if (firstAgeDays !== null && firstAgeDays <= NEW_THRESHOLD_DAYS) {
    const version = since ?? "";
    return { text: version ? `New in ${version}` : "New", variant: "success" };
  }

  if (lastAgeDays !== null && lastAgeDays <= UPDATED_THRESHOLD_DAYS) {
    return { text: "Updated", variant: "note" };
  }

  return null;
}

async function main() {
  const { glob } = await import("glob");
  const files = await glob("**/*.{md,mdx}", { cwd: DOCS_DIR, absolute: true });
  let changed = 0;

  for (const filePath of files) {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;

    // Skip splash/index pages — they never get auto-badges
    if (data.template === "splash") continue;

    // Respect manually-set badges
    const hasBadge = Boolean(data.badge);
    const isAutoGenBadge =
      hasBadge &&
      typeof data.badge === "object" &&
      (data.badge as Record<string, string>).__auto === "1";
    if (hasBadge && !isAutoGenBadge) continue;

    const lastCommit = getLastCommit(filePath);
    const firstDate = getFirstCommitDate(filePath);

    // Backfill `since` from git tags if missing
    let since = (data.since as string | undefined) ?? null;
    if (!since) {
      since = getNearestVersion(filePath);
    }

    const badge = computeBadge(
      data.stability as string | undefined,
      firstDate,
      lastCommit?.date ?? null,
      since,
    );

    const daysAgo = lastCommit ? daysSince(lastCommit.date) : null;

    const updates: Record<string, unknown> = {};

    if (badge) {
      updates.badge = { ...badge, __auto: "1" };
    } else if (isAutoGenBadge) {
      // Remove stale auto-badge
      updates.badge = undefined;
    }

    if (lastCommit && daysAgo !== null) {
      updates.lastCommit = {
        subject: lastCommit.subject,
        hash: lastCommit.hash.slice(0, 7),
        date: lastCommit.date,
        daysAgo,
      };
    }

    if (since && !data.since) {
      updates.since = since;
    }

    if (Object.keys(updates).length === 0) continue;

    const newData = { ...data };
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) {
        delete newData[k];
      } else {
        newData[k] = v;
      }
    }

    const newContent = matter.stringify(parsed.content, newData);

    if (DRY_RUN) {
      console.log(`[dry-run] ${relative(DOCS_DIR, filePath)}`);
      console.log("  updates:", JSON.stringify(updates, null, 2));
    } else {
      writeFileSync(filePath, newContent, "utf-8");
      changed++;
    }
  }

  console.log(DRY_RUN ? `[dry-run] ${files.length} files scanned` : `sync-page-metadata: updated ${changed}/${files.length} files`);
}

main().catch((err) => {
  console.error("sync-page-metadata failed:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Update `package.json` prebuild to include the new script**

In `apps/docs/package.json`, update `"prebuild"` and `"predev"` scripts:

```json
"predev": "bun run scripts/generate-metrics.ts && bun run scripts/sync-page-metadata.ts --dry-run",
"prebuild": "bun run scripts/generate-metrics.ts && bun run scripts/sync-page-metadata.ts",
```

- [ ] **Step 4: Dry-run the script to verify it scans without errors**

```bash
bun run scripts/sync-page-metadata.ts --dry-run
```

Expected: output lists files with computed badge/lastCommit updates. No stack traces.

- [ ] **Step 5: Run the script for real and spot-check two pages**

```bash
bun run scripts/sync-page-metadata.ts
```

Open `src/content/docs/guides/structured-output.mdx` — should now have `since: v0.12` and `badge: { text: "New in v0.12", variant: "success", __auto: "1" }` in frontmatter.

Open `src/content/docs/guides/introduction.mdx` — should have `lastCommit:` block, no badge (page is old).

- [ ] **Step 6: Build to verify schema accepts new fields**

```bash
bun run build
```

Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add apps/docs/src/content.config.ts apps/docs/scripts/sync-page-metadata.ts apps/docs/package.json
git add apps/docs/src/content/docs
git commit -m "docs(badges): unified badge system — sync-page-metadata replaces new-page-indicator"
```

---

## Task 3: Updated Callout Component (replace new-page-indicator)

**Files:**
- Modify: `apps/docs/src/components/PageTitle.astro` — replace old JS indicator with lastCommit callout
- Delete: `apps/docs/public/new-page-indicator.js`
- Delete: `apps/docs/src/plugins/new-page-indicator.ts`
- Modify: `apps/docs/astro.config.mjs` — remove new-page-indicator integration
- Modify: `apps/docs/src/styles/custom.css` — add callout styles

**Interfaces:**
- Consumes: `entry.data.lastCommit` from Task 2 schema
- Consumes: `entry.data.badge` from Task 2 build script

- [ ] **Step 1: Rewrite `src/components/PageTitle.astro`**

Replace entire file contents:

```astro
---
const route = Astro.locals.starlightRoute;
const data = route?.entry?.data ?? {};

const lastCommit = data.lastCommit as
  | { subject: string; hash: string; date: string; daysAgo: number }
  | undefined;

const badge = data.badge as
  | { text: string; variant: string; __auto?: string }
  | undefined;

// Show "what changed" callout only on Updated/New auto-badge pages
const showCallout =
  lastCommit &&
  badge?.__auto === "1" &&
  (badge.text.startsWith("New") || badge.text === "Updated");

const commitUrl = lastCommit
  ? `https://github.com/tylerjrbuell/reactive-agents-ts/commit/${lastCommit.hash}`
  : undefined;

const id = route?.entry?.id ?? "";
---

<h1 id="_top" class="ra-page-title" data-page-id={id}>
  {data.title}
</h1>

{showCallout && lastCommit && (
  <details class="ra-updated-callout">
    <summary>
      <span class="ra-updated-icon">↑</span>
      {lastCommit.daysAgo === 0
        ? "Updated today"
        : lastCommit.daysAgo === 1
        ? "Updated yesterday"
        : `Updated ${lastCommit.daysAgo} days ago`}
    </summary>
    <p class="ra-updated-detail">
      <span class="ra-updated-subject">"{lastCommit.subject}"</span>
      {" · "}
      <a href={commitUrl} target="_blank" rel="noopener" class="ra-updated-hash">
        {lastCommit.hash}
      </a>
      {" · "}
      <span class="ra-updated-date">{lastCommit.date}</span>
    </p>
  </details>
)}
```

- [ ] **Step 2: Add callout styles to `src/styles/custom.css`**

Append after existing styles:

```css
/* ── Updated callout (PageTitle.astro) ──────────────────────── */
.ra-updated-callout {
  margin: -0.5rem 0 1.25rem;
  border-left: 2px solid var(--sl-color-accent);
  padding: 0.35rem 0.75rem;
  border-radius: 0 4px 4px 0;
  background: color-mix(in srgb, var(--sl-color-accent) 6%, transparent);
  font-size: 0.8rem;
  color: var(--sl-color-gray-2);
}

.ra-updated-callout summary {
  cursor: pointer;
  user-select: none;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 500;
}

.ra-updated-callout summary::-webkit-details-marker { display: none; }

.ra-updated-icon {
  font-size: 0.7rem;
  color: var(--sl-color-accent);
}

.ra-updated-detail {
  margin: 0.35rem 0 0;
  color: var(--sl-color-gray-3);
  font-size: 0.75rem;
}

.ra-updated-subject { font-style: italic; }

.ra-updated-hash {
  font-family: var(--sl-font-mono, monospace);
  color: var(--sl-color-accent-high);
  text-decoration: none;
}
.ra-updated-hash:hover { text-decoration: underline; }
```

- [ ] **Step 3: Remove old new-page-indicator from `astro.config.mjs`**

Delete the import line:
```js
import { newPageIndicator } from "./src/plugins/new-page-indicator.ts";
```

Delete the plugin call in `integrations: [...]`:
```js
newPageIndicator({ withinDays: 14, maxAutoDetected: 10 }),
```

Delete the head script entry:
```js
{
  tag: "script",
  attrs: {
    defer: true,
    src: "/new-page-indicator.js",
  },
},
```

- [ ] **Step 4: Delete the old files**

```bash
rm apps/docs/public/new-page-indicator.js
rm apps/docs/src/plugins/new-page-indicator.ts
```

- [ ] **Step 5: Build to verify no broken references**

```bash
bun run build
```

Expected: clean build with no references to `new-page-indicator`.

- [ ] **Step 6: Visual check on a recently-updated page**

```bash
bun run dev
```

Navigate to a guide page that was updated recently (e.g., `guides/structured-output`). Verify the callout appears below the title and the commit hash links to GitHub.

Navigate to an older page (e.g., `guides/introduction`). Verify no callout appears.

- [ ] **Step 7: Commit**

```bash
git add apps/docs/src/components/PageTitle.astro
git add apps/docs/src/styles/custom.css
git add apps/docs/astro.config.mjs
git rm apps/docs/public/new-page-indicator.js
git rm apps/docs/src/plugins/new-page-indicator.ts
git commit -m "docs(badges): replace new-page-indicator with build-time lastCommit callout"
```

---

## Task 4: GitHub Stats + Star CTA

**Files:**
- Create: `apps/docs/scripts/fetch-github-stats.ts`
- Create: `apps/docs/src/data/github-stats.json` (generated, committed as fallback)
- Modify: `apps/docs/package.json` — add fetch-github-stats to prebuild
- Modify: `apps/docs/src/components/PageSidebar.astro` — star CTA widget
- Modify: `apps/docs/src/content/docs/index.mdx` — star button in hero
- Modify: `apps/docs/src/styles/custom.css` — star CTA styles

**Interfaces:**
- Produces: `src/data/github-stats.json` with `{ stars: number, fetchedAt: string }`
- Consumes: GitHub REST API `GET /repos/tylerjrbuell/reactive-agents-ts`

- [ ] **Step 1: Create `scripts/fetch-github-stats.ts`**

```typescript
#!/usr/bin/env bun
/**
 * fetch-github-stats.ts
 *
 * Fetches star count from GitHub API at build time.
 * Falls back gracefully if API is unavailable (no token, rate limit).
 * Writes src/data/github-stats.json.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT = join(import.meta.dir, "../src/data/github-stats.json");
const REPO = "tylerjrbuell/reactive-agents-ts";

async function fetchStats(): Promise<{ stars: number; fetchedAt: string }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${REPO}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);

  const json = (await res.json()) as { stargazers_count: number };
  return {
    stars: json.stargazers_count,
    fetchedAt: new Date().toISOString().slice(0, 10),
  };
}

async function main() {
  try {
    const stats = await fetchStats();
    writeFileSync(OUTPUT, JSON.stringify(stats, null, 2) + "\n");
    console.log(`fetch-github-stats: ${stats.stars} stars`);
  } catch (err) {
    // Graceful fallback — keep existing file if present, otherwise write default
    if (existsSync(OUTPUT)) {
      console.warn(`fetch-github-stats: API unavailable, keeping cached stats. (${err})`);
    } else {
      writeFileSync(OUTPUT, JSON.stringify({ stars: 0, fetchedAt: "unknown" }, null, 2) + "\n");
      console.warn(`fetch-github-stats: API unavailable, wrote fallback. (${err})`);
    }
  }
}

main();
```

- [ ] **Step 2: Create fallback `src/data/github-stats.json`**

```json
{
  "stars": 16,
  "fetchedAt": "2026-07-01"
}
```

- [ ] **Step 3: Add fetch script to prebuild in `package.json`**

```json
"prebuild": "bun run scripts/generate-metrics.ts && bun run scripts/fetch-github-stats.ts && bun run scripts/sync-page-metadata.ts",
"predev": "bun run scripts/generate-metrics.ts && bun run scripts/fetch-github-stats.ts && bun run scripts/sync-page-metadata.ts --dry-run",
```

- [ ] **Step 4: Add star CTA widget to `src/components/PageSidebar.astro`**

```astro
---
import type { Props } from "@astrojs/starlight/props";
import Default from "@astrojs/starlight/components/PageSidebar.astro";
import EmailSubscribe from "./EmailSubscribe.astro";
import FeedbackButton from "./FeedbackButton.astro";
import githubStats from "../data/github-stats.json";

const GITHUB_URL = "https://github.com/tylerjrbuell/reactive-agents-ts";
---

<Default {...Astro.props}><slot /></Default>

<div class="right-sidebar-panel sl-hidden lg:sl-block ra-sub-panel-wrap">
    <div class="sl-container">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener"
          class="ra-star-cta"
          data-umami-event="github_star_cta"
          data-umami-event-location="sidebar"
        >
          <span class="ra-star-icon">⭐</span>
          <span class="ra-star-label">Star on GitHub</span>
          {githubStats.stars > 0 && (
            <span class="ra-star-count">{githubStats.stars}</span>
          )}
        </a>
        <EmailSubscribe sidebar />
        <FeedbackButton />
    </div>
</div>
```

- [ ] **Step 5: Add star CTA styles to `src/styles/custom.css`**

Append:

```css
/* ── GitHub Star CTA (PageSidebar) ──────────────────────────── */
.ra-star-cta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 1rem;
  border-radius: 6px;
  border: 1px solid var(--sl-color-gray-5);
  background: color-mix(in srgb, var(--sl-color-accent) 5%, transparent);
  color: var(--sl-color-white);
  text-decoration: none;
  font-size: 0.8rem;
  font-weight: 600;
  transition: border-color 0.15s, background 0.15s;
}

.ra-star-cta:hover {
  border-color: var(--sl-color-accent);
  background: color-mix(in srgb, var(--sl-color-accent) 12%, transparent);
  text-decoration: none;
}

.ra-star-icon { font-size: 0.9rem; }

.ra-star-label { flex: 1; }

.ra-star-count {
  background: var(--sl-color-gray-5);
  border-radius: 10px;
  padding: 0 0.45rem;
  font-size: 0.7rem;
  color: var(--sl-color-gray-2);
}
```

- [ ] **Step 6: Add star button to homepage hero in `index.mdx`**

In the frontmatter `actions:` block, add the star action:

```yaml
actions:
    - text: Get Started
      link: guides/quickstart/
      icon: right-arrow
      variant: primary
    - text: "⭐ Star on GitHub"
      link: https://github.com/tylerjrbuell/reactive-agents-ts
      icon: external
      variant: secondary
```

- [ ] **Step 7: Run the fetch script and build**

```bash
bun run scripts/fetch-github-stats.ts
bun run build
```

Expected: `src/data/github-stats.json` updated with live count. Build passes.

- [ ] **Step 8: Visual check**

```bash
bun run dev
```

Verify: star CTA appears in right sidebar on all doc pages. Homepage hero has star button. Count is displayed.

- [ ] **Step 9: Commit**

```bash
git add apps/docs/scripts/fetch-github-stats.ts
git add apps/docs/src/data/github-stats.json
git add apps/docs/src/components/PageSidebar.astro
git add apps/docs/src/content/docs/index.mdx
git add apps/docs/src/styles/custom.css
git add apps/docs/package.json
git commit -m "docs(cta): GitHub star CTA — sidebar widget + hero button + build-time star count"
```

---

## Task 5: Umami Deep Event Additions

**Files:**
- Modify: `apps/docs/public/umami-deep.js`

**Interfaces:**
- All new events follow pattern: `track(eventName, { key: "value", ... })`
- Uses event delegation on `document` — no per-element listeners

- [ ] **Step 1: Add 8 new event trackers to `public/umami-deep.js`**

Append the following block inside the existing IIFE `(() => { ... })()`, before the closing `})()`:

```js
/* ---------- GitHub Star CTA clicks ---------- */
// data-umami-event / data-umami-event-location handled by Umami's auto-collect,
// but we also fire a named event for consistent naming with other CTA events.
document.addEventListener(
  "click",
  (ev) => {
    const a = ev.target?.closest?.("a.ra-star-cta");
    if (!a) return;
    const location = a.dataset.umamiEventLocation || "unknown";
    track("github_star_cta", { location, from: location.pathname });
  },
  { capture: true, passive: true },
);

/* ---------- Sidebar navigation ---------- */
document.addEventListener(
  "click",
  (ev) => {
    const a = ev.target?.closest?.("nav.sidebar a[href], .sidebar a[href]");
    if (!a) return;
    const label = (a.textContent || "").trim().slice(0, 60);
    const to = a.getAttribute("href") || "";
    // Try to find the section heading this link is nested under
    const group = a.closest("[data-sl-collapsed], .sidebar-group")
      ?.querySelector?.("summary, .group-label")
      ?.textContent?.trim().slice(0, 40) || "";
    track("sidebar_nav", { label, section: group, to, from: location.pathname });
  },
  { capture: true, passive: true },
);

/* ---------- TOC clicks ---------- */
document.addEventListener(
  "click",
  (ev) => {
    const a = ev.target?.closest?.(".right-sidebar a[href^='#'], .toc a[href^='#']");
    if (!a) return;
    const heading = (a.textContent || "").trim().slice(0, 60);
    track("toc_click", { heading, path: location.pathname });
  },
  { capture: true, passive: true },
);

/* ---------- Stability badge hover ---------- */
document.addEventListener(
  "pointerenter",
  (ev) => {
    const badge = ev.target?.closest?.(".sl-badge, [class*='badge']");
    if (!badge) return;
    const text = (badge.textContent || "").trim().slice(0, 30);
    if (!text) return;
    track("version_badge_hover", { badge: text, path: location.pathname });
  },
  { capture: true, passive: true },
);

/* ---------- Updated callout hash link clicks ---------- */
document.addEventListener(
  "click",
  (ev) => {
    const a = ev.target?.closest?.(".ra-updated-hash");
    if (!a) return;
    const hash = (a.textContent || "").trim().slice(0, 10);
    track("changelog_link", { hash, path: location.pathname });
  },
  { capture: true, passive: true },
);

/* ---------- 404 hit ---------- */
(function () {
  if (
    location.pathname === "/404/" ||
    document.querySelector('meta[name="generator"][content*="404"]') ||
    document.title?.includes("404")
  ) {
    track("404_hit", { referrer: document.referrer.slice(0, 120) });
  }
})();

/* ---------- Time on page (capped at 10 min) ---------- */
(function () {
  const START = Date.now();
  const MAX_SEC = 600;

  function flush() {
    const elapsed = Math.round(Math.min((Date.now() - START) / 1000, MAX_SEC));
    if (elapsed < 5) return; // ignore bounces under 5s
    track("time_on_page", { path: location.pathname, seconds: elapsed });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  // Re-arm on Starlight view-transitions
  document.addEventListener("astro:before-preparation", flush);
})();

/* ---------- Pagefind search result click ---------- */
document.addEventListener(
  "click",
  (ev) => {
    const result = ev.target?.closest?.(".pagefind-ui__result-link, [data-pagefind-result]");
    if (!result) return;
    const title = result.querySelector?.(".pagefind-ui__result-title")?.textContent?.trim().slice(0, 60)
      || (result.textContent || "").trim().slice(0, 60);
    const href = result.getAttribute?.("href") || result.closest?.("a")?.getAttribute?.("href") || "";
    // Find the search input to read current query
    const q = document.querySelector?.(".pagefind-ui__search-input")?.value?.trim().slice(0, 80) || "";
    // Rank is hard to get from DOM; use position in result list
    const allResults = [...(document.querySelectorAll?.(".pagefind-ui__result") ?? [])];
    const resultItem = result.closest?.(".pagefind-ui__result");
    const rank = resultItem ? allResults.indexOf(resultItem) + 1 : 0;
    track("search_result_click", { q, result_title: title, result_path: href, rank });
  },
  { capture: true, passive: true },
);
```

- [ ] **Step 2: Build to verify no parse errors**

```bash
bun run build
```

Expected: clean build.

- [ ] **Step 3: Manual smoke test in dev**

```bash
bun run dev
```

Open browser devtools → Network tab filtered to `analytics.reactiveagents.dev` (or check console for errors). Click a sidebar link — confirm no JS errors. The actual Umami events only fire in production; locally verify no exceptions thrown.

- [ ] **Step 4: Commit**

```bash
git add apps/docs/public/umami-deep.js
git commit -m "docs(analytics): 8 new Umami events — star CTA, sidebar nav, TOC, time-on-page, 404, search result"
```

---

## Task 6: Starlight Plugins + CSS Polish

**Files:**
- Modify: `apps/docs/package.json` — add `starlight-scroll-to-top`
- Modify: `apps/docs/astro.config.mjs` — register plugin
- Modify: `apps/docs/src/styles/custom.css` — numbered steps counter

**Interfaces:**
- `starlight-scroll-to-top` exposes no config API — zero-config install

- [ ] **Step 1: Install `starlight-scroll-to-top`**

```bash
bun add starlight-scroll-to-top
```

- [ ] **Step 2: Register the plugin in `astro.config.mjs`**

Add import at top:
```js
import starlightScrollToTop from "starlight-scroll-to-top";
```

Add to `plugins: [...]` array (after existing plugins):
```js
starlightScrollToTop(),
```

- [ ] **Step 3: Set expressive-code terminal frame theme**

In `astro.config.mjs`, add `expressiveCode` config inside `starlight({})`:

```js
expressiveCode: {
  themes: ["github-dark", "github-light"],
  defaultProps: {
    // bash/sh/shell blocks get the terminal frame by default
    overridesByLang: {
      bash: { frame: "terminal" },
      sh: { frame: "terminal" },
      shell: { frame: "terminal" },
    },
  },
},
```

- [ ] **Step 4: Add numbered steps CSS to `src/styles/custom.css`**

Append:

```css
/* ── Numbered steps (Tailwind-style 01 → 02 → ...) ─────────── */
/* Apply class="ra-steps" to <ol> in guides for numbered steps  */
ol.ra-steps {
  counter-reset: ra-step;
  list-style: none;
  padding: 0;
}

ol.ra-steps > li {
  counter-increment: ra-step;
  position: relative;
  padding-left: 3rem;
  padding-bottom: 1.5rem;
  border-left: 2px solid var(--sl-color-gray-5);
  margin-left: 1rem;
}

ol.ra-steps > li::before {
  content: counter(ra-step, decimal-leading-zero);
  position: absolute;
  left: -1.35rem;
  top: 0;
  background: var(--sl-color-bg);
  border: 2px solid var(--sl-color-accent);
  color: var(--sl-color-accent);
  font-size: 0.7rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

ol.ra-steps > li:last-child {
  border-left-color: transparent;
}
```

- [ ] **Step 5: Apply numbered steps to Installation and Quickstart guides**

In `src/content/docs/guides/installation.mdx`, wrap the existing ordered list steps with:
```mdx
<ol class="ra-steps">
<li>

**Step title**

content...

</li>
</ol>
```

Do the same for `src/content/docs/guides/quickstart.mdx`.

- [ ] **Step 6: Build and verify**

```bash
bun run build
```

Expected: clean build. The scroll-to-top button appears on long pages, terminal code blocks have frame styling, installation guide shows numbered circles.

- [ ] **Step 7: Commit**

```bash
git add apps/docs/package.json apps/docs/astro.config.mjs apps/docs/src/styles/custom.css
git add apps/docs/src/content/docs/guides/installation.mdx
git add apps/docs/src/content/docs/guides/quickstart.mdx
git commit -m "docs(ux): scroll-to-top, terminal frame theme, numbered steps CSS"
```

---

## Task 7: Code Accuracy Audit

**Files:**
- Various `src/content/docs/**/*.md` and `*.mdx` — surgical fixes only

**Interfaces:**
- None — this is a grep-and-fix pass

- [ ] **Step 1: Find deprecated `.withLeanHarness()` usage**

```bash
grep -rn "withLeanHarness" apps/docs/src/content/docs/
```

For every match, replace the call with:
```typescript
// Old (deprecated):
.withLeanHarness()

// New:
.withProfile(HarnessProfile.lean())
// or equivalently for the minimal preset:
.withProfile("lean")
```

Also ensure any file that uses `HarnessProfile` has the import noted:
```typescript
import { HarnessProfile } from 'reactive-agents'
```

- [ ] **Step 2: Verify strategy count and names**

```bash
grep -rn "strateg" apps/docs/src/content/docs/guides/reasoning.mdx | head -30
```

The docs must list exactly these 7 strategies (+ blueprint = 8 total per AGENTS.md):
- `reactive` (ReAct)
- `reflexion`
- `plan-execute-reflect`
- `tree-of-thought`
- `code-action` (@experimental)
- `direct`
- `adaptive`
- `blueprint`

Fix any listing that omits `blueprint` or uses the wrong name `plan-execute` (must be `plan-execute-reflect`).

- [ ] **Step 3: Add `.withModelRouting()` to cost-optimization guide**

```bash
grep -n "withModelRouting\|cost.*rout\|model.*rout" apps/docs/src/content/docs/guides/cost-optimization.md
```

If `.withModelRouting()` is not documented, add a section. The API is:

```typescript
import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withModelRouting({
    // Route cheap/simple tasks to haiku, complex to sonnet
    tiers: [
      { maxComplexity: 0.4, model: "claude-haiku-4-5" },
      { model: "claude-sonnet-4-6" },
    ],
  })
  .build()
```

Add this after the existing cost tracking section with heading `## Cost-Aware Model Routing` and badge `badge: { text: "New in v0.13", variant: "success" }` in the frontmatter.

- [ ] **Step 4: Verify all public-facing imports use `reactive-agents`**

```bash
grep -rn "from '@reactive-agents/" apps/docs/src/content/docs/ | grep -v "// internal"
```

Any public-facing example that imports from a sub-package (e.g., `@reactive-agents/core`) should be updated to use the umbrella package `reactive-agents` unless the sub-package is the only way to access that API.

- [ ] **Step 5: Fix `result.success` vs `metadata.success` confusion**

Per memory: `result.success` is top-level (no `metadata.success`). Check:

```bash
grep -rn "metadata\.success\|result\.metadata\.success" apps/docs/src/content/docs/
```

Replace any `result.metadata.success` with `result.success`.

- [ ] **Step 6: Build with link validation**

```bash
bun run build
```

Expected: zero link errors from `starlightLinksValidator`. Fix any broken links before committing.

- [ ] **Step 7: Commit**

```bash
git add apps/docs/src/content/docs
git commit -m "docs(accuracy): fix deprecated APIs, strategy count, withModelRouting, result.success"
```

---

## Self-Review Notes

**Spec coverage check:**

| Spec item | Task |
|-----------|------|
| IA restructure | Task 1 |
| Badge system (New/Updated/Experimental/Unstable/Deprecated) | Task 2 |
| `since:` backfill from git tags | Task 2 |
| `lastCommit:` metadata | Task 2 |
| Page-level "what changed" callout | Task 3 |
| Remove old new-page-indicator | Task 3 |
| GitHub star count at build time | Task 4 |
| Star CTA in hero, sidebar | Task 4 |
| `github_star_cta` Umami event | Task 4, 5 |
| 8 new Umami events | Task 5 |
| `starlight-scroll-to-top` | Task 6 |
| Terminal frame theme | Task 6 |
| Numbered steps CSS | Task 6 |
| `.withLeanHarness()` deprecation fix | Task 7 |
| Strategy count (8 with blueprint) | Task 7 |
| `.withModelRouting()` docs | Task 7 |
| `result.success` fix | Task 7 |

**Deferred (out of scope per spec):** `starlight-versions`, `starlight-giscus`, framework quickstart cards, "trusted by" social proof.
