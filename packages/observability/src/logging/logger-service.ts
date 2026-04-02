import * as fs from "node:fs";
import * as path from "node:path";

export interface LoggingConfig {
  /** Minimum log level. Default: "info" */
  level: "debug" | "info" | "warn" | "error";
  /** Output format. Default: "text" */
  format: "text" | "json";
  /** Output destination. Default: "console" */
  output: "console" | "file" | WritableStream;
  /** File path -- required when output: "file" */
  filePath?: string;
  /** Max file size in bytes before rotation. Default: 10_485_760 (10MB) */
  maxFileSizeBytes?: number;
  /** Max rotated files to keep. Default: 5 */
  maxFiles?: number;
}

const LOG_LEVEL_ORDER: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerService {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, error?: unknown, metadata?: Record<string, unknown>): void;
  debug(message: string, metadata?: Record<string, unknown>): void;
}

export function makeLoggerService(config: LoggingConfig): LoggerService {
  const minLevel = LOG_LEVEL_ORDER[config.level] ?? 1;
  const format = config.format ?? "text";

  /** Ensure parent directory exists before append; avoids ENOENT on nested paths like `.cortex/logs/foo.log`. */
  const ensureDirForFile = (filePath: string): void => {
    const dir = path.dirname(filePath);
    if (!dir || dir === "." || dir === path.parse(filePath).root) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Non-fatal; appendFileSync will surface permission errors
    }
  };

  const shouldLog = (level: string): boolean =>
    (LOG_LEVEL_ORDER[level] ?? 0) >= minLevel;

  const formatEntry = (level: string, message: string, metadata?: Record<string, unknown>): string => {
    if (format === "json") {
      return JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...metadata });
    }
    const ts = new Date().toISOString();
    const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : "";
    return `[${ts}] [${level.toUpperCase()}] ${message}${metaStr}`;
  };

  // File rotation state
  let currentFileSize = 0;
  let currentFilePath = config.filePath;
  let fileRotationIndex = 0;

  const write = (line: string): void => {
    if (config.output === "file" && config.filePath) {
      const maxSize = config.maxFileSizeBytes ?? 10_485_760;
      const maxFiles = config.maxFiles ?? 5;
      if (currentFileSize > maxSize) {
        fileRotationIndex = (fileRotationIndex + 1) % maxFiles;
        const ext = path.extname(config.filePath);
        const base = config.filePath.slice(0, -ext.length || undefined);
        currentFilePath = ext ? `${base}.${fileRotationIndex}${ext}` : `${base}.${fileRotationIndex}`;
        currentFileSize = 0;
      }
      ensureDirForFile(currentFilePath!);
      fs.appendFileSync(currentFilePath!, line + "\n");
      currentFileSize += line.length + 1;
    } else if (typeof config.output === "object" && config.output instanceof WritableStream) {
      const writer = config.output.getWriter();
      writer.write(new TextEncoder().encode(line + "\n"));
      writer.releaseLock();
    } else {
      console.log(line);
    }
  };

  const log = (level: string, message: string, metadata?: Record<string, unknown>): void => {
    if (!shouldLog(level)) return;
    write(formatEntry(level, message, metadata));
  };

  return {
    info: (msg, meta) => log("info", msg, meta),
    warn: (msg, meta) => log("warn", msg, meta),
    error: (msg, err, meta) =>
      log("error", msg, {
        ...meta,
        error: err instanceof Error ? err.message : String(err ?? ""),
      }),
    debug: (msg, meta) => log("debug", msg, meta),
  };
}
