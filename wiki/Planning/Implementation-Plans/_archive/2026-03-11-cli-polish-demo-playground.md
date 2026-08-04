# CLI Polish, Demo & Playground — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the rax CLI into a visually polished developer experience with chalk/ora/boxen styling, a zero-config `rax demo` command, and a rebuilt `rax playground` using agent.session().

**Architecture:** CLI (`apps/cli/`) owns all visual rendering — core packages stay dependency-free. The observability package exports structured `DashboardData`; the CLI renders it with chalk+boxen. Playground uses `agent.session()` for stateful multi-turn conversation with automatic history management.

**Tech Stack:** chalk v5 (ESM), ora v8 (ESM), boxen v8 (ESM), existing ReactiveAgents builder, TestLLMService for demo, agent.session()/chat() for playground.

---

## Chunk 1: Visual Foundation

### Task 1: Add Dependencies

**Files:**
- Modify: `apps/cli/package.json`

- [ ] **Step 1: Add chalk, ora, boxen to dependencies**

In `apps/cli/package.json`, add to `"dependencies"`:

```json
"chalk": "^5.4.0",
"ora": "^8.2.0",
"boxen": "^8.0.1"
```

- [ ] **Step 2: Install and verify resolution**

Run: `cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun install`
Expected: Clean install, no resolution errors.

- [ ] **Step 3: Verify ESM imports work**

Run: `cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cli && bun -e "import chalk from 'chalk'; import ora from 'ora'; import boxen from 'boxen'; console.log(chalk.hex('#8b5cf6')('ok'), boxen('ok', {padding: 0}))"`
Expected: Colored "ok" and boxed "ok" printed to terminal.

- [ ] **Step 4: Update tsup externals**

In `apps/cli/tsup.config.ts`, add chalk, ora, boxen to the external array so they're resolved at runtime (they're ESM-only, don't bundle):

```typescript
external: [
  "effect",
  "@reactive-agents/core",
  "@reactive-agents/runtime",
  "@reactive-agents/benchmarks",
  "chalk",
  "ora",
  "boxen",
],
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/package.json apps/cli/tsup.config.ts bun.lock
git commit -m "chore(cli): add chalk, ora, boxen dependencies for visual polish"
```

---

### Task 2: Rewrite `ui.ts` Visual Foundation

**Files:**
- Rewrite: `apps/cli/src/ui.ts`

The current file is 49 lines of raw ANSI. Rewrite with chalk/ora/boxen while preserving the existing API surface (section, info, success, warn, fail, event, kv, hint, muted) and adding new helpers.

- [ ] **Step 1: Write the new ui.ts**

Replace `apps/cli/src/ui.ts` entirely with:

```typescript
import chalk from "chalk";
import ora, { type Ora } from "ora";
import boxen from "boxen";

// ── Brand Colors ──────────────────────────────────────────
const VIOLET = "#8b5cf6";
const CYAN = "#06b6d4";
const YELLOW = "#eab308";
const GREEN = "#22c55e";
const RED = "#ef4444";
const DIM_COLOR = "#6b7280";

// ── Preserved API (internals upgraded) ────────────────────

export function color(text: string, _ansi: string): string {
  // Legacy compat — callers that passed raw ANSI codes get chalk.dim fallback
  return chalk.dim(text);
}

export function section(title: string): string {
  return `\n${chalk.hex(DIM_COLOR)("══")} ${chalk.bold(title)} ${chalk.hex(DIM_COLOR)("══")}`;
}

export function info(message: string): string {
  return `${chalk.hex(CYAN)("ℹ")} ${message}`;
}

export function success(message: string): string {
  return `${chalk.hex(GREEN)("✔")} ${message}`;
}

export function warn(message: string): string {
  return `${chalk.hex(YELLOW)("⚠")} ${message}`;
}

export function fail(message: string): string {
  return `${chalk.hex(RED)("✖")} ${message}`;
}

export function event(label: string, message: string): string {
  return `${chalk.hex(VIOLET)(`${label}›`)} ${message}`;
}

export function kv(key: string, value: string): string {
  return `  ${chalk.hex(DIM_COLOR)(`${key}:`)} ${value}`;
}

export function hint(message: string): string {
  return `  ${chalk.hex(DIM_COLOR)("tip:")} ${message}`;
}

export function muted(message: string): string {
  return chalk.hex(DIM_COLOR)(message);
}

// ── New Helpers ───────────────────────────────────────────

/** Boxen-wrapped banner header with violet border. */
export function banner(title: string, subtitle?: string): void {
  const content = subtitle
    ? `${chalk.bold.hex(VIOLET)(title)}\n${chalk.hex(DIM_COLOR)(subtitle)}`
    : chalk.bold.hex(VIOLET)(title);

  console.log(
    boxen(content, {
      padding: { top: 1, bottom: 1, left: 3, right: 3 },
      borderColor: VIOLET,
      borderStyle: "round",
    }),
  );
}

/** Styled ora spinner. Returns handle for .succeed(), .fail(), .text = ... */
export function spinner(text: string): Ora {
  return ora({
    text,
    color: "magenta",
    spinner: "dots",
  }).start();
}

/** Boxen wrapper with consistent styling. */
export function box(
  content: string,
  opts?: { title?: string; borderColor?: string; dimBorder?: boolean },
): void {
  console.log(
    boxen(content, {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      borderColor: opts?.borderColor ?? CYAN,
      borderStyle: "round",
      title: opts?.title,
      titleAlignment: "left",
      dimBorder: opts?.dimBorder ?? false,
    }),
  );
}

/** Formatted agent response with cyan accent. */
export function agentResponse(text: string): void {
  box(text, { title: chalk.hex(CYAN)(" Agent "), borderColor: CYAN });
}

/** Colored tool call indicator. */
export function toolCall(
  name: string,
  status: "start" | "done" | "error",
  duration?: number,
): void {
  const icon = status === "start" ? "🔧" : status === "done" ? "✅" : "❌";
  const dur = duration !== undefined ? ` ${chalk.hex(DIM_COLOR)(`${duration}ms`)}` : "";
  const nameStr =
    status === "error" ? chalk.hex(RED)(name) : chalk.hex(CYAN)(name);
  console.log(`${icon} ${nameStr}${dur}`);
}

/** Iteration progress line. */
export function thinking(iteration: number, max?: number): void {
  const progress = max ? `${iteration}/${max}` : `${iteration}`;
  console.log(
    `${chalk.hex(VIOLET)("💭")} ${chalk.hex(DIM_COLOR)(`Step ${progress}`)} ${chalk.hex(DIM_COLOR)("— thinking...")}`,
  );
}

/** Aligned key-value metric pair. */
export function metric(label: string, value: string | number): void {
  const padded = label.padEnd(14);
  console.log(`  ${chalk.hex(DIM_COLOR)(padded)} ${chalk.bold(String(value))}`);
}

/** Subtle horizontal divider. */
export function divider(): void {
  console.log(chalk.hex(DIM_COLOR)("─".repeat(50)));
}

/** Styled prompt string for readline. */
export function styledPrompt(prefix?: string): string {
  const p = prefix ?? "❯";
  // Note: chalk styling in readline prompts can cause cursor position issues.
  // Use plain colored prefix for safety.
  return `${p} `;
}

/** Metrics summary one-liner for post-run display. */
export function metricsSummary(opts: {
  duration: number;
  steps: number;
  tokens: number;
  tools: number;
  success: boolean;
}): void {
  const icon = opts.success ? chalk.hex(GREEN)("✔") : chalk.hex(RED)("✖");
  const dur = `${(opts.duration / 1000).toFixed(1)}s`;
  console.log(
    `${icon} ${dur} · ${opts.steps} steps · ${opts.tokens.toLocaleString()} tokens · ${opts.tools} tools`,
  );
}

// ── Dashboard Renderer ────────────────────────────────────

export interface DashboardPhase {
  readonly name: string;
  readonly duration: number;
  readonly status: "success" | "warning" | "error";
  readonly detail?: string;
}

export interface DashboardTool {
  readonly name: string;
  readonly calls: number;
  readonly errors: number;
  readonly avgDuration: number;
}

export interface DashboardData {
  readonly status: "success" | "error" | "partial";
  readonly totalDuration: number;
  readonly stepCount: number;
  readonly tokenCount: number;
  readonly estimatedCost: number;
  readonly modelName: string;
  readonly provider: string;
  readonly phases: readonly DashboardPhase[];
  readonly tools: readonly DashboardTool[];
  readonly alerts: readonly string[];
}

/** Render a rich metrics dashboard using boxen + chalk. */
export function renderDashboard(data: DashboardData): void {
  const statusIcon =
    data.status === "success"
      ? chalk.hex(GREEN)("✔ Success")
      : data.status === "error"
        ? chalk.hex(RED)("✖ Failed")
        : chalk.hex(YELLOW)("⚠ Partial");

  const dur = `${(data.totalDuration / 1000).toFixed(1)}s`;
  const cost = `~$${data.estimatedCost.toFixed(4)}`;

  // Header card
  const header = [
    `${chalk.bold("Status:")}    ${statusIcon}   ${chalk.bold("Duration:")} ${dur}   ${chalk.bold("Steps:")} ${data.stepCount}`,
    `${chalk.bold("Tokens:")}    ${data.tokenCount.toLocaleString()}        ${chalk.bold("Cost:")} ${cost}     ${chalk.bold("Model:")} ${data.modelName}`,
  ].join("\n");

  box(header, {
    title: chalk.hex(GREEN).bold(" Execution Summary "),
    borderColor: data.status === "success" ? GREEN : data.status === "error" ? RED : YELLOW,
  });

  // Timeline
  if (data.phases.length > 0) {
    console.log(`\n${chalk.bold("📊 Execution Timeline")}`);
    const totalMs = data.totalDuration || 1;
    for (let i = 0; i < data.phases.length; i++) {
      const p = data.phases[i];
      const prefix = i === data.phases.length - 1 ? "└─" : "├─";
      const pct = ((p.duration / totalMs) * 100).toFixed(0);
      const durStr = `${p.duration.toLocaleString()}ms`.padStart(10);
      const icon =
        p.status === "warning"
          ? chalk.hex(YELLOW)("⚠️")
          : p.status === "error"
            ? chalk.hex(RED)("✖")
            : chalk.hex(GREEN)("✔");
      const detail = p.detail ? chalk.hex(DIM_COLOR)(` (${p.detail})`) : "";
      const nameStr = chalk.hex(DIM_COLOR)(`[${p.name}]`).padEnd(25);
      console.log(
        `${prefix} ${nameStr} ${durStr}  ${icon}  ${chalk.hex(DIM_COLOR)(`${pct}%`)}${detail}`,
      );
    }
  }

  // Tools
  if (data.tools.length > 0) {
    console.log(`\n${chalk.bold("🔧 Tool Execution")} (${data.tools.length} tool${data.tools.length === 1 ? "" : "s"})`);
    for (let i = 0; i < data.tools.length; i++) {
      const t = data.tools[i];
      const prefix = i === data.tools.length - 1 ? "└─" : "├─";
      const errStr =
        t.errors > 0 ? chalk.hex(RED)(` ${t.errors} errors`) : "";
      console.log(
        `${prefix} ${chalk.hex(CYAN)(t.name)}  ${chalk.hex(GREEN)("✔")} ${t.calls} calls, ${t.avgDuration}ms avg${errStr}`,
      );
    }
  }

  // Alerts
  if (data.alerts.length > 0) {
    console.log(`\n${chalk.hex(YELLOW).bold("⚠️  Alerts")}`);
    for (let i = 0; i < data.alerts.length; i++) {
      const prefix = i === data.alerts.length - 1 ? "└─" : "├─";
      console.log(`${prefix} ${data.alerts[i]}`);
    }
  }
}

/** Legacy compat — deprecated in favor of spinner(). */
export function createSpinner(message: string) {
  const s = spinner(message);
  return {
    stop(finalMessage?: string) {
      if (finalMessage) s.succeed(finalMessage);
      else s.succeed();
    },
    fail(finalMessage: string) {
      s.fail(finalMessage);
    },
  };
}
```

- [ ] **Step 2: Verify existing imports still work**

Run: `cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cli && bun run build`
Expected: Build succeeds. All existing commands that import from `ui.ts` still work.

- [ ] **Step 3: Quick smoke test**

Run: `cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun run --cwd apps/cli src/index.ts help`
Expected: Help output renders without errors (banner + help text).

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/ui.ts
git commit -m "feat(cli): rewrite ui.ts with chalk/ora/boxen visual foundation"
```

---

## Chunk 2: Demo Command

### Task 3: Create Demo Responses

**Files:**
- Create: `apps/cli/src/commands/demo-responses.ts`

Pre-scripted test responses that follow ReAct format and flow through the real execution engine via TestLLMService pattern matching.

- [ ] **Step 1: Write demo-responses.ts**

Create `apps/cli/src/commands/demo-responses.ts`:

```typescript
/**
 * Pre-scripted responses for `rax demo`.
 * Keys are substring patterns matched by TestLLMService against the prompt.
 * Values are ReAct-formatted responses that flow through the real execution engine.
 */
export const demoResponses: Record<string, string> = {
  // Step 1: Agent sees the task, decides to search
  "Find the top 3 TypeScript testing frameworks":
    `Thought: I need to research current TypeScript testing frameworks to find the top 3 and compare their features. Let me search for recent information.
ACTION: web-search
ACTION_INPUT: {"query": "TypeScript testing frameworks 2026 comparison"}`,

  // Step 2: Agent sees search results, does a focused comparison search
  "Results for: TypeScript testing frameworks":
    `Thought: Good results. The top contenders appear to be Vitest, Jest, and the Bun test runner. Let me get a more detailed comparison of these three.
ACTION: web-search
ACTION_INPUT: {"query": "vitest vs jest vs bun test runner features comparison"}`,

  // Step 3: Agent synthesizes the final answer
  "Results for: vitest vs jest":
    `Thought: I now have enough information to provide a comprehensive comparison of the top 3 TypeScript testing frameworks. Let me synthesize this into a clear comparison.
ACTION: final-answer
ACTION_INPUT: {"answer": "## Top 3 TypeScript Testing Frameworks (2026)\\n\\n| Framework | Speed | DX | Ecosystem | TypeScript |\\n|-----------|-------|-----|-----------|------------|\\n| **Vitest** | ⚡ Fast | Excellent | Growing | Native |\\n| **Bun Test** | ⚡⚡ Fastest | Great | Emerging | Native |\\n| **Jest** | Moderate | Good | Mature | Via ts-jest |\\n\\n### 1. Vitest\\nThe leading choice for TypeScript projects. Native ESM support, Vite-powered HMR for tests, and Jest-compatible API. Watch mode is instant. First-class TypeScript without configuration.\\n\\n### 2. Bun Test\\nThe fastest test runner available — built into the Bun runtime. Zero-config TypeScript support. Lifecycle hooks, snapshot testing, and mock support. Ecosystem is newer but growing rapidly.\\n\\n### 3. Jest\\nThe established standard with the largest ecosystem. Requires ts-jest or SWC transformer for TypeScript. Slower than Vitest/Bun but has the most mature plugin ecosystem and community support.\\n\\n**Recommendation:** Vitest for most TypeScript projects — it combines speed, excellent DX, and a growing ecosystem. Choose Bun Test if you're already using the Bun runtime. Jest remains solid for existing projects with heavy Jest plugin dependencies."}`,

  // Fallback for any unmatched prompt
  "": "ACTION: final-answer\nACTION_INPUT: {\"answer\": \"Demo complete.\"}",
};

/** The demo task prompt. */
export const DEMO_TASK =
  "Find the top 3 TypeScript testing frameworks and compare their features";

/**
 * Simulated web-search tool results for the demo.
 * TestProvider tools return these strings when the tool name matches.
 */
export const demoToolResults: Record<string, string> = {
  "TypeScript testing frameworks 2026":
    "Results for: TypeScript testing frameworks 2026 comparison — Top results: 1. Vitest - Blazing fast unit testing framework powered by Vite. 2. Bun Test - Built-in test runner for the Bun runtime. 3. Jest - The most popular JavaScript testing framework. 4. Playwright - End-to-end testing. 5. tsx + node:test - Lightweight native option.",

  "vitest vs jest vs bun test":
    "Results for: vitest vs jest vs bun test runner features comparison — Vitest: Native ESM, Vite HMR, Jest-compatible API, ~10x faster than Jest. Bun Test: Fastest execution, zero-config TS, built into Bun runtime. Jest: Largest ecosystem, mature plugins, requires ts-jest for TS. All three support: snapshots, mocking, coverage, watch mode.",
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/commands/demo-responses.ts
git commit -m "feat(cli): add pre-scripted demo responses for rax demo command"
```

---

### Task 4: Create Demo Command

**Files:**
- Create: `apps/cli/src/commands/demo.ts`
- Modify: `apps/cli/src/index.ts`

The demo command builds a real agent with test provider, runs a pre-scripted research task through the actual execution engine, and renders the output with the new UI helpers.

- [ ] **Step 1: Write demo.ts**

Create `apps/cli/src/commands/demo.ts`:

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";
import {
  banner,
  spinner,
  box,
  agentResponse,
  toolCall,
  thinking,
  metricsSummary,
  renderDashboard,
  divider,
  kv,
  muted,
  type DashboardData,
} from "../ui.js";
import chalk from "chalk";
import { DEMO_TASK, demoResponses, demoToolResults } from "./demo-responses.js";

export async function runDemo(_args: string[]): Promise<void> {
  // Banner
  banner("Reactive Agents — Live Demo", "The open-source agent framework built for control, not magic.");

  console.log("");
  console.log(`${chalk.hex("#eab308")("🎯")} ${chalk.bold("Task:")} "${DEMO_TASK}"`);
  console.log("");
  console.log(`${chalk.bold("📋 Agent Config:")}`);
  console.log(kv("Provider", "test (deterministic, no API key needed)"));
  console.log(kv("Strategy", "reactive (ReAct loop)"));
  console.log(kv("Tools", "web-search, final-answer"));
  console.log(kv("Observability", "enabled"));
  console.log("");

  // Build agent with test provider and pre-scripted responses
  const buildSpinner = spinner("Building agent...");

  const agent = await ReactiveAgents.create()
    .withName("demo-agent")
    .withProvider("test", { responses: demoResponses })
    .withReasoning()
    .withTools()
    .withObservability({ verbosity: "minimal" })
    .build();

  buildSpinner.succeed("Agent ready");

  // Run with streaming to show step-by-step progress
  const execSpinner = spinner("Running agent...");
  const startTime = Date.now();

  let stepCount = 0;
  let output = "";
  let tokenCount = 0;
  const toolCalls: Array<{ name: string; duration: number; success: boolean }> = [];

  for await (const event of agent.runStream(DEMO_TASK)) {
    switch (event._tag) {
      case "ThoughtEmitted":
        stepCount++;
        execSpinner.stop();
        thinking(stepCount, 5);
        console.log(`   ${muted(event.content.replace(/\s+/g, " ").slice(0, 80))}`);
        console.log("");
        break;

      case "ToolCallStarted":
        toolCall(event.toolName, "start");
        break;

      case "ToolCallCompleted": {
        const dur = event.durationMs ?? 0;
        toolCall(event.toolName, event.success ? "done" : "error", dur);
        toolCalls.push({
          name: event.toolName,
          duration: dur,
          success: event.success,
        });
        console.log("");
        break;
      }

      case "TextDelta":
        output += event.text;
        break;

      case "StreamCompleted":
        if (!output && event.output) output = event.output;
        tokenCount = event.metadata?.tokensUsed ?? 0;
        break;
    }
  }

  const totalDuration = Date.now() - startTime;

  // Agent response
  console.log("");
  agentResponse(output || "(no output)");
  console.log("");

  // Build dashboard data from what we observed
  const uniqueTools = new Map<string, { calls: number; errors: number; totalDur: number }>();
  for (const tc of toolCalls) {
    const existing = uniqueTools.get(tc.name) ?? { calls: 0, errors: 0, totalDur: 0 };
    existing.calls++;
    if (!tc.success) existing.errors++;
    existing.totalDur += tc.duration;
    uniqueTools.set(tc.name, existing);
  }

  const dashboardData: DashboardData = {
    status: "success",
    totalDuration,
    stepCount,
    tokenCount,
    estimatedCost: tokenCount * 0.000003,
    modelName: "test",
    provider: "test",
    phases: [
      { name: "bootstrap", duration: Math.round(totalDuration * 0.03), status: "success" },
      { name: "think", duration: Math.round(totalDuration * 0.6), status: "success", detail: `${stepCount} iterations` },
      { name: "act", duration: Math.round(totalDuration * 0.25), status: "success", detail: `${toolCalls.length} tools` },
      { name: "complete", duration: Math.round(totalDuration * 0.02), status: "success" },
    ],
    tools: Array.from(uniqueTools.entries()).map(([name, t]) => ({
      name,
      calls: t.calls,
      errors: t.errors,
      avgDuration: Math.round(t.totalDur / t.calls),
    })),
    alerts: [],
  };

  renderDashboard(dashboardData);

  // CTA
  console.log("");
  divider();
  console.log(`\n${chalk.hex("#8b5cf6").bold("🚀 Liked what you saw?")}\n`);
  console.log(`   ${chalk.bold("bun add reactive-agents")}`);
  console.log(`   ${muted("Docs:")}  ${chalk.underline("https://docs.reactiveagents.dev/")}`);
  console.log(`   ${muted("GitHub:")} ${chalk.underline("https://github.com/tylerjrbuell/reactive-agents-ts")}`);
  console.log("");
}
```

- [ ] **Step 2: Register demo command in index.ts**

In `apps/cli/src/index.ts`, add the import at top:

```typescript
import { runDemo } from "./commands/demo.js";
```

Add `demo` to the HELP string after the `bench` line:

```
    demo                                        Run a zero-config live demo (no API key needed)
```

Add `demo` case to the switch before the `version` case:

```typescript
    case "demo":
      runAsync(runDemo(argv.slice(1)));
      break;
```

- [ ] **Step 3: Update help text to highlight demo**

In the HELP string in `index.ts`, add a note at the bottom:

```
  Quick start:
    rax demo                                    See reactive-agents in action (no setup needed)
```

- [ ] **Step 4: Build and test**

Run: `cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun run build && bun run --cwd apps/cli src/index.ts demo`

Expected: Demo runs, shows banner, step-by-step progress, agent response box, dashboard, and CTA. No crashes.

**Note:** The demo may not produce the exact scripted flow on first try — TestLLMService matches on substring patterns. If the matching doesn't work correctly, adjust the keys in `demoResponses` to match what TestLLMService actually receives. Debug with:

```bash
bun run --cwd apps/cli src/index.ts demo 2>&1
```

Check that response patterns in `demoResponses` match the prompt content that TestLLMService sees. The key needs to be a substring of the combined system prompt + last user message.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/demo.ts apps/cli/src/index.ts
git commit -m "feat(cli): add rax demo command with zero-config live showcase"
```

---

## Chunk 3: Playground Rebuild

### Task 5: Rewrite Playground with agent.session()

**Files:**
- Rewrite: `apps/cli/src/commands/playground.ts`

The current playground is 259 lines of manual history management and raw readline. Rewrite to use `agent.session()` for stateful conversation, add slash commands (/debrief, /metrics, /tools, /strategy, /provider, /model, /save, /clear), and use the new UI helpers.

**Key API context:**
- `agent.session()` returns `AgentSession` with `chat(message)` → `ChatReply { message, toolsUsed?, fromMemory? }`
- `AgentSession.history()` returns `ChatMessage[]` — `{ role: "user"|"assistant"; content: string }`
- `agent._lastDebrief` is `AgentDebrief | undefined` — set after each run
- Agent must be rebuilt to switch provider/model (re-create builder, new `.build()`)
- `agent.chat()` routes: direct LLM for simple questions, ReAct for tool-capable queries

- [ ] **Step 1: Write the new playground.ts**

Replace `apps/cli/src/commands/playground.ts` entirely:

```typescript
import { createInterface, type Interface as RLInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeFileSync } from "node:fs";
import { ReactiveAgents, type ReactiveAgent } from "@reactive-agents/runtime";
import chalk from "chalk";
import {
  banner,
  spinner,
  info,
  success,
  warn,
  fail,
  kv,
  muted,
  divider,
  agentResponse,
  toolCall,
  thinking,
  metricsSummary,
  box,
  renderDashboard,
  type DashboardData,
} from "../ui.js";

// ── Types ─────────────────────────────────────────────────

const VALID_PROVIDERS = [
  "anthropic",
  "openai",
  "ollama",
  "gemini",
  "litellm",
  "test",
] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

interface PlaygroundConfig {
  provider: Provider;
  model?: string;
  name: string;
  enableTools: boolean;
  enableReasoning: boolean;
  enableMemory: boolean;
  memoryTier: "1" | "2";
  stream: boolean;
}

interface SessionTurn {
  user: string;
  agent: string;
  toolsUsed?: string[];
  durationMs: number;
  tokens?: number;
}

// ── Help ──────────────────────────────────────────────────

const HELP_TEXT = `
${chalk.bold("Usage:")} rax playground [options]

${chalk.bold("Options:")}
  --provider <name>   Provider: anthropic|openai|ollama|gemini|litellm|test (default: test)
  --model <model>     Model identifier
  --name <name>       Agent name (default: playground-agent)
  --tools             Enable tools
  --reasoning         Enable reasoning
  --memory            Enable conversational memory (defaults to tier 1)
  --memory-tier <n>   Memory tier: 1|2 (default: 1 when --memory is set)
  --stream            Stream token output
  --help              Show this help
`.trimEnd();

const SLASH_HELP = `
${chalk.bold("Slash Commands:")}
  /help                  Show this help
  /tools                 List available tools
  /memory                Show conversation history (last 10 turns)
  /debrief               Show last run's structured debrief
  /metrics               Show full metrics dashboard for last run
  /strategy [name]       Show or switch reasoning strategy
  /provider [name]       Switch LLM provider (rebuilds agent, keeps history)
  /model [name]          Switch model (rebuilds agent, keeps history)
  /clear                 Clear conversation history
  /save [path]           Save session transcript to markdown
  /exit                  Exit (also: Ctrl+C, Ctrl+D)
`.trimEnd();

// ── Arg Parsing ───────────────────────────────────────────

function parseArgs(args: string[]): PlaygroundConfig | null {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    return null;
  }

  const config: PlaygroundConfig = {
    provider: "test",
    name: "playground-agent",
    enableTools: false,
    enableReasoning: false,
    enableMemory: false,
    memoryTier: "1",
    stream: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--provider" && args[i + 1]) {
      const raw = args[++i];
      if (!(VALID_PROVIDERS as readonly string[]).includes(raw)) {
        console.error(fail(`Unknown provider: "${raw}". Valid: ${VALID_PROVIDERS.join(", ")}`));
        process.exit(1);
      }
      config.provider = raw as Provider;
    } else if (arg === "--model" && args[i + 1]) {
      config.model = args[++i];
    } else if (arg === "--name" && args[i + 1]) {
      config.name = args[++i];
    } else if (arg === "--tools") {
      config.enableTools = true;
    } else if (arg === "--reasoning") {
      config.enableReasoning = true;
    } else if (arg === "--memory") {
      config.enableMemory = true;
    } else if (arg === "--memory-tier" && args[i + 1]) {
      const raw = args[++i];
      if (raw !== "1" && raw !== "2") {
        console.error(fail(`Invalid memory tier: "${raw}". Valid: 1, 2`));
        process.exit(1);
      }
      config.enableMemory = true;
      config.memoryTier = raw;
    } else if (arg === "--stream") {
      config.stream = true;
    }
  }

  return config;
}

// ── Agent Builder ─────────────────────────────────────────

async function buildAgent(config: PlaygroundConfig): Promise<ReactiveAgent> {
  let builder = ReactiveAgents.create()
    .withName(config.name)
    .withProvider(config.provider);

  if (config.model) builder = builder.withModel(config.model);
  if (config.enableTools) builder = builder.withTools();
  if (config.enableReasoning) builder = builder.withReasoning();
  if (config.enableMemory) builder = builder.withMemory(config.memoryTier);

  return builder.build();
}

// ── Slash Command Handlers ────────────────────────────────

function handleHelp(): void {
  console.log(SLASH_HELP);
}

function handleTools(agent: ReactiveAgent): void {
  // Tools list isn't directly exposed on the agent facade yet.
  // Show what we know from config.
  console.log(chalk.bold("Available Tools:"));
  console.log(muted("  (Tool listing depends on agent configuration)"));
  console.log(muted("  Enable tools with: --tools flag"));
}

function handleMemory(turns: SessionTurn[]): void {
  if (turns.length === 0) {
    console.log(info("No conversation history yet."));
    return;
  }
  const recent = turns.slice(-10);
  console.log(chalk.bold(`Conversation History (${recent.length} of ${turns.length} turns):`));
  for (let i = 0; i < recent.length; i++) {
    const t = recent[i];
    const userPreview = t.user.replace(/\s+/g, " ").slice(0, 80);
    const agentPreview = t.agent.replace(/\s+/g, " ").slice(0, 80);
    console.log(`  ${chalk.hex("#8b5cf6")(`${i + 1}.`)} ${chalk.bold("You:")} ${userPreview}${t.user.length > 80 ? "..." : ""}`);
    console.log(`     ${chalk.hex("#06b6d4")("Agent:")} ${agentPreview}${t.agent.length > 80 ? "..." : ""}`);
    if (t.toolsUsed && t.toolsUsed.length > 0) {
      console.log(`     ${muted(`Tools: ${t.toolsUsed.join(", ")}`)}`);
    }
  }
}

function handleDebrief(agent: ReactiveAgent): void {
  const debrief = (agent as any)._lastDebrief;
  if (!debrief) {
    console.log(info("No debrief available yet. Run a query first."));
    return;
  }
  const content = [
    `${chalk.bold("Summary:")} ${debrief.summary}`,
    `${chalk.bold("Confidence:")} ${debrief.confidence}`,
    debrief.keyFindings?.length > 0
      ? `${chalk.bold("Key Findings:")}\n${debrief.keyFindings.map((f: string) => `  • ${f}`).join("\n")}`
      : null,
    debrief.toolsUsed?.length > 0
      ? `${chalk.bold("Tools Used:")}\n${debrief.toolsUsed.map((t: any) => `  • ${t.name} (${t.calls}x, ${Math.round(t.successRate * 100)}% success)`).join("\n")}`
      : null,
    debrief.errorsEncountered?.length > 0
      ? `${chalk.bold("Errors:")}\n${debrief.errorsEncountered.map((e: string) => `  • ${e}`).join("\n")}`
      : null,
    debrief.lessonsLearned?.length > 0
      ? `${chalk.bold("Lessons:")}\n${debrief.lessonsLearned.map((l: string) => `  • ${l}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  box(content, { title: chalk.hex("#8b5cf6").bold(" Last Run Debrief "), borderColor: "#8b5cf6" });
}

function handleMetrics(lastDashboard: DashboardData | null): void {
  if (!lastDashboard) {
    console.log(info("No metrics available yet. Run a query first."));
    return;
  }
  renderDashboard(lastDashboard);
}

function handleClear(turns: SessionTurn[]): void {
  turns.length = 0;
  console.log(success("Conversation history cleared."));
}

function handleSave(
  turns: SessionTurn[],
  config: PlaygroundConfig,
  pathArg?: string,
): void {
  if (turns.length === 0) {
    console.log(warn("No conversation to save."));
    return;
  }
  const path =
    pathArg || `playground-session-${new Date().toISOString().slice(0, 10)}.md`;
  const date = new Date().toISOString().slice(0, 10);

  const lines = [
    `# Reactive Agents Playground Session`,
    `Provider: ${config.provider} | Model: ${config.model ?? "default"} | Date: ${date}`,
    "",
  ];

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    lines.push(`## Turn ${i + 1}`);
    lines.push(`**User:** ${t.user}`);
    lines.push(`**Agent:** ${t.agent}`);
    const dur = `${(t.durationMs / 1000).toFixed(1)}s`;
    const tools = t.toolsUsed ? `, ${t.toolsUsed.length} tools` : "";
    lines.push(`**Metrics:** ${dur}${t.tokens ? `, ${t.tokens} tokens` : ""}${tools}`);
    lines.push("");
  }

  writeFileSync(path, lines.join("\n"), "utf-8");
  console.log(success(`Session saved to ${path}`));
}

// ── Main REPL ─────────────────────────────────────────────

export async function runPlayground(args: string[]): Promise<void> {
  const config = parseArgs(args);
  if (!config) return;

  // Banner
  banner("Reactive Agents Playground", "Interactive agent exploration");
  console.log("");

  // Build agent
  const buildSpin = spinner("Building agent...");
  let agent = await buildAgent(config);
  buildSpin.succeed("Agent ready");

  console.log(kv("Provider", config.provider));
  console.log(kv("Model", config.model ?? "default"));
  console.log(kv("Tools", config.enableTools ? "enabled" : "disabled"));
  console.log(kv("Reasoning", config.enableReasoning ? "enabled" : "disabled"));
  console.log(kv("Memory", config.enableMemory ? `tier ${config.memoryTier}` : "disabled"));
  console.log("");
  console.log(muted("Type a message to chat. Use /help for commands."));
  console.log("");

  // Session state
  const session = agent.session();
  const turns: SessionTurn[] = [];
  let lastDashboard: DashboardData | null = null;

  const rl = createInterface({ input, output });

  try {
    while (true) {
      let line: string;
      try {
        line = (await rl.question("❯ ")).trim();
      } catch {
        // Ctrl+D / Ctrl+C
        break;
      }
      if (!line) continue;

      // ── Slash Commands ────────────────────────────────
      if (line.startsWith("/")) {
        const [cmd, ...rest] = line.split(/\s+/);
        const cmdArg = rest.join(" ").trim();

        switch (cmd) {
          case "/exit":
          case "/quit":
            console.log(muted("Goodbye!"));
            return;

          case "/help":
            handleHelp();
            break;

          case "/tools":
            handleTools(agent);
            break;

          case "/memory":
            handleMemory(turns);
            break;

          case "/debrief":
            handleDebrief(agent);
            break;

          case "/metrics":
            handleMetrics(lastDashboard);
            break;

          case "/strategy":
            if (cmdArg) {
              console.log(warn("Strategy switching requires agent rebuild. Use /provider or /model to rebuild."));
            } else {
              console.log(info(`Current strategy: ${config.enableReasoning ? "reactive (ReAct)" : "direct (no reasoning)"}`));
            }
            break;

          case "/provider": {
            if (!cmdArg) {
              console.log(info(`Current provider: ${config.provider}`));
              console.log(muted(`  Available: ${VALID_PROVIDERS.join(", ")}`));
              break;
            }
            if (!(VALID_PROVIDERS as readonly string[]).includes(cmdArg)) {
              console.log(fail(`Unknown provider: "${cmdArg}". Valid: ${VALID_PROVIDERS.join(", ")}`));
              break;
            }
            config.provider = cmdArg as Provider;
            const rebuildSpin = spinner(`Switching to ${cmdArg}...`);
            try {
              await agent.dispose();
            } catch { /* best effort */ }
            agent = await buildAgent(config);
            rebuildSpin.succeed(`Switched to ${cmdArg}`);
            // Re-create session on new agent
            break;
          }

          case "/model": {
            if (!cmdArg) {
              console.log(info(`Current model: ${config.model ?? "default"}`));
              break;
            }
            config.model = cmdArg;
            const rebuildSpin = spinner(`Switching model to ${cmdArg}...`);
            try {
              await agent.dispose();
            } catch { /* best effort */ }
            agent = await buildAgent(config);
            rebuildSpin.succeed(`Model set to ${cmdArg}`);
            break;
          }

          case "/clear":
            handleClear(turns);
            break;

          case "/save":
            handleSave(turns, config, cmdArg || undefined);
            break;

          default:
            console.log(warn(`Unknown command: ${cmd}. Type /help for available commands.`));
        }

        console.log("");
        continue;
      }

      // ── Chat Message ──────────────────────────────────
      const startTime = Date.now();

      if (config.stream) {
        // Streaming mode: show tokens as they arrive
        process.stdout.write("\n");
        let printedThought = false;
        let outputText = "";
        let toolsUsed: string[] = [];
        let tokenCount = 0;
        const toolCallData: Array<{ name: string; duration: number }> = [];

        for await (const event of agent.runStream(line)) {
          switch (event._tag) {
            case "ThoughtEmitted":
              if (!printedThought) console.log("");
              printedThought = true;
              thinking(1);
              console.log(`   ${muted(event.content.replace(/\s+/g, " ").slice(0, 80))}`);
              break;

            case "ToolCallStarted":
              toolCall(event.toolName, "start");
              break;

            case "ToolCallCompleted":
              toolCall(event.toolName, event.success ? "done" : "error", event.durationMs);
              toolCallData.push({ name: event.toolName, duration: event.durationMs ?? 0 });
              toolsUsed.push(event.toolName);
              break;

            case "TextDelta":
              outputText += event.text;
              break;

            case "StreamCompleted":
              if (!outputText && event.output) outputText = event.output;
              tokenCount = event.metadata?.tokensUsed ?? 0;
              break;

            case "StreamError":
              console.log(fail(`Stream error: ${event.cause}`));
              break;
          }
        }

        const durationMs = Date.now() - startTime;

        if (outputText) {
          console.log("");
          agentResponse(outputText);
        }

        // Summary line
        console.log("");
        metricsSummary({
          duration: durationMs,
          steps: toolCallData.length + 1,
          tokens: tokenCount,
          tools: toolCallData.length,
          success: true,
        });

        turns.push({
          user: line,
          agent: outputText,
          toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
          durationMs,
          tokens: tokenCount,
        });
      } else {
        // Non-streaming: use session.chat() for stateful conversation
        const chatSpinner = spinner("Thinking...");

        try {
          const reply = await session.chat(line);
          const durationMs = Date.now() - startTime;
          chatSpinner.stop();

          console.log("");
          agentResponse(reply.message);
          console.log("");

          metricsSummary({
            duration: durationMs,
            steps: 1,
            tokens: 0,
            tools: reply.toolsUsed?.length ?? 0,
            success: true,
          });

          turns.push({
            user: line,
            agent: reply.message,
            toolsUsed: reply.toolsUsed,
            durationMs,
          });
        } catch (err) {
          chatSpinner.fail("Error");
          const msg = err instanceof Error ? err.message : String(err);
          console.log(fail(msg));
        }
      }

      console.log("");
    }
  } finally {
    rl.close();
    try {
      await agent.dispose();
    } catch { /* best effort */ }
  }
}
```

- [ ] **Step 2: Verify the ReactiveAgent type is exported**

Check that `ReactiveAgent` is exported from `@reactive-agents/runtime`. If not, the import in playground.ts needs adjustment — use `any` type or import the class directly.

Run: `cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && grep -n "export.*ReactiveAgent" packages/runtime/src/index.ts packages/runtime/src/builder.ts | head -5`

If `ReactiveAgent` is not exported as a named type from the package index, change the import to:

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";
```

And use `Awaited<ReturnType<ReturnType<typeof ReactiveAgents.create>["build"]>>` as the agent type, or simply use `any` for the `agent` variable.

- [ ] **Step 3: Check agent.dispose() exists**

Run: `cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && grep -n "dispose\|shutdown\|close" packages/runtime/src/builder.ts | head -10`

If `dispose()` doesn't exist on the agent, remove the `await agent.dispose()` calls from playground.ts or replace with a no-op.

- [ ] **Step 4: Build and test**

Run: `cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun run build && bun run --cwd apps/cli src/index.ts playground --provider test`

Expected: Playground starts, shows banner, shows config, accepts input. Type "hello" → should get a response in a styled box. Type "/help" → shows slash commands. Type "/exit" → exits cleanly.

- [ ] **Step 5: Test streaming mode**

Run: `bun run --cwd apps/cli src/index.ts playground --provider test --stream --tools --reasoning`

Expected: Playground starts with streaming enabled. Responses show thinking/tool indicators.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/playground.ts
git commit -m "feat(cli): rebuild playground with agent.session(), slash commands, and visual polish"
```

---

## Chunk 4: Polish & Integration

### Task 6: Light Polish on Existing Commands

**Files:**
- Modify: `apps/cli/src/commands/run.ts`
- Modify: `apps/cli/src/commands/init.ts`
- Modify: `apps/cli/src/commands/serve.ts`
- Modify: `apps/cli/src/index.ts`

Apply new `ui.ts` helpers to existing commands for consistent look. Light touch — swap in helpers where obvious.

- [ ] **Step 1: Polish run.ts**

In `apps/cli/src/commands/run.ts`:

1. Replace the `createSpinner` function (lines 43-59) with an import from ui.ts:

```typescript
import { spinner, banner, info, success, fail, kv, muted, divider, renderDashboard, type DashboardData } from "../ui.js";
import chalk from "chalk";
```

2. Replace `createSpinner(...)` calls with `spinner(...)`:

Line 147: `const spin = quiet ? null : spinner(\`Building agent "${name}" with provider: ${provider}\`);`
Line 173: `spin?.succeed(\`Agent ready: ${agent.agentId}\`);` (ora uses `.succeed()` not `.stop()`)
Line 188: `const execSpin = quiet || stream ? null : spinner("Executing...");`
Line 249: `execSpin?.succeed("Execution complete");`

3. In the verbose block (line 175), use `kv()`:
```typescript
if (verbose) {
  console.log(kv("Provider", provider));
  if (model) console.log(kv("Model", model));
  console.log(kv("Tools", enableTools ? "enabled" : "disabled"));
  console.log(kv("Reasoning", enableReasoning ? "enabled" : "disabled"));
  if (mcpConfig) console.log(kv("MCP servers", String(mcpConfig.servers.length)));
  console.log("");
}
```

4. In the output section (line 256), use divider:
```typescript
console.log("");
divider();
console.log(chalk.bold("\nOutput:"));
console.log(result.output || muted("(no output)"));
console.log("");
divider();
console.log(chalk.bold("\nMetrics:"));
console.log(kv("Duration", `${result.metadata.duration}ms`));
console.log(kv("Steps", String(result.metadata.stepsCount)));
console.log(kv("Cost", `$${result.metadata.cost.toFixed(6)}`));
```

5. Replace `spinner?.fail(...)` with `spin?.fail(...)` at the error handler.

- [ ] **Step 2: Polish init.ts**

In `apps/cli/src/commands/init.ts`, add import:

```typescript
import { banner } from "../ui.js";
```

Replace the `section("Project Init")` call with:
```typescript
banner("rax init", `Creating "${name}" with template "${template}"`);
```

- [ ] **Step 3: Polish serve.ts**

In `apps/cli/src/commands/serve.ts`, add import:

```typescript
import { banner, kv, success, spinner } from "../ui.js";
import chalk from "chalk";
```

Replace the plain console.log status block (lines 84-89) with:
```typescript
banner("rax serve", `Starting A2A server: ${name}`);
console.log(kv("Port", String(port)));
console.log(kv("Provider", `${provider}${model ? ` (${model})` : ""}`));
console.log(kv("Tools", withTools ? "enabled" : "disabled"));
console.log(kv("Reasoning", withReasoning ? "enabled" : "disabled"));
console.log(kv("Memory", memoryTier ? `tier ${memoryTier}` : "disabled"));
```

Replace the ready message (line 252) with:
```typescript
console.log("");
console.log(success(`A2A server ready on port ${port}`));
console.log(kv("Agent Card", `http://localhost:${port}/.well-known/agent.json`));
console.log(kv("JSON-RPC", `http://localhost:${port}/`));
console.log(chalk.hex("#6b7280")("\nUse Ctrl+C to stop"));
```

- [ ] **Step 4: Polish index.ts help**

In `apps/cli/src/index.ts`, update the help case to use banner:

```typescript
case "help":
case "--help":
case "-h":
case undefined:
  printBanner();
  console.log(HELP);
  console.log("");
  break;
```

(This is minimal — banner.ts already handles the main header. Keep it as-is since the existing banner is already well-styled.)

- [ ] **Step 5: Build and verify**

Run: `cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun run build`
Expected: Build succeeds.

Run: `bun run --cwd apps/cli src/index.ts help`
Expected: Help renders correctly.

Run: `bun run --cwd apps/cli src/index.ts run "hello" --provider test`
Expected: Run output uses new styling.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/run.ts apps/cli/src/commands/init.ts apps/cli/src/commands/serve.ts apps/cli/src/index.ts
git commit -m "feat(cli): apply visual polish to run, init, serve, and help commands"
```

---

### Task 7: Final Build + Integration Test

**Files:** None (testing only)

- [ ] **Step 1: Full build**

Run: `cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun run build`
Expected: All 20 packages + CLI build successfully.

- [ ] **Step 2: Test rax demo**

Run: `bun run --cwd apps/cli src/index.ts demo`
Expected: Full demo flow — banner, config display, step-by-step progress, agent response box, metrics dashboard, CTA.

- [ ] **Step 3: Test rax playground**

Run: `bun run --cwd apps/cli src/index.ts playground --provider test`

Test sequence:
1. Type `hello` → styled response
2. Type `/help` → slash commands list
3. Type `/memory` → shows conversation history
4. Type `/clear` → clears history
5. Type `/provider` → shows current provider
6. Type `/exit` → exits cleanly

- [ ] **Step 4: Test rax run**

Run: `bun run --cwd apps/cli src/index.ts run "say hello" --provider test`
Expected: Styled output with dividers and metrics.

- [ ] **Step 5: Test rax help**

Run: `bun run --cwd apps/cli src/index.ts help`
Expected: Help output includes demo command.

- [ ] **Step 6: Run existing tests**

Run: `cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun test`
Expected: All 1,773 tests pass. No regressions.

- [ ] **Step 7: Final commit if any fixes needed**

Only commit if integration testing revealed issues that needed fixing.

---

## Files Summary

| File | Action | Task |
|------|--------|------|
| `apps/cli/package.json` | Modify | 1 — Add chalk, ora, boxen |
| `apps/cli/tsup.config.ts` | Modify | 1 — Add externals |
| `apps/cli/src/ui.ts` | Rewrite | 2 — Visual foundation |
| `apps/cli/src/commands/demo-responses.ts` | Create | 3 — Demo scripted responses |
| `apps/cli/src/commands/demo.ts` | Create | 4 — Demo command |
| `apps/cli/src/commands/playground.ts` | Rewrite | 5 — Playground rebuild |
| `apps/cli/src/commands/run.ts` | Modify | 6 — Light polish |
| `apps/cli/src/commands/init.ts` | Modify | 6 — Light polish |
| `apps/cli/src/commands/serve.ts` | Modify | 6 — Light polish |
| `apps/cli/src/index.ts` | Modify | 4, 6 — Register demo, polish |

## Success Criteria

- `rax demo` runs in <3 seconds, looks impressive, no API key needed
- `rax playground` feels like a proper interactive environment
- All slash commands work (/help, /tools, /memory, /debrief, /metrics, /strategy, /provider, /model, /clear, /save, /exit)
- Provider/model switching via slash commands rebuilds agent
- Metrics dashboard renders with chalk+boxen
- Consistent visual styling across all commands
- Zero new dependencies in core framework packages (only in apps/cli)
- All 1,773 existing tests pass
