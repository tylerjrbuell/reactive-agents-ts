import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { makeFileExporter } from "../src/exporters/file-exporter.js";
import type { LogEntry, Span, Metric } from "../src/types.js";

// Prefix split so secret scanners do not flag the fixture.
const SECRET = "sk-" + "proj-abcdefghijklmnopqrstuvwxyz0123456789";
const file = "/tmp/rax-test-exporter-redaction.jsonl";
const fresh = () => {
  if (existsSync(file)) unlinkSync(file);
};

describe("FileExporter redaction", () => {
  test("log message and metadata never reach disk with a secret", async () => {
    fresh();
    const exporter = makeFileExporter({ filePath: file, mode: "overwrite" });
    const logs: LogEntry[] = [
      {
        timestamp: new Date(),
        level: "info",
        message: `calling with key ${SECRET}`,
        metadata: { header: `Bearer ${SECRET}`, nested: { k: [SECRET] }, n: 3 },
      },
    ];
    await exporter.exportLogs(logs);
    const raw = readFileSync(file, "utf-8");
    expect(raw).not.toContain(SECRET);
    const parsed = JSON.parse(raw.trim());
    expect(parsed.message).toContain("[redacted-openai-key]");
    expect(parsed.metadata.n).toBe(3);
  });

  test("span attributes and event attributes are redacted", async () => {
    fresh();
    const exporter = makeFileExporter({ filePath: file, mode: "overwrite" });
    const spans: Span[] = [
      {
        traceId: "t",
        spanId: "s",
        name: "x",
        startTime: new Date(),
        status: "ok",
        attributes: { key: SECRET },
        events: [{ name: "e", timestamp: new Date(), attributes: { key: SECRET } }],
      },
    ];
    await exporter.exportSpans(spans);
    expect(readFileSync(file, "utf-8")).not.toContain(SECRET);
  });

  test("metric labels are redacted", async () => {
    fresh();
    const exporter = makeFileExporter({ filePath: file, mode: "overwrite" });
    const metrics: Metric[] = [
      { name: "m", type: "counter", value: 1, timestamp: new Date(), labels: { k: SECRET } },
    ];
    await exporter.exportMetrics(metrics);
    expect(readFileSync(file, "utf-8")).not.toContain(SECRET);
  });

  test("custom redactors option replaces the defaults", async () => {
    fresh();
    const exporter = makeFileExporter({
      filePath: file,
      mode: "overwrite",
      redactors: [{ name: "x", pattern: /hunter2/g, replacement: "[gone]" }],
    });
    await exporter.exportLogs([{ timestamp: new Date(), level: "info", message: "pw hunter2" }]);
    expect(JSON.parse(readFileSync(file, "utf-8").trim()).message).toBe("pw [gone]");
  });
});
