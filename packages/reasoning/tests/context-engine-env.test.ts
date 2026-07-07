import { describe, it, expect, afterEach } from "bun:test";
import { buildEnvironmentContext } from "../src/context/context-engine.js";

describe("buildEnvironmentContext — env block (ported from deleted buildStaticContext wrapper, Phase 1b)", () => {
  const PRIOR = process.env.RA_ENV_TIME_PRECISION;
  afterEach(() => {
    if (PRIOR === undefined) delete process.env.RA_ENV_TIME_PRECISION;
    else process.env.RA_ENV_TIME_PRECISION = PRIOR;
  });

  it("includes Date: line", () => {
    expect(buildEnvironmentContext()).toContain("Date:");
  });

  it("OMITS the volatile Time: line by DEFAULT (KV-cache prefix stability)", () => {
    delete process.env.RA_ENV_TIME_PRECISION;
    const ctx = buildEnvironmentContext();
    expect(ctx).not.toContain("Time:");
    expect(ctx).toContain("Date:");
  });

  it("includes Timezone: line", () => {
    expect(buildEnvironmentContext()).toContain("Timezone:");
  });

  it("merges custom environment context keys", () => {
    const ctx = buildEnvironmentContext({ Agent: "cortex-desk", RunId: "abc123" });
    expect(ctx).toContain("Agent: cortex-desk");
    expect(ctx).toContain("RunId: abc123");
  });
});

describe("buildEnvironmentContext — time precision (control-first KV-cache knob)", () => {
  const PRIOR = process.env.RA_ENV_TIME_PRECISION;
  afterEach(() => {
    if (PRIOR === undefined) delete process.env.RA_ENV_TIME_PRECISION;
    else process.env.RA_ENV_TIME_PRECISION = PRIOR;
  });

  it("default (date): Date present, Time absent → stable prefix", () => {
    delete process.env.RA_ENV_TIME_PRECISION;
    const env = buildEnvironmentContext();
    expect(env).toContain("Date:");
    expect(env).not.toContain("Time:");
  });

  it("explicit param 'minute' restores the Time line (opt-in)", () => {
    const env = buildEnvironmentContext(undefined, "minute");
    expect(env).toContain("Time:");
  });

  it("RA_ENV_TIME_PRECISION=minute env override restores the Time line", () => {
    process.env.RA_ENV_TIME_PRECISION = "minute";
    const env = buildEnvironmentContext();
    expect(env).toContain("Time:");
  });

  it("explicit param wins over env (param 'date' + env 'minute' → no Time)", () => {
    process.env.RA_ENV_TIME_PRECISION = "minute";
    const env = buildEnvironmentContext(undefined, "date");
    expect(env).not.toContain("Time:");
  });
});
