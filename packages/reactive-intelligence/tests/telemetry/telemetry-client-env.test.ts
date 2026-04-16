import { describe, it, expect, afterEach } from "bun:test";

// We need to test resolveDefaultReportsEndpoint() which reads process.env at call time.
// Import it fresh for each test scenario.

describe("resolveDefaultReportsEndpoint", () => {
  const savedEnv: Record<string, string | undefined> = {};

  function saveAndClear(...keys: string[]) {
    for (const key of keys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  }

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("uses REACTIVE_AGENTS_TELEMETRY_REPORTS_URL when set (highest precedence)", async () => {
    saveAndClear("REACTIVE_AGENTS_TELEMETRY_REPORTS_URL", "REACTIVE_AGENTS_TELEMETRY_BASE_URL");
    process.env["REACTIVE_AGENTS_TELEMETRY_REPORTS_URL"] = "https://override.example/v1/reports";
    process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"] = "https://should-be-ignored.example";
    const { resolveDefaultReportsEndpoint } = await import("../../src/telemetry/telemetry-client.js");
    expect(resolveDefaultReportsEndpoint()).toBe("https://override.example/v1/reports");
  });

  it("derives from REACTIVE_AGENTS_TELEMETRY_BASE_URL + /v1/reports", async () => {
    saveAndClear("REACTIVE_AGENTS_TELEMETRY_REPORTS_URL", "REACTIVE_AGENTS_TELEMETRY_BASE_URL");
    delete process.env["REACTIVE_AGENTS_TELEMETRY_REPORTS_URL"];
    process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"] = "https://pi.home.example.com";
    const { resolveDefaultReportsEndpoint } = await import("../../src/telemetry/telemetry-client.js");
    expect(resolveDefaultReportsEndpoint()).toBe("https://pi.home.example.com/v1/reports");
  });

  it("falls back to hardcoded default when neither env var is set", async () => {
    saveAndClear("REACTIVE_AGENTS_TELEMETRY_REPORTS_URL", "REACTIVE_AGENTS_TELEMETRY_BASE_URL");
    const { resolveDefaultReportsEndpoint } = await import("../../src/telemetry/telemetry-client.js");
    expect(resolveDefaultReportsEndpoint()).toMatch(/reactiveagents\.dev.*\/v1\/reports$/);
  });
});
