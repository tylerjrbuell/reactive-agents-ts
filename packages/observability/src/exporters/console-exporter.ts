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
