import { describe, it, expect } from "bun:test";
import { makeRunId, defaultCortexConfig } from "../types.js";

describe("Cortex types / config", () => {
  it("makeRunId returns a UUID-shaped branded string", () => {
    const id = makeRunId();
    expect(typeof id).toBe("string");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("defaultCortexConfig has expected defaults", () => {
    expect(defaultCortexConfig.port).toBe(4321);
    expect(defaultCortexConfig.dbPath).toBe(".cortex/cortex.db");
    expect(defaultCortexConfig.openBrowser).toBe(true);
    expect(defaultCortexConfig.staticAssetsPath).toBeUndefined();
  });
});
