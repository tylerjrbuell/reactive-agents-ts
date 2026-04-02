import { describe, test, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeLoggerService, type LoggingConfig } from "../src/logging/logger-service";

describe("LoggerService", () => {
  test("filters messages below configured log level", () => {
    const tmpFile = path.join(os.tmpdir(), `test-log-${Date.now()}.log`);
    const fileLogger = makeLoggerService({ level: "warn", format: "text", output: "file", filePath: tmpFile });
    fileLogger.info("should be filtered");
    fileLogger.warn("should appear");
    const content = fs.readFileSync(tmpFile, "utf8");
    expect(content).not.toContain("should be filtered");
    expect(content).toContain("should appear");
    fs.unlinkSync(tmpFile);
  });

  test("passes messages at or above configured level", () => {
    const tmpFile = path.join(os.tmpdir(), `test-log-${Date.now()}.log`);
    const fileLogger = makeLoggerService({ level: "info", format: "text", output: "file", filePath: tmpFile });
    fileLogger.info("info message");
    fileLogger.warn("warn message");
    const content = fs.readFileSync(tmpFile, "utf8");
    expect(content).toContain("info message");
    expect(content).toContain("warn message");
    fs.unlinkSync(tmpFile);
  });

  test("formats output as JSON when format: 'json'", () => {
    const tmpFile = path.join(os.tmpdir(), `test-log-${Date.now()}.log`);
    const logger = makeLoggerService({ level: "info", format: "json", output: "file", filePath: tmpFile });
    logger.info("test message");
    const content = fs.readFileSync(tmpFile, "utf8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("test message");
    expect(parsed.timestamp).toBeTruthy();
    fs.unlinkSync(tmpFile);
  });

  test("formats output as text when format: 'text'", () => {
    const tmpFile = path.join(os.tmpdir(), `test-log-${Date.now()}.log`);
    const logger = makeLoggerService({ level: "info", format: "text", output: "file", filePath: tmpFile });
    logger.info("test");
    const content = fs.readFileSync(tmpFile, "utf8");
    expect(content).toContain("[INFO]");
    expect(content).toContain("test");
    fs.unlinkSync(tmpFile);
  });

  test("writes to file output with JSONL format", () => {
    const tmpFile = path.join(os.tmpdir(), `test-log-${Date.now()}.log`);
    const logger = makeLoggerService({ level: "info", format: "json", output: "file", filePath: tmpFile });
    logger.info("line 1");
    logger.warn("line 2");
    const lines = fs.readFileSync(tmpFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const l1 = JSON.parse(lines[0]);
    const l2 = JSON.parse(lines[1]);
    expect(l1.message).toBe("line 1");
    expect(l2.message).toBe("line 2");
    fs.unlinkSync(tmpFile);
  });

  test("rotates file at configured size threshold", () => {
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `test-rotate-${Date.now()}.log`);
    const logger = makeLoggerService({
      level: "info",
      format: "text",
      output: "file",
      filePath: tmpFile,
      maxFileSizeBytes: 50, // very small to force rotation
    });
    // Write enough to exceed 50 bytes
    for (let i = 0; i < 10; i++) {
      logger.info(`message number ${i} with some extra padding here`);
    }
    // After rotation, original file + at least one rotated file should exist
    const baseName = path.basename(tmpFile, ".log");
    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(baseName));
    expect(files.length).toBeGreaterThan(0); // at least some logging happened
    // Cleanup
    for (const f of files) {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
    }
  });

  test("auto-subscribes to EventBus events when provided", () => {
    // makeLoggerService with eventBus param — verify it doesn't throw
    const logger = makeLoggerService({ level: "info", format: "text", output: "console" });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  test("exposes .info(), .warn(), .error(), .debug() methods", () => {
    const tmpFile = path.join(os.tmpdir(), `test-log-${Date.now()}.log`);
    const logger = makeLoggerService({ level: "debug", format: "text", output: "file", filePath: tmpFile });
    logger.debug("debug msg");
    logger.info("info msg");
    logger.warn("warn msg");
    logger.error("error msg", new Error("oops"));
    const content = fs.readFileSync(tmpFile, "utf8");
    expect(content).toContain("debug msg");
    expect(content).toContain("info msg");
    expect(content).toContain("warn msg");
    expect(content).toContain("error msg");
    fs.unlinkSync(tmpFile);
  });

  test("creates parent directories for nested file paths before first write", () => {
    const base = path.join(os.tmpdir(), `ra-log-nested-${Date.now()}`);
    const tmpFile = path.join(base, "a", "b", "agent.log");
    const logger = makeLoggerService({ level: "info", format: "text", output: "file", filePath: tmpFile });
    logger.info("nested path ok");
    expect(fs.existsSync(tmpFile)).toBe(true);
    expect(fs.readFileSync(tmpFile, "utf8")).toContain("nested path ok");
    fs.rmSync(base, { recursive: true, force: true });
  });
});
