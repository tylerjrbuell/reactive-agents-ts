import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { dirname } from "path";
import type { LogEntry, Span, Metric } from "../types.js";

// ─── File Exporter ───
// Writes log entries, spans, and metrics as JSONL (newline-delimited JSON)
// to a configurable file path for post-analysis.

/**
 * Configuration options for file-based observability export.
 *
 * Files are written in JSONL format (JSON Lines): one complete JSON object
 * per line, with no commas or brackets. This format is ideal for streaming
 * and post-analysis tools.
 *
 * @example
 * ```typescript
 * const config: FileExporterOptions = {
 *   filePath: "./logs/agent-execution.jsonl",
 *   mode: "append",
 * };
 * ```
 */
export interface FileExporterOptions {
  /**
   * File path for JSONL output. Must have `.jsonl` extension.
   * Each line is a complete JSON object representing one log entry, span, or metric.
   * Parent directories are created automatically if they do not exist.
   *
   * @default "./reactive-agents-obs.jsonl"
   *
   * @example `"./logs/agent-execution.jsonl"` or `"/var/log/agents/trace.jsonl"`
   */
  readonly filePath?: string;

  /**
   * Write mode: whether to append to or overwrite the file on each flush.
   *
   * - `"append"`: Add new entries to the end of the file (default)
   * - `"overwrite"`: Replace file contents on first flush, then append subsequent entries
   *
   * @default "append"
   *
   * @remarks
   * When `mode: "overwrite"` is set, the first `flush()` call writes fresh,
   * and subsequent calls append. This is useful for starting a clean log per agent run.
   */
  readonly mode?: "append" | "overwrite";
}

/**
 * Create a file exporter for observability data (JSONL format).
 *
 * Exports logs, spans, and metrics as JSONL (JSON Lines) to a configurable file.
 * Parent directories are created automatically. File I/O errors are silent
 * to prevent observability from disrupting agent execution.
 *
 * @param options - Configuration options for file path and write mode
 * @returns FileExporter object with `exportLogs()`, `exportSpans()`, `exportMetrics()` methods
 *
 * @example
 * ```typescript
 * const exporter = makeFileExporter({
 *   filePath: "./logs/agent-trace.jsonl",
 *   mode: "append",
 * });
 *
 * exporter.exportLogs([logEntry1, logEntry2]);
 * exporter.exportSpans([span1, span2]);
 * exporter.exportMetrics([metric1, metric2]);
 * ```
 *
 * @remarks
 * Each exported entry is a separate JSON object on its own line, prefixed with
 * `_type` to distinguish logs, spans, and metrics. This JSONL format can be
 * parsed and analyzed by streaming tools and log aggregators.
 */
export const makeFileExporter = (options: FileExporterOptions = {}) => {
  const {
    filePath = "./reactive-agents-obs.jsonl",
    mode = "append",
  } = options;

  let firstFlush = true;

  const ensureDir = async (fp: string): Promise<void> => {
    try {
      await mkdir(dirname(fp), { recursive: true });
    } catch {
      // Directory already exists or not writable — suppress
    }
  };

  const writeLines = async (lines: string[]): Promise<void> => {
    if (lines.length === 0) return;
    const content = lines.join("\n") + "\n";
    try {
      await ensureDir(filePath);
      if (mode === "overwrite" && firstFlush) {
        await writeFile(filePath, content, "utf-8");
        firstFlush = false;
      } else {
        await appendFile(filePath, content, "utf-8");
      }
    } catch {
      // File system errors are non-fatal for observability
    }
  };

  /** Write an array of log entries to the JSONL file. Each entry becomes one `_type: "log"` line. */
  const exportLogs = (logs: readonly LogEntry[]): Promise<void> => {
    return writeLines(
      logs.map((l) =>
        JSON.stringify({
          _type: "log",
          timestamp: l.timestamp.toISOString(),
          level: l.level,
          message: l.message,
          ...(l.agentId ? { agentId: l.agentId } : {}),
          ...(l.traceId ? { traceId: l.traceId } : {}),
          ...(l.spanId ? { spanId: l.spanId } : {}),
          ...(l.metadata ? { metadata: l.metadata } : {}),
        }),
      ),
    );
  };

  /** Write an array of trace spans to the JSONL file. Each span becomes one `_type: "span"` line. */
  const exportSpans = (spans: readonly Span[]): Promise<void> => {
    return writeLines(
      spans.map((s) =>
        JSON.stringify({
          _type: "span",
          traceId: s.traceId,
          spanId: s.spanId,
          ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
          name: s.name,
          startTime: s.startTime.toISOString(),
          ...(s.endTime ? { endTime: s.endTime.toISOString() } : {}),
          status: s.status,
          attributes: s.attributes,
          events: s.events.map((e) => ({
            name: e.name,
            timestamp: e.timestamp.toISOString(),
            attributes: e.attributes,
          })),
        }),
      ),
    );
  };

  /** Write an array of metric values to the JSONL file. Each metric becomes one `_type: "metric"` line. */
  const exportMetrics = (metrics: readonly Metric[]): Promise<void> => {
    return writeLines(
      metrics.map((m) =>
        JSON.stringify({
          _type: "metric",
          name: m.name,
          type: m.type,
          value: m.value,
          timestamp: m.timestamp.toISOString(),
          labels: m.labels,
          ...(m.unit ? { unit: m.unit } : {}),
        }),
      ),
    );
  };

  return { exportLogs, exportSpans, exportMetrics, filePath };
};

/**
 * File exporter object returned by `makeFileExporter()`.
 *
 * Provides three methods for writing observability data to a JSONL file:
 * - `exportLogs(logs)` — writes log entries as `{ _type: "log", ... }` lines
 * - `exportSpans(spans)` — writes trace spans as `{ _type: "span", ... }` lines
 * - `exportMetrics(metrics)` — writes metric values as `{ _type: "metric", ... }` lines
 * - `filePath` — the resolved file path being written to
 *
 * @remarks
 * Each method appends lines to the configured file. Multiple calls accumulate entries.
 * File I/O errors are silently suppressed to prevent observability from disrupting
 * agent execution. Entries are written in JSONL format (one JSON object per line).
 *
 * @see {@link makeFileExporter} for factory function and configuration
 */
export type FileExporter = ReturnType<typeof makeFileExporter>;
