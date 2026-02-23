import { writeFileSync, appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { LogEntry, Span, Metric } from "../types.js";

// ─── File Exporter ───
// Writes log entries, spans, and metrics as JSONL (newline-delimited JSON)
// to a configurable file path for post-analysis.

export interface FileExporterOptions {
  /** Path to the JSONL output file. Default: "./reactive-agents-obs.jsonl" */
  readonly filePath?: string;
  /** Whether to append or overwrite on each flush. Default: "append" */
  readonly mode?: "append" | "overwrite";
}

export const makeFileExporter = (options: FileExporterOptions = {}) => {
  const {
    filePath = "./reactive-agents-obs.jsonl",
    mode = "append",
  } = options;

  let firstFlush = true;

  const ensureDir = (fp: string): void => {
    try {
      mkdirSync(dirname(fp), { recursive: true });
    } catch {
      // Directory already exists or not writable — suppress
    }
  };

  const writeLines = (lines: string[]): void => {
    if (lines.length === 0) return;
    const content = lines.join("\n") + "\n";
    try {
      ensureDir(filePath);
      if (mode === "overwrite" && firstFlush) {
        writeFileSync(filePath, content, "utf-8");
        firstFlush = false;
      } else {
        appendFileSync(filePath, content, "utf-8");
      }
    } catch {
      // File system errors are non-fatal for observability
    }
  };

  const exportLogs = (logs: readonly LogEntry[]): void => {
    writeLines(
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

  const exportSpans = (spans: readonly Span[]): void => {
    writeLines(
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

  const exportMetrics = (metrics: readonly Metric[]): void => {
    writeLines(
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

export type FileExporter = ReturnType<typeof makeFileExporter>;
