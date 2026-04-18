---
title: Status Display (TUI)
description: Show a live spinner, collapsible think panel, cost display, and tool call scrollback in interactive terminal sessions.
sidebar:
  order: 6
---

`StatusRenderer` is a terminal UI that replaces scrolling log output with a single updating status line during agent execution. It is designed for interactive terminal sessions where you want a clean, information-dense view of what the agent is doing without a wall of streaming text.

## When to use it

- **Interactive terminals** — running an agent from a shell script, REPL, or CLI tool
- **Long-running tasks** — research agents, file-processing pipelines, multi-step workflows where you need elapsed time and cost visible at all times
- **Demos** — cleaner than scrolling log output when showing the agent to someone

Use `mode: "stream"` instead when you need every token visible (server logs, CI pipelines, or piped output).

## Auto-detection

`StatusRenderer` activates automatically when `process.stdout.isTTY` is `true` and you have not explicitly set `mode: "stream"`. In CI or piped output (`agent.run() | tee log.txt`) it falls back to plain line-by-line output with no ANSI escape codes.

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .build();

// In an interactive terminal: StatusRenderer starts automatically.
// In CI or piped output: plain log lines, no ANSI.
const result = await agent.run("Summarize the top 5 papers on attention mechanisms");
console.log(result.output);
```

## Forcing a mode

Pass `logging: { mode: "status" }` to force the TUI on regardless of TTY, or `mode: "stream"` to force plain streaming output even in an interactive terminal.

```typescript
import { ReactiveAgents, defaultReactiveAgentsConfig } from "reactive-agents";
import { createReactiveAgentsRuntime } from "@reactive-agents/runtime";

// Force status mode (TUI) even if stdout is not a TTY
const config = defaultReactiveAgentsConfig("my-agent", {
  logging: { mode: "status" },
});

// Force stream mode (plain output) even in an interactive terminal
const configStream = defaultReactiveAgentsConfig("my-agent", {
  logging: { mode: "stream" },
});
```

## What it shows

### Status line

A single line updates in place at 100 ms intervals:

```
⠙  Thinking...  iter 3  14s  1,234 tok  $0.0012  entropy 0.43 ↓  [t: expand]
```

| Field | Description |
|-------|-------------|
| Spinner | Braille animation — confirms the agent is alive |
| Action | Current phase: `Starting...`, `Thinking...`, `Acting...`, `Calling <tool>...` |
| `iter N` | Current reasoning iteration (hidden on iteration 0) |
| Elapsed | Wall-clock time since `agent.run()` was called |
| `N tok` | Cumulative tokens used (hidden until first token metric arrives) |
| `$N.NNNN` | Cumulative cost in USD (hidden until first cost metric arrives) |
| `entropy N.NN ↑↓→` | Semantic entropy with trend arrow (hidden during tool calls) |
| `[t: expand]` | Keyboard hint — only shown during the think phase when text is available |

### Tool call scrollback

Each completed tool call prints a permanent line above the status line:

```
→  web-search  ✓ 1.2s
→  file-write  ✓ 0.3s
→  web-search  ✗ 0.8s — connection timeout
```

These lines scroll up as more calls complete. The status line stays pinned at the bottom.

### Completion line

When the agent finishes, the status line is replaced with a final summary:

```
✓  Done  ·  18s  ·  3,412 tok  ·  4 calls  ·  $0.0021
```

Or on failure:

```
✗  Failed  ·  5s  ·  800 tok  ·  1 call  ·  $0.0004
```

Cost is always shown — including `$0.0000` for local models — so the line format is consistent.

### Warnings, errors, and notices

These print as permanent scrollback lines immediately above the status:

```
⚠  High entropy detected
✗  Max iterations exceeded
ℹ  Reactive Intelligence — Telemetry enabled
```

## Think panel (collapsible)

During the think phase, press `t` or `T` to expand a 4-line panel showing the tail of the model's current reasoning stream:

```
  the most relevant paper appears to be "Attention Is All You Need"
  (Vaswani et al., 2017), which introduced the transformer architecture.
  I should also check for more recent work on sparse attention and
  linear attention variants before writing the summary.
  [t: collapse thinking]
⠸  Thinking...  iter 2  8s  980 tok  $0.0008  [t: collapse]
```

Press `t` again to collapse it back to the single-line preview. The panel collapses automatically when a tool call starts or a new iteration begins.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `t` / `T` | Toggle think panel open / closed |
| `Ctrl+C` | Exit the process immediately |

## Mode comparison

| Feature | `mode: "status"` (TUI) | `mode: "stream"` (plain) |
|---------|------------------------|--------------------------|
| Output | Single updating line | Scrolling log lines |
| Think text | Collapsible panel | Streamed tokens to stdout |
| Tool results | Scrollback lines | Log lines |
| ANSI escape codes | Yes (TTY only) | No |
| Good for | Interactive terminals, demos | CI, piped output, server logs |
| Auto-selected when | `stdout.isTTY === true` | `stdout.isTTY === false` |

## Complete example

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("research-assistant")
  .withProvider("anthropic")
  .withReasoning({ maxIterations: 10 })
  .withTools()
  .build();

// Run in an interactive terminal — StatusRenderer starts automatically.
// Press `t` during execution to expand the think panel.
const result = await agent.run(
  "Find the three most-cited papers on retrieval-augmented generation and summarize each in two sentences."
);

if (result.success) {
  console.log(result.output);
} else {
  console.error("Agent failed:", result.error);
}

await agent.dispose();
```

Sample terminal output during execution:

```
→  web-search  ✓ 1.4s
→  web-search  ✓ 0.9s
→  web-search  ✓ 1.1s
⠦  Thinking...  iter 4  18s  2,104 tok  $0.0019  entropy 0.31 ↓  [t: expand]
```

After completion:

```
→  web-search  ✓ 1.4s
→  web-search  ✓ 0.9s
→  web-search  ✓ 1.1s
✓  Done  ·  23s  ·  2,891 tok  ·  3 calls  ·  $0.0026
```

## Using StatusRenderer directly

`makeStatusRenderer` is exported from `@reactive-agents/observability` for advanced use cases where you want to drive the renderer manually (custom CLI tools, testing, etc.).

```typescript
import { makeObservableLogger, makeStatusRenderer } from "@reactive-agents/observability";
import { Effect } from "effect";

const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
const renderer = makeStatusRenderer(logger, process.stdout);

await Effect.runPromise(renderer.start());

// Feed events to the logger — the renderer reacts automatically.
// Push LLM text deltas into the think panel:
renderer.pushThinkChunk("Analyzing the search results...");

// Stop and clear the status line when done:
renderer.stop();
```

The `StatusRenderer` interface:

```typescript
interface StatusRenderer {
  /** Subscribe to the logger and start the spinner. */
  readonly start: () => Effect.Effect<void, never>;
  /** Stop the spinner, clear the status line, and unsubscribe. */
  readonly stop: () => void;
  /** Append a streaming LLM text chunk to the think panel. */
  readonly pushThinkChunk: (text: string) => void;
}
```
