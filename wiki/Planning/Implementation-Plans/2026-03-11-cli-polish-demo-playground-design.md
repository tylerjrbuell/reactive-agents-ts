# rax CLI Polish, Demo & Playground — Design Document

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the rax CLI from a functional-but-plain tool into a visually polished, impressive developer experience. Three deliverables: upgraded visual foundation, zero-config `rax demo` command, and a rebuilt `rax playground` that showcases the framework's session/chat capabilities.

**Tech Stack:** chalk (colors), ora (spinners), boxen (boxes), existing reactive-agents framework (test provider, agent.session(), streaming, observability).

---

## Context

The CLI is the first thing many developers will touch. Currently it works but has:
- Basic ANSI color helpers in `ui.ts` (no external deps)
- Playground is a raw readline loop with minimal formatting
- No demo/showcase command
- No usage of v0.8 features (agent.chat(), session, debrief)
- Metrics dashboard lives in observability package as plain text — CLI should render a rich version

The new vision emphasizes DX: "Great frameworks disappear — the DX should feel like building with superpowers." The CLI must deliver on this promise.

---

## Architecture Decision: CLI as Visual Layer

Core framework packages (`packages/observability/`, etc.) stay dependency-free. The CLI (`apps/cli/`) owns all visual rendering. The observability package exports structured metrics data; the CLI renders it beautifully with chalk+boxen.

---

## Task 1: Add Dependencies

**Files:** `apps/cli/package.json`

Add to dependencies:
```json
{
  "chalk": "^5.3.0",
  "ora": "^8.0.0",
  "boxen": "^8.0.0"
}
```

Run `bun install` to verify resolution.

---

## Task 2: Upgrade `ui.ts` Visual Foundation

**Files:** `apps/cli/src/ui.ts`

Rewrite internals to use chalk/ora/boxen while preserving the existing API surface. Add new helpers:

### Color Palette (constants)

```typescript
// Brand colors — consistent across all commands
const VIOLET = "#8b5cf6";
const CYAN = "#06b6d4";
const YELLOW = "#eab308";
const GREEN = "#22c55e";
const RED = "#ef4444";
const DIM = "#6b7280";
```

### New Exports

| Export | Signature | Purpose |
|--------|-----------|---------|
| `banner` | `(title: string, subtitle?: string) => void` | Boxen-wrapped header with violet border, used by demo/playground/help |
| `spinner` | `(text: string) => OraInstance` | Styled ora spinner, returns handle for `.succeed()`, `.fail()`, `.text =` |
| `box` | `(content: string, opts?: BoxOptions) => void` | Boxen wrapper with consistent padding/border |
| `agentResponse` | `(text: string) => void` | Formatted agent output with cyan left-border accent |
| `toolCall` | `(name: string, status: "start"\|"done"\|"error", duration?: number) => void` | Colored tool indicator |
| `thinking` | `(iteration: number, max?: number) => void` | Iteration progress line |
| `metric` | `(label: string, value: string\|number) => void` | Aligned key-value pair |
| `divider` | `() => void` | Subtle horizontal rule |
| `styledPrompt` | `(prefix?: string) => string` | Returns styled prompt string for readline |

### Preserved Exports (refactored internals)

Keep: `color`, `section`, `info`, `success`, `warn`, `fail`, `event`, `kv`, `hint`, `muted`, `createSpinner` (deprecated in favor of `spinner` but kept for compat).

---

## Task 3: `rax demo` Command

**Files:**
- Create: `apps/cli/src/commands/demo.ts`
- Create: `apps/cli/src/commands/demo-responses.ts`
- Modify: `apps/cli/src/index.ts` (register command)

### Flow

```
$ rax demo

┌─────────────────────────────────────────────────┐
│                                                 │
│   Reactive Agents — Live Demo                   │
│   The open-source agent framework built for     │
│   control, not magic.                           │
│                                                 │
└─────────────────────────────────────────────────┘

🎯 Task: "Find the top 3 TypeScript testing frameworks
         and compare their features"

📋 Agent Config:
   Provider: test (deterministic, no API key needed)
   Strategy: reactive (ReAct loop)
   Tools:    web-search, file-write
   Observability: enabled

⏳ Running agent...

💭 Step 1/5 — thinking...
   Planning approach to research testing frameworks

🔧 web-search → "TypeScript testing frameworks 2026"  ✅ 12ms

💭 Step 2/5 — thinking...
   Analyzing results: Vitest, Jest, Bun test runner...

🔧 web-search → "vitest vs jest vs bun test comparison"  ✅ 8ms

💭 Step 3/5 — thinking...
   Synthesizing comparison table...

✅ Agent completed in 1.8s (5 steps, 847 tokens)

┌─────────────────────────────────────────────────┐
│ Agent Response                                  │
├─────────────────────────────────────────────────┤
│                                                 │
│ ## Top 3 TypeScript Testing Frameworks          │
│                                                 │
│ | Framework | Speed  | DX    | Ecosystem |      │
│ |-----------|--------|-------|-----------|      │
│ | Vitest    | ⚡ Fast | ✅    | Growing   |      │
│ | Bun Test  | ⚡⚡    | ✅    | Emerging  |      │
│ | Jest      | 🐢     | ✅    | Mature    |      │
│                                                 │
│ Vitest leads for TypeScript projects...         │
│                                                 │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ ✅ Execution Summary                             │
├─────────────────────────────────────────────────┤
│ Status: ✅ Success  Duration: 1.8s  Steps: 5    │
│ Tokens: 847         Cost: ~$0.001               │
├─────────────────────────────────────────────────┤
│ 📊 Timeline                                     │
│ ├─ [bootstrap]    45ms  ✅                       │
│ ├─ [think]     1,200ms  ✅  (5 iterations)      │
│ ├─ [act]         340ms  ✅  (2 tools)           │
│ └─ [complete]     15ms  ✅                       │
│                                                 │
│ 🔧 Tools                                        │
│ └─ web-search  ✅ 2 calls, 10ms avg             │
└─────────────────────────────────────────────────┘

🚀 Liked what you saw?

   bun add reactive-agents
   Docs: https://docs.reactiveagents.dev/
   GitHub: https://github.com/tylerjrbuell/reactive-agents-ts
```

### demo-responses.ts

Pre-scripted test responses that follow ReAct format:

```typescript
export const demoResponses: Record<string, string> = {
  "Find the top 3": `Thought: I need to research current TypeScript testing frameworks...
ACTION: web-search
ACTION_INPUT: {"query": "TypeScript testing frameworks 2026"}`,

  "Results for: TypeScript testing": `Thought: Good results. I see Vitest, Jest, and Bun test. Let me compare...
ACTION: web-search
ACTION_INPUT: {"query": "vitest vs jest vs bun test comparison"}`,

  "Results for: vitest vs jest": `Thought: I have enough information to provide a comprehensive comparison.
FINAL ANSWER: ## Top 3 TypeScript Testing Frameworks...`,

  // Default fallback
  "": "FINAL ANSWER: Demo complete."
};
```

The responses flow through the REAL execution engine — test provider matches on string prefix and returns the scripted response. The agent actually runs through bootstrap → guardrail → strategy → think → act → observe → complete phases.

### CLI Dashboard Renderer

New function in `ui.ts` (or separate `dashboard.ts`):

```typescript
export function renderDashboard(metrics: ExportedMetrics): void
```

Takes the structured metrics from `exportMetrics()` and renders the rich boxen+chalk version shown above. This replaces the plain-text `formatMetricsDashboard()` output for CLI contexts only.

---

## Task 4: `rax playground` Rebuild

**Files:**
- Rewrite: `apps/cli/src/commands/playground.ts`
- Modify: `apps/cli/src/index.ts` (update registration if needed)

### Invocation

```bash
rax playground                          # Interactive provider selection
rax playground --provider anthropic     # Skip to prompt
rax playground --provider ollama --model qwen3:14b
rax playground --provider test          # Deterministic mode
```

### Startup Flow

```
$ rax playground

┌─────────────────────────────────────────────────┐
│                                                 │
│   Reactive Agents Playground                    │
│   Interactive agent exploration                 │
│                                                 │
└─────────────────────────────────────────────────┘

? Select provider:
  ❯ anthropic (Claude)
    openai (GPT)
    ollama (Local)
    test (Deterministic, no API key)

? Model: claude-sonnet-4-20250514

⏳ Building agent...
   ✅ Provider: anthropic
   ✅ Reasoning: adaptive
   ✅ Tools: web-search, file-read, file-write, code-execute
   ✅ Memory: enabled (session-scoped)
   ✅ Observability: enabled

Type a message to chat. Use /help for commands.

❯
```

### REPL Loop

Each user message flows through `agent.session()`:

1. User types message → show spinner ("Thinking...")
2. If streaming: show TextDelta tokens as they arrive, tool calls inline
3. If non-streaming: spinner until complete, then show response
4. Display agent response in styled box
5. Show brief metrics line: `✅ 3.2s · 12 steps · 1,847 tokens · 2 tools`
6. Return to prompt

### Slash Commands

```
/help                  Show all commands and key bindings
/tools                 List available tools with descriptions
/memory                Show conversation history (last 10 turns)
/debrief               Show last run's structured debrief
/metrics               Show full metrics dashboard for last run
/strategy [name]       Show current strategy or switch (reactive, adaptive, plan-execute, tot, reflexion)
/provider [name]       Switch LLM provider (rebuilds agent, keeps history)
/model [name]          Switch model (rebuilds agent, keeps history)
/clear                 Clear conversation history, start fresh
/save [path]           Save session transcript to markdown file
/exit                  Exit playground (also: Ctrl+C, Ctrl+D)
```

### Command Implementation Details

**`/provider` and `/model`** — These rebuild the agent:
1. Save current conversation history from session
2. Build new agent with updated provider/model
3. Create new session, inject saved history
4. Print confirmation: `✅ Switched to ollama / qwen3:14b`

**`/debrief`** — Renders `agent._lastDebrief` (if available) in a styled box:
```
┌─ Last Run Debrief ──────────────────────────────┐
│ Summary: Found and compared 3 testing frameworks │
│ Key Findings:                                    │
│   • Vitest leads for TypeScript-first projects   │
│   • Bun test runner fastest but ecosystem small  │
│ Tools Used: web-search (2x)                      │
│ Confidence: high                                 │
└──────────────────────────────────────────────────┘
```

**`/metrics`** — Calls `renderDashboard()` with the last run's metrics data.

**`/save`** — Writes conversation transcript as markdown:
```markdown
# Reactive Agents Playground Session
Provider: anthropic | Model: claude-sonnet-4 | Date: 2026-03-11

## Turn 1
**User:** Find TypeScript testing frameworks
**Agent:** [response...]
**Metrics:** 3.2s, 1847 tokens, 2 tools

## Turn 2
...
```

**`/tools`** — Lists registered tools with name + description in a table.

### Streaming Display

During agent execution:

```
❯ Find the top TypeScript testing frameworks and compare them

⏳ Thinking...
💭 Step 1 — Planning research approach
🔧 web-search → "TypeScript testing frameworks"  ✅ 340ms
💭 Step 2 — Analyzing results
🔧 web-search → "vitest vs jest comparison"  ✅ 280ms
💭 Step 3 — Synthesizing answer

┌─ Agent ──────────────────────────────────────────┐
│                                                  │
│ Here are the top 3 TypeScript testing            │
│ frameworks...                                    │
│                                                  │
└──────────────────────────────────────────────────┘
✅ 4.1s · 8 steps · 2,340 tokens · 2 tools

❯
```

---

## Task 5: Light Polish on Existing Commands

Apply new `ui.ts` helpers to existing commands for consistent styling:

- **`rax run`** — Use `banner()` for header, `spinner()` during execution, `renderDashboard()` for metrics
- **`rax init`** — Use `banner()`, `success()` for completion
- **`rax help`** — Use `banner()` with tagline, styled command table
- **`rax serve`** — Use `banner()`, styled status output
- **Other commands** — Light touch, replace raw `console.log` with `ui.*` helpers where obvious

This is NOT a full rewrite of every command — just swapping in the new helpers where they improve output with minimal changes.

---

## Task 6: Register Demo Command + Update Help

- Add `demo` case to switch in `index.ts`
- Update help text to include demo command
- Update `rax help` output to show demo prominently

---

## Testing

- **Demo:** Run `rax demo`, verify full output matches expected flow, dashboard renders correctly
- **Playground:** Manual testing — start playground, chat, use each slash command, switch provider, save transcript
- **Existing commands:** Run `rax help`, `rax init test-project`, `rax run "hello" --provider test` — verify styling is consistent and nothing broke

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `apps/cli/package.json` | Modify | Add chalk, ora, boxen |
| `apps/cli/src/ui.ts` | Rewrite | Visual foundation with chalk/ora/boxen |
| `apps/cli/src/commands/demo.ts` | Create | Demo command |
| `apps/cli/src/commands/demo-responses.ts` | Create | Pre-scripted test responses |
| `apps/cli/src/commands/playground.ts` | Rewrite | Session-based interactive REPL |
| `apps/cli/src/index.ts` | Modify | Register demo, update help |
| `apps/cli/src/commands/run.ts` | Modify | Use new ui helpers |
| `apps/cli/src/commands/init.ts` | Modify | Use new ui helpers |
| `apps/cli/src/commands/serve.ts` | Modify | Use new ui helpers |
| Other command files | Light touch | Swap console.log for ui helpers |

---

## Success Criteria

- `rax demo` runs in <3 seconds, looks impressive, no API key needed
- `rax playground` feels like a proper interactive environment, not a raw REPL
- All slash commands work
- Provider/model switching preserves conversation
- Metrics dashboard in CLI looks professional
- Consistent visual styling across all commands
- Zero new dependencies in core framework packages (only in apps/cli)
