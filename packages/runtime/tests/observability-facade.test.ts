// Run: bun test packages/runtime/tests/observability-facade.test.ts --timeout 15000
//
// DX wave (v0.12) — builder consolidation: one canonical observability route.
// `.withObservability({ cortex, telemetry, logging, tracing, health, audit,
// costs })` fans out to the SAME builder state the dedicated convenience methods
// set, so users can configure the whole observability stack through one method.
// The dedicated methods remain (additive). Precedence: last call wins.
import { describe, expect, it } from "bun:test";
import { ReactiveAgents } from "../src";

// White-box view of the observability-related builder state the unified facade
// must populate identically to the dedicated methods.
type ObsState = {
  _cortexUrl: string | null;
  _telemetryConfig?: unknown;
  _loggingConfig?: unknown;
  _tracingConfig?: unknown;
  _enableHealthCheck: boolean;
  _enableAudit: boolean;
  _enableCostTracking: boolean;
};

describe("withObservability unified facade (DX wave, v0.12)", () => {
  it("fans out sub-options to the same state as the dedicated methods", () => {
    const unified = ReactiveAgents.create().withObservability({
      cortex: { url: "http://localhost:9999" },
      telemetry: { mode: "isolated" },
      logging: { level: "debug" },
      tracing: { dir: "/tmp/facade-traces" },
      health: true,
      audit: true,
      costs: true,
    }) as unknown as ObsState;

    const chained = ReactiveAgents.create()
      .withCortex("http://localhost:9999")
      // telemetry has no dedicated wither (removed v0.14 — folded into
      // withObservability); the facade is now its only entry point.
      .withObservability({ telemetry: { mode: "isolated" } })
      .withLogging({ level: "debug" })
      .withTracing({ dir: "/tmp/facade-traces" })
      .withHealthCheck()
      .withAudit()
      .withCostTracking() as unknown as ObsState;

    expect(unified._cortexUrl).toBe(chained._cortexUrl);
    expect(unified._telemetryConfig).toEqual(chained._telemetryConfig);
    expect(unified._loggingConfig).toEqual(chained._loggingConfig);
    expect(unified._tracingConfig).toEqual(chained._tracingConfig);
    expect(unified._enableHealthCheck).toBe(true);
    expect(unified._enableAudit).toBe(true);
    expect(unified._enableCostTracking).toBe(true);
  }, 15000);

  it("verbosity/live still work alongside the new sub-options", () => {
    const b = ReactiveAgents.create().withObservability({
      verbosity: "verbose",
      cortex: true,
    }) as unknown as ObsState & { _observabilityOptions?: { verbosity?: string } };
    expect(b._observabilityOptions?.verbosity).toBe("verbose");
    // cortex:true resolves the URL via CORTEX_URL env / default.
    expect(typeof b._cortexUrl).toBe("string");
  }, 15000);

  it("tracing:false disables tracing (parity with withoutTracing)", () => {
    const b = ReactiveAgents.create()
      .withTracing({ dir: "/tmp/x" })
      .withObservability({ tracing: false }) as unknown as ObsState;
    expect(b._tracingConfig).toBeNull();
  }, 15000);
});
