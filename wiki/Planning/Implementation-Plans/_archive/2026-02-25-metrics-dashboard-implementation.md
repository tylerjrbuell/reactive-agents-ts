# CLI Metrics Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Transform verbose metrics output into a professional CLI dashboard showing execution summary, phase timeline, tool execution, and smart alerts.

**Architecture:**
- Enhance `MetricsCollector` to track tool execution (name, duration, status, count)
- Add `formatMetricsDashboard()` in console-exporter to build structured dashboard object
- Create sub-functions for header card, timeline, tools section, and alerts
- Update `exportMetrics()` to use new dashboard formatter instead of raw counter output
- Wire tool execution data from ExecutionEngine → MetricsCollector

**Tech Stack:** TypeScript, Effect-TS, bun:test, ANSI colors (existing)

---

## Task 1: Enhance MetricsCollector for Tool Tracking

**Files:**
- Modify: `packages/observability/src/metrics/metrics-collector.ts`
- Modify: `packages/observability/src/types.ts`
- Test: `packages/observability/tests/metrics-collector.test.ts`

**Step 1: Add ToolMetric type to types.ts**

```typescript
// packages/observability/src/types.ts - add near Metric type

export interface ToolMetric {
  readonly toolName: string;
  readonly duration: number; // ms
  readonly status: "success" | "error" | "partial";
  readonly callCount: number;
  readonly timestamp: Date;
}
```

**Step 2: Write failing test for tool tracking**

```typescript
// packages/observability/tests/metrics-collector.test.ts - add test

import { describe, it, expect } from "bun:test";
import { MetricsCollector } from "../metrics/metrics-collector.js";

describe("MetricsCollector - Tool Tracking", () => {
  it("should track tool executions with name, duration, and status", () => {
    const collector = new MetricsCollector();

    collector.recordToolExecution("file-write", 450, "success");
    collector.recordToolExecution("file-write", 380, "success");
    collector.recordToolExecution("web-search", 280, "success");

    const tools = collector.getToolMetrics();
    expect(tools).toHaveLength(3);
    expect(tools[0]).toEqual({
      toolName: "file-write",
      duration: 450,
      status: "success",
      callCount: 1,
      timestamp: expect.any(Date),
    });
  });

  it("should group tool calls by name for summary", () => {
    const collector = new MetricsCollector();

    collector.recordToolExecution("file-write", 450, "success");
    collector.recordToolExecution("file-write", 380, "success");

    const summary = collector.getToolSummary();
    expect(summary.get("file-write")).toEqual({
      name: "file-write",
      callCount: 2,
      totalDuration: 830,
      avgDuration: 415,
      successCount: 2,
      errorCount: 0,
    });
  });
});
```

**Step 3: Run test to verify failure**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test packages/observability/tests/metrics-collector.test.ts
```

Expected: FAIL with "recordToolExecution is not defined"

**Step 4: Add recordToolExecution() method to MetricsCollector**

```typescript
// packages/observability/src/metrics/metrics-collector.ts

export class MetricsCollector {
  private metrics: Metric[] = [];
  private toolMetrics: ToolMetric[] = []; // Add this

  // ... existing code ...

  recordToolExecution(
    toolName: string,
    duration: number,
    status: "success" | "error" | "partial"
  ): void {
    this.toolMetrics.push({
      toolName,
      duration,
      status,
      callCount: 1,
      timestamp: new Date(),
    });
  }

  getToolMetrics(): ToolMetric[] {
    return [...this.toolMetrics];
  }

  getToolSummary(): Map<
    string,
    {
      name: string;
      callCount: number;
      totalDuration: number;
      avgDuration: number;
      successCount: number;
      errorCount: number;
    }
  > {
    const summary = new Map();
    for (const tool of this.toolMetrics) {
      const existing = summary.get(tool.toolName) ?? {
        name: tool.toolName,
        callCount: 0,
        totalDuration: 0,
        successCount: 0,
        errorCount: 0,
      };
      existing.callCount++;
      existing.totalDuration += tool.duration;
      if (tool.status === "success") existing.successCount++;
      else if (tool.status === "error") existing.errorCount++;
      summary.set(tool.toolName, existing);
    }
    // Compute avgDuration for each
    for (const [name, data] of summary.entries()) {
      data.avgDuration = Math.round(data.totalDuration / data.callCount);
      summary.set(name, data);
    }
    return summary;
  }
}
```

**Step 5: Run test to verify pass**

```bash
bun test packages/observability/tests/metrics-collector.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add \
  packages/observability/src/types.ts \
  packages/observability/src/metrics/metrics-collector.ts \
  packages/observability/tests/metrics-collector.test.ts
git commit -m "feat(observability): add tool execution tracking to MetricsCollector

- Add ToolMetric interface for individual tool calls
- Add recordToolExecution(name, duration, status) method
- Add getToolSummary() to aggregate tool metrics by name
- Compute call count, total/avg duration, success/error counts
- 2 new tests verify tracking and summarization

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add Dashboard Data Structure & Helper Functions

**Files:**
- Modify: `packages/observability/src/exporters/console-exporter.ts`
- Test: `packages/observability/tests/console-exporter.test.ts`

**Step 1: Define DashboardData type**

```typescript
// packages/observability/src/exporters/console-exporter.ts - add at top

export interface DashboardData {
  readonly status: "success" | "error" | "partial";
  readonly totalDuration: number; // ms
  readonly stepCount: number;
  readonly tokenCount: number;
  readonly estimatedCost: number; // USD
  readonly modelName: string;

  readonly phases: Array<{
    readonly name: string;
    readonly duration: number;
    readonly status: "ok" | "warning" | "error";
    readonly details?: string; // e.g., "7 iter, 72% of time"
  }>;

  readonly tools: Array<{
    readonly name: string;
    readonly callCount: number;
    readonly successCount: number;
    readonly errorCount: number;
    readonly avgDuration: number;
  }>;

  readonly alerts: Array<{
    readonly level: "warning" | "error" | "info";
    readonly message: string;
  }>;
}
```

**Step 2: Write test for dashboard formatting**

```typescript
// packages/observability/tests/console-exporter.test.ts - add test

import { describe, it, expect } from "bun:test";
import { formatMetricsDashboard } from "../exporters/console-exporter.js";

describe("formatMetricsDashboard", () => {
  it("should format dashboard data into a professional CLI output", () => {
    const data: DashboardData = {
      status: "success",
      totalDuration: 13879,
      stepCount: 7,
      tokenCount: 1963,
      estimatedCost: 0.003,
      modelName: "claude-3.5-sonnet",
      phases: [
        { name: "bootstrap", duration: 100, status: "ok" },
        { name: "think", duration: 10001, status: "warning", details: "7 iter, 72% of time" },
        { name: "act", duration: 1000, status: "ok", details: "2 tools" },
      ],
      tools: [
        { name: "file-write", callCount: 3, successCount: 3, errorCount: 0, avgDuration: 450 },
        { name: "web-search", callCount: 2, successCount: 2, errorCount: 0, avgDuration: 280 },
      ],
      alerts: [
        { level: "warning", message: "think phase blocked ≥10s (LLM latency)" },
      ],
    };

    const output = formatMetricsDashboard(data);

    // Verify structure
    expect(output).toContain("✅");
    expect(output).toContain("Execution Summary");
    expect(output).toContain("Execution Timeline");
    expect(output).toContain("Tool Execution");
    expect(output).toContain("Alerts");

    // Verify data presence
    expect(output).toContain("Success");
    expect(output).toContain("13.9s");
    expect(output).toContain("1,963");
    expect(output).toContain("$0.003");
    expect(output).toContain("72% of time");
  });

  it("should use warning icon for phases > 10s", () => {
    const data: DashboardData = {
      status: "success",
      totalDuration: 15000,
      stepCount: 5,
      tokenCount: 500,
      estimatedCost: 0.001,
      modelName: "gpt-4",
      phases: [
        { name: "think", duration: 12000, status: "warning", details: "4 iter" },
      ],
      tools: [],
      alerts: [],
    };

    const output = formatMetricsDashboard(data);
    expect(output).toContain("⚠️");
  });

  it("should omit empty sections (no tools, no alerts)", () => {
    const data: DashboardData = {
      status: "success",
      totalDuration: 500,
      stepCount: 1,
      tokenCount: 100,
      estimatedCost: 0.0001,
      modelName: "test-model",
      phases: [
        { name: "bootstrap", duration: 500, status: "ok" },
      ],
      tools: [],
      alerts: [],
    };

    const output = formatMetricsDashboard(data);
    expect(output).not.toContain("Tool Execution");
    expect(output).not.toContain("Alerts");
    expect(output).toContain("Execution Summary");
  });
});
```

**Step 3: Run test to verify failure**

```bash
bun test packages/observability/tests/console-exporter.test.ts -t "formatMetricsDashboard"
```

Expected: FAIL with "formatMetricsDashboard is not defined"

**Step 4: Implement formatMetricsDashboard() function**

```typescript
// packages/observability/src/exporters/console-exporter.ts - add function

/**
 * Format DashboardData into a professional CLI dashboard string.
 */
export const formatMetricsDashboard = (data: DashboardData): string => {
  const lines: string[] = [];

  // Header card
  lines.push(`┌─────────────────────────────────────────────────────────────┐`);
  const statusIcon = data.status === "success" ? "✅" : data.status === "error" ? "❌" : "⚠️";
  lines.push(`│ ${statusIcon} Agent Execution Summary                                   │`);
  lines.push(`├─────────────────────────────────────────────────────────────┤`);

  const statusText = data.status === "success" ? "Success" : data.status === "error" ? "Error" : "Partial";
  const durationStr = formatDuration(data.totalDuration);
  lines.push(`│ Status:    ${statusIcon} ${statusText.padEnd(8)} Duration: ${durationStr.padEnd(7)} Steps: ${String(data.stepCount).padEnd(2)} │`);
  lines.push(`│ Tokens:    ${String(data.tokenCount).padEnd(10)} Cost: ~$${data.estimatedCost.toFixed(4).padEnd(7)} Model: ${data.modelName} │`);
  lines.push(`└─────────────────────────────────────────────────────────────┘`);
  lines.push("");

  // Timeline section
  if (data.phases.length > 0) {
    lines.push(`📊 Execution Timeline`);
    const totalDuration = data.totalDuration || 1; // Avoid division by zero

    for (let i = 0; i < data.phases.length; i++) {
      const phase = data.phases[i];
      const isLast = i === data.phases.length - 1;
      const prefix = isLast ? "└─" : "├─";

      const phaseIcon = phase.status === "ok" ? "✅" : phase.status === "warning" ? "⚠️" : "❌";
      const durationStr = String(phase.duration).padStart(8) + "ms";
      const percentage = ((phase.duration / totalDuration) * 100).toFixed(0);
      const details = phase.details ? ` (${phase.details})` : "";
      const percentDisplay = phase.status === "warning" ? ` ${percentage}% of time` : "";

      lines.push(`${prefix} [${phase.name.padEnd(16)}] ${durationStr}  ${phaseIcon}${percentDisplay}${details}`);
    }
    lines.push("");
  }

  // Tools section
  if (data.tools.length > 0) {
    lines.push(`🔧 Tool Execution (${data.tools.length} called)`);
    for (let i = 0; i < data.tools.length; i++) {
      const tool = data.tools[i];
      const isLast = i === data.tools.length - 1;
      const prefix = isLast ? "└─" : "├─";

      const icon = tool.errorCount === 0 ? "✅" : "⚠️";
      const callsText = `${tool.callCount} call${tool.callCount === 1 ? "" : "s"}`;
      lines.push(`${prefix} ${tool.name.padEnd(16)} ${icon} ${callsText}, ${tool.avgDuration}ms avg`);
    }
    lines.push("");
  }

  // Alerts section
  if (data.alerts.length > 0) {
    lines.push(`⚠️  Alerts & Insights`);
    for (let i = 0; i < data.alerts.length; i++) {
      const alert = data.alerts[i];
      const isLast = i === data.alerts.length - 1;
      const prefix = isLast ? "└─" : "├─";

      const icon = alert.level === "error" ? "❌" : alert.level === "warning" ? "⚠️" : "ℹ️";
      lines.push(`${prefix} ${icon} ${alert.message}`);
    }
  }

  return lines.join("\n");
};

/**
 * Format milliseconds into human-readable duration (e.g., "13.9s", "500ms").
 */
const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
};
```

**Step 5: Run test to verify pass**

```bash
bun test packages/observability/tests/console-exporter.test.ts -t "formatMetricsDashboard"
```

Expected: PASS (all 3 test cases)

**Step 6: Commit**

```bash
git add \
  packages/observability/src/exporters/console-exporter.ts \
  packages/observability/tests/console-exporter.test.ts
git commit -m "feat(observability): add formatMetricsDashboard() for professional CLI output

- Add DashboardData interface with status, phases, tools, alerts
- Implement formatMetricsDashboard() with header card, timeline, tools, alerts
- Add formatDuration() helper (ms → 's' or 'ms')
- Professional box drawing, percentages, icons for status
- Omit empty sections (no tools, no alerts)
- 3 tests verify structure, warning icons, empty section handling

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Wire Tool Execution Tracking in ExecutionEngine

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`
- Test: `packages/runtime/tests/execution-engine.test.ts`

**Step 1: Find where tools are executed in ExecutionEngine**

```bash
grep -n "ToolService\|executeTool\|tool.execute" packages/runtime/src/execution-engine.ts | head -20
```

(Review output to identify tool execution points)

**Step 2: Add recordToolExecution call after tool execution**

In the ACT phase or tool result handling, add:

```typescript
// packages/runtime/src/execution-engine.ts - in act phase or tool handler

import { MetricsCollector } from "@reactive-agents/observability";

// After tool executes successfully:
const startTime = Date.now();
const result = await toolService.execute(toolName, params);
const duration = Date.now() - startTime;

const metricsCollector = /* get from context or Effect */;
metricsCollector.recordToolExecution(toolName, duration, "success");
```

(Exact location depends on current code structure; verify during implementation)

**Step 3: Run tests to verify**

```bash
bun test packages/runtime/tests/execution-engine.test.ts
```

Expected: PASS (tool execution recorded)

**Step 4: Commit**

```bash
git add packages/runtime/src/execution-engine.ts
git commit -m "feat(runtime): wire tool execution tracking into MetricsCollector

- Record tool name, duration, and status after each tool execution
- Integrated into ACT phase execution flow
- Metrics collected for dashboard display

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Update exportMetrics() to use formatMetricsDashboard()

**Files:**
- Modify: `packages/observability/src/exporters/console-exporter.ts`
- Test: `packages/observability/tests/console-exporter.test.ts`

**Step 1: Write test for exportMetrics integration**

```typescript
// packages/observability/tests/console-exporter.test.ts - add test

it("should export formatted dashboard when showMetrics is true", () => {
  const exporter = makeConsoleExporter({ showMetrics: true });

  const metrics: Metric[] = [
    { name: "execution.phase.duration_ms", type: "histogram", value: 100 },
    { name: "execution.phase.duration_ms", type: "histogram", value: 10001 },
    { name: "execution.phase.count", type: "counter", value: 7 },
  ];

  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => output.push(args.join(" "));

  exporter.exportMetrics(metrics);

  console.log = originalLog;

  const allOutput = output.join("\n");
  expect(allOutput).toContain("Execution Summary"); // Dashboard format
  expect(allOutput).not.toContain("counter"); // Not raw counter format
});
```

**Step 2: Build DashboardData from metrics in exportMetrics()**

```typescript
// packages/observability/src/exporters/console-exporter.ts - replace exportMetrics

const exportMetrics = (metrics: readonly Metric[], context?: ExecutionContext): void => {
  if (!showMetrics || metrics.length === 0) return;

  // Aggregate metrics into DashboardData
  const dashboardData = buildDashboardData(metrics, context);

  // Format and output
  const formatted = formatMetricsDashboard(dashboardData);
  console.log(`\n${BOLD}${CYAN}═══ Metrics Summary ═══${RESET}\n${formatted}`);
};

/**
 * Build DashboardData by aggregating raw metrics.
 */
const buildDashboardData = (
  metrics: readonly Metric[],
  context?: ExecutionContext
): DashboardData => {
  // Extract phase durations
  const phaseDurations = new Map<string, number>();
  for (const m of metrics) {
    if (m.name.includes("duration_ms")) {
      const phaseMatch = m.name.match(/phase\.(\w+)\.duration/);
      if (phaseMatch) {
        const phase = phaseMatch[1];
        phaseDurations.set(phase, (phaseDurations.get(phase) ?? 0) + m.value);
      }
    }
  }

  const totalDuration = Array.from(phaseDurations.values()).reduce((a, b) => a + b, 0);

  // Build phases array
  const phases = Array.from(phaseDurations.entries()).map(([name, duration]) => ({
    name,
    duration,
    status: duration > 10000 ? ("warning" as const) : ("ok" as const),
    details: name === "think" ? `${context?.metadata?.stepsCount ?? 0} iter, ${((duration / totalDuration) * 100).toFixed(0)}% of time` : undefined,
  }));

  // Get tool summary (assumes toolCollector available)
  // This may require passing MetricsCollector instance

  return {
    status: context?.executionStatus ?? "success",
    totalDuration,
    stepCount: context?.metadata?.stepsCount ?? 0,
    tokenCount: context?.metadata?.tokensUsed ?? 0,
    estimatedCost: calculateCost(context?.metadata?.tokensUsed ?? 0),
    modelName: context?.config?.model ?? "unknown",
    phases,
    tools: [], // Populated from collector.getToolSummary()
    alerts: generateAlerts(phases, totalDuration),
  };
};

const calculateCost = (tokens: number): number => {
  // Rough estimate: $0.003 per 1M tokens (varies by model)
  return (tokens / 1000000) * 0.003;
};

const generateAlerts = (
  phases: DashboardData["phases"],
  totalDuration: number
): DashboardData["alerts"] => {
  const alerts: DashboardData["alerts"] = [];

  for (const phase of phases) {
    if (phase.duration > 10000) {
      alerts.push({
        level: "warning",
        message: `${phase.name} phase blocked ≥10s (LLM latency)`,
      });
    }
  }

  return alerts;
};
```

**Step 3: Run tests**

```bash
bun test packages/observability/tests/console-exporter.test.ts -t "export"
```

Expected: PASS

**Step 4: Commit**

```bash
git add packages/observability/src/exporters/console-exporter.ts
git commit -m "feat(observability): replace raw metrics with professional dashboard output

- exportMetrics() now builds DashboardData from aggregated metrics
- formatMetricsDashboard() generates professional CLI output
- buildDashboardData() extracts phases, calculates percentages
- generateAlerts() identifies bottlenecks and warnings
- calculateCost() estimates USD cost from token count
- Replaces verbose counter/histogram output

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Run Full Test Suite & Verify Output

**Files:**
- No changes (verification only)

**Step 1: Run all observability tests**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test packages/observability/tests/ --verbose
```

Expected: All tests PASS (existing + new)

**Step 2: Run all runtime tests**

```bash
bun test packages/runtime/tests/
```

Expected: All tests PASS (no regressions)

**Step 3: Run full suite**

```bash
bun test
```

Expected: All 864 tests PASS

**Step 4: Manual verification with a real agent run**

```bash
# Run test.ts to see the dashboard output
bun run test.ts 2>&1 | tail -40
```

Expected: Professional dashboard output (not raw counters)

**Step 5: Commit verification**

```bash
git add -A
git commit -m "test: verify all tests pass with dashboard metrics

- All 864 tests pass
- Manual verification confirms professional dashboard output
- No regressions in existing functionality

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Update Docs & Finalize

**Files:**
- Modify: `CLAUDE.md` (if metrics are documented)
- Modify: `README.md` (if examples need updating)

**Step 1: Check if CLAUDE.md or README documents current metrics output**

```bash
grep -n "Metrics\|metrics\|observability output" CLAUDE.md README.md
```

**Step 2: Update docs if needed**

Example update to CLAUDE.md:

```markdown
## Observability Output

Agents with observability enabled display a professional metrics dashboard on completion:

\`\`\`
┌─────────────────────────────────────────────────────────────┐
│ ✅ Agent Execution Summary                                   │
├─────────────────────────────────────────────────────────────┤
│ Status:    ✅ Success   Duration: 13.9s   Steps: 7          │
│ Tokens:    1,963        Cost: ~$0.003     Model: claude-3.5 │
└─────────────────────────────────────────────────────────────┘

📊 Execution Timeline
├─ [bootstrap]       100ms    ✅
├─ [think]        10,001ms    ⚠️  (7 iter, 72% of time)
...
\`\`\`

Shows: execution status, timing per phase, tool calls, and smart alerts about bottlenecks.
```

**Step 3: Commit docs**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document new professional metrics dashboard format

- Add example output showing header, timeline, tools, alerts
- Update observability section with feature description
- Link to design spec for implementation details

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Summary

**Total Tasks:** 6
**Total Time:** ~2 hours for full implementation
**Commits:** 7 focused commits (one per task + final)
**Tests Added:** ~5 new tests (tool tracking, dashboard formatting)
**Test Coverage:** 864 total tests maintained

**Key Deliverables:**
- ✅ Enhanced MetricsCollector with tool execution tracking
- ✅ Professional formatMetricsDashboard() with header, timeline, tools, alerts
- ✅ Integrated tool tracking in ExecutionEngine
- ✅ Updated exportMetrics() to use new dashboard
- ✅ All tests passing, no regressions
- ✅ Documentation updated

---

## Execution Status

Now proceeding with **Subagent-Driven Development**: Fresh subagent per task, two-stage review (spec compliance + code quality), all 864 tests passing.
