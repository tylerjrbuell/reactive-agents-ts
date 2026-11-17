import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import {
  ObservabilityService,
  ObservabilityServiceLive,
  resolveVerbosity,
  type ExporterConfig,
} from "../src/observability-service.js";
import { MetricsCollectorLive } from "../src/metrics/metrics-collector.js";

// An embedded library must not narrate to a piped/server stdout. With no
// verbosity configured, the default depends on whether stdout is a TTY:
// interactive terminals keep the "normal" narration; non-TTY stdout gets
// warnings and errors only. An explicit verbosity always wins.

const layerWith = (config: ExporterConfig, isTTY: boolean) =>
  ObservabilityServiceLive(config, { stdoutIsTTY: () => isTTY }).pipe(
    Layer.provide(MetricsCollectorLive.pipe(Layer.provide(EventBusLive))),
  );

/** Run `program` and return every line written to stdout (console.log + process.stdout.write). */
const captureStdout = async <A>(
  program: Effect.Effect<A, unknown, ObservabilityService>,
  layer: Layer.Layer<ObservabilityService>,
): Promise<{ readonly value: A; readonly out: string }> => {
  const chunks: string[] = [];
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args: unknown[]) => {
    chunks.push(args.map(String).join(" ") + "\n");
  };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const value = await Effect.runPromise(Effect.provide(program, layer));
    return { value, out: chunks.join("") };
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
  }
};

const logAllLevelsAndFlush = Effect.gen(function* () {
  const obs = yield* ObservabilityService;
  yield* obs.info("info-line-should-hide");
  yield* obs.debug("debug-line-should-hide");
  yield* obs.warn("warn-line-should-show");
  yield* obs.error("error-line-should-show");
  yield* obs.withSpan("span-should-hide", Effect.void);
  yield* obs.setGauge("execution.tokens_used", 42);
  yield* obs.flush();
  return obs.verbosity();
});

describe("resolveVerbosity", () => {
  test("explicit verbosity wins regardless of TTY", () => {
    expect(resolveVerbosity("verbose", false)).toBe("verbose");
    expect(resolveVerbosity("normal", false)).toBe("normal");
    expect(resolveVerbosity("minimal", true)).toBe("minimal");
  });

  test("unset resolves to normal on a TTY and minimal off one", () => {
    expect(resolveVerbosity(undefined, true)).toBe("normal");
    expect(resolveVerbosity(undefined, false)).toBe("minimal");
  });
});

describe("ObservabilityServiceLive default verbosity by stdout TTY", () => {
  test("unset + TTY keeps the normal narration (logs, spans, dashboard)", async () => {
    const { value, out } = await captureStdout(logAllLevelsAndFlush, layerWith({}, true));
    expect(value).toBe("normal");
    expect(out).toContain("info-line-should-hide");
    expect(out).toContain("span-should-hide");
  });

  test("unset + non-TTY prints only warnings and errors on flush", async () => {
    const { value, out } = await captureStdout(logAllLevelsAndFlush, layerWith({}, false));
    expect(value).toBe("minimal");
    expect(out).toContain("warn-line-should-show");
    expect(out).toContain("error-line-should-show");
    expect(out).not.toContain("info-line-should-hide");
    expect(out).not.toContain("debug-line-should-hide");
    expect(out).not.toContain("span-should-hide");
    expect(out).not.toContain("Agent Execution Summary");
  });

  test("unset + non-TTY + live streams warnings/errors once, never info", async () => {
    const { out } = await captureStdout(logAllLevelsAndFlush, layerWith({ live: true }, false));
    expect(out).not.toContain("info-line-should-hide");
    expect(out.split("warn-line-should-show").length - 1).toBe(1);
    expect(out.split("error-line-should-show").length - 1).toBe(1);
  });

  test("explicit normal on non-TTY is honored", async () => {
    const { value, out } = await captureStdout(
      logAllLevelsAndFlush,
      layerWith({ verbosity: "normal" }, false),
    );
    expect(value).toBe("normal");
    expect(out).toContain("info-line-should-hide");
  });

  test("explicit minimal stays fully silent, even for warnings", async () => {
    const { out } = await captureStdout(
      logAllLevelsAndFlush,
      layerWith({ verbosity: "minimal", live: true }, true),
    );
    expect(out).toBe("");
  });
});
