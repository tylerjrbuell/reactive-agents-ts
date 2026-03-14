import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ReactiveAgents } from "../src/index.js";
import { ObservabilityService, ObservabilityServiceLive } from "@reactive-agents/observability";

// ─── Helpers ───

const buildAgent = async (verbosity: "minimal" | "normal" | "verbose" | "debug") =>
  ReactiveAgents.create()
    .withName("verbosity-test")
    .withTestScenario([{ match: "verbosity test", text: "The answer is correct." }])
    .withObservability({ verbosity, live: false })
    .build();

// ─── Tests ───

describe("withObservability verbosity threading", () => {
  test("withObservability({ verbosity: 'verbose', live: false }) builds successfully", async () => {
    const agent = await buildAgent("verbose");
    expect(agent).toBeDefined();
  });

  test("withObservability({ verbosity: 'minimal' }) builds successfully", async () => {
    const agent = await buildAgent("minimal");
    expect(agent).toBeDefined();
  });

  test("withObservability({ verbosity: 'debug' }) builds successfully", async () => {
    const agent = await buildAgent("debug");
    expect(agent).toBeDefined();
  });

  test("agent runs successfully with verbose mode", async () => {
    const agent = await buildAgent("verbose");
    const result = await agent.run("verbosity test");
    expect(result.success).toBe(true);
  });

  test("agent runs successfully with minimal mode", async () => {
    const agent = await buildAgent("minimal");
    const result = await agent.run("verbosity test");
    expect(result.success).toBe(true);
  });
});

// ─── Verbosity level on ObservabilityService directly ───

describe("ObservabilityService verbosity level", () => {
  test("verbosity is 'verbose' when configured", async () => {
    const layer = ObservabilityServiceLive({ verbosity: "verbose" });
    const v = await Effect.runPromise(
      ObservabilityService.pipe(
        Effect.flatMap((obs) => Effect.sync(() => obs.verbosity())),
        Effect.provide(layer),
      ),
    );
    expect(v).toBe("verbose");
  });

  test("verbosity is 'minimal' when configured", async () => {
    const layer = ObservabilityServiceLive({ verbosity: "minimal" });
    const v = await Effect.runPromise(
      ObservabilityService.pipe(
        Effect.flatMap((obs) => Effect.sync(() => obs.verbosity())),
        Effect.provide(layer),
      ),
    );
    expect(v).toBe("minimal");
  });

  test("verbosity defaults to 'normal'", async () => {
    const layer = ObservabilityServiceLive();
    const v = await Effect.runPromise(
      ObservabilityService.pipe(
        Effect.flatMap((obs) => Effect.sync(() => obs.verbosity())),
        Effect.provide(layer),
      ),
    );
    expect(v).toBe("normal");
  });
});

// ─── Live mode log collection ───

describe("live mode log collection", () => {
  test("logs are captured before flush() in both live and non-live mode", async () => {
    // non-live mode
    const layer = ObservabilityServiceLive({ live: false });
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const obs = yield* ObservabilityService;
        yield* obs.info("msg1");
        yield* obs.debug("msg2");
        // No flush — getLogs still returns all buffered logs
        return yield* obs.getLogs();
      }).pipe(Effect.provide(layer)),
    );
    expect(logs.length).toBeGreaterThanOrEqual(2);
    const messages = logs.map((l) => l.message);
    expect(messages).toContain("msg1");
    expect(messages).toContain("msg2");
  });

  test("live mode wires liveWriter — logs are captured before flush", async () => {
    // In live mode, we can't easily intercept stdout in tests, but we verify
    // that getLogs() still has all entries (liveWriter + buffer both receive entries)
    const layer = ObservabilityServiceLive({ live: true });
    const logs = await Effect.runPromise(
      Effect.gen(function* () {
        const obs = yield* ObservabilityService;
        yield* obs.info("live-msg1");
        yield* obs.warn("live-msg2");
        return yield* obs.getLogs();
      }).pipe(Effect.provide(layer)),
    );
    expect(logs.length).toBeGreaterThanOrEqual(2);
    const messages = logs.map((l) => l.message);
    expect(messages).toContain("live-msg1");
    expect(messages).toContain("live-msg2");
  });
});
