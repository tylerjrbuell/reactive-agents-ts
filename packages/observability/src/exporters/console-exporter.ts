import type { LogEntry, Span, Metric } from "../types.js";
import type { LiveLogWriter } from "../logging/structured-logger.js";
import type {
  MetricsCollector,
  ToolSummary,
} from "../metrics/metrics-collector.js";
import chalk from "chalk";
import boxen from "boxen";

// ─── Brand Palette ───
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

// ─── Dashboard Data Structure ───

export interface DashboardPhase {
  readonly name: string;
  readonly duration: number; // milliseconds
  readonly status: "ok" | "warning" | "error";
  readonly details?: string;
}

export interface DashboardTool {
  readonly name: string;
  readonly callCount: number;
  readonly successCount: number;
  readonly errorCount: number;
  readonly avgDuration: number; // milliseconds
}

export interface DashboardAlert {
  readonly level: "warning" | "error" | "info";
  readonly message: string;
}

export interface DashboardEntropyPoint {
  readonly iteration: number;
  readonly composite: number;
  readonly trajectory: {
    readonly shape: string;
    readonly derivative: number;
    readonly momentum: number;
  };
  readonly confidence: "high" | "medium" | "low";
  readonly sources: {
    readonly token: number | null;
    readonly structural: number;
    readonly semantic: number | null;
    readonly behavioral: number;
    readonly contextPressure: number;
  };
}

export interface DashboardData {
  readonly status: "success" | "error" | "partial";
  readonly totalDuration: number; // milliseconds
  readonly stepCount: number;
  readonly tokenCount: number;
  readonly estimatedCost: number; // USD
  readonly modelName: string;
  readonly provider: string;
  readonly phases: readonly DashboardPhase[];
  readonly tools: readonly DashboardTool[];
  readonly alerts: readonly DashboardAlert[];
  readonly entropyTrace?: readonly DashboardEntropyPoint[];
}

// ─── Console Exporter ───

export interface ConsoleExporterOptions {
  /** Whether to print spans. Default: true */
  readonly showSpans?: boolean;
  /** Whether to print metrics summary. Default: true */
  readonly showMetrics?: boolean;
  /** Whether to print logs. Default: true */
  readonly showLogs?: boolean;
  /** Minimum log level to display. Default: "debug" */
  readonly minLevel?: "debug" | "info" | "warn" | "error";
}

const LOG_LEVEL_ORDER: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ─── Helper Functions for Dashboard Data Building ───

/**
 * Extract phase metrics (duration in ms) from metric array.
 * Looks for histogram metrics named "execution.phase.duration_ms" with phase label
 */
const extractPhaseMetrics = (
  metrics: readonly Metric[],
): Map<string, number[]> => {
  const phaseMetrics = new Map<string, number[]>();

  for (const metric of metrics) {
    if (
      metric.type === "histogram" &&
      metric.name === "execution.phase.duration_ms"
    ) {
      const phaseName = metric.labels?.phase;
      if (phaseName) {
        const existing = phaseMetrics.get(phaseName) ?? [];
        phaseMetrics.set(phaseName, [...existing, metric.value]);
      }
    }
  }

  return phaseMetrics;
};

/**
 * Calculate estimated cost in USD based on token count.
 * Uses a simple heuristic: ~$0.0015 per 1K tokens (Claude 3.5 Sonnet pricing approx).
 */
const calculateCost = (tokenCount: number): number => {
  return (tokenCount / 1000) * 0.0015;
};

/**
 * Generate alerts based on phases, tools, and overall metrics.
 */
const generateAlerts = (
  phases: readonly DashboardPhase[],
  tools: readonly DashboardTool[],
  stepCount: number,
  entropyTrace?: readonly DashboardEntropyPoint[],
): readonly DashboardAlert[] => {
  const alerts: DashboardAlert[] = [];

  // Check for slow phases
  for (const phase of phases) {
    if (phase.duration >= 10000) {
      alerts.push({
        level: "warning",
        message: `${phase.name} phase blocked ≥10s (LLM latency)`,
      });
    }
  }

  // Check for tool errors
  for (const tool of tools) {
    if (tool.errorCount > 0) {
      const errorRate = ((tool.errorCount / tool.callCount) * 100).toFixed(0);
      alerts.push({
        level: "warning",
        message: `${tool.name} had ${tool.errorCount} error(s) (${errorRate}% failure rate)`,
      });
    }
  }

  // Info alerts for reasoning complexity
  if (stepCount >= 7) {
    alerts.push({
      level: "info",
      message: `${stepCount} reasoning steps (complex reasoning)`,
    });
  }

  if (stepCount > 8) {
    alerts.push({
      level: "warning",
      message:
        "High step count suggests task complexity or model confusion",
    });
  }

  // Entropy-informed alerts
  if (entropyTrace && entropyTrace.length > 0) {
    const last = entropyTrace[entropyTrace.length - 1];
    const mean = entropyTrace.reduce((s, p) => s + p.composite, 0) / entropyTrace.length;

    if (last.trajectory.shape === "diverging") {
      alerts.push({
        level: "warning",
        message: "Entropy diverging — model became less certain over iterations",
      });
    }

    if (last.trajectory.shape === "flat" && entropyTrace.length >= 3 && mean > 0.5) {
      alerts.push({
        level: "warning",
        message: "Entropy flat with high uncertainty — model may be stuck in a reasoning loop",
      });
    }

    if (mean < 0.3 && last.trajectory.shape === "converging") {
      alerts.push({
        level: "info",
        message: "Low entropy + converging — strong reasoning signal, task well-suited for this model",
      });
    }
  }

  return alerts;
};

/**
 * Build DashboardData from metrics array and optional MetricsCollector.
 * Aggregates phase durations, tool metrics, and generates alerts.
 */
export const buildDashboardData = (
  metrics: readonly Metric[],
  metricsCollector?: MetricsCollector,
  entropyTraceOverride?: readonly DashboardEntropyPoint[],
): DashboardData => {
  // Count total tokens from metrics
  let tokenCount = 0;
  for (const metric of metrics) {
    if (metric.type === "gauge" && metric.name === "execution.tokens_used") {
      tokenCount = Math.max(tokenCount, Math.round(metric.value));
    }
  }

  // Count steps from gauge
  let stepCount = 0;
  for (const metric of metrics) {
    if (metric.type === "gauge" && metric.name === "execution.iteration") {
      stepCount = Math.max(stepCount, Math.round(metric.value));
    }
  }

  // If tokenCount is 0, estimate from step count (rough heuristic)
  if (tokenCount === 0 && stepCount > 0) {
    tokenCount = Math.round(stepCount * 300);
  }

  // Extract tool metrics from metrics array (name: execution.tool.execution with tool label)
  const tools: DashboardTool[] = [];
  const toolMetrics = new Map<
    string,
    {
      count: number;
      successCount: number;
      errorCount: number;
      totalDuration: number;
    }
  >();

  for (const metric of metrics) {
    if (
      metric.type === "histogram" &&
      metric.name === "execution.tool.execution"
    ) {
      const toolName = metric.labels?.tool;
      const status = metric.labels?.status;
      if (toolName) {
        const existing = toolMetrics.get(toolName) ?? {
          count: 0,
          successCount: 0,
          errorCount: 0,
          totalDuration: 0,
        };
        const newSuccess =
          status === "success"
            ? existing.successCount + 1
            : existing.successCount;
        const newError =
          status === "error" ? existing.errorCount + 1 : existing.errorCount;
        toolMetrics.set(toolName, {
          count: existing.count + 1,
          successCount: newSuccess,
          errorCount: newError,
          totalDuration: existing.totalDuration + metric.value,
        });
      }
    }
  }

  // Build tool array from extracted metrics
  for (const [toolName, toolData] of toolMetrics.entries()) {
    const avgDuration =
      toolData.count > 0 ? toolData.totalDuration / toolData.count : 0;
    tools.push({
      name: toolName,
      callCount: toolData.count,
      successCount: toolData.successCount,
      errorCount: toolData.errorCount,
      avgDuration,
    });
  }

  // Extract phase metrics
  const phaseMetrics = extractPhaseMetrics(metrics);
  const phases: DashboardPhase[] = [];

  // Build phase array (in typical execution order)
  const phaseOrder = [
    "bootstrap",
    "guardrail",
    "cost-route",
    "strategy-select",
    "think",
    "act",
    "observe",
    "verify",
    "memory-flush",
    "cost-track",
    "audit",
    "complete",
  ];

  // Calculate total phase duration for percentage calculation
  let totalPhaseDuration = 0;
  const phaseDurations = new Map<string, number>();
  for (const phaseName of phaseOrder) {
    const values = phaseMetrics.get(phaseName) ?? [];
    const duration = values.reduce((a, b) => a + b, 0);
    if (duration > 0) {
      phaseDurations.set(phaseName, duration);
      totalPhaseDuration += duration;
    }
  }

  for (const phaseName of phaseOrder) {
    const values = phaseMetrics.get(phaseName) ?? [];
    if (values.length > 0) {
      const duration = values.reduce((a, b) => a + b, 0);

      // Build details string based on phase name
      let details: string | undefined;
      if (phaseName === "think" && stepCount > 0) {
        const percentOfTotal =
          totalPhaseDuration > 0
            ? ((duration / totalPhaseDuration) * 100).toFixed(0)
            : "?";
        details = `${stepCount} steps, ${percentOfTotal}% of time`;
      } else if (phaseName === "act" && tools.length > 0) {
        const totalCalls = tools.reduce((n, t) => n + t.callCount, 0);
        details = `${totalCalls} calls`;
      }

      phases.push({
        name: phaseName,
        duration,
        status: duration >= 10000 ? "warning" : "ok",
        details,
      });
    }
  }

  // Calculate total duration from execution.total_duration gauge (most accurate)
  let totalDuration = 0;
  for (const metric of metrics) {
    if (metric.type === "gauge" && metric.name === "execution.total_duration") {
      totalDuration = Math.max(totalDuration, Math.round(metric.value));
      break;
    }
  }
  // Fallback to phase durations if no gauge found
  if (totalDuration === 0) {
    totalDuration = phases.reduce((sum, p) => sum + p.duration, 0);
  }

  // Determine status — only actual errors affect overall status.
  // Timing warnings (slow phases) are informational and don't indicate partial completion.
  let status: "success" | "error" | "partial" = "success";
  for (const phase of phases) {
    if (phase.status === "error") {
      status = "error";
      break;
    }
  }

  // If we have a metricsCollector, we could get tool summary here
  // but since it's sync and collector is Effect-based, we skip for now
  // Callers can enhance this by passing pre-fetched tool data if needed

  // Get model name and provider from counter labels
  let modelName = "unknown";
  let provider = "unknown";
  for (const metric of metrics) {
    if (metric.type === "counter" && metric.name === "execution.model_name") {
      if (metric.labels?.model) {
        modelName = String(metric.labels.model);
      }
      if (metric.labels?.provider) {
        provider = String(metric.labels.provider);
      }
      break;
    }
  }

  // Extract entropy trace from gauge metrics
  const entropyPoints = new Map<number, DashboardEntropyPoint>();
  for (const metric of metrics) {
    if (metric.type === "gauge" && metric.name === "entropy.composite" && metric.labels) {
      const iteration = parseInt(metric.labels.iteration ?? "0", 10);
      if (!entropyPoints.has(iteration)) {
        entropyPoints.set(iteration, {
          iteration,
          composite: metric.value,
          trajectory: {
            shape: metric.labels.shape ?? "unknown",
            derivative: 0,
            momentum: 0,
          },
          confidence: (metric.labels.confidence as "high" | "medium" | "low") ?? "low",
          sources: { token: null, structural: 0, semantic: null, behavioral: 0, contextPressure: 0 },
        });
      }
    }
  }
  const entropyTrace = entropyTraceOverride ?? (entropyPoints.size > 0
    ? [...entropyPoints.values()].sort((a, b) => a.iteration - b.iteration)
    : undefined);

  const estimatedCost = calculateCost(tokenCount);
  const alerts = generateAlerts(phases, tools, stepCount, entropyTrace);

  return {
    status,
    totalDuration,
    stepCount,
    tokenCount,
    estimatedCost,
    modelName,
    provider,
    phases,
    tools,
    alerts,
    entropyTrace,
  };
};

export const makeConsoleExporter = (options: ConsoleExporterOptions = {}) => {
  const {
    showSpans = true,
    showMetrics = true,
    showLogs = true,
    minLevel = "debug",
  } = options;

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

  return { exportLogs, exportSpans, exportMetrics };
};

export type ConsoleExporter = ReturnType<typeof makeConsoleExporter>;

// ─── Live Log Writer ───

/**
 * Format a single log entry as a chalk-colored single line (no newline).
 */
export const formatLogEntryLive = (entry: LogEntry): string => {
  const colorFn = LOG_COLORS[entry.level] ?? ((s: string) => s);
  const ts = entry.timestamp.toISOString().slice(11, 23);
  const level = entry.level.toUpperCase().padEnd(5);
  const meta = entry.metadata
    ? ` ${chalk.hex(C_DIM)(JSON.stringify(entry.metadata))}`
    : "";
  return `  ${chalk.hex(C_DIM)(ts)} ${colorFn(chalk.bold(level))} ${entry.message}${meta}`;
};

/**
 * Create a LiveLogWriter that writes each log entry immediately to stdout.
 * Respects minLevel filtering from options.
 */
export const makeLiveLogWriter = (
  options?: ConsoleExporterOptions,
): LiveLogWriter => {
  const minLevel = options?.minLevel ?? "debug";
  const minLevelOrder = LOG_LEVEL_ORDER[minLevel] ?? 0;
  return (entry: LogEntry): void => {
    if ((LOG_LEVEL_ORDER[entry.level] ?? 0) >= minLevelOrder) {
      process.stdout.write(formatLogEntryLive(entry) + "\n");
    }
  };
};

// ─── Dashboard Formatter ───

/**
 * Format milliseconds to a human-readable duration string.
 * < 1000ms: "500ms"
 * >= 1000ms: "13.9s"
 */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
};

/**
 * Format a number as currency with commas.
 */
export const formatNumber = (n: number): string => {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

/**
 * Format a DashboardData object into a beautiful, scannable dashboard output.
 */
export const formatMetricsDashboard = (data: DashboardData): string => {
  const lines: string[] = [];

  // ── Header box ──────────────────────────────────────────────────────────
  const borderColor =
    data.status === "success" ? C_GREEN
    : data.status === "error" ? C_RED
    : C_YELLOW;

  const statusLabel =
    data.status === "success" ? "Success"
    : data.status === "error"  ? "Failed"
    : "Partial";

  const durationStr = formatDuration(data.totalDuration);
  const isLocalProvider =
    data.provider?.toLowerCase().includes("ollama") ||
    data.provider?.toLowerCase().includes("test");

  const headerLines = [
    `Status:   ${statusLabel}   Duration: ${durationStr}   Steps: ${data.stepCount}`,
    `Model:    ${data.modelName}   (${data.provider})   Tokens: ${formatNumber(data.tokenCount)}`,
  ];
  if (!isLocalProvider) {
    headerLines.push(`Cost:     ~$${data.estimatedCost.toFixed(3)}`);
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

      const icon =
        phase.status === "warning" ? "⚠️"
        : phase.status === "error"  ? "❌"
        : "✅";

      // Pad before applying chalk so ANSI codes don't skew padEnd math
      const phaseName = chalk.hex(C_DIM)(`[${phase.name}]`.padEnd(maxPhaseNameLen));
      const durStr = formatDuration(phase.duration).padStart(8);
      const detailsStr = phase.details ? chalk.hex(C_DIM)(` (${phase.details})`) : "";

      lines.push(`${prefix} ${icon}  ${phaseName} ${durStr}${detailsStr}`);
    }
  }

  // ── Tool Execution ───────────────────────────────────────────────────────
  if (data.tools.length > 0) {
    lines.push("");
    const totalToolCalls = data.tools.reduce((n, t) => n + t.callCount, 0);
    lines.push(chalk.hex(C_CYAN).bold(`🔧 Tool Execution (${totalToolCalls} calls across ${data.tools.length} tools)`));

    const maxToolNameLen = Math.max(...data.tools.map((t) => t.name.length), 10);

    for (let i = 0; i < data.tools.length; i++) {
      const tool = data.tools[i];
      const isLast = i === data.tools.length - 1;
      const prefix = isLast ? "└─" : "├─";

      const icon = tool.errorCount > 0 ? "⚠️" : "✅";

      // Pad name before chalk so ANSI codes don't skew column alignment
      const toolName = chalk.hex(C_CYAN)(tool.name.padEnd(maxToolNameLen));
      const avgStr = formatDuration(tool.avgDuration);
      const errStr = tool.errorCount > 0
        ? chalk.hex(C_RED)(` ${tool.errorCount} errors`)
        : "";

      lines.push(
        `${prefix} ${icon}  ${toolName}  ${tool.callCount} calls, ${avgStr} avg${errStr}`,
      );
    }
  }

  // ── Entropy Signal ──────────────────────────────────────────────────────
  if (data.entropyTrace && data.entropyTrace.length > 0) {
    lines.push("");
    lines.push(chalk.hex(C_CYAN).bold("🧠 Reasoning Signal"));

    const trace = data.entropyTrace;
    const first = trace[0];
    const last = trace[trace.length - 1];
    const meanComposite = trace.reduce((s, p) => s + p.composite, 0) / trace.length;

    // Shape distribution
    const shapes = new Map<string, number>();
    for (const pt of trace) {
      shapes.set(pt.trajectory.shape, (shapes.get(pt.trajectory.shape) ?? 0) + 1);
    }
    const dominantShape = [...shapes.entries()].sort((a, b) => b[1] - a[1])[0][0];

    // Signal quality assessment
    const converged = last.trajectory.shape === "converging";
    const flat = last.trajectory.shape === "flat";
    const diverging = last.trajectory.shape === "diverging";
    const oscillating = last.trajectory.shape === "oscillating";

    // Overall grade: A/B/C/D/F based on convergence + mean entropy
    // Single-iteration tasks get graded on efficiency, not trajectory
    const singleIteration = trace.length <= 1;
    const taskSucceeded = data.status === "success";

    const grade = singleIteration && taskSucceeded && meanComposite < 0.5 ? "A"
      : singleIteration && taskSucceeded && meanComposite < 0.7 ? "B"
      : singleIteration && taskSucceeded ? "B"
      : converged && meanComposite < 0.35 ? "A"
      : converged && meanComposite < 0.55 ? "B"
      : flat && meanComposite < 0.45 ? "B"
      : flat && meanComposite < 0.65 ? "C"
      : diverging ? "D"
      : oscillating ? "C"
      : meanComposite > 0.7 ? "F"
      : "C";

    const gradeColor = grade === "A" ? C_GREEN : grade === "B" ? C_GREEN : grade === "C" ? C_YELLOW : C_RED;
    const gradeLabel = chalk.hex(gradeColor).bold(grade);

    const signalLabel = converged ? chalk.hex(C_GREEN)("converged")
      : flat ? chalk.hex(C_YELLOW)("flat")
      : diverging ? chalk.hex(C_RED)("diverging")
      : oscillating ? chalk.hex(C_YELLOW)("oscillating")
      : chalk.hex(C_DIM)(last.trajectory.shape);

    // Delta from first to last
    const delta = last.composite - first.composite;
    const deltaStr = delta <= 0
      ? chalk.hex(C_GREEN)(`${delta.toFixed(3)}`)
      : chalk.hex(C_RED)(`+${delta.toFixed(3)}`);

    // Efficiency: how many tokens per unit of entropy reduction
    const entropyReduction = Math.max(0, first.composite - last.composite);
    const tokensPerReduction = entropyReduction > 0.01 && data.tokenCount > 0
      ? Math.round(data.tokenCount / (entropyReduction * 100))
      : null;

    lines.push(`├─ Grade: ${gradeLabel}   Signal: ${signalLabel}   Mean: ${meanComposite.toFixed(3)}   Delta: ${deltaStr}`);

    // Actionable summary line
    const summaryParts: string[] = [];
    if (singleIteration && taskSucceeded) {
      summaryParts.push("Solved in one pass — no trajectory to analyze");
    } else if (converged) {
      if (meanComposite < 0.35) summaryParts.push("Model solved this efficiently");
      else summaryParts.push("Model converged but with moderate uncertainty");
    } else if (flat) {
      summaryParts.push("Model stalled — entropy didn't decrease across iterations");
    } else if (diverging) {
      summaryParts.push("Model became more confused over time");
    } else if (oscillating) {
      summaryParts.push("Model alternated between progress and confusion");
    }

    if (tokensPerReduction !== null) {
      summaryParts.push(`${tokensPerReduction} tok/% entropy reduced`);
    }

    if (summaryParts.length > 0) {
      lines.push(`├─ ${chalk.hex(C_DIM)(summaryParts.join(" · "))}`);
    }

    // Source breakdown — show which entropy sources dominated
    const avgSources = {
      structural: trace.reduce((s, p) => s + p.sources.structural, 0) / trace.length,
      behavioral: trace.reduce((s, p) => s + p.sources.behavioral, 0) / trace.length,
      contextPressure: trace.reduce((s, p) => s + p.sources.contextPressure, 0) / trace.length,
      token: trace.reduce((s, p) => s + (p.sources.token ?? 0), 0) / trace.length,
      semantic: trace.reduce((s, p) => s + (p.sources.semantic ?? 0), 0) / trace.length,
    };

    // Find dominant source
    const sourceEntries = [
      { name: "structural", val: avgSources.structural, label: "response structure varies" },
      { name: "behavioral", val: avgSources.behavioral, label: "repetitive tool patterns" },
      { name: "context", val: avgSources.contextPressure, label: "context window pressure" },
      { name: "token", val: avgSources.token, label: "token-level uncertainty" },
      { name: "semantic", val: avgSources.semantic, label: "semantic drift" },
    ].filter(s => s.val > 0.1).sort((a, b) => b.val - a.val);

    if (sourceEntries.length > 0) {
      const topSources = sourceEntries.slice(0, 3).map(s => {
        const color = s.val > 0.6 ? C_RED : s.val > 0.35 ? C_YELLOW : C_GREEN;
        return `${s.name} ${chalk.hex(color)(s.val.toFixed(2))}`;
      });
      lines.push(`├─ Sources: ${topSources.join(chalk.hex(C_DIM)(" · "))}`);
    }

    // Per-iteration sparkline with gap annotations
    const maxBar = 20;
    for (let i = 0; i < trace.length; i++) {
      const pt = trace[i];
      const prevIter = i > 0 ? trace[i - 1].iteration : pt.iteration;
      const gap = pt.iteration - prevIter;
      if (gap > 1) {
        const omitted = gap - 1;
        lines.push(`├─  ${chalk.hex(C_DIM)(`┈┈┈ ${omitted} tool/system step${omitted > 1 ? "s" : ""} (no thought scored) ┈┈┈`)}`);
      }
      const isLast = i === trace.length - 1;
      const prefix = isLast ? "└─" : "├─";
      const barLen = Math.round(pt.composite * maxBar);
      const barColor = pt.composite > 0.6 ? C_RED : pt.composite > 0.35 ? C_YELLOW : C_GREEN;
      const bar = chalk.hex(barColor)("█".repeat(barLen)) + chalk.hex(C_DIM)("░".repeat(maxBar - barLen));
      const shapeIcon = pt.trajectory.shape === "converging" ? "↘" : pt.trajectory.shape === "diverging" ? "↗" : pt.trajectory.shape === "oscillating" ? "~" : "→";
      lines.push(`${prefix}  iter ${String(pt.iteration).padStart(2)} ${bar} ${pt.composite.toFixed(3)} ${chalk.hex(C_DIM)(shapeIcon)}`);
    }

    // Actionable recommendations based on signal
    const recommendations: string[] = [];
    if (diverging) {
      recommendations.push("Try a simpler prompt or break the task into sub-tasks");
      if (avgSources.behavioral > 0.5) recommendations.push("Reduce available tools to only what's needed");
    }
    if (flat && data.stepCount > 3) {
      recommendations.push("Consider enabling strategy switching (.withReasoning({ enableStrategySwitching: true }))");
      if (avgSources.structural > 0.6) recommendations.push("Add more structure to the prompt (examples, step-by-step format)");
    }
    if (oscillating) {
      recommendations.push("Model is uncertain — try a higher-capability model or more specific instructions");
    }
    if (meanComposite > 0.6 && converged) {
      recommendations.push("Converged but with high entropy — the answer may lack confidence");
    }
    if (avgSources.contextPressure > 0.5) {
      recommendations.push("Context window under pressure — enable compression or reduce tool result size");
    }
    if (grade === "A" && data.stepCount > 5) {
      recommendations.push("Strong signal — could complete faster with early-stop (.withReactiveIntelligence({ controller: { earlyStop: true } }))");
    }

    if (recommendations.length > 0) {
      lines.push(`${chalk.hex(C_DIM)("   ┈┈┈")}`);
      for (let i = 0; i < recommendations.length; i++) {
        const isLast = i === recommendations.length - 1;
        const prefix = isLast ? "└─" : "├─";
        lines.push(`${prefix} ${chalk.hex(C_DIM)("💡")} ${chalk.hex(C_DIM)(recommendations[i])}`);
      }
    }
  }

  // ── Alerts & Insights ────────────────────────────────────────────────────
  if (data.alerts.length > 0) {
    lines.push("");
    lines.push(chalk.hex(C_YELLOW).bold("⚠️  Alerts & Insights"));

    for (let i = 0; i < data.alerts.length; i++) {
      const alert = data.alerts[i];
      const isLast = i === data.alerts.length - 1;
      const prefix = isLast ? "└─" : "├─";
      const icon =
        alert.level === "error"   ? "❌"
        : alert.level === "warning" ? "⚠️"
        : "ℹ️";
      lines.push(`${prefix} ${icon}  ${alert.message}`);
    }
  }

  return lines.join("\n");
};
