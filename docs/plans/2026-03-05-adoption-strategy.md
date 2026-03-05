# Adoption Strategy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Drive organic adoption of reactive-agents through two parallel vectors: a persistent community-growth meta-agent (built on the framework itself) and a suite of ecosystem distribution materials (awesome lists, Show HN, dev.to articles, Bun outreach).

**Architecture:** The meta-agent is a gateway agent (`agent.start()`) that monitors developer communities for relevant conversations, drafts value-add responses and weekly blog posts, and saves them as markdown files for human review before posting. Distribution materials are static files (Reddit posts, HN post, awesome-list PRs) generated once and committed to the repo.

**Tech Stack:** reactive-agents (`withGateway`, `withTools`, `withMemory`, `withReasoning`), built-in tools (`web-search`, `http-get`, `file-write`, `scratchpad-write/read`), Bun, TypeScript.

---

## Context

The "stickiness" phase is complete (v0.6.3):
- 24 runnable examples including gateway + streaming
- All example imports fixed to use `reactive-agents`
- `AgentStream` exported from public package
- Effect install instructions clarified

The remaining gaps from the brainstorming session:
1. **Meta Community Agent** — framework proves itself by growing its own community
2. **Ecosystem Distribution** — submit to curated lists, prep launch posts, Bun outreach

---

## Task 1: Community Agent Directory + README

**Purpose:** Create the home for the meta-agent and establish the narrative.

**Files:**
- Create: `apps/meta-agent/README.md`
- Create: `apps/meta-agent/package.json`
- Create: `apps/meta-agent/tsconfig.json`

**Step 1: Create the directory**

```bash
mkdir -p apps/meta-agent/drafts
```

**Step 2: Write package.json**

```json
{
  "name": "@reactive-agents/meta-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/index.ts",
    "dry-run": "bun run src/index.ts --dry-run"
  },
  "dependencies": {
    "reactive-agents": "workspace:*",
    "effect": "^3.10.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "bun-types": "latest"
  }
}
```

**Step 3: Write tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

**Step 4: Write README.md**

The README is the meta-narrative: "We built an agent to grow the reactive-agents community using reactive-agents itself."

Content:
```markdown
# Reactive Agents — Community Growth Agent

> An autonomous agent built entirely on `reactive-agents` that helps grow the reactive-agents community.
> This is the meta demo: the framework proving itself by marketing itself.

## What it does

- Monitors Hacker News, Reddit (`r/typescript`, `r/MachineLearning`, `r/LocalLLaMA`, `r/node`), and dev.to for TypeScript AI agent discussions
- Drafts value-add responses that mention reactive-agents when genuinely relevant
- Generates weekly blog post drafts from recent releases and framework activity
- Saves all drafts to `drafts/` for human review before posting — never auto-posts

## Features demonstrated

| Feature | How it's used |
|---|---|
| `.withGateway()` | Runs 24/7, heartbeat every 6 hours |
| `.withTools()` | web-search, http-get, file-write, scratchpad |
| `.withMemory("1")` | Remembers seen threads to avoid duplicates |
| `.withReasoning()` | Adaptive strategy decides whether to respond |
| `.withPersona()` | Friendly developer-advocate voice |

## Setup

```bash
cp .env.example .env
# Add ANTHROPIC_API_KEY and TAVILY_API_KEY
bun install
bun run start
```

## Draft review

Drafts are saved to `drafts/` as markdown files. Review, edit, then post manually.
Never auto-posts anything.
```

**Step 5: Commit**

```bash
git add apps/meta-agent/
git commit -m "feat(meta-agent): scaffold community growth agent directory"
```

---

## Task 2: Community Monitor Tool

**Purpose:** Build the core search + filter logic for finding relevant developer community threads.

**Files:**
- Create: `apps/meta-agent/src/tools/community-monitor.ts`

This is a custom tool the agent registers that wraps web-search with reactive-agents-specific search terms and filters.

**Step 1: Write the tool**

```typescript
// apps/meta-agent/src/tools/community-monitor.ts
import type { ToolDefinition } from "reactive-agents";

/**
 * Custom tool: search developer communities for TypeScript AI agent discussions.
 * Returns threads that are likely opportunities to add value and mention reactive-agents.
 */
export const communityMonitorTool: ToolDefinition = {
  name: "community-monitor",
  description:
    "Search Hacker News, Reddit, and dev.to for TypeScript AI agent framework discussions. " +
    "Returns threads where reactive-agents could be genuinely relevant and helpful to mention. " +
    "Use this during heartbeat to find new opportunities.",
  inputSchema: {
    type: "object",
    properties: {
      topics: {
        type: "array",
        items: { type: "string" },
        description: "Topics to search for. Default covers TypeScript agent frameworks.",
      },
    },
    required: [],
  },
  handler: async (input: { topics?: string[] }) => {
    const topics = input.topics ?? [
      "TypeScript AI agent framework",
      "LangChain TypeScript alternative",
      "Mastra framework",
      "Effect-TS agents",
      "autonomous agents TypeScript",
      "AI agent observability TypeScript",
    ];

    // Return structured results for the agent to reason about
    return {
      searchTerms: topics,
      platforms: ["Hacker News", "Reddit r/typescript", "Reddit r/MachineLearning", "Reddit r/LocalLLaMA", "dev.to"],
      instruction:
        "Use the web-search tool with each term to find recent discussions. " +
        "For each relevant thread found, evaluate: Is this a genuine opportunity to add value? " +
        "Would mentioning reactive-agents be helpful (not spammy)? " +
        "Draft a response only if you can lead with value, not with promotion.",
    };
  },
};
```

**Step 2: Commit**

```bash
git add apps/meta-agent/src/tools/
git commit -m "feat(meta-agent): add community-monitor tool"
```

---

## Task 3: Draft Writer Tool

**Purpose:** Structured tool for saving response drafts and blog post drafts to the `drafts/` directory.

**Files:**
- Create: `apps/meta-agent/src/tools/draft-writer.ts`

**Step 1: Write the tool**

```typescript
// apps/meta-agent/src/tools/draft-writer.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition } from "reactive-agents";

const DRAFTS_DIR = join(import.meta.dirname, "../../drafts");

export const draftWriterTool: ToolDefinition = {
  name: "draft-writer",
  description:
    "Save a draft response or blog post to the drafts directory for human review. " +
    "Use this whenever you have a response or post worth saving. " +
    "NEVER auto-post anything — always save as a draft first.",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["response", "blog-post", "tweet", "reddit-post"],
        description: "Type of draft content",
      },
      title: {
        type: "string",
        description: "Short title for the draft file",
      },
      platform: {
        type: "string",
        description: "Target platform: 'reddit', 'hackernews', 'dev.to', 'twitter', etc.",
      },
      threadUrl: {
        type: "string",
        description: "URL of the thread this responds to (if applicable)",
      },
      content: {
        type: "string",
        description: "The full draft content in markdown",
      },
      context: {
        type: "string",
        description: "Why this draft was created — what opportunity was spotted",
      },
    },
    required: ["type", "title", "content"],
  },
  handler: async (input: {
    type: string;
    title: string;
    platform?: string;
    threadUrl?: string;
    content: string;
    context?: string;
  }) => {
    mkdirSync(DRAFTS_DIR, { recursive: true });

    const timestamp = new Date().toISOString().split("T")[0];
    const slug = input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50);
    const filename = `${timestamp}-${input.type}-${slug}.md`;
    const filepath = join(DRAFTS_DIR, filename);

    const frontmatter = [
      "---",
      `type: ${input.type}`,
      `title: "${input.title}"`,
      input.platform ? `platform: ${input.platform}` : null,
      input.threadUrl ? `thread_url: ${input.threadUrl}` : null,
      `created: ${new Date().toISOString()}`,
      `status: draft`,
      "---",
      "",
    ]
      .filter(Boolean)
      .join("\n");

    const body = [
      input.context ? `> **Context:** ${input.context}\n` : null,
      input.threadUrl ? `> **Thread:** ${input.threadUrl}\n` : null,
      input.content,
    ]
      .filter(Boolean)
      .join("\n");

    writeFileSync(filepath, frontmatter + body, "utf-8");

    return {
      saved: true,
      path: filepath,
      filename,
      message: `Draft saved to drafts/${filename}. Review and post manually.`,
    };
  },
};
```

**Step 2: Commit**

```bash
git add apps/meta-agent/src/tools/
git commit -m "feat(meta-agent): add draft-writer tool"
```

---

## Task 4: The Meta Agent Itself

**Purpose:** Build the main agent — the gateway loop that monitors communities and generates drafts.

**Files:**
- Create: `apps/meta-agent/src/index.ts`
- Create: `apps/meta-agent/.env.example`

**Step 1: Write the agent**

```typescript
// apps/meta-agent/src/index.ts
/**
 * Reactive Agents — Community Growth Agent
 *
 * A persistent autonomous agent built on reactive-agents that monitors
 * developer communities and drafts value-add responses for human review.
 *
 * This is the meta demo: the framework proving itself.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... TAVILY_API_KEY=tvly-... bun run src/index.ts
 *   bun run src/index.ts --dry-run   # validate config without starting loop
 */

import { ReactiveAgents } from "reactive-agents";
import { communityMonitorTool } from "./tools/community-monitor.js";
import { draftWriterTool } from "./tools/draft-writer.js";

const isDryRun = process.argv.includes("--dry-run");
const provider = process.env.ANTHROPIC_API_KEY ? "anthropic" : "test";

console.log("=== Reactive Agents — Community Growth Agent ===");
console.log(`Mode: ${isDryRun ? "DRY RUN" : provider === "anthropic" ? "LIVE" : "TEST"}\n`);

// ─── Build the agent ──────────────────────────────────────────────────────────

const agent = await ReactiveAgents.create()
  .withName("community-growth-agent")
  .withProvider(provider === "anthropic" ? "anthropic" : "test")
  .withModel("claude-sonnet-4-20250514")

  // Persona: developer advocate, adds value first
  .withPersona({
    role: "Developer Advocate for reactive-agents",
    background:
      "Deep expertise in TypeScript AI agent frameworks, Effect-TS, and developer tooling. " +
      "Knowledgeable about LangChain, Mastra, Vercel AI SDK, and where reactive-agents differs.",
    instructions:
      "ALWAYS lead with genuine value in responses. Only mention reactive-agents when it is " +
      "directly relevant and would genuinely help the person asking. Never spam or self-promote. " +
      "Think like a helpful developer first, advocate second. " +
      "Save ALL drafts for human review — never claim to have posted anything.",
    tone: "friendly, technical, developer-to-developer",
  })

  // Tools: search communities, fetch pages, save drafts, scratchpad for state
  .withTools({
    include: ["web-search", "http-get", "file-write", "scratchpad-write", "scratchpad-read"],
    custom: [communityMonitorTool, draftWriterTool],
  })

  // Memory: remember what we've seen to avoid duplicate drafts
  .withMemory("1")

  // Reasoning: adaptive — decides how complex each task needs to be
  .withReasoning({ defaultStrategy: "adaptive" })

  // Gateway: persistent autonomous loop
  .withGateway({
    heartbeat: {
      intervalMs: isDryRun ? 100 : 6 * 60 * 60 * 1000, // 6 hours in production
      policy: "adaptive",
      instruction:
        "Check developer communities for TypeScript AI agent framework discussions. " +
        "Use the community-monitor tool to find relevant threads on Hacker News, Reddit " +
        "(r/typescript, r/MachineLearning, r/LocalLLaMA, r/node), and dev.to. " +
        "For each genuinely relevant thread where reactive-agents could help: " +
        "draft a value-first response and save it with draft-writer. " +
        "Record thread URLs in scratchpad to avoid revisiting the same threads.",
    },
    crons: [
      {
        // Weekly blog post draft — every Monday at 9am
        schedule: "0 9 * * MON",
        instruction:
          "Generate a draft blog post for dev.to or Hashnode based on recent reactive-agents " +
          "activity. Topics to consider: new features shipped, interesting usage patterns, " +
          "comparison with other frameworks, TypeScript AI agent patterns. " +
          "Titles that rank well: 'Building X with TypeScript (no Python)', " +
          "'Why I built...', 'TypeScript vs Python for AI agents'. " +
          "Save the draft with draft-writer (type: blog-post, platform: dev.to).",
        priority: "normal",
      },
      {
        // Monthly competitive landscape check — 1st of each month
        schedule: "0 10 1 * *",
        instruction:
          "Research the current TypeScript AI agent framework landscape. Search for: " +
          "Mastra updates, LangChain JS updates, new TS agent frameworks. " +
          "Identify 2-3 concrete differentiators reactive-agents has vs current alternatives. " +
          "Save findings as a draft comparison post.",
        priority: "low",
      },
    ],
    policies: {
      dailyTokenBudget: 100_000,
      maxActionsPerHour: 10,
    },
  })

  .withTestResponses({
    "Check developer": "FINAL ANSWER: Monitored communities. Found 2 relevant threads. Saved drafts.",
    "": "FINAL ANSWER: Community check complete. No new opportunities found.",
  })
  .withMaxIterations(10)
  .build();

console.log(`Agent ID: ${agent.agentId}`);

if (isDryRun) {
  console.log("\nDry run — validating config (1 heartbeat, then stop)...\n");
  const handle = agent.start();
  await new Promise((r) => setTimeout(r, 500));
  const summary = await handle.stop();
  console.log("Summary:", summary);
  await agent.dispose();
  console.log("\n✅ Config valid. Ready to run with: bun run start");
  process.exit(0);
}

// ─── Start the persistent loop ─────────────────────────────────────────────

console.log("Starting persistent loop (Ctrl+C to stop)...\n");
console.log("Drafts will be saved to: apps/meta-agent/drafts/\n");

const handle = agent.start();

// Graceful shutdown on Ctrl+C
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  const summary = await handle.stop();
  console.log("Summary:", summary);
  await agent.dispose();
  process.exit(0);
});

// Wait forever (or until stop() is called)
await handle.done;
await agent.dispose();
```

**Step 2: Write .env.example**

```bash
# apps/meta-agent/.env.example
ANTHROPIC_API_KEY=sk-ant-...
TAVILY_API_KEY=tvly-...          # Required for web-search tool
# Optional: override model
# LLM_DEFAULT_MODEL=claude-opus-4-20250514
```

**Step 3: Verify dry-run works**

```bash
bun run apps/meta-agent/src/index.ts --dry-run
```

Expected output:
```
=== Reactive Agents — Community Growth Agent ===
Mode: DRY RUN

Agent ID: community-growth-agent-...
Dry run — validating config (1 heartbeat, then stop)...
Summary: { heartbeatsFired: 1, totalRuns: 1, cronChecks: 1 }
✅ Config valid. Ready to run with: bun run start
```

**Step 4: Commit**

```bash
git add apps/meta-agent/
git commit -m "feat(meta-agent): complete community growth agent

Uses reactive-agents to monitor TypeScript AI agent discussions
on HN, Reddit, and dev.to. Drafts value-add responses and weekly
blog posts to drafts/ for human review before posting.

Demonstrates: withGateway, withTools (custom + built-in),
withMemory, withReasoning (adaptive), withPersona"
```

---

## Task 5: Ecosystem Distribution Materials

**Purpose:** Create ready-to-use distribution assets — submissions for awesome lists, Show HN post, Reddit posts, Bun outreach.

**Files:**
- Create: `docs/distribution/awesome-list-submissions.md`
- Create: `docs/distribution/show-hn-post.md`
- Create: `docs/distribution/reddit-posts.md`
- Create: `docs/distribution/bun-outreach.md`

**Step 1: Create directory**

```bash
mkdir -p docs/distribution
```

**Step 2: Write awesome-list-submissions.md**

Curated lists that drive long-tail GitHub traffic for years.
Each entry needs: the list repo, PR title, and the one-line description to submit.

```markdown
# Awesome List Submissions

Submit these PRs to get passive, long-tail discovery traffic.
Each entry is one PR to the list repo.

---

## awesome-typescript
Repo: https://github.com/dzharii/awesome-typescript
Section: Libraries / AI & Machine Learning

Entry:
> - [reactive-agents](https://github.com/tylerjrbuell/reactive-agents-ts) -
>   Composable AI agent framework with Effect-TS type safety, 5 reasoning strategies,
>   persistent gateway, real-time streaming, and multi-agent orchestration.

PR title: "Add reactive-agents — composable TypeScript AI agent framework"

---

## awesome-ai-agents
Repo: https://github.com/e2b-dev/awesome-ai-agents
Section: TypeScript / JavaScript

Entry:
> **[Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts)**
> TypeScript-first agent framework built on Effect-TS. 19 composable packages,
> 5 reasoning strategies, persistent autonomous gateway, real-time token streaming,
> A2A multi-agent protocol, and production guardrails.

---

## awesome-effect-ts
Repo: https://github.com/mikearnaldi/awesome-effect
Section: Applications / AI

Entry:
> - [reactive-agents](https://github.com/tylerjrbuell/reactive-agents-ts) -
>   AI agent framework built on Effect-TS with composable layers, type-safe service
>   boundaries, and FiberRef-based streaming.

---

## awesome-llm-apps
Repo: https://github.com/Shubhamsaboo/awesome-llm-apps
Section: TypeScript / Node.js

Entry:
> - [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) -
>   Composable TypeScript AI agent framework. Effect-TS type safety, 6 LLM providers,
>   persistent gateway, streaming SSE, multi-agent orchestration.
```

**Step 3: Write show-hn-post.md**

The Show HN post. Timing: post Tuesday–Thursday 9–11am EST (highest traffic).
Do NOT post until the meta-agent has been running for a few days (use a live demo as the hook).

```markdown
# Show HN Post (Draft)

**Title (60 chars max):**
Show HN: Reactive Agents – composable TypeScript AI agent framework

**Body:**

I've been building Reactive Agents for the past 6 months — a TypeScript AI agent
framework that takes a different approach to the usual "wrap LangChain" pattern.

The core idea: 19 independent packages that compose via Effect-TS layers. You
enable exactly what you need — reasoning, memory, guardrails, cost tracking,
streaming — and nothing you don't. `agent.run()` works without knowing Effect at all.

The differentiator I'm most excited about is the Gateway: a persistent autonomous
agent harness with adaptive heartbeats, crons, and webhooks. No custom server needed.
I actually built a community growth agent on it that monitors HN and Reddit for
TypeScript AI framework discussions and drafts responses for me to review.

Key features:
- 5 reasoning strategies (ReAct, Plan-Execute, Tree-of-Thought, Reflexion, Adaptive)
- 6 LLM providers: Anthropic, OpenAI, Gemini, Ollama, LiteLLM (local + cloud)
- Real-time token streaming → SSE in one line: AgentStream.toSSE(agent.runStream(...))
- A2A multi-agent protocol for typed agent-to-agent communication
- Production guardrails, cost tracking, real Ed25519 identity
- 1,381 tests, CI green

24 runnable examples work without an API key (test mode).

GitHub: https://github.com/tylerjrbuell/reactive-agents-ts
Docs: https://tylerjrbuell.github.io/reactive-agents-ts/
npm: https://npmjs.com/package/reactive-agents

Happy to answer questions about the architecture or the Effect-TS approach.

---
**Post timing:** Tuesday–Thursday, 9–11am EST
**Best moment:** After first real-world usage story (meta-agent has been running live)
```

**Step 4: Write reddit-posts.md**

Three posts, one per subreddit, each with a different angle.

```markdown
# Reddit Posts (Drafts)

Post one at a time, spaced at least a week apart.

---

## r/typescript — Architecture angle

**Title:** I built a TypeScript AI agent framework using Effect-TS as the composition layer

**Body:**
After 6 months of building, I've open-sourced Reactive Agents — a framework where
every capability (memory, guardrails, cost tracking, streaming) is an independent
Effect-TS layer you compose only when needed.

The architecture: `agent.run()` for simple usage, `agent.runEffect()` for full
Effect-TS access. Users who don't know Effect can ignore it entirely.

What I found interesting about using Effect here: ManagedRuntime lets all methods
share the same service instances (EventBus, KillSwitch), which plain `runPromise`
calls can't do. FiberRef enables fiber-local text delta propagation for streaming
without global state.

24 runnable examples, all work without an API key.

Repo: https://github.com/tylerjrbuell/reactive-agents-ts

---

## r/LocalLLaMA — Local model angle

**Title:** TypeScript AI agent framework with first-class Ollama support and context profiles

**Body:**
Built Reactive Agents with local models as a first-class use case. Key features
for local inference:

- Model-adaptive context profiles (local/mid/large/frontier tiers) that tune
  prompt density, compaction strategy, and tool result truncation per model capability
- Ollama provider works out of the box — no API key, just `withProvider("ollama")`
- Context budget system prevents small models from hitting context limits mid-run
- Works well with qwen3:14b, cogito:14b, llama3.1:8b

Example with local model:
```typescript
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3:14b")
  .withContextProfile({ tier: "local", toolResultMaxChars: 800 })
  .withReasoning({ defaultStrategy: "reactive" })
  .build();
```

Repo: https://github.com/tylerjrbuell/reactive-agents-ts

---

## r/MachineLearning — Framework architecture angle

**Title:** [Project] Reactive Agents: TypeScript agent framework with swappable reasoning kernels and Effect-TS type safety

**Body:**
Open-sourcing Reactive Agents — a TypeScript agent framework with a few
architectural decisions I haven't seen elsewhere in the TS ecosystem:

1. **Composable Kernel SDK**: reasoning algorithms are swappable. The
   `ThoughtKernel` abstraction lets you register custom reasoning algorithms
   that integrate with all existing tooling (observability, guardrails, cost).

2. **FiberRef-based streaming**: TextDelta events propagate through the
   react-kernel via Effect FiberRef, avoiding global state for concurrent streams.

3. **Structured plan engine**: Plan-Execute strategy uses JSON plans with
   SQLite persistence, hybrid step dispatch, and graduated retry → patch → replan.

1,381 tests, 19 packages, CI green.

Repo: https://github.com/tylerjrbuell/reactive-agents-ts
```

**Step 5: Write bun-outreach.md**

```markdown
# Bun Team Outreach

Bun's account has highlighted interesting projects before. The SSE streaming
example (24-streaming-sse-server.ts) is a natural Bun showcase: zero dependencies
beyond `reactive-agents`, uses `Bun.serve`, and shows token streaming in 3 lines.

---

## Tweet to @bunjavascript

**Option A (code-focused):**
```
Token-streaming AI agent → SSE endpoint in 3 lines with @bunjavascript:

const agent = await ReactiveAgents.create()
  .withProvider("anthropic").withStreaming().build();

Bun.serve({ fetch: (req) =>
  AgentStream.toSSE(agent.runStream(req.url))
});

Full example: [link to 24-streaming-sse-server.ts]
Built with: reactive-agents + Bun.serve
```

**Option B (gateway-focused):**
```
Persistent autonomous agents on @bunjavascript — no server needed:

await agent.withGateway({
  heartbeat: { intervalMs: 3_600_000 },
  crons: [{ schedule: "0 9 * * MON", instruction: "..." }],
}).build().start()

Runs forever, adaptive heartbeat, budget enforcement, webhooks.
Source: https://github.com/tylerjrbuell/reactive-agents-ts
```

---

## Direct issue/discussion

Alternatively, post in the Bun GitHub discussions under "Show & Tell":
https://github.com/oven-sh/bun/discussions

Title: "Built a TypeScript AI agent framework using Bun.serve for streaming SSE"
```

**Step 6: Commit**

```bash
git add docs/distribution/
git commit -m "docs(distribution): add adoption distribution materials

- awesome-list-submissions.md: 4 curated list PRs ready to submit
- show-hn-post.md: Show HN draft with timing guidance
- reddit-posts.md: 3 subreddit posts with different angles
- bun-outreach.md: Bun team tweet options + discussion template"
```

---

## Task 6: GitHub Repo Discoverability Polish

**Purpose:** One-time improvements that affect discovery from GitHub search and topic browsing.

**Files:**
- Modify: `.github/CONTRIBUTING.md` (create)
- Modify: GitHub repo description and topics via `gh` CLI

**Step 1: Update repo description and topics**

```bash
gh repo edit tylerjrbuell/reactive-agents-ts \
  --description "Composable TypeScript AI agent framework — Effect-TS type safety, 5 reasoning strategies, persistent gateway, real-time streaming, multi-agent A2A" \
  --homepage "https://tylerjrbuell.github.io/reactive-agents-ts/"
```

**Step 2: Add missing topics** (currently missing: `mcp`, `ai-agents`, `streaming`, `gateway`, `bun`)

```bash
gh api repos/tylerjrbuell/reactive-agents-ts/topics \
  --method PUT \
  --field names[]="agent-framework" \
  --field names[]="agent-observability" \
  --field names[]="agent-orchestration" \
  --field names[]="agentic-ai" \
  --field names[]="anthropic" \
  --field names[]="bun" \
  --field names[]="composable" \
  --field names[]="effect-ts" \
  --field names[]="google-ai" \
  --field names[]="llm" \
  --field names[]="multi-agent" \
  --field names[]="ollama" \
  --field names[]="openai" \
  --field names[]="type-safe" \
  --field names[]="typescript" \
  --field names[]="mcp" \
  --field names[]="ai-agents" \
  --field names[]="streaming" \
  --field names[]="gateway" \
  --field names[]="automation"
```

**Step 3: Create CONTRIBUTING.md**

```markdown
# Contributing to Reactive Agents

Thanks for your interest! Here's how to get started.

## Setup

```bash
git clone https://github.com/tylerjrbuell/reactive-agents-ts
cd reactive-agents-ts
bun install
bun test          # 1381 tests, should all pass
bun run build     # builds all 19 packages
```

## Structure

```
packages/          19 composable packages
apps/
  docs/            Starlight docs site
  examples/        24 runnable examples (bun run apps/examples/src/...)
  meta-agent/      Community growth agent (the meta demo)
```

## Making changes

1. Pick an issue or discuss a new feature in GitHub Discussions
2. Create a feature branch
3. Write tests first (`bun test --watch`)
4. Keep package boundaries clean — each package has one job
5. Run `bun test` before opening a PR

## Key patterns

See `CLAUDE.md` for the full architecture guide.
Effect-TS patterns: `@effect-ts-patterns` skill in `.claude/skills/`
```

**Step 4: Commit**

```bash
git add .github/CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING.md for community onboarding"
```

---

## Task 7: First Blog Post Draft

**Purpose:** Write the first dev.to article manually — "Why I built reactive-agents" — this is the founder story that HN and dev Twitter share.

**Files:**
- Create: `docs/distribution/blog-posts/2026-03-why-i-built-reactive-agents.md`

**Step 1: Write the post**

```markdown
---
title: Why I Built a TypeScript AI Agent Framework on Effect-TS
published: false
tags: typescript, ai, agents, effectts
canonical_url: https://tylerjrbuell.github.io/reactive-agents-ts/
---

[~800 words covering:]

1. The problem: every TS agent framework was either a Python port or a monolith
2. The insight: Effect-TS makes the composable layer pattern actually work
3. The key decisions: why 19 packages instead of one, why swap reasoning strategies
4. The unexpected win: the Gateway pattern for persistent autonomous agents
5. The meta moment: running the framework to grow the framework
6. Where it goes next: Scout layer, collective learning

[End with:] "Try it: `bun add reactive-agents` — 24 runnable examples work without an API key."
```

Write the full post (not a template — actual content).

**Step 2: Commit**

```bash
git add docs/distribution/blog-posts/
git commit -m "docs(distribution): add founder story blog post draft"
```

---

## Execution Order

Run in this order:

1. **Task 1–4** (meta-agent): Build the agent, verify dry-run passes
2. **Task 5** (distribution materials): Create static assets
3. **Task 6** (repo polish): Update GitHub description + topics, add CONTRIBUTING.md
4. **Task 7** (blog post): Write the founder story

Then distribute:

| Action | When | Where |
|---|---|---|
| Submit awesome-list PRs | Immediately | GitHub PRs to each repo |
| Update GitHub topics | Immediately | `gh api` command from Task 6 |
| Start meta-agent (live) | After setting TAVILY_API_KEY | `bun run start` in apps/meta-agent |
| Post to r/typescript | Week 1 | Reddit |
| Post to r/LocalLLaMA | Week 2 | Reddit |
| Publish founder blog post | Week 2 | dev.to |
| Show HN | Week 3 (after blog post traction) | news.ycombinator.com |
| Bun outreach | Week 3 | Twitter/X @bunjavascript |
| Post to r/MachineLearning | Week 4 | Reddit |

---

## Success Metrics (30 days)

- GitHub stars: 50+ (from ~2)
- npm weekly downloads: 100+
- Discord members: 20+
- Awesome list inclusions: 2+
- Blog post views: 500+
