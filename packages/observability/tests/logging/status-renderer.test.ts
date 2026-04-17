import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { makeObservableLogger } from "../../src/logging/observable-logger.js";
import { makeStatusRenderer } from "../../src/logging/status-renderer.js";

function makeMockStream(isTTY = true) {
  const lines: string[] = [];
  const raw: string[] = [];
  return {
    isTTY,
    write(chunk: string) {
      raw.push(chunk);
      // Collect permanent lines (those ending in \n)
      if (chunk.includes("\n")) {
        lines.push(chunk.replace(/\r\x1b\[2K/g, "").replace(/\n$/, "").trim());
      }
      return true;
    },
    lines,
    raw,
  };
}

describe("makeStatusRenderer", () => {
  it("permanent lines: notice prints as a scrollback line", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());

    await Effect.runPromise(logger.emit({
      _tag: "notice",
      level: "info",
      title: "Reactive Intelligence",
      message: "Telemetry enabled",
      dismissible: true,
      timestamp: new Date(),
    }));

    renderer.stop();

    expect(out.lines.some((l) => l.includes("Reactive Intelligence"))).toBe(true);
  });

  it("permanent lines: warning prints as a scrollback line", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());
    await Effect.runPromise(logger.emit({
      _tag: "warning",
      message: "High entropy detected",
      timestamp: new Date(),
    }));
    renderer.stop();

    expect(out.lines.some((l) => l.includes("High entropy detected"))).toBe(true);
  });

  it("permanent lines: error prints as a scrollback line", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());
    await Effect.runPromise(logger.emit({
      _tag: "error",
      message: "Max iterations exceeded",
      timestamp: new Date(),
    }));
    renderer.stop();

    expect(out.lines.some((l) => l.includes("Max iterations exceeded"))).toBe(true);
  });

  it("completion: success prints done line with checkmark", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());
    await Effect.runPromise(logger.emit({
      _tag: "metric", name: "tokens_used", value: 5000, unit: "tokens", timestamp: new Date(),
    }));
    await Effect.runPromise(logger.emit({
      _tag: "metric", name: "cost_usd", value: 0.0012, unit: "usd", timestamp: new Date(),
    }));
    await Effect.runPromise(logger.emit({
      _tag: "tool_result", tool: "web-search", duration: 500, status: "success", timestamp: new Date(),
    }));
    await Effect.runPromise(logger.emit({
      _tag: "tool_result", tool: "web-search", duration: 400, status: "success", timestamp: new Date(),
    }));
    await Effect.runPromise(logger.emit({
      _tag: "completion", success: true, summary: "Done", timestamp: new Date(),
    }));
    renderer.stop();

    const completionLine = out.lines.find((l) => l.startsWith("✓"));
    expect(completionLine).toBeDefined();
    expect(completionLine).toContain("5,000 tok");
    expect(completionLine).toContain("$0.0012");
    expect(completionLine).toContain("2 calls");
  });

  it("completion: failure prints failed line with cross", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());
    await Effect.runPromise(logger.emit({
      _tag: "completion", success: false, summary: "Failed", timestamp: new Date(),
    }));
    renderer.stop();

    expect(out.lines.some((l) => l.startsWith("✗"))).toBe(true);
  });

  it("non-TTY: writes plain lines without ANSI overwrite sequences", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream(false); // isTTY = false
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());
    await Effect.runPromise(logger.emit({
      _tag: "warning", message: "test warning", timestamp: new Date(),
    }));
    renderer.stop();

    // Should not contain ANSI escape codes
    expect(out.raw.some((r) => r.includes("\x1b"))).toBe(false);
    expect(out.lines.some((l) => l.includes("test warning"))).toBe(true);
  });

  it("stop() clears the status line on TTY", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());
    renderer.stop();

    // After stop, should have written the clear sequence
    expect(out.raw.some((r) => r.includes("\r\x1b[2K"))).toBe(true);
  });
});
