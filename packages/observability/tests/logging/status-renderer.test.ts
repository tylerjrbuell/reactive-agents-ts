import { describe, it, expect, vi } from "vitest";
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
      // Collect permanent lines (those ending in \n). Strips cursor-control
      // AND color SGR codes (`\x1b[32m` ... `\x1b[0m`) so assertions can match
      // on plain text regardless of whether color is on for this stream.
      if (chunk.includes("\n")) {
        lines.push(
          chunk.replace(/\r\x1b\[2K/g, "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\n$/, "").trim(),
        );
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

    const completionLine = out.lines.find((l) => l.startsWith("✓") && l.includes("Done"));
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

    expect(out.lines.some((l) => l.startsWith("✗") && l.includes("Failed"))).toBe(true);
  });

  it("completion: always shows cost even when $0.0000 (local models)", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    await Effect.runPromise(renderer.start());
    await Effect.runPromise(logger.emit({
      _tag: "completion", success: true, summary: "Done", timestamp: new Date(),
    }));
    renderer.stop();

    const doneLine = out.lines.find((l) => l.startsWith("✓") && l.includes("Done"));
    expect(doneLine).toBeDefined();
    expect(doneLine).toContain("$0.0000");
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

  it("stop() pauses stdin (not resume) when the renderer owned it exclusively, so a plain script exits", async () => {
    // `ownsKeyboard` is only ever true when setupKeyboard() found no
    // existing stdin consumer — a host readline.createInterface() case
    // bails out of setup entirely (see the next test) and never reaches
    // this cleanup path. So this is exclusively "we were the only stdin
    // reader" — a bare one-shot `agent.run()` script with no readline of
    // its own. Live repro, 2026-08-16: `resume()` here left such a script
    // hanging forever after printing its result, because a flowing stdin
    // with nothing left to consume it keeps the TTY handle ref'd and the
    // event loop alive. `pause()` lets the process exit normally.
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    const resume = vi.fn();
    const pause = vi.fn();
    const setRawMode = vi.fn();
    const stdin = {
      isTTY: true,
      setRawMode,
      resume,
      pause,
      on: vi.fn(),
      off: vi.fn(),
      setEncoding: vi.fn(),
      listenerCount: vi.fn(() => 0),
    };
    const original = process.stdin;
    Object.defineProperty(process, "stdin", { value: stdin, configurable: true });

    try {
      await Effect.runPromise(renderer.start());
      // setupKeyboard() legitimately calls resume() once, at start, to put
      // stdin into flowing mode so raw keypress bytes can be read during the
      // run — that's not the bug. The bug was cleanupKeyboard() calling it
      // AGAIN at stop(), re-flowing a stream nothing was left to consume.
      resume.mockClear();
      renderer.stop();
      expect(pause).toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();
      expect(setRawMode).toHaveBeenCalledWith(false);
    } finally {
      Object.defineProperty(process, "stdin", { value: original, configurable: true });
    }
  });

  it("defers to a host readline interface instead of stealing raw mode", async () => {
    const logger = await Effect.runPromise(makeObservableLogger({ live: false }));
    const out = makeMockStream();
    const renderer = makeStatusRenderer(logger, out as unknown as NodeJS.WriteStream);

    const setRawMode = vi.fn();
    const onData = vi.fn();
    const stdin = {
      isTTY: true,
      setRawMode,
      resume: vi.fn(),
      pause: vi.fn(),
      on: onData,
      off: vi.fn(),
      setEncoding: vi.fn(),
      // A readline.Interface on a TTY attaches its own 'data' listener to
      // decode keypresses — this is what setupKeyboard() must detect and
      // defer to, rather than layering its own raw-mode ownership on top.
      listenerCount: vi.fn(() => 1),
    };
    const original = process.stdin;
    Object.defineProperty(process, "stdin", { value: stdin, configurable: true });

    try {
      await Effect.runPromise(renderer.start());
      renderer.stop();
      expect(setRawMode).not.toHaveBeenCalled();
      expect(onData).not.toHaveBeenCalledWith("data", expect.anything());
    } finally {
      Object.defineProperty(process, "stdin", { value: original, configurable: true });
    }
  });
});
