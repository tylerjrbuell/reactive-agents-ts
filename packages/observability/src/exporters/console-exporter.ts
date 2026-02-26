import type { LogEntry, Span, Metric } from "../types.js";
import type { LiveLogWriter } from "../logging/structured-logger.js";

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
  debug: 0, info: 1, warn: 2, error: 3,
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
    const filtered = logs.filter((l) => (LOG_LEVEL_ORDER[l.level] ?? 0) >= minLevelOrder);
    if (filtered.length === 0) return;

    console.log(`\n${BOLD}${CYAN}═══ Logs (${filtered.length}) ═══${RESET}`);
    for (const entry of filtered) {
      const color = LOG_COLORS[entry.level] ?? RESET;
      const ts = entry.timestamp.toISOString().slice(11, 23);
      const level = entry.level.toUpperCase().padEnd(5);
      const meta = entry.metadata
        ? ` ${GRAY}${JSON.stringify(entry.metadata)}${RESET}`
        : "";
      console.log(`  ${GRAY}${ts}${RESET} ${color}${BOLD}${level}${RESET} ${entry.message}${meta}`);
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
      const durStr = durationMs !== undefined ? ` ${DIM}(${durationMs.toFixed(1)}ms)${RESET}` : "";
      const statusColor = span.status === "ok" ? GREEN : span.status === "error" ? RED : GRAY;
      const statusIcon = span.status === "ok" ? "✓" : span.status === "error" ? "✗" : "○";
      console.log(`${prefix}${statusColor}${statusIcon}${RESET} ${BOLD}${span.name}${RESET}${durStr} ${GRAY}[${span.traceId.slice(0, 8)}…]${RESET}`);

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

  const exportMetrics = (metrics: readonly Metric[]): void => {
    if (!showMetrics || metrics.length === 0) return;
    console.log(`\n${BOLD}${CYAN}═══ Metrics Summary ═══${RESET}`);

    // Group by metric name and type
    const grouped = new Map<string, { type: string; values: number[] }>();
    for (const m of metrics) {
      const key = m.name;
      const existing = grouped.get(key);
      if (existing) {
        existing.values.push(m.value);
      } else {
        grouped.set(key, { type: m.type, values: [m.value] });
      }
    }

    for (const [name, { type, values }] of grouped.entries()) {
      if (type === "counter") {
        const total = values.reduce((a, b) => a + b, 0);
        console.log(`  ${BLUE}counter${RESET}  ${name}: ${BOLD}${total}${RESET}`);
      } else if (type === "gauge") {
        const last = values[values.length - 1] ?? 0;
        console.log(`  ${YELLOW}gauge${RESET}    ${name}: ${BOLD}${last}${RESET}`);
      } else if (type === "histogram") {
        const sorted = [...values].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
        console.log(`  ${GREEN}histogram${RESET} ${name}: p50=${BOLD}${p50.toFixed(1)}${RESET} p95=${p95.toFixed(1)} p99=${p99.toFixed(1)} (n=${values.length})`);
      }
    }
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
export const makeLiveLogWriter = (options?: ConsoleExporterOptions): LiveLogWriter => {
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
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

/**
 * Get status icon based on status string.
 */
const getStatusIcon = (status: "ok" | "warning" | "error" | "success" | "partial"): string => {
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

  // Header card with box drawing
  const statusIcon = getStatusIcon(data.status);
  const headerLines = [
    `┌${"─".repeat(61)}┐`,
    `│ ${statusIcon} Agent Execution Summary${"─".repeat(37)}│`,
    `├${"─".repeat(61)}┤`,
    `│ Status:    ${statusIcon} ${data.status === "success" ? "Success" : data.status === "error" ? "Error" : "Partial"}${" ".repeat(8)} Duration: ${formatDuration(data.totalDuration).padEnd(8)} Steps: ${data.stepCount}${" ".repeat(10)}│`,
    `│ Tokens:    ${formatNumber(data.tokenCount).padEnd(11)} Cost: ~$${data.estimatedCost.toFixed(3)}${" ".repeat(8)} Model: ${data.modelName}${" ".repeat(Math.max(0, 21 - data.modelName.length))}│`,
    `└${"─".repeat(61)}┘`,
  ];
  lines.push(...headerLines);

  // Execution Timeline section (only if phases exist)
  if (data.phases.length > 0) {
    lines.push("");
    lines.push(`${CYAN}${BOLD}📊 Execution Timeline${RESET}`);
    for (let i = 0; i < data.phases.length; i++) {
      const phase = data.phases[i];
      const isLast = i === data.phases.length - 1;
      const prefix = isLast ? "└─" : "├─";
      const icon = getStatusIcon(phase.status);
      const durationStr = formatDuration(phase.duration).padStart(10);
      const detailsStr = phase.details ? `  (${phase.details})` : "";
      lines.push(`${prefix} [${phase.name}]${" ".repeat(Math.max(1, 12 - phase.name.length))}${durationStr}    ${icon}${detailsStr}`);
    }
  }

  // Tool Execution section (only if tools exist)
  if (data.tools.length > 0) {
    lines.push("");
    lines.push(`${CYAN}${BOLD}🔧 Tool Execution (${data.tools.length} called)${RESET}`);
    for (let i = 0; i < data.tools.length; i++) {
      const tool = data.tools[i];
      const isLast = i === data.tools.length - 1;
      const prefix = isLast ? "└─" : "├─";
      const icon = tool.errorCount > 0 ? "⚠️" : "✅";
      const avgStr = formatDuration(tool.avgDuration);
      lines.push(`${prefix} ${tool.name.padEnd(15)} ${icon} ${tool.callCount} calls, ${avgStr} avg`);
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
