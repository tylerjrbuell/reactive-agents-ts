import { describe, it, expect } from "bun:test";
import { getOrCreateInstallId } from "../../src/telemetry/install-id.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("getOrCreateInstallId", () => {
  it("should return a valid UUID string", () => {
    const id = getOrCreateInstallId();
    expect(typeof id).toBe("string");
    expect(id).toMatch(UUID_REGEX);
  });

  it("should return the same ID on subsequent calls", () => {
    const id1 = getOrCreateInstallId();
    const id2 = getOrCreateInstallId();
    expect(id1).toBe(id2);
  });
});
