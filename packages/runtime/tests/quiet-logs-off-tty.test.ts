/**
 * Quiet logs off a TTY.
 *
 * An agent embedded in a server, pipe or CI job (stdout is not a TTY) with no
 * explicit verbosity must not narrate phases to its host's stdout, but its
 * warnings and errors still print. Only stdout changes: the ObservableLogger
 * buffer, its subscribers and the EventBus stream stay exactly the same,
 * because hosts such as Cortex (a Bun server, never a TTY) build their UI
 * from EventBus and trace data.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { ReactiveAgents } from "../src/index.js";
import {
  bindExecutionObservability,
  makeExecutionLogger,
} from "../src/engine/execute-obs-wiring.js";
import { withStdoutTTY } from "./_helpers-tty.js";

const captureConsoleLog = () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => { console.log = original; } };
};

const captureConsoleWarn = () => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => { console.warn = original; } };
};

describe("bindExecutionObservability: verbosity default follows stdout", () => {
  const bind = (observabilityVerbosity: "minimal" | "normal" | undefined, isTTY: boolean) =>
    Effect.runPromise(
      bindExecutionObservability({ observabilityVerbosity }, { stdoutIsTTY: () => isTTY }),
    );

  test("unset verbosity on a TTY: normal narration", async () => {
    const w = await bind(undefined, true);
    expect(w.verbosity).toBe("normal");
    expect(w.liveWarningsOnly).toBe(false);
  });

  test("unset verbosity off a TTY: minimal narration, warnings/errors still live", async () => {
    const w = await bind(undefined, false);
    expect(w.verbosity).toBe("minimal");
    expect(w.isNormal).toBe(false);
    expect(w.liveWarningsOnly).toBe(true);
  });

  test("explicit verbosity always wins off a TTY", async () => {
    const normal = await bind("normal", false);
    expect(normal.verbosity).toBe("normal");
    expect(normal.liveWarningsOnly).toBe(false);
    // Explicit "minimal" stays fully silent: no warnings-only printer.
    const minimal = await bind("minimal", false);
    expect(minimal.verbosity).toBe("minimal");
    expect(minimal.liveWarningsOnly).toBe(false);
  });
});

describe("makeExecutionLogger: warnings-only live printing", () => {
  const events = (): LogEvent[] => [
    { _tag: "phase_started", phase: "think", timestamp: new Date() },
    { _tag: "warning", message: "quiet-probe-warning", timestamp: new Date() },
    { _tag: "error", message: "quiet-probe-error", timestamp: new Date() },
  ];

  test("prints warn/error only, on stderr; buffer and subscribers still get every event", async () => {
    // stderr, not stdout (dx-warden 2026-11-17): a piped run's stdout carries
    // only the answer, so `agent | jq` style hosts never see a warning line.
    const out = captureConsoleLog();
    const cap = captureConsoleWarn();
    try {
      const seen = await Effect.runPromise(
        Effect.gen(function* () {
          const logger = yield* makeExecutionLogger({ live: true, verbosity: "minimal" }, true);
          const tags: string[] = [];
          yield* logger.subscribe((e) => Effect.sync(() => { tags.push(e._tag); }));
          for (const e of events()) yield* logger.emit(e);
          const buffer = yield* logger.getBuffer();
          return { tags, buffered: buffer.map((e) => e._tag) };
        }),
      );
      expect(seen.tags).toEqual(["phase_started", "warning", "error"]);
      expect(seen.buffered).toEqual(["phase_started", "warning", "error"]);
    } finally {
      cap.restore();
      out.restore();
    }
    expect(out.lines).toEqual([]);
    expect(cap.lines.length).toBe(2);
    expect(cap.lines.some((l) => l.includes("quiet-probe-warning"))).toBe(true);
    expect(cap.lines.some((l) => l.includes("quiet-probe-error"))).toBe(true);
    expect(cap.lines.some((l) => l.includes("think"))).toBe(false);
  });

  test("not warnings-only: the logger's own config decides (explicit minimal prints nothing)", async () => {
    const cap = captureConsoleLog();
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const logger = yield* makeExecutionLogger({ live: true, verbosity: "minimal" }, false);
          for (const e of events()) yield* logger.emit(e);
        }),
      );
    } finally {
      cap.restore();
    }
    expect(cap.lines).toEqual([]);
  });
});

describe("plain agent (no withObservability): stdout quiet off a TTY, EventBus unchanged", () => {
  // Status mode stays off on both arms (withStdoutTTY), so the only difference
  // between them is the TTY-dependent verbosity default.
  const runWithTTY = (isTTY: boolean) => withStdoutTTY(isTTY, async () => {
    const agent = await ReactiveAgents.create()
      .withName("quiet-logs-probe")
      .withTestScenario([{ match: "quiet logs probe", text: "Quiet answer." }])
      .build();
    const tags: string[] = [];
    const unsub = await agent.subscribe((e) => { tags.push(e._tag); });
    const cap = captureConsoleLog();
    try {
      const result = await agent.run("quiet logs probe");
      expect(result.success).toBe(true);
    } finally {
      cap.restore();
      unsub();
      await agent.dispose();
    }
    return { tags, lines: cap.lines };
  });

  test("off a TTY prints no narration; the same EventBus events are published", async () => {
    const tty = await runWithTTY(true);
    const offTty = await runWithTTY(false);
    expect(tty.lines.length).toBeGreaterThan(0);
    expect(offTty.lines).toEqual([]);
    expect(offTty.tags.length).toBeGreaterThan(0);
    expect(offTty.tags).toEqual(tty.tags);
  }, 30000);
});
