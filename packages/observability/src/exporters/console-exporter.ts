import type { LogEntry, Span, Metric } from "../types.js";
import type { LiveLogWriter } from "../logging/structured-logger.js";
import type {
  MetricsCollector,
  ToolSummary,
} from "../metrics/metrics-collector.js";

// ─── ANSI Colors ───

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

const LOG_COLORS: Record<string, string> = {
  debug: GRAY,
  info: GREEN,
  warn: YELLOW,
  error: RED,
};

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
      message: `${stepCount} iterations needed (complex reasoning)`,
    });
  }

  if (stepCount > 8) {
    alerts.push({
      level: "warning",
      message:
        "High iteration count suggests task complexity or model confusion",
    });
  }

  return alerts;
};

/**
 * Build DashboardData from metrics array and optional MetricsCollector.
 * Aggregates phase durations, tool metrics, and generates alerts.
 */
const buildDashboardData = (
  metrics: readonly Metric[],
  metricsCollector?: MetricsCollector,
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
        details = `${stepCount} iter, ${percentOfTotal}% of time`;
      } else if (phaseName === "act" && tools.length > 0) {
        details = `${tools.length} tools`;
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

  // Determine status
  let status: "success" | "error" | "partial" = "success";
  for (const phase of phases) {
    if (phase.status === "error") {
      status = "error";
      break;
    }
    if (phase.status === "warning") {
      status = "partial";
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

  const estimatedCost = calculateCost(tokenCount);
  const alerts = generateAlerts(phases, tools, stepCount);

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

    console.log(`\n${BOLD}${CYAN}═══ Logs (${filtered.length}) ═══${RESET}`);
    for (const entry of filtered) {
      const color = LOG_COLORS[entry.level] ?? RESET;
      const ts = entry.timestamp.toISOString().slice(11, 23);
      const level = entry.level.toUpperCase().padEnd(5);
      const meta = entry.metadata
        ? ` ${GRAY}${JSON.stringify(entry.metadata)}${RESET}`
        : "";
      console.log(
        `  ${GRAY}${ts}${RESET} ${color}${BOLD}${level}${RESET} ${entry.message}${meta}`,
      );
    }
  };

  const exportSpans = (spans: readonly Span[]): void => {
    if (!showSpans || spans.length === 0) return;
    console.log(`\n${BOLD}${CYAN}═══ Spans (${spans.length}) ═══${RESET}`);

    // Build parent → children map for tree display
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
      const durStr =
        durationMs !== undefined
          ? ` ${DIM}(${durationMs.toFixed(1)}ms)${RESET}`
          : "";
      const statusColor =
        span.status === "ok" ? GREEN : span.status === "error" ? RED : GRAY;
      const statusIcon =
        span.status === "ok" ? "✓" : span.status === "error" ? "✗" : "○";
      console.log(
        `${prefix}${statusColor}${statusIcon}${RESET} ${BOLD}${span.name}${RESET}${durStr} ${GRAY}[${span.traceId.slice(0, 8)}…]${RESET}`,
      );

      const children = childrenMap.get(span.spanId) ?? [];
      for (const child of children) printTree(child, indent + 1);
    };

    // Print root spans (no parent) first
    const roots = childrenMap.get(undefined) ?? [];
    for (const root of roots) printTree(root, 0);

    // Any orphaned spans (parent not in current batch)
    for (const span of spans) {
      if (span.parentSpanId && !spanMap.has(span.parentSpanId)) {
        printTree(span, 0);
      }
    }
  };

  const exportMetrics = (
    metrics: readonly Metric[],
    metricsCollector?: MetricsCollector,
  ): void => {
    if (!showMetrics || metrics.length === 0) return;

    // Build dashboard data from metrics and collector
    const dashboardData = buildDashboardData(metrics, metricsCollector);

    // Format and output the dashboard
    const dashboard = formatMetricsDashboard(dashboardData);
    console.log(`\n${BOLD}${CYAN}═══ Metrics Summary ═══${RESET}`);
    console.log(dashboard);
  };

  return { exportLogs, exportSpans, exportMetrics };
};

export type ConsoleExporter = ReturnType<typeof makeConsoleExporter>;

// ─── Live Log Writer ───

/**
 * Format a single log entry as an ANSI-colored single line (no newline).
 */
export const formatLogEntryLive = (entry: LogEntry): string => {
  const color = LOG_COLORS[entry.level] ?? RESET;
  const ts = entry.timestamp.toISOString().slice(11, 23);
  const level = entry.level.toUpperCase().padEnd(5);
  const meta = entry.metadata
    ? ` ${GRAY}${JSON.stringify(entry.metadata)}${RESET}`
    : "";
  return `  ${GRAY}${ts}${RESET} ${color}${BOLD}${level}${RESET} ${entry.message}${meta}`;
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
 * Get status icon based on status string.
 */
const getStatusIcon = (
  status: "ok" | "warning" | "error" | "success" | "partial",
): string => {
  if (status === "ok" || status === "success") return "✅";
  if (status === "warning" || status === "partial") return "⚠️";
  return "❌";
};

/**
 * Get alert icon based on level.
 */
const getAlertIcon = (level: "warning" | "error" | "info"): string => {
  if (level === "warning") return "⚠️";
  if (level === "error") return "❌";
  return "ℹ️";
};

/**
 * Format a DashboardData object into a beautiful, scannable dashboard output.
 */
export const formatMetricsDashboard = (data: DashboardData): string => {
  const lines: string[] = [];

  // Helper to build a box line accounting for emoji visual width (2 columns per emoji)
  const BOX_WIDTH = 72;
  const buildBoxLine = (content: string): string => {
    // Approximate visual width in terminal columns.
    // Treat most characters as width 1, and common emoji symbols as width 2.
    const emojiPattern = /\p{Extended_Pictographic}/gu;

    let visualWidth = 0;
    for (const ch of content) {
      visualWidth += emojiPattern.test(ch) ? 2 : 1;
    }

    const padding = Math.max(0, BOX_WIDTH - visualWidth);
    return `│ ${content}${" ".repeat(padding)} │`;
  };

  // Header card with box drawing
  const statusIcon = getStatusIcon(data.status);
  const headerLines = [
    `┌${"─".repeat(BOX_WIDTH + 2)}┐`,
    buildBoxLine(`📄 Agent Execution Summary`),
    `├${"─".repeat(BOX_WIDTH + 2)}┤`,
  ];

  // Build status line
  const statusText =
    data.status === "success"
      ? "Success"
      : data.status === "error"
        ? "Error"
        : "Partial";
  const durationStr = formatDuration(data.totalDuration);
  const statusLine = `${statusIcon} ${statusText.padEnd(7)}  Duration: ${durationStr.padStart(7)}  Steps: ${data.stepCount}`;
  headerLines.push(buildBoxLine(statusLine));

  // Build model/provider line
  const modelLine = `Model: ${data.modelName.padEnd(15)} (${data.provider})  Tokens: ${formatNumber(data.tokenCount)}`;
  headerLines.push(buildBoxLine(modelLine));

  // Build cost line - only for cloud providers (not local models like ollama)
  const isLocalProvider =
    data.provider?.toLowerCase().includes("ollama") ||
    data.provider?.toLowerCase().includes("test");
  if (!isLocalProvider) {
    const costLine = `Cost: ~$${data.estimatedCost.toFixed(3)}`;
    headerLines.push(buildBoxLine(costLine));
  }

  headerLines.push(`└${"─".repeat(BOX_WIDTH + 2)}┘`);
  lines.push(...headerLines);

  // Execution Timeline section (only if phases exist)
  if (data.phases.length > 0) {
    lines.push("");
    lines.push(`${CYAN}${BOLD}📊 Execution Timeline${RESET}`);
    // Find max phase name length for alignment
    const maxPhaseNameLen = Math.max(
      ...data.phases.map((p) => p.name.length),
      10,
    );
    for (let i = 0; i < data.phases.length; i++) {
      const phase = data.phases[i];
      const isLast = i === data.phases.length - 1;
      const prefix = isLast ? "└─" : "├─";
      const icon = getStatusIcon(phase.status);
      const durationStr = formatDuration(phase.duration).padStart(8);
      const detailsStr = phase.details ? `  (${phase.details})` : "";
      const phaseName = `[${phase.name}]`.padEnd(maxPhaseNameLen + 2);
      lines.push(`${prefix} ${phaseName} ${durationStr}  ${icon}${detailsStr}`);
    }
  }

  // Tool Execution section (only if tools exist)
  if (data.tools.length > 0) {
    lines.push("");
    lines.push(
      `${CYAN}${BOLD}🔧 Tool Execution (${data.tools.length} called)${RESET}`,
    );
    for (let i = 0; i < data.tools.length; i++) {
      const tool = data.tools[i];
      const isLast = i === data.tools.length - 1;
      const prefix = isLast ? "└─" : "├─";
      const icon = tool.errorCount > 0 ? "⚠️" : "✅";
      const avgStr = formatDuration(tool.avgDuration);
      lines.push(
        `${prefix} ${tool.name.padEnd(15)} ${icon} ${tool.callCount} calls, ${avgStr} avg`,
      );
    }
  }

  // Alerts & Insights section (only if alerts exist)
  if (data.alerts.length > 0) {
    lines.push("");
    lines.push(`${CYAN}${BOLD}⚠️  Alerts & Insights${RESET}`);
    for (let i = 0; i < data.alerts.length; i++) {
      const alert = data.alerts[i];
      const isLast = i === data.alerts.length - 1;
      const prefix = isLast ? "└─" : "├─";
      const icon = getAlertIcon(alert.level);
      lines.push(`${prefix} ${icon}  ${alert.message}`);
    }
  }

  return lines.join("\n");
};
