import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeNoticesManager } from "../../src/logging/notices-manager.js";

describe("NoticesManager", () => {
  const savedSuppressNotices = process.env.REACTIVE_AGENTS_SUPPRESS_NOTICES;

  beforeEach(() => {
    delete process.env.REACTIVE_AGENTS_SUPPRESS_NOTICES;
  });

  afterEach(() => {
    if (savedSuppressNotices === undefined) {
      delete process.env.REACTIVE_AGENTS_SUPPRESS_NOTICES;
    } else {
      process.env.REACTIVE_AGENTS_SUPPRESS_NOTICES = savedSuppressNotices;
    }
  });

  it("shows a notice only once per session", () => {
    const manager = makeNoticesManager();

    const notice1 = manager.shouldShow("telemetry-enabled");
    expect(notice1).toBe(true);

    const notice2 = manager.shouldShow("telemetry-enabled");
    expect(notice2).toBe(false);
  });

  it("distinguishes between different notice types", () => {
    const manager = makeNoticesManager();

    const telemetry = manager.shouldShow("telemetry-enabled");
    const strategyDisabled = manager.shouldShow("strategy-switching-disabled");

    expect(telemetry).toBe(true);
    expect(strategyDisabled).toBe(true);
  });

  it("returns false after notice dismissed", () => {
    const manager = makeNoticesManager();

    const before = manager.shouldShow("telemetry-enabled");
    expect(before).toBe(true);

    manager.dismiss("telemetry-enabled");

    const after = manager.shouldShow("telemetry-enabled");
    expect(after).toBe(false);
  });

  it("resets all notices on new session", () => {
    const manager = makeNoticesManager();

    manager.shouldShow("telemetry-enabled");
    manager.reset();

    const after = manager.shouldShow("telemetry-enabled");
    expect(after).toBe(true);
  });
});
