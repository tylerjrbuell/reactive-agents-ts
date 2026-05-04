# Observability Dashboard chalk+boxen Upgrade Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw ANSI escape codes in `packages/observability` with `chalk` + `boxen` for a visually polished dashboard, and eliminate the duplicate `renderDashboard()` in the CLI.

**Architecture:** Add `chalk` and `boxen` as dependencies to `packages/observability`. Rewrite `formatMetricsDashboard()` and all log/span helpers in `console-exporter.ts` to use chalk for coloring and boxen for the header card. Remove the parallel `renderDashboard()` and duplicate type definitions from `apps/cli/src/ui.ts`. Wire `apps/cli/src/commands/demo.ts` to use the observability formatter directly.

**Tech Stack:** TypeScript, `chalk ^5.4.0`, `boxen ^8.0.1`, `bun:test`, Effect-TS

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/observability/package.json` | Modify | Add chalk + boxen deps |
| `packages/observability/src/exporters/console-exporter.ts` | Modify | Rewrite all ANSI → chalk; header card → boxen |
| `packages/observability/tests/exporters.test.ts` | Modify | Update test for "Metrics Summary" label change if needed |
| `apps/cli/src/ui.ts` | Modify | Delete `renderDashboard()` + 3 duplicate interfaces |
| `apps/cli/src/commands/demo.ts` | Modify | Swap import source; replace `renderDashboard()` call |

---

## Chunk 1: Add deps and rewrite console-exporter.ts

### Task 1: Add chalk and boxen to observability package

**Files:**
- Modify: `packages/observability/package.json`

- [ ] **Step 1: Add chalk and boxen to dependencies**

In `packages/observability/package.json`, add to the `"dependencies"` block:

```json
"chalk": "^5.4.0",
"boxen": "^8.0.1"
```

Final `dependencies` section should look like:

```json
"dependencies": {
  "@opentelemetry/api": "^1.9.0",
  "@opentelemetry/exporter-metrics-otlp-http": "^0.213.0",
  "@opentelemetry/exporter-trace-otlp-http": "^0.213.0",
  "@opentelemetry/resources": "^2.6.0",
  "@opentelemetry/sdk-metrics": "^2.6.0",
  "@opentelemetry/sdk-trace-base": "^2.6.0",
  "@opentelemetry/semantic-conventions": "^1.40.0",
  "@reactive-agents/core": "0.7.8",
  "chalk": "^5.4.0",
  "boxen": "^8.0.1",
  "effect": "^3.10.0"
}
```

- [ ] **Step 2: Install dependencies**

Run from the workspace root (the directory containing `bun.lockb`):

```bash
bun install
```

Expected: `bun install` completes without errors. Bun workspace deduplication means chalk/boxen resolve to the same copy already used by `apps/cli`.

- [ ] **Step 3: Verify observability package builds**

```bash
cd packages/observability && bun run build
```

Expected: `dist/` emits successfully with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/observability/package.json bun.lockb
git commit -m "deps(observability): add chalk and boxen for terminal UI"
```

---

### Task 2: Rewrite console-exporter.ts with chalk + boxen

**Files:**
- Modify: `packages/observability/src/exporters/console-exporter.ts`

This task replaces the entire coloring approach. The file structure stays the same; only the color/style mechanisms change.

- [ ] **Step 1: Replace ANSI color constants with chalk imports and brand palette**

At the top of `packages/observability/src/exporters/console-exporter.ts`, replace the ANSI block:

```typescript
// REMOVE all of these (all 9 constants including BLUE which is unused but must go):
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";  // unused but remove it — the grep in Step 9 will catch it if left
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

const LOG_COLORS: Record<string, string> = {
  debug: GRAY,
  info: GREEN,
  warn: YELLOW,
  error: RED,
};
```

With chalk import and brand palette constants:

```typescript
import chalk from "chalk";
import boxen from "boxen";

// ─── Brand Palette ───
const C_VIOLET = "#8b5cf6";
const C_CYAN   = "#06b6d4";
const C_GREEN  = "#22c55e";
const C_YELLOW = "#eab308";
const C_RED    = "#ef4444";
const C_DIM    = "#6b7280";

const LOG_COLORS: Record<string, (s: string) => string> = {
  debug: (s) => chalk.hex(C_DIM)(s),
  info:  (s) => chalk.hex(C_GREEN)(s),
  warn:  (s) => chalk.hex(C_YELLOW)(s),
  error: (s) => chalk.hex(C_RED)(s),
};
```

- [ ] **Step 2: Add visualWidth and padEndVisual helpers**

After the brand palette, add these two helpers. They ensure emoji-bearing strings can be padded to a target visual column width without ragged alignment:

```typescript
// ─── Emoji-aware padding ───

/**
 * Returns the visual terminal width of a string.
 * Most characters = 1 column; emoji (Extended_Pictographic) = 2 columns.
 */
const visualWidth = (s: string): number => {
  let w = 0;
  for (const ch of s) {
    w += /\p{Extended_Pictographic}/u.test(ch) ? 2 : 1;
  }
  return w;
};

/**
 * Pad a string to a target visual width, accounting for emoji double-width.
 */
const padEndVisual = (s: string, width: number): string =>
  s + " ".repeat(Math.max(0, width - visualWidth(s)));
```

- [ ] **Step 3: Rewrite exportLogs() to use chalk**

Find the `exportLogs` function and replace its internals. It currently uses ANSI constants to build log lines. Replace with chalk calls:

```typescript
const exportLogs = (logs: readonly LogEntry[]): void => {
  if (!showLogs || logs.length === 0) return;
  const minLevelOrder = LOG_LEVEL_ORDER[minLevel] ?? 0;
  const filtered = logs.filter(
    (l) => (LOG_LEVEL_ORDER[l.level] ?? 0) >= minLevelOrder,
  );
  if (filtered.length === 0) return;

  console.log(`\n${chalk.hex(C_CYAN).bold(`═══ Logs (${filtered.length}) ═══`)}`);
  for (const entry of filtered) {
    const colorFn = LOG_COLORS[entry.level] ?? ((s: string) => s);
    const ts = entry.timestamp.toISOString().slice(11, 23);
    const level = entry.level.toUpperCase().padEnd(5);
    const meta = entry.metadata
      ? ` ${chalk.hex(C_DIM)(JSON.stringify(entry.metadata))}`
      : "";
    console.log(
      `  ${chalk.hex(C_DIM)(ts)} ${colorFn(chalk.bold(level))} ${entry.message}${meta}`,
    );
  }
};
```

- [ ] **Step 4: Rewrite exportSpans() to use chalk**

Replace the `exportSpans` internals:

```typescript
const exportSpans = (spans: readonly Span[]): void => {
  if (!showSpans || spans.length === 0) return;
  console.log(`\n${chalk.hex(C_CYAN).bold(`═══ Spans (${spans.length}) ═══`)}`);

  const spanMap = new Map(spans.map((s) => [s.spanId, s]));
  const childrenMap = new Map<string | undefined, Span[]>();
  for (const span of spans) {
    const parent = span.parentSpanId;
    const siblings = childrenMap.get(parent) ?? [];
    childrenMap.set(parent, [...siblings, span]);
  }

  const printTree = (span: Span, indent: number): void => {
    const prefix = "  " + "  ".repeat(indent);
    const durationMs = span.attributes["duration_ms"] as number | undefined;
    const durStr = durationMs !== undefined
      ? ` ${chalk.hex(C_DIM)(`(${durationMs.toFixed(1)}ms)`)}`
      : "";
    const [statusColor, statusIcon] =
      span.status === "ok"
        ? [chalk.hex(C_GREEN), "✓"]
        : span.status === "error"
          ? [chalk.hex(C_RED), "✗"]
          : [chalk.hex(C_DIM), "○"];
    console.log(
      `${prefix}${statusColor(statusIcon)} ${chalk.bold(span.name)}${durStr} ${chalk.hex(C_DIM)(`[${span.traceId.slice(0, 8)}…]`)}`,
    );
    for (const child of childrenMap.get(span.spanId) ?? []) {
      printTree(child, indent + 1);
    }
  };

  for (const root of childrenMap.get(undefined) ?? []) printTree(root, 0);
  for (const span of spans) {
    if (span.parentSpanId && !spanMap.has(span.parentSpanId)) printTree(span, 0);
  }
};
```

- [ ] **Step 5: Rewrite exportMetrics() to use chalk and remove dead helpers**

The `exportMetrics` body currently references removed ANSI constants (`BOLD`, `CYAN`, `RESET`). Replace it, and delete the now-dead `getStatusIcon` and `getAlertIcon` helper functions (they are only used inside `formatMetricsDashboard` which is being fully rewritten):

```typescript
const exportMetrics = (
  metrics: readonly Metric[],
  metricsCollector?: MetricsCollector,
): void => {
  if (!showMetrics || metrics.length === 0) return;

  const dashboardData = buildDashboardData(metrics, metricsCollector);
  const dashboard = formatMetricsDashboard(dashboardData);
  console.log(`\n${chalk.hex(C_CYAN).bold("═══ Metrics Summary ═══")}`);
  console.log(dashboard);
};
```

Also delete the `getStatusIcon` and `getAlertIcon` helper functions entirely — they are replaced by inline chalk expressions in `formatMetricsDashboard`.

> **Dual-header design note:** After this rewrite, `exportMetrics()` outputs two visual elements: (1) `═══ Metrics Summary ═══` as a section divider above the box, and (2) the boxen box itself with its own `Agent Execution Summary` title. This is intentional — the outer label acts as a scroll-anchor in long terminal sessions, while the boxen box is the rich card. The existing test at line 118 (`toContain("Metrics Summary")`) verifies both coexist.

- [ ] **Step 6: Rewrite formatLogEntryLive() and makeLiveLogWriter() to use chalk**

Replace:

```typescript
export const formatLogEntryLive = (entry: LogEntry): string => {
  const colorFn = LOG_COLORS[entry.level] ?? ((s: string) => s);
  const ts = entry.timestamp.toISOString().slice(11, 23);
  const level = entry.level.toUpperCase().padEnd(5);
  const meta = entry.metadata
    ? ` ${chalk.hex(C_DIM)(JSON.stringify(entry.metadata))}`
    : "";
  return `  ${chalk.hex(C_DIM)(ts)} ${colorFn(chalk.bold(level))} ${entry.message}${meta}`;
};
```

`makeLiveLogWriter` does not reference ANSI constants directly; it calls `formatLogEntryLive`, so no change needed there beyond the function above.

- [ ] **Step 7: Rewrite formatMetricsDashboard() — header box with boxen**

The header card switches from manual box-drawing characters to `boxen`. The key rule: **do not manually pad content strings containing emoji inside boxen** — let boxen own the border.

Replace the entire `formatMetricsDashboard` function with:

```typescript
export const formatMetricsDashboard = (data: DashboardData): string => {
  const lines: string[] = [];

  // ── Header box ──────────────────────────────────────────────────────────
  const borderColor =
    data.status === "success" ? C_GREEN
    : data.status === "error" ? C_RED
    : C_YELLOW;

  const statusText =
    data.status === "success" ? chalk.hex(C_GREEN)("✔ Success")
    : data.status === "error" ? chalk.hex(C_RED)("✖ Failed")
    : chalk.hex(C_YELLOW)("⚠ Partial");

  const durationStr = formatDuration(data.totalDuration);
  const isLocalProvider =
    data.provider?.toLowerCase().includes("ollama") ||
    data.provider?.toLowerCase().includes("test");

  const headerLines = [
    `${chalk.bold("Status:")}   ${statusText}   ${chalk.bold("Duration:")} ${durationStr}   ${chalk.bold("Steps:")} ${data.stepCount}`,
    `${chalk.bold("Model:")}    ${data.modelName}   (${data.provider})   ${chalk.bold("Tokens:")} ${formatNumber(data.tokenCount)}`,
  ];
  if (!isLocalProvider) {
    headerLines.push(`${chalk.bold("Cost:")}     ~$${data.estimatedCost.toFixed(3)}`);
  }

  lines.push(
    boxen(headerLines.join("\n"), {
      title: chalk.bold("Agent Execution Summary"),
      titleAlignment: "left",
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      borderStyle: "round",
      borderColor,
    }),
  );

  // ── Execution Timeline ───────────────────────────────────────────────────
  if (data.phases.length > 0) {
    lines.push("");
    lines.push(chalk.hex(C_CYAN).bold("📊 Execution Timeline"));

    // Phase names don't contain emoji — safe to use regular padEnd
    const maxPhaseNameLen = Math.max(...data.phases.map((p) => p.name.length + 2), 12);

    for (let i = 0; i < data.phases.length; i++) {
      const phase = data.phases[i];
      const isLast = i === data.phases.length - 1;
      const prefix = isLast ? "└─" : "├─";
      const phaseName = chalk.hex(C_DIM)(`[${phase.name}]`.padEnd(maxPhaseNameLen));
      const durStr = formatDuration(phase.duration).padStart(8);

      // Status icon — emoji at end of line, no padding needed after it
      const icon =
        phase.status === "warning" ? chalk.hex(C_YELLOW)("⚠")
        : phase.status === "error" ? chalk.hex(C_RED)("✖")
        : chalk.hex(C_GREEN)("✔");

      const detailsStr = phase.details ? chalk.hex(C_DIM)(` (${phase.details})`) : "";
      lines.push(`${prefix} ${phaseName} ${durStr}  ${icon}${detailsStr}`);
    }
  }

  // ── Tool Execution ───────────────────────────────────────────────────────
  if (data.tools.length > 0) {
    lines.push("");
    lines.push(chalk.hex(C_CYAN).bold(`🔧 Tool Execution (${data.tools.length} called)`));

    for (let i = 0; i < data.tools.length; i++) {
      const tool = data.tools[i];
      const isLast = i === data.tools.length - 1;
      const prefix = isLast ? "└─" : "├─";
      const icon = tool.errorCount > 0 ? chalk.hex(C_YELLOW)("⚠") : chalk.hex(C_GREEN)("✔");
      const avgStr = formatDuration(tool.avgDuration);
      const errStr = tool.errorCount > 0
        ? chalk.hex(C_RED)(` ${tool.errorCount} errors`)
        : "";
      lines.push(
        `${prefix} ${chalk.hex(C_CYAN)(tool.name)}  ${icon} ${tool.callCount} calls, ${avgStr} avg${errStr}`,
      );
    }
  }

  // ── Alerts & Insights ────────────────────────────────────────────────────
  if (data.alerts.length > 0) {
    lines.push("");
    lines.push(chalk.hex(C_YELLOW).bold("⚠  Alerts & Insights"));

    for (let i = 0; i < data.alerts.length; i++) {
      const alert = data.alerts[i];
      const isLast = i === data.alerts.length - 1;
      const prefix = isLast ? "└─" : "├─";
      const icon =
        alert.level === "error" ? chalk.hex(C_RED)("✖")
        : alert.level === "warning" ? chalk.hex(C_YELLOW)("⚠")
        : chalk.hex(C_DIM)("ℹ");
      lines.push(`${prefix} ${icon}  ${alert.message}`);
    }
  }

  return lines.join("\n");
};
```

> **Emoji alignment note:** Section header lines (`📊 Execution Timeline`, `🔧 Tool Execution`, `⚠  Alerts & Insights`) are standalone — no trailing border alignment needed, so emoji is safe here. Tree branch lines use text-only phase names in the padded column; the icon follows the duration and is always last before the optional detail string, so no misalignment occurs. The boxen header box owns all its own padding — do not manually pad content strings inside it.

- [ ] **Step 8: Fix all breaking test assertions in exporters.test.ts**

The rewrite replaces emoji status icons (`✅`, `❌`, `⚠️`) with plain chalk-wrapped glyphs (`✔`, `✖`, `⚠`). The following **six assertions** in `packages/observability/tests/exporters.test.ts` will break and must be updated:

| Test name | Line | Old assertion | New assertion |
|-----------|------|---------------|---------------|
| `formats all sections correctly` | 372 | `toContain("✅")` | `toContain("✔ Success")` |
| `formats all sections correctly` | 390 | `toContain("⚠️  Alerts & Insights")` | `toContain("Alerts & Insights")` |
| `shows warning icon for phases > 10s` | 415 | `toContain("⚠️")` on think-line | `toContain("⚠")` (plain glyph, no variation selector) |
| `formats error status correctly` | 463 | `toContain("❌")` | `toContain("✖ Failed")` |
| `includes tool error indicators` | 486 | `toContain("⚠️")` | `toContain("⚠")` |
| `exportMetrics: shows success for slow phases` | 640 | `toContain("⚠️")` | `toContain("⚠")` |

After updating those assertions, run:

```bash
cd packages/observability && bun test tests/exporters.test.ts
```

Expected: all tests in this file pass.

- [ ] **Step 9: Verify no ANSI constants remain**

```bash
grep -n 'RESET\|\\x1b\[' packages/observability/src/exporters/console-exporter.ts
```

Expected: no output. If any hits, replace with the equivalent `chalk` call.

- [ ] **Step 10: Run full observability test suite**

```bash
cd packages/observability && bun test
```

Expected: all tests pass.

- [ ] **Step 11: Build observability package**

```bash
cd packages/observability && bun run build
```

Expected: `dist/` builds successfully with no TypeScript errors.

- [ ] **Step 12: Commit**

```bash
git add packages/observability/src/exporters/console-exporter.ts \
        packages/observability/tests/exporters.test.ts
git commit -m "feat(observability): rewrite dashboard formatter with chalk+boxen"
```

---

## Chunk 2: CLI cleanup and wiring

### Task 3: Remove duplicate dashboard types and renderer from ui.ts

**Files:**
- Modify: `apps/cli/src/ui.ts`

- [ ] **Step 1: Delete the duplicate dashboard section from ui.ts**

Remove lines 197–290 from `apps/cli/src/ui.ts` — this is the entire `// ── Dashboard Renderer ────────────────────────────────────` block including:

- The `DashboardPhase` interface (lines 199–204)
- The `DashboardTool` interface (lines 206–211)
- The `DashboardData` interface (lines 213–224)
- The `renderDashboard()` function (lines 226–290)

Do not remove anything else. Leave the `// ── Legacy compat ──` section below it intact.

- [ ] **Step 2: Verify ui.ts still compiles**

```bash
cd apps/cli && bun run typecheck 2>&1 | head -30
```

Expected: no errors from `ui.ts`. If `DashboardData` is still referenced elsewhere in `ui.ts`, it would error — but it is not, so no errors expected.

---

### Task 4: Wire demo.ts to use observability formatter

**Files:**
- Modify: `apps/cli/src/commands/demo.ts`

- [ ] **Step 1: Update imports in demo.ts**

Find the current import block at the top of `demo.ts`:

```typescript
import {
  banner,
  spinner,
  agentResponse,
  thinking,
  metricsSummary,
  renderDashboard,
  divider,
  kv,
  muted,
  type DashboardData,
} from "../ui.js";
```

Replace with (remove `renderDashboard` and `DashboardData`; add observability import):

```typescript
import {
  banner,
  spinner,
  agentResponse,
  thinking,
  metricsSummary,
  divider,
  kv,
  muted,
} from "../ui.js";
import { formatMetricsDashboard, type DashboardData } from "@reactive-agents/observability";
```

- [ ] **Step 2: Update the DashboardData object literal in demo.ts**

The current `dashboardData` object at lines 93–109 uses `ui.ts`'s interface fields. Update it to match the observability `DashboardData` shape (field name differences: `detail` → `details` on phases; `alerts` becomes `DashboardAlert[]`):

```typescript
const dashboardData: DashboardData = {
  status: result.success ? "success" : "error",
  totalDuration: presentedDuration,
  stepCount: 3,
  tokenCount,
  estimatedCost: tokenCount * 0.000003,
  modelName: "test",
  provider: "test",
  phases: [
    { name: "bootstrap", duration: 45,  status: "ok" },
    { name: "strategy",  duration: 30,  status: "ok" },
    { name: "think",     duration: Math.round(presentedDuration * 0.65), status: "ok", details: "3 iterations" },
    { name: "complete",  duration: 15,  status: "ok" },
  ],
  tools: [],
  alerts: [],
};
```

Key changes from the old object:
- `status: "success"` on phases → `status: "ok"` (observability uses `"ok" | "warning" | "error"`)
- `detail: "3 iterations"` → `details: "3 iterations"` (note: `details` not `detail`)
- `alerts: []` type is now `DashboardAlert[]` — empty array satisfies both

- [ ] **Step 3: Replace renderDashboard() call**

Find:
```typescript
renderDashboard(dashboardData);
```

Replace with:
```typescript
console.log(formatMetricsDashboard(dashboardData));
```

> **Why the explicit `console.log`:** `renderDashboard()` was `void` (it called `console.log` internally). `formatMetricsDashboard()` returns a `string`. The `console.log` wrapper is required.

- [ ] **Step 4: Typecheck the CLI**

```bash
cd apps/cli && bun run typecheck 2>&1 | head -40
```

Expected: no TypeScript errors. If any errors mention `DashboardData` field mismatches, fix the object literal in `demo.ts` to align with the observability types.

- [ ] **Step 5: Build the CLI**

```bash
cd apps/cli && bun run build
```

Expected: `dist/` builds successfully.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/ui.ts apps/cli/src/commands/demo.ts
git commit -m "refactor(cli): remove duplicate dashboard renderer; delegate to observability"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
cd /path/to/reactive-agents-ts && bun test
```

Expected: all 1921 tests pass. If count differs slightly due to test file structure, verify no new failures vs baseline.

- [ ] **Step 2: Run full build**

```bash
bun run build
```

Expected: all 21 packages build successfully.

- [ ] **Step 3: Smoke-test rax demo (manual)**

```bash
cd apps/cli && bun run src/index.ts demo
```

Visually verify:
- The header card is a rounded `boxen` box with colored border (green for success)
- `📊 Execution Timeline` section shows with colored phase names and duration column aligned
- No ragged column offsets where emoji icons appear
- Colors match brand palette (violet/cyan/green/yellow/red)

- [ ] **Step 4: Verify no raw ANSI constants remain in console-exporter.ts**

```bash
grep -n '\\x1b\[' packages/observability/src/exporters/console-exporter.ts
```

Expected: no output (zero matches).

- [ ] **Step 5: Verify renderDashboard is gone from CLI**

```bash
grep -rn 'renderDashboard' apps/cli/src/
```

Expected: no output.

- [ ] **Step 6: Final commit (if any loose changes)**

```bash
git status
```

If clean, no commit needed. If any stray changes, stage and commit with an appropriate message.
