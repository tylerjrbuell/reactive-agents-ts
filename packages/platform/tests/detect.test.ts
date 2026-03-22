import { afterEach, describe, expect, it } from "bun:test";
import { detectRuntime, getPlatform, resetPlatform, setPlatform } from "../src/detect.js";
import type { PlatformAdapters } from "../src/types.js";

describe("detectRuntime", () => {
  it("returns 'bun' when running under Bun", () => {
    expect(detectRuntime()).toBe("bun");
  });
});

describe("getPlatform", () => {
  afterEach(() => {
    resetPlatform();
  });

  it("returns valid PlatformAdapters bundle", async () => {
    const platform = await getPlatform();
    expect(platform.runtime).toBe("bun");
    expect(typeof platform.database).toBe("function");
    expect(typeof platform.process.spawn).toBe("function");
    expect(typeof platform.process.exec).toBe("function");
    expect(typeof platform.server.serve).toBe("function");
  });

  it("caches the platform instance on repeated calls", async () => {
    const p1 = await getPlatform();
    const p2 = await getPlatform();
    expect(p1).toBe(p2);
  });
});

describe("setPlatform", () => {
  afterEach(() => {
    resetPlatform();
  });

  it("overrides auto-detected platform", async () => {
    const mock: PlatformAdapters = {
      runtime: "node",
      database: () => ({}) as ReturnType<PlatformAdapters["database"]>,
      process: {} as PlatformAdapters["process"],
      server: {} as PlatformAdapters["server"],
    };
    setPlatform(mock);
    const p = await getPlatform();
    expect(p.runtime).toBe("node");
    expect(p).toBe(mock);
  });
});

describe("resetPlatform", () => {
  afterEach(() => {
    resetPlatform();
  });

  it("clears the cached platform so next call re-detects", async () => {
    const p1 = await getPlatform();
    resetPlatform();
    const p2 = await getPlatform();
    // Both should be valid Bun platforms but are distinct instances
    expect(p1.runtime).toBe("bun");
    expect(p2.runtime).toBe("bun");
    expect(p1).not.toBe(p2);
  });
});
