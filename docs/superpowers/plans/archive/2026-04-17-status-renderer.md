# Status Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude-Code-style single-line TUI status display that replaces the raw event stream in TTY environments, showing a live spinner with iteration, elapsed time, tokens, cost, and entropy.

**Architecture:** `makeStatusRenderer` in `packages/observability` subscribes to the existing `ObservableLoggerService` subscriber system and manages all ANSI output itself. In status mode the `ObservableLogger` runs buffered (no live `console.log` per event) — the renderer is the sole output controller. Auto-detected from `process.stdout.isTTY`; CI/pipe environments fall back to stream mode automatically. Effect's built-in logger is silenced in status mode to suppress `INFO ◉ [bootstrap]...` lines from the ObservabilityService.

**Tech Stack:** Effect-TS v3, Node.js ANSI escape codes, bun test, tsup

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `packages/observability/src/logging/status-renderer.ts` | Spinner state machine, ANSI output, subscriber wiring |
| **Modify** | `packages/observability/src/index.ts` | Export `makeStatusRenderer`, `StatusRenderer` |
| **Modify** | `packages/runtime/src/types.ts` | Add `mode?: "stream" \| "status"` to logging config |
| **Modify** | `packages/runtime/src/execution-engine.ts` | Auto-detect TTY, emit tokens+cost metrics, create/start/stop renderer, silence Effect logger in status mode |
| **Create** | `packages/observability/tests/logging/status-renderer.test.ts` | Unit tests for renderer state machine |

---

### Task 1: Emit `tokens_used` and `cost_usd` metrics before completion event

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts` (~line 4045)

The renderer needs these as `metric` events to update the status line live. They should fire just before the `completion` event so the completion line shows final values.

- [ ] **Step 1: Add metric emissions before the completion event**

Find the block starting with `// Emit completion event` (~line 4045) and insert before it:

```typescript
// Emit token and cost metrics for status renderer
yield* Effect.serviceOption(ObservableLogger).pipe(
  Effect.tap((loggerOpt) => {
    if (loggerOpt._tag === "Some") {
      return Effect.all([
        loggerOpt.value.emit({
          _tag: "metric",
          name: "tokens_used",
          value: result.metadata.tokensUsed ?? 0,
          unit: "tokens",
          timestamp: new Date(),
        }),
        loggerOpt.value.emit({
          _tag: "metric",
          name: "cost_usd",
          value: result.metadata.cost ?? 0,
          unit: "usd",
          timestamp: new Date(),
        }),
      ], { concurrency: "unbounded" }).pipe(Effect.asVoid);
    }
    return Effect.void;
  }),
  Effect.catchAll(() => Effect.void),
);
```

- [ ] **Step 2: Typecheck**

```bash
cd /path/to/reactive-agents-ts && rtk tsc 2>&1 | grep "src/execution-engine.ts"
```

Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
rtk git add packages/runtime/src/execution-engine.ts
rtk git commit -m "feat(observability): emit tokens_used and cost_usd metrics before completion"
```

---

### Task 2: Add `mode` to logging config type

**Files:**
- Modify: `packages/runtime/src/types.ts`

- [ ] **Step 1: Find the logging config schema**

```bash
grep -n "minLevel\|logging" /path/to/reactive-agents-ts/packages/runtime/src/types.ts | head -15
```

- [ ] **Step 2: Add `mode` field**

Locate the `logging?` field in `ReactiveAgentsConfig` (around the block with `live?`, `minLevel?`) and add:

```typescript
readonly logging?: {
  readonly live?: boolean;
  readonly mode?: "stream" | "status";
  readonly minLevel?: "debug" | "info" | "warn" | "error";
  readonly destinations?: Array<"console" | "file" | "custom">;
  readonly filePath?: string;
};
```

- [ ] **Step 3: Typecheck**

```bash
rtk tsc 2>&1 | grep "src/" | grep -v "tests/" | head -10
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
rtk git add packages/runtime/src/types.ts
rtk git commit -m "feat(config): add mode:'stream'|'status' to logging config"
```

---

### Task 3: Write failing tests for the status renderer

**Files:**
- Create: `packages/observability/tests/logging/status-renderer.test.ts`

The renderer manages side effects (ANSI writes, timers). Tests use a mock `WriteStream` that captures writes, and don't test ANSI byte-for-byte — they test behaviour: what gets written permanently, what stays on the status line, that completion fires correctly.

- [ ] **Step 1: Create the test file**

```typescript
// packages/observability/tests/logging/status-renderer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import { makeObservableLogger } from "../../src/logging/observable-logger.js";
import { makeStatusRenderer } from "../../src/logging/status-renderer.js";
import type { LogEvent } from "../../src/types.js";

function makeMockStream(isTTY = true) {
  const lines: string[] = [];
  const raw: string[] = [];
  return {
    isTTY,
    write(chunk: string) {
      raw.push(chunk);
      // Collect permanent lines (those ending in \n)
      if (chunk.includes("\n")) {
        lines.push(chunk.replace(/\r\x1b\[2K/g, "").replace(/\n$/, "").trim());
      }
      return true;
    },
    lines,
    raw,
  };
}

describe("makeStatusRenderer", () => {
  it("permanent lines: notice prints as a scrollback line", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());

    await Effect.runPromise(logger.emit({
      _tag: "notice",
      level: "info",
      title: "Reactive Intelligence",
      message: "Telemetry enabled",
      dismissible: true,
      timestamp: new Date(),
    }));

    renderer.stop();

    expect(out.lines.some((l) => l.includes("Reactive Intelligence"))).toBe(true);
  });

  it("permanent lines: warning prints as a scrollback line", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());
    await Effect.runPromise(logger.emit({
      _tag: "warning",
      message: "High entropy detected",
      timestamp: new Date(),
    }));
    renderer.stop();

    expect(out.lines.some((l) => l.includes("High entropy detected"))).toBe(true);
  });

  it("permanent lines: error prints as a scrollback line", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());
    await Effect.runPromise(logger.emit({
      _tag: "error",
      message: "Max iterations exceeded",
      timestamp: new Date(),
    }));
    renderer.stop();

    expect(out.lines.some((l) => l.includes("Max iterations exceeded"))).toBe(true);
  });

  it("completion: success prints done line with checkmark", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());
    await Effect.runPromise(logger.emit({
      _tag: "metric", name: "tokens_used", value: 5000, unit: "tokens", timestamp: new Date(),
    }));
    await Effect.runPromise(logger.emit({
      _tag: "metric", name: "cost_usd", value: 0.0012, unit: "usd", timestamp: new Date(),
    }));
    await Effect.runPromise(logger.emit({
      _tag: "tool_result", tool: "web-search", duration: 500, status: "success", timestamp: new Date(),
    }));
    await Effect.runPromise(logger.emit({
      _tag: "tool_result", tool: "web-search", duration: 400, status: "success", timestamp: new Date(),
    }));
    await Effect.runPromise(logger.emit({
      _tag: "completion", success: true, summary: "Done", timestamp: new Date(),
    }));
    renderer.stop();

    const completionLine = out.lines.find((l) => l.startsWith("✓"));
    expect(completionLine).toBeDefined();
    expect(completionLine).toContain("5,000 tok");
    expect(completionLine).toContain("$0.0012");
    expect(completionLine).toContain("2 calls");
  });

  it("completion: failure prints failed line with cross", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());
    await Effect.runPromise(logger.emit({
      _tag: "completion", success: false, summary: "Failed", timestamp: new Date(),
    }));
    renderer.stop();

    expect(out.lines.some((l) => l.startsWith("✗"))).toBe(true);
  });

  it("non-TTY: writes plain lines without ANSI overwrite sequences", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream(false); // isTTY = false
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());
    await Effect.runPromise(logger.emit({
      _tag: "warning", message: "test warning", timestamp: new Date(),
    }));
    renderer.stop();

    // Should not contain ANSI escape codes
    expect(out.raw.some((r) => r.includes("\x1b"))).toBe(false);
    expect(out.lines.some((l) => l.includes("test warning"))).toBe(true);
  });

  it("stop() clears the status line on TTY", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());
    renderer.stop();

    // After stop, should have written the clear sequence
    expect(out.raw.some((r) => r.includes("\r\x1b[2K"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /path/to/reactive-agents-ts && rtk bun test packages/observability/tests/logging/status-renderer.test.ts 2>&1 | tail -10
```

Expected: errors like `Cannot find module '../../src/logging/status-renderer.js'`

---

### Task 4: Implement `status-renderer.ts`

**Files:**
- Create: `packages/observability/src/logging/status-renderer.ts`

- [ ] **Step 1: Create the file**

```typescript
// packages/observability/src/logging/status-renderer.ts
import { Effect } from "effect";
import type { ObservableLoggerService } from "./observable-logger.js";
import type { LogEvent } from "../types.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

interface RendererState {
  phase: string;
  iteration: number;
  tool: string | null;
  tokens: number;
  costUsd: number;
  toolCallCount: number;
  entropy: number | null;
  entropyTrend: " ↑" | " ↓" | " →" | "";
  spinnerIdx: number;
  startMs: number;
  active: boolean;
}

export interface StatusRenderer {
  readonly start: () => Effect.Effect<void, never>;
  readonly stop: () => void;
}

export function makeStatusRenderer(
  logger: ObservableLoggerService,
  out: NodeJS.WriteStream = process.stdout,
): StatusRenderer {
  const isTTY = Boolean(out.isTTY);

  const s: RendererState = {
    phase: "starting",
    iteration: 0,
    tool: null,
    tokens: 0,
    costUsd: 0,
    toolCallCount: 0,
    entropy: null,
    entropyTrend: "",
    spinnerIdx: 0,
    startMs: Date.now(),
    active: false,
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  let unsub: (() => void) | null = null;

  function elapsedStr(): string {
    const sec = (Date.now() - s.startMs) / 1000;
    if (sec < 60) return `${Math.round(sec)}s`;
    return `${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`;
  }

  function statusLine(): string {
    const spin = SPINNER[s.spinnerIdx % SPINNER.length]!;

    let action: string;
    if (s.tool) {
      action = `Calling ${s.tool}...`;
    } else if (s.phase === "think") {
      action = "Thinking...";
    } else if (s.phase === "act") {
      action = "Acting...";
    } else if (s.phase === "execution" || s.phase === "starting") {
      action = "Starting...";
    } else {
      action = `${s.phase.charAt(0).toUpperCase()}${s.phase.slice(1)}...`;
    }

    const parts: string[] = [`${spin}  ${action}`];
    if (s.iteration > 0) parts.push(`iter ${s.iteration}`);
    parts.push(elapsedStr());
    if (s.tokens > 0) parts.push(`${s.tokens.toLocaleString()} tok`);
    if (s.costUsd > 0) parts.push(`$${s.costUsd.toFixed(4)}`);
    if (s.entropy !== null && !s.tool) {
      parts.push(`entropy ${s.entropy.toFixed(2)}${s.entropyTrend}`);
    }

    return parts.join("  ·  ");
  }

  function redraw(): void {
    if (!isTTY || !s.active) return;
    out.write(`\r\x1b[2K${statusLine()}`);
  }

  function printLine(line: string): void {
    if (isTTY) {
      out.write(`\r\x1b[2K${line}\n`);
    } else {
      out.write(`${line}\n`);
    }
    redraw();
  }

  function onEvent(event: LogEvent): void {
    switch (event._tag) {
      case "phase_started":
        s.phase = event.phase;
        if (event.phase !== "execution") s.tool = null;
        redraw();
        break;
      case "tool_call":
        s.tool = event.tool;
        redraw();
        break;
      case "tool_result":
        s.toolCallCount++;
        s.tool = null;
        redraw();
        break;
      case "iteration":
        s.iteration = event.iteration;
        s.tool = null;
        redraw();
        break;
      case "metric":
        if (event.name === "tokens_used") {
          s.tokens = event.value;
          redraw();
        } else if (event.name === "cost_usd") {
          s.costUsd = event.value;
          redraw();
        } else if (event.name === "entropy") {
          const prev = s.entropy;
          s.entropy = event.value;
          if (prev === null) {
            s.entropyTrend = "";
          } else if (event.value > prev + 0.05) {
            s.entropyTrend = " ↑";
          } else if (event.value < prev - 0.05) {
            s.entropyTrend = " ↓";
          } else {
            s.entropyTrend = " →";
          }
          redraw();
        }
        break;
      case "warning":
        printLine(`⚠  ${event.message}`);
        break;
      case "error":
        printLine(`✗  ${event.message}`);
        break;
      case "notice":
        printLine(`ℹ  ${event.title} — ${event.message}`);
        break;
      case "completion": {
        s.active = false;
        if (timer) { clearInterval(timer); timer = null; }
        const parts = [elapsedStr()];
        if (s.tokens > 0) parts.push(`${s.tokens.toLocaleString()} tok`);
        if (s.toolCallCount > 0) parts.push(`${s.toolCallCount} call${s.toolCallCount === 1 ? "" : "s"}`);
        if (s.costUsd > 0) parts.push(`$${s.costUsd.toFixed(4)}`);
        const statsStr = parts.join("  ·  ");
        const line = event.success
          ? `✓  Done  ·  ${statsStr}`
          : `✗  Failed  ·  ${statsStr}`;
        if (isTTY) out.write(`\r\x1b[2K${line}\n`);
        else out.write(`${line}\n`);
        break;
      }
    }
  }

  return {
    start: (): Effect.Effect<void, never> =>
      logger.subscribe((_event, _formatted) =>
        Effect.sync(() => onEvent(_event)),
      ).pipe(
        Effect.flatMap((unsubscribeFn) =>
          Effect.sync(() => {
            unsub = unsubscribeFn;
            s.active = true;
            s.startMs = Date.now();
            timer = setInterval(() => {
              s.spinnerIdx++;
              redraw();
            }, 100);
          }),
        ),
      ),

    stop: (): void => {
      s.active = false;
      if (timer) { clearInterval(timer); timer = null; }
      if (unsub) { unsub(); unsub = null; }
      if (isTTY) out.write("\r\x1b[2K");
    },
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
rtk bun test packages/observability/tests/logging/status-renderer.test.ts 2>&1 | tail -10
```

Expected: `8 pass, 0 fail`

- [ ] **Step 3: Commit**

```bash
rtk git add packages/observability/src/logging/status-renderer.ts packages/observability/tests/logging/status-renderer.test.ts
rtk git commit -m "feat(observability): add StatusRenderer — Claude-Code-style TUI status line"
```

---

### Task 5: Export from observability index

**Files:**
- Modify: `packages/observability/src/index.ts` (~line 41)

- [ ] **Step 1: Add export**

After the `makeObservableLogger` export line, add:

```typescript
export { makeStatusRenderer } from "./logging/status-renderer.js";
export type { StatusRenderer } from "./logging/status-renderer.js";
```

- [ ] **Step 2: Build observability package to verify DTS**

```bash
cd /path/to/reactive-agents-ts/packages/observability && bun run build 2>&1 | tail -5
```

Expected: `DTS ⚡️ Build success`

- [ ] **Step 3: Commit**

```bash
rtk git add packages/observability/src/index.ts
rtk git commit -m "feat(observability): export makeStatusRenderer and StatusRenderer"
```

---

### Task 6: Wire renderer into execution engine

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`

This task has three parts: (A) add Logger import for suppressing Effect logs, (B) auto-detect mode and configure logger accordingly, (C) create/start/stop renderer around executeCore.

- [ ] **Step 1: Add `Logger` to the Effect import**

Find line 1 of execution-engine.ts:
```typescript
import { Effect, Context, Layer, Ref, Option, Queue, Stream as EStream, Duration, FiberRef } from "effect";
```

Change to:
```typescript
import { Effect, Context, Layer, Ref, Option, Queue, Stream as EStream, Duration, FiberRef, Logger } from "effect";
```

- [ ] **Step 2: Add `makeStatusRenderer` import**

Find the observability import (~line 24):
```typescript
import { ObservabilityService, createProgressLogger, renderCalibrationProvenance, ObservableLogger, makeObservableLogger } from "@reactive-agents/observability";
import type { RunSummary } from "@reactive-agents/observability";
```

Change to:
```typescript
import { ObservabilityService, createProgressLogger, renderCalibrationProvenance, ObservableLogger, makeObservableLogger, makeStatusRenderer } from "@reactive-agents/observability";
import type { RunSummary } from "@reactive-agents/observability";
```

- [ ] **Step 3: Replace the logger initialization block**

Find (~line 4094):
```typescript
            // Initialize ObservableLogger
            const loggerConfig = { live: config.logging?.live ?? true };
            const logger = yield* makeObservableLogger(loggerConfig);
```

Replace with:
```typescript
            // Initialize ObservableLogger
            const isStatusMode =
              config.logging?.mode === "status" ||
              (config.logging?.mode !== "stream" && Boolean(process.stdout.isTTY));

            const loggerConfig = {
              // In status mode the renderer owns all output; logger stays buffered
              live: isStatusMode ? false : (config.logging?.live ?? true),
              minLevel: config.logging?.minLevel,
            };
            const logger = yield* makeObservableLogger(loggerConfig);

            // Create renderer (no-op when not in status mode)
            const renderer = isStatusMode
              ? makeStatusRenderer(logger)
              : null;
```

- [ ] **Step 4: Start renderer and suppress Effect logger in status mode**

Find (~line 4100):
```typescript
            // Wrap in root observability span for the full execution trace
            // The cast is required because executeCore has service requirements from Effect.gen,
            // but they will be satisfied by Effect.provide(runtime) in the builder.
            const executeCoreWithLogger = executeCore().pipe(
              Effect.provideService(ObservableLogger, logger),
              Effect.tapError((err) => {
```

Replace with:
```typescript
            // Start status renderer before events flow
            if (renderer) yield* renderer.start();

            // Wrap in root observability span for the full execution trace
            // The cast is required because executeCore has service requirements from Effect.gen,
            // but they will be satisfied by Effect.provide(runtime) in the builder.
            const executeCoreWithLogger = executeCore().pipe(
              Effect.provideService(ObservableLogger, logger),
              Effect.tapError((err) => {
```

- [ ] **Step 5: Add renderer stop in Effect.ensuring and silence Effect logger**

Find (~line 4115):
```typescript
            const executeCoreWithLogger = executeCore().pipe(
              Effect.provideService(ObservableLogger, logger),
              Effect.tapError((err) => {
                // All RuntimeErrors extend Data.TaggedError which extends Error
                const asErr = err as unknown as Error & { cause?: Error };
                const message = asErr.message ?? String(err);
                const cause = asErr.cause instanceof Error ? asErr.cause : undefined;
                return logger.emit({
                  _tag: "error",
                  message,
                  error: cause ? { name: cause.name, message: cause.message, stack: cause.stack } : undefined,
                  timestamp: new Date(),
                }).pipe(Effect.catchAll(() => Effect.void));
              }),
            );
```

Replace with:
```typescript
            const executeCoreRaw = executeCore().pipe(
              Effect.provideService(ObservableLogger, logger),
              Effect.tapError((err) => {
                // All RuntimeErrors extend Data.TaggedError which extends Error
                const asErr = err as unknown as Error & { cause?: Error };
                const message = asErr.message ?? String(err);
                const cause = asErr.cause instanceof Error ? asErr.cause : undefined;
                return logger.emit({
                  _tag: "error",
                  message,
                  error: cause ? { name: cause.name, message: cause.message, stack: cause.stack } : undefined,
                  timestamp: new Date(),
                }).pipe(Effect.catchAll(() => Effect.void));
              }),
              Effect.ensuring(Effect.sync(() => { renderer?.stop(); })),
            );

            // In status mode, silence Effect's built-in logger (suppresses INFO ◉ lines)
            const executeCoreWithLogger = isStatusMode
              ? executeCoreRaw.pipe(Effect.provide(Logger.none))
              : executeCoreRaw;
```

- [ ] **Step 6: Typecheck**

```bash
rtk tsc 2>&1 | grep "src/execution-engine.ts"
```

Expected: no output.

- [ ] **Step 7: Build runtime package**

```bash
cd /path/to/reactive-agents-ts/packages/runtime && bun run build 2>&1 | tail -5
```

Expected: `DTS ⚡️ Build success`

- [ ] **Step 8: Commit**

```bash
rtk git add packages/runtime/src/execution-engine.ts
rtk git commit -m "feat(runtime): wire StatusRenderer — auto-detects TTY, silences Effect logger in status mode"
```

---

### Task 7: Run full test suite and update scratch.ts

**Files:**
- Modify: `scratch.ts` (demo update)

- [ ] **Step 1: Run full packages test suite**

```bash
rtk bun test packages/ 2>&1 | grep " pass\| fail" | tail -3
```

Expected: `3709+ pass, 0 fail`

- [ ] **Step 2: Update scratch.ts to demo status mode**

Replace contents of `scratch.ts`:

```typescript
/**
 * Demo: Claude-Code-style status renderer
 *
 * Runs with status mode auto-detected (isTTY=true in terminal).
 * Run with `| cat` to see stream mode fallback.
 */
import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
  .withProvider('ollama')
  .withModel({ model: 'gemma4:e4b' })
  .withReasoning({ defaultStrategy: 'reactive' })
  .withTools()
  .withObservability({ verbosity: 'silent', live: false })
  .build()

const result = await agent.run(
  'Fetch the current USD price for each of the following currencies: XRP, XLM, ETH, Bitcoin. ' +
  'Then render a markdown table with columns: Currency | Price | Source.'
)

console.log('\n--- Result ---')
console.log(result.output)

await agent.dispose()
```

- [ ] **Step 3: Run scratch.ts and verify the TUI experience**

```bash
bun /path/to/reactive-agents-ts/scratch.ts
```

Expected output during run (single line updating):
```
⠹  Thinking...  ·  iter 3  ·  17s  ·  4,200 tok  ·  $0.0000  ·  entropy 0.55 ↑
```

Expected permanent lines when they occur:
```
⚠  [oracle-gate] Stage 1 nudge injected
```

Expected completion line:
```
✓  Done  ·  34s  ·  11,390 tok  ·  4 calls  ·  $0.0000
```

Expected: NO `INFO ◉ [bootstrap]...` lines, NO `timestamp=...fiber=...` lines.

- [ ] **Step 4: Commit**

```bash
rtk git add scratch.ts
rtk git commit -m "chore: update scratch.ts to demo status renderer TUI experience"
```

---

## Self-Review

**Spec coverage:**
- ✅ Single updating status line with ANSI overwrite — Task 4
- ✅ Spinner at 100ms interval — Task 4 (`setInterval`)
- ✅ iter + elapsed + tokens + cost + entropy on status line — Task 4 (`statusLine()`)
- ✅ Permanent lines for warnings/errors/notices — Task 4 (`printLine()`)
- ✅ Completion line with all stats — Task 4 (`completion` case)
- ✅ Auto-detect TTY → status mode — Task 6 (`isStatusMode`)
- ✅ CI/pipe fallback to stream mode — Task 6 (`isStatusMode` false when not TTY)
- ✅ Suppress `INFO ◉` lines — Task 6 (`Effect.provide(Logger.none)`)
- ✅ `mode?: "stream" | "status"` config — Task 2
- ✅ `tokens_used` + `cost_usd` metrics — Task 1
- ✅ Tests — Task 3 + Task 4

**Placeholder scan:** None found. All steps include exact code.

**Type consistency:**
- `makeStatusRenderer(logger, out?)` — consistent across Tasks 4, 5, 6
- `StatusRenderer.start()` returns `Effect.Effect<void, never>` — consistent Task 4 impl and Task 6 usage
- `StatusRenderer.stop()` is `() => void` — consistent Task 4 impl and Task 6 `renderer?.stop()`
- `ObservableLoggerService` (not `ObservableLogger`) — correct, matches the interface separation from the Tag class
