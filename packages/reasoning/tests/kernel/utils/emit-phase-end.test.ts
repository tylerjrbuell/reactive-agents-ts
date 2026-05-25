// File: tests/kernel/utils/emit-phase-end.test.ts
/**
 * Invariant + drift-prevention tests for primitive #4 (emitPhaseEnd).
 *
 * Phase 0 template, applied to primitive #4:
 *   1. Helper behavior: emits the right events with the right shapes
 *   2. Drift contract: no strategies/*.ts file may inline `_tag: "phase_complete"`
 *      via emitLog. Single migration covers all 12 prior sites.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { emitPhaseEnd } from "../../../src/kernel/utils/service-utils.js";
import type { LogEvent } from "@reactive-agents/observability";

// Capturing emitLog for assertion.
function captureEmitLog(): {
  emitLog: (event: LogEvent) => Effect.Effect<void, never>;
  emitted: LogEvent[];
} {
  const emitted: LogEvent[] = [];
  return {
    emitted,
    emitLog: (event) => {
      emitted.push(event);
      return Effect.void;
    },
  };
}

describe("emitPhaseEnd — phase_complete emission", () => {
  it("emits phase_complete with status:success by default", async () => {
    const { emitLog, emitted } = captureEmitLog();
    const startedAt = Date.now() - 100;
    await Effect.runPromise(emitPhaseEnd({ emitLog, phase: "test:p", startedAt }));
    expect(emitted.length).toBe(1);
    const e = emitted[0] as { _tag: string; phase: string; status: string; duration: number };
    expect(e._tag).toBe("phase_complete");
    expect(e.phase).toBe("test:p");
    expect(e.status).toBe("success");
    expect(e.duration).toBeGreaterThanOrEqual(0);
  });

  it("emits phase_complete with status:error when requested", async () => {
    const { emitLog, emitted } = captureEmitLog();
    await Effect.runPromise(
      emitPhaseEnd({ emitLog, phase: "test:p", startedAt: Date.now(), status: "error" }),
    );
    expect((emitted[0] as { status: string }).status).toBe("error");
  });
});

describe("emitPhaseEnd — tokens metric emission", () => {
  it("skips tokens_used metric when totalTokens is omitted", async () => {
    const { emitLog, emitted } = captureEmitLog();
    await Effect.runPromise(emitPhaseEnd({ emitLog, phase: "p", startedAt: Date.now() }));
    expect(emitted.length).toBe(1);
    expect((emitted[0] as { _tag: string })._tag).toBe("phase_complete");
  });

  it("emits tokens_used metric AFTER phase_complete when totalTokens provided", async () => {
    const { emitLog, emitted } = captureEmitLog();
    await Effect.runPromise(
      emitPhaseEnd({ emitLog, phase: "p", startedAt: Date.now(), totalTokens: 1234 }),
    );
    expect(emitted.length).toBe(2);
    expect((emitted[0] as { _tag: string })._tag).toBe("phase_complete");
    const m = emitted[1] as { _tag: string; name: string; value: number; unit: string };
    expect(m._tag).toBe("metric");
    expect(m.name).toBe("tokens_used");
    expect(m.value).toBe(1234);
    expect(m.unit).toBe("tokens");
  });

  it("emits tokens metric with value:0 (zero is a valid token count)", async () => {
    const { emitLog, emitted } = captureEmitLog();
    await Effect.runPromise(
      emitPhaseEnd({ emitLog, phase: "p", startedAt: Date.now(), totalTokens: 0 }),
    );
    expect(emitted.length).toBe(2);
    expect((emitted[1] as { value: number }).value).toBe(0);
  });
});

// ── DRIFT CONTRACT — phase_complete must route through helper ────────────────

describe("drift contract — emitPhaseEnd primitive", () => {
  it("no strategies/*.ts file may inline emitLog phase_complete", () => {
    // Recipe-specific signature: any `_tag: "phase_complete"` literal inside
    // a strategies/*.ts file means a phase-end emit was inlined instead of
    // routed through emitPhaseEnd. Single regex catches all 12 prior sites.
    //
    // Opt-out: `// emit-phase-end-exempt` comment on the line above.
    const stratDir = join(__dirname, "../../../src/strategies");
    const files = readdirSync(stratDir).filter((f) => f.endsWith(".ts"));
    const violations: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      const src = readFileSync(join(stratDir, file), "utf8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (!/_tag:\s*["']phase_complete["']/.test(line)) continue;
        // Skip comments / docstrings that mention phase_complete.
        if (/^\s*(?:\/\/|\*)/.test(line)) continue;
        const exempt = /emit-phase-end-exempt/.test(lines.slice(Math.max(0, i - 3), i).join("\n"));
        if (exempt) continue;
        violations.push({ file, line: i + 1, text: line.trim().slice(0, 100) });
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}: inline phase_complete — use emitPhaseEnd\n    ${v.text}`)
        .join("\n");
      throw new Error(
        `Drift contract violated — phase_complete emissions must route through emitPhaseEnd:\n${msg}`,
      );
    }
    expect(violations.length).toBe(0);
  });
});
