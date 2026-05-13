# Stackblitz Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three embeddable Stackblitz demos in the docs playground page so users can run real agents in-browser with no local install, supplying their own API key.

**Architecture:** Each scenario lives in `apps/stackblitz/<name>/` as a standalone npm project (no `workspace:*`) using `reactive-agents@latest` from the npm registry. The docs `/guides/playground` page embeds all three via lazy-loaded `<iframe>` elements inside Starlight `<Tabs>`. Provider and API key are injected via Stackblitz Secrets as env vars; the agent code reads them at runtime.

**Tech Stack:** `reactive-agents@latest`, `tsx@4`, TypeScript 5, Astro/Starlight 0.38.x, `@astrojs/starlight/components` Tabs

**Design Spec:** `wiki/Architecture/Design-Specs/2026-05-13-stackblitz-playground-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `apps/stackblitz/01-hello-agent/package.json` | Create | npm deps for scenario 1 |
| `apps/stackblitz/01-hello-agent/tsconfig.json` | Create | TS config for scenario 1 |
| `apps/stackblitz/01-hello-agent/.stackblitzrc` | Create | Stackblitz boot config |
| `apps/stackblitz/01-hello-agent/src/agent.ts` | Create | Hello agent demo |
| `apps/stackblitz/02-tool-integration/package.json` | Create | npm deps for scenario 2 |
| `apps/stackblitz/02-tool-integration/tsconfig.json` | Create | TS config |
| `apps/stackblitz/02-tool-integration/.stackblitzrc` | Create | Stackblitz boot config |
| `apps/stackblitz/02-tool-integration/src/agent.ts` | Create | Built-in tools demo |
| `apps/stackblitz/03-strategy-demo/package.json` | Create | npm deps for scenario 3 |
| `apps/stackblitz/03-strategy-demo/tsconfig.json` | Create | TS config |
| `apps/stackblitz/03-strategy-demo/.stackblitzrc` | Create | Stackblitz boot config |
| `apps/stackblitz/03-strategy-demo/src/agent.ts` | Create | Strategy comparison demo |
| `apps/docs/src/content/docs/guides/playground.mdx` | Create | Docs playground page |

---

## Task 1: Scaffold configs for all three scenarios

**Files:**
- Create: `apps/stackblitz/01-hello-agent/package.json`
- Create: `apps/stackblitz/01-hello-agent/tsconfig.json`
- Create: `apps/stackblitz/01-hello-agent/.stackblitzrc`
- Create: `apps/stackblitz/02-tool-integration/package.json`
- Create: `apps/stackblitz/02-tool-integration/tsconfig.json`
- Create: `apps/stackblitz/02-tool-integration/.stackblitzrc`
- Create: `apps/stackblitz/03-strategy-demo/package.json`
- Create: `apps/stackblitz/03-strategy-demo/tsconfig.json`
- Create: `apps/stackblitz/03-strategy-demo/.stackblitzrc`

- [ ] **Step 1: Create 01-hello-agent config files**

`apps/stackblitz/01-hello-agent/package.json`:
```json
{
  "name": "reactive-agents-01-hello-agent",
  "version": "1.0.0",
  "type": "module",
  "description": "Reactive Agents hello-agent demo — runs in Stackblitz, no install needed",
  "scripts": {
    "start": "npx tsx src/agent.ts"
  },
  "dependencies": {
    "reactive-agents": "latest"
  },
  "devDependencies": {
    "tsx": "^4",
    "typescript": "^5"
  }
}
```

`apps/stackblitz/01-hello-agent/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`apps/stackblitz/01-hello-agent/.stackblitzrc`:
```json
{
  "startCommand": "npm install && npm start",
  "openFile": "src/agent.ts"
}
```

- [ ] **Step 2: Create 02-tool-integration config files**

`apps/stackblitz/02-tool-integration/package.json`:
```json
{
  "name": "reactive-agents-02-tool-integration",
  "version": "1.0.0",
  "type": "module",
  "description": "Reactive Agents tool-integration demo — scratchpad + code-execute built-in tools",
  "scripts": {
    "start": "npx tsx src/agent.ts"
  },
  "dependencies": {
    "reactive-agents": "latest"
  },
  "devDependencies": {
    "tsx": "^4",
    "typescript": "^5"
  }
}
```

`apps/stackblitz/02-tool-integration/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`apps/stackblitz/02-tool-integration/.stackblitzrc`:
```json
{
  "startCommand": "npm install && npm start",
  "openFile": "src/agent.ts"
}
```

- [ ] **Step 3: Create 03-strategy-demo config files**

`apps/stackblitz/03-strategy-demo/package.json`:
```json
{
  "name": "reactive-agents-03-strategy-demo",
  "version": "1.0.0",
  "type": "module",
  "description": "Reactive Agents strategy-demo — reactive vs plan-execute-reflect side-by-side",
  "scripts": {
    "start": "npx tsx src/agent.ts"
  },
  "dependencies": {
    "reactive-agents": "latest"
  },
  "devDependencies": {
    "tsx": "^4",
    "typescript": "^5"
  }
}
```

`apps/stackblitz/03-strategy-demo/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`apps/stackblitz/03-strategy-demo/.stackblitzrc`:
```json
{
  "startCommand": "npm install && npm start",
  "openFile": "src/agent.ts"
}
```

- [ ] **Step 4: Verify no workspace:* refs in any of the new package.json files**

```bash
grep -r "workspace:" apps/stackblitz/
```

Expected: no output (zero matches)

- [ ] **Step 5: Commit**

```bash
git add apps/stackblitz/01-hello-agent/ apps/stackblitz/02-tool-integration/ apps/stackblitz/03-strategy-demo/
git commit -m "chore(stackblitz): scaffold project configs for all 3 playground scenarios"
```

---

## Task 2: Implement 01-hello-agent

**Files:**
- Create: `apps/stackblitz/01-hello-agent/src/agent.ts`

This scenario is a simple Q&A: user asks a question, agent responds. No tools, minimal setup, maximum clarity.

- [ ] **Step 1: Create src/ directory**

```bash
mkdir -p apps/stackblitz/01-hello-agent/src
```

- [ ] **Step 2: Write agent.ts**

`apps/stackblitz/01-hello-agent/src/agent.ts`:
```ts
/**
 * Hello Agent — simplest Reactive Agents demo
 *
 * Runs a single Q&A query and streams the result.
 *
 * Secrets to add in Stackblitz (⚙️ icon):
 *   GOOGLE_API_KEY     → ai.google.dev  ← recommended (free tier)
 *   ANTHROPIC_API_KEY  → console.anthropic.com
 *   OPENAI_API_KEY     → platform.openai.com
 *
 *   Or use local Ollama:
 *   PROVIDER=ollama
 *   OLLAMA_ENDPOINT=http://localhost:11434
 *   (requires: OLLAMA_ORIGINS=* on your Ollama server)
 */

import { ReactiveAgents } from "reactive-agents";

type PN = "gemini" | "anthropic" | "openai" | "ollama";

const provider = (process.env.PROVIDER ?? "gemini") as PN;

const hasKey =
  Boolean(process.env.GOOGLE_API_KEY) ||
  Boolean(process.env.ANTHROPIC_API_KEY) ||
  Boolean(process.env.OPENAI_API_KEY) ||
  provider === "ollama";

if (!hasKey) {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  No API key found. Add one in Stackblitz Secrets (⚙️):

  GOOGLE_API_KEY     → ai.google.dev   ← free tier, recommended
  ANTHROPIC_API_KEY  → console.anthropic.com
  OPENAI_API_KEY     → platform.openai.com

  For local Ollama (Chrome only):
    PROVIDER          = ollama
    OLLAMA_ENDPOINT   = http://localhost:11434
    (run: OLLAMA_ORIGINS=* ollama serve)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  process.exit(0);
}

// v0.12 hook: Chrome extension can bridge localhost Ollama via postMessage
const ollamaEndpoint =
  process.env.OLLAMA_BRIDGE_EXTENSION
    ? "reactive-agents://ollama-bridge"
    : (process.env.OLLAMA_ENDPOINT ?? "http://localhost:11434");

const model =
  process.env.MODEL ??
  (provider === "gemini"
    ? "gemini-1.5-flash"
    : provider === "ollama"
      ? "llama3.2"
      : undefined);

const agent = await ReactiveAgents.create()
  .withName("hello-agent")
  .withProvider(provider)
  .withModel(model ?? "")
  .withMaxIterations(3)
  .build();

const question =
  process.env.QUESTION ??
  "What are three practical use cases for AI agents in software development?";

console.log(`\nProvider: ${provider}${model ? ` (${model})` : ""}`);
console.log(`Question: ${question}\n`);
console.log("Running...\n");

const result = await agent.run(question);

console.log("─── Answer ───");
console.log(result.output);
console.log("\n─── Stats ───");
console.log(`Steps:    ${result.metadata.stepsCount}`);
console.log(`Tokens:   ${result.metadata.tokensUsed}`);
console.log(`Cost:     $${result.metadata.cost.toFixed(6)}`);
console.log(`Duration: ${result.metadata.durationMs}ms`);
console.log(`\nDone. Try changing QUESTION in Secrets to ask anything!`);
```

- [ ] **Step 3: Manual smoke test — no key set**

```bash
cd apps/stackblitz/01-hello-agent
# Do NOT npm install (simulating first open)
node --input-type=module <<'EOF'
process.env.PROVIDER = "gemini";
delete process.env.GOOGLE_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
EOF
```

Expected: The agent.ts setup instructions block would print and exit 0. Full verification in Stackblitz after deploy.

- [ ] **Step 4: Commit**

```bash
git add apps/stackblitz/01-hello-agent/src/agent.ts
git commit -m "feat(stackblitz): add 01-hello-agent demo scenario"
```

---

## Task 3: Implement 02-tool-integration

**Files:**
- Create: `apps/stackblitz/02-tool-integration/src/agent.ts`

This scenario demonstrates built-in tool use: the agent uses `scratchpad-write` (store intermediate reasoning) and `code-execute` (run a computation). No external API keys beyond the LLM provider — built-in tools run inside the WebContainer.

- [ ] **Step 1: Create src/ directory**

```bash
mkdir -p apps/stackblitz/02-tool-integration/src
```

- [ ] **Step 2: Write agent.ts**

`apps/stackblitz/02-tool-integration/src/agent.ts`:
```ts
/**
 * Tool Integration — built-in tools demo
 *
 * The agent uses built-in tools to:
 *   1. Write reasoning notes to the scratchpad
 *   2. Execute a small JS snippet to compute a result
 *   3. Synthesize a final answer
 *
 * No extra API keys required beyond the LLM provider.
 * Built-in tools run inside the WebContainer sandbox.
 *
 * Secrets to add in Stackblitz (⚙️ icon):
 *   GOOGLE_API_KEY     → ai.google.dev  ← recommended (free tier)
 *   ANTHROPIC_API_KEY  → console.anthropic.com
 *   OPENAI_API_KEY     → platform.openai.com
 *
 *   Or use local Ollama:
 *   PROVIDER=ollama
 *   OLLAMA_ENDPOINT=http://localhost:11434
 */

import { ReactiveAgents } from "reactive-agents";

type PN = "gemini" | "anthropic" | "openai" | "ollama";

const provider = (process.env.PROVIDER ?? "gemini") as PN;

const hasKey =
  Boolean(process.env.GOOGLE_API_KEY) ||
  Boolean(process.env.ANTHROPIC_API_KEY) ||
  Boolean(process.env.OPENAI_API_KEY) ||
  provider === "ollama";

if (!hasKey) {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  No API key found. Add one in Stackblitz Secrets (⚙️):

  GOOGLE_API_KEY     → ai.google.dev   ← free tier, recommended
  ANTHROPIC_API_KEY  → console.anthropic.com
  OPENAI_API_KEY     → platform.openai.com

  For local Ollama (Chrome only):
    PROVIDER          = ollama
    OLLAMA_ENDPOINT   = http://localhost:11434
    (run: OLLAMA_ORIGINS=* ollama serve)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  process.exit(0);
}

const ollamaEndpoint =
  process.env.OLLAMA_BRIDGE_EXTENSION
    ? "reactive-agents://ollama-bridge"
    : (process.env.OLLAMA_ENDPOINT ?? "http://localhost:11434");

const model =
  process.env.MODEL ??
  (provider === "gemini"
    ? "gemini-1.5-flash"
    : provider === "ollama"
      ? "llama3.2"
      : undefined);

const agent = await ReactiveAgents.create()
  .withName("tool-integration-demo")
  .withProvider(provider)
  .withModel(model ?? "")
  .withTools()                                        // enables: file-read, file-write, code-execute, scratchpad-write, scratchpad-read
  .withReasoning({ defaultStrategy: "reactive" })     // ReAct loop: think → use tool → observe → repeat
  .withMaxIterations(8)
  .build();

const task =
  process.env.TASK ??
  "Calculate the sum of the first 10 Fibonacci numbers using the code-execute tool, then write a brief explanation to the scratchpad.";

console.log(`\nProvider: ${provider}${model ? ` (${model})` : ""}`);
console.log(`Task: ${task}\n`);
console.log("Running agent with built-in tools...\n");
console.log("(Watch the terminal — you'll see each tool call as it happens)\n");

const result = await agent.run(task);

console.log("─── Final Answer ───");
console.log(result.output);
console.log("\n─── Stats ───");
console.log(`Steps:    ${result.metadata.stepsCount}`);
console.log(`Tokens:   ${result.metadata.tokensUsed}`);
console.log(`Cost:     $${result.metadata.cost.toFixed(6)}`);
console.log(`Duration: ${result.metadata.durationMs}ms`);
console.log(`\nTry changing TASK in Secrets to give the agent a different challenge!`);
```

- [ ] **Step 3: Commit**

```bash
git add apps/stackblitz/02-tool-integration/src/agent.ts
git commit -m "feat(stackblitz): add 02-tool-integration demo scenario"
```

---

## Task 4: Implement 03-strategy-demo

**Files:**
- Create: `apps/stackblitz/03-strategy-demo/src/agent.ts`

This scenario runs the same task using two different reasoning strategies — `reactive` and `plan-execute-reflect` — and prints a side-by-side comparison of step counts and token usage. This makes strategy tradeoffs tangible without explanation.

- [ ] **Step 1: Create src/ directory**

```bash
mkdir -p apps/stackblitz/03-strategy-demo/src
```

- [ ] **Step 2: Write agent.ts**

`apps/stackblitz/03-strategy-demo/src/agent.ts`:
```ts
/**
 * Strategy Demo — side-by-side reasoning comparison
 *
 * Runs the same task with two strategies and compares:
 *   reactive:             ReAct loop (think → act → observe)
 *   plan-execute-reflect: Plan all steps first, execute, then reflect
 *
 * Try the other available strategies via STRATEGY_B env var:
 *   tree-of-thought | reflexion | adaptive
 *
 * Secrets to add in Stackblitz (⚙️ icon):
 *   GOOGLE_API_KEY     → ai.google.dev  ← recommended (free tier)
 *   ANTHROPIC_API_KEY  → console.anthropic.com
 *   OPENAI_API_KEY     → platform.openai.com
 *
 *   Or use local Ollama:
 *   PROVIDER=ollama
 *   OLLAMA_ENDPOINT=http://localhost:11434
 */

import { ReactiveAgents } from "reactive-agents";

type PN = "gemini" | "anthropic" | "openai" | "ollama";
type Strategy = "reactive" | "plan-execute-reflect" | "tree-of-thought" | "reflexion" | "adaptive";

const provider = (process.env.PROVIDER ?? "gemini") as PN;

const hasKey =
  Boolean(process.env.GOOGLE_API_KEY) ||
  Boolean(process.env.ANTHROPIC_API_KEY) ||
  Boolean(process.env.OPENAI_API_KEY) ||
  provider === "ollama";

if (!hasKey) {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  No API key found. Add one in Stackblitz Secrets (⚙️):

  GOOGLE_API_KEY     → ai.google.dev   ← free tier, recommended
  ANTHROPIC_API_KEY  → console.anthropic.com
  OPENAI_API_KEY     → platform.openai.com

  For local Ollama (Chrome only):
    PROVIDER          = ollama
    OLLAMA_ENDPOINT   = http://localhost:11434
    (run: OLLAMA_ORIGINS=* ollama serve)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  process.exit(0);
}

const model =
  process.env.MODEL ??
  (provider === "gemini"
    ? "gemini-1.5-flash"
    : provider === "ollama"
      ? "llama3.2"
      : undefined);

const strategyA = (process.env.STRATEGY_A ?? "reactive") as Strategy;
const strategyB = (process.env.STRATEGY_B ?? "plan-execute-reflect") as Strategy;

const task =
  process.env.TASK ??
  "Explain in 2-3 sentences why distributed systems are harder to debug than single-process applications.";

console.log(`\nProvider: ${provider}${model ? ` (${model})` : ""}`);
console.log(`Task: ${task}`);
console.log(`Comparing: ${strategyA} vs ${strategyB}\n`);
console.log("Running both strategies in sequence...\n");

type RunResult = { strategy: Strategy; output: string; steps: number; tokens: number; durationMs: number };

async function runWithStrategy(strategy: Strategy): Promise<RunResult> {
  const start = Date.now();
  console.log(`── Starting: ${strategy} ──`);

  const agent = await ReactiveAgents.create()
    .withName(`strategy-${strategy}`)
    .withProvider(provider)
    .withModel(model ?? "")
    .withReasoning({ defaultStrategy: strategy })
    .withMaxIterations(6)
    .build();

  const result = await agent.run(task);

  console.log(`✓ ${strategy} done in ${Date.now() - start}ms (${result.metadata.stepsCount} steps)\n`);

  return {
    strategy,
    output: result.output,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

const [resultA, resultB] = await Promise.all([
  runWithStrategy(strategyA),
  runWithStrategy(strategyB),
]);

console.log("═══════════════════════════════════════════════");
console.log("                  COMPARISON                  ");
console.log("═══════════════════════════════════════════════");

for (const r of [resultA, resultB]) {
  console.log(`\n[${r.strategy}]`);
  console.log(`  Steps:    ${r.steps}`);
  console.log(`  Tokens:   ${r.tokens}`);
  console.log(`  Duration: ${r.durationMs}ms`);
  console.log(`  Output:   ${r.output.slice(0, 120)}${r.output.length > 120 ? "..." : ""}`);
}

console.log("\n───────────────────────────────────────────────");
const winner = resultA.tokens <= resultB.tokens ? resultA : resultB;
console.log(`More token-efficient: ${winner.strategy} (${winner.tokens} tokens)`);
console.log(`\nTry changing STRATEGY_B to: tree-of-thought | reflexion | adaptive`);
```

- [ ] **Step 3: Commit**

```bash
git add apps/stackblitz/03-strategy-demo/src/agent.ts
git commit -m "feat(stackblitz): add 03-strategy-demo scenario"
```

---

## Task 5: Create docs playground page

**Files:**
- Create: `apps/docs/src/content/docs/guides/playground.mdx`

The sidebar uses `autogenerate: { directory: "guides" }` — the file auto-appears in "Getting Started" when added with correct frontmatter. Sidebar order is controlled by the `sidebar.order` frontmatter field.

- [ ] **Step 1: Check current highest sidebar order in guides**

```bash
grep -r "sidebar:" apps/docs/src/content/docs/guides/ | grep "order:" | sort
```

Note the highest order number. The playground page should come near the top (order: 2) so it's visible before long guides.

- [ ] **Step 2: Create playground.mdx**

`apps/docs/src/content/docs/guides/playground.mdx`:
```mdx
---
title: Interactive Playground
description: Run Reactive Agents in your browser — no install needed. Powered by StackBlitz WebContainers.
sidebar:
  order: 2
  badge:
    text: New
    variant: tip
---

import { Tabs, TabItem, Aside, Steps } from '@astrojs/starlight/components';

Run a real agent in your browser — no local install, no cloning, no CLI setup. Powered by [StackBlitz WebContainers](https://stackblitz.com), which runs Node.js entirely in-browser.

## Quick setup

Add your API key in the Stackblitz **Secrets** panel (⚙️ in the sidebar):

| Provider | Free tier? | Secret name |
|----------|-----------|-------------|
| **Google Gemini** ← recommended | ✅ Yes — generous free tier | `GOOGLE_API_KEY` |
| Anthropic Claude | ❌ Pay-as-you-go | `ANTHROPIC_API_KEY` |
| OpenAI | ❌ Pay-as-you-go | `OPENAI_API_KEY` |
| Local Ollama | ✅ Free | `PROVIDER=ollama` + `OLLAMA_ENDPOINT` |

Get a free Gemini API key at [ai.google.dev](https://ai.google.dev) — no credit card required.

<Aside type="tip">
**Secrets stay local.** Stackblitz Secrets are stored in your browser session only. They are never sent to our servers.
</Aside>

---

## Scenarios

<Tabs>
  <TabItem label="Hello Agent">

    **The simplest possible agent.** One question, one answer. Start here to see the core API in action.

    Set `QUESTION` in Secrets to ask anything you like.

    <iframe
      src="https://stackblitz.com/github/tylerjrbuell/reactive-agents-ts/tree/main/apps/stackblitz/01-hello-agent?embed=1&file=src%2Fagent.ts&terminal=start&theme=dark&view=editor"
      style="width:100%;height:600px;border:0;border-radius:8px"
      loading="lazy"
      title="Hello Agent — Reactive Agents playground"
    />

  </TabItem>
  <TabItem label="Tool Integration">

    **Agent with built-in tools.** The agent uses `code-execute` and `scratchpad-write` — tools that run inside the WebContainer sandbox. No extra API keys needed.

    Set `TASK` in Secrets to give the agent a custom challenge.

    <iframe
      src="https://stackblitz.com/github/tylerjrbuell/reactive-agents-ts/tree/main/apps/stackblitz/02-tool-integration?embed=1&file=src%2Fagent.ts&terminal=start&theme=dark&view=editor"
      style="width:100%;height:600px;border:0;border-radius:8px"
      loading="lazy"
      title="Tool Integration — Reactive Agents playground"
    />

  </TabItem>
  <TabItem label="Strategy Demo">

    **Two strategies, same task.** See how `reactive` and `plan-execute-reflect` differ in steps, tokens, and style. Set `STRATEGY_B` to try `tree-of-thought`, `reflexion`, or `adaptive`.

    <iframe
      src="https://stackblitz.com/github/tylerjrbuell/reactive-agents-ts/tree/main/apps/stackblitz/03-strategy-demo?embed=1&file=src%2Fagent.ts&terminal=start&theme=dark&view=editor"
      style="width:100%;height:600px;border:0;border-radius:8px"
      loading="lazy"
      title="Strategy Demo — Reactive Agents playground"
    />

  </TabItem>
</Tabs>

---

## Using local Ollama

<Aside type="caution">
Local Ollama requires Chrome 94+ (loopback exception). Does not work in Firefox or Safari.
</Aside>

<Steps>
1. Start Ollama with CORS enabled:

   **Mac/Linux:**
   ```bash
   OLLAMA_ORIGINS=* ollama serve
   ```
   **Windows:**
   ```cmd
   set OLLAMA_ORIGINS=* && ollama serve
   ```

2. Pull a model if you haven't already:
   ```bash
   ollama pull llama3.2
   ```

3. In Stackblitz Secrets (⚙️), add:
   ```
   PROVIDER        = ollama
   OLLAMA_ENDPOINT = http://localhost:11434
   MODEL           = llama3.2
   ```

4. Click the terminal **restart** button (↺) to re-run with the new env vars.
</Steps>
```

- [ ] **Step 3: Verify page builds without errors**

```bash
cd apps/docs && bun run build 2>&1 | tail -20
```

Expected: build completes without broken link or MDX errors.

- [ ] **Step 4: Commit**

```bash
git add apps/docs/src/content/docs/guides/playground.mdx
git commit -m "feat(docs): add interactive playground page with 3 Stackblitz scenarios"
```

---

## Task 6: CI validation — verify no workspace:* leakage

**Files:**
- No new files — validate via existing CI or a shell check

These Stackblitz projects must never contain `workspace:*` references. If they do, Stackblitz can't resolve deps from the npm registry.

- [ ] **Step 1: Run validation check**

```bash
grep -r "workspace:" apps/stackblitz/ && echo "FAIL: workspace:* found" || echo "PASS: no workspace refs"
```

Expected output:
```
PASS: no workspace refs
```

- [ ] **Step 2: Type-check each scenario**

```bash
cd apps/stackblitz/01-hello-agent && npm install --prefer-offline 2>/dev/null || npx --yes tsx --version > /dev/null
npx tsc --noEmit --skipLibCheck 2>&1 | head -10
cd ../02-tool-integration && npx tsc --noEmit --skipLibCheck 2>&1 | head -10
cd ../03-strategy-demo && npx tsc --noEmit --skipLibCheck 2>&1 | head -10
cd ../../..
```

Expected: zero TypeScript errors across all three.

Note: `npm install` requires network access. In CI, run this step only when connectivity is available. If running offline, use `--prefer-offline` to skip if cache is cold.

- [ ] **Step 3: Add workspace-leak guard to monorepo AGENTS.md**

Open `AGENTS.md` and add to the pre-commit checklist section (or create one if absent):

```markdown
## Stackblitz examples guard
apps/stackblitz/ contains standalone npm projects. Never add workspace:* deps to
any package.json under apps/stackblitz/. Run:
  grep -r "workspace:" apps/stackblitz/ && echo FAIL || echo PASS
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "chore: add Stackblitz workspace-leak guard to AGENTS.md"
```

---

## Task 7: Smoke-test the full playground (manual)

This task is manual — verify the end-to-end experience works in a real browser with a real Stackblitz boot.

- [ ] **Step 1: Push branch and open Stackblitz embed URLs**

For each scenario, open the embed URL directly to verify it boots:

```
https://stackblitz.com/github/tylerjrbuell/reactive-agents-ts/tree/main/apps/stackblitz/01-hello-agent?embed=1&file=src%2Fagent.ts&terminal=start
https://stackblitz.com/github/tylerjrbuell/reactive-agents-ts/tree/main/apps/stackblitz/02-tool-integration?embed=1&file=src%2Fagent.ts&terminal=start
https://stackblitz.com/github/tylerjrbuell/reactive-agents-ts/tree/main/apps/stackblitz/03-strategy-demo?embed=1&file=src%2Fagent.ts&terminal=start
```

- [ ] **Step 2: Verify no-key behavior**

In each scenario, open the terminal tab without adding any Secrets. Expected:
- Setup instructions print to terminal
- Process exits cleanly (exit 0)
- No stack trace, no crash

- [ ] **Step 3: Verify with Gemini free key**

Add `GOOGLE_API_KEY=<your-key>` to Stackblitz Secrets and restart each terminal.
Expected for each:
- Agent runs and prints a response
- Stats (steps/tokens/cost) print at the end

- [ ] **Step 4: Verify docs page renders**

Run `bun run dev` in `apps/docs/` and visit `http://localhost:4321/guides/playground/`.
Expected:
- "Interactive Playground" appears in sidebar under Getting Started
- "New" badge visible
- Three tabs: Hello Agent / Tool Integration / Strategy Demo
- Iframes render with Stackblitz editor + terminal layout

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -p  # stage only relevant changes
git commit -m "fix(stackblitz): smoke-test fixups"
```

---

## Acceptance Criteria

From the design spec:

- [ ] All 3 scenarios boot in Stackblitz and print setup instructions when no key is set
- [ ] With a valid `GOOGLE_API_KEY`, all 3 scenarios complete successfully
- [ ] With Ollama running + `OLLAMA_ORIGINS=*`, scenario 01 runs via local model (Chrome only)
- [ ] Docs playground page loads; iframes render lazily on scroll
- [ ] Tabs switch between scenarios without page reload
- [ ] No `workspace:*` references in any `apps/stackblitz/` package
- [ ] v0.12 extension hook (`OLLAMA_BRIDGE_EXTENSION` env var) present in scenarios 01 and 02 but no-op
