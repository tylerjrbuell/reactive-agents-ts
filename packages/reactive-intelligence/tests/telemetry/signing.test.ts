import { describe, it, expect } from "bun:test";
import { signPayload } from "../../src/telemetry/signing.js";

describe("signPayload", () => {
  it("should produce consistent output for the same input", () => {
    const sig1 = signPayload('{"hello":"world"}');
    const sig2 = signPayload('{"hello":"world"}');
    expect(sig1).toBe(sig2);
  });

  it("should produce different output for different input", () => {
    const sig1 = signPayload('{"a":1}');
    const sig2 = signPayload('{"b":2}');
    expect(sig1).not.toBe(sig2);
  });

  it("should return a hex string", () => {
    const sig = signPayload("test-payload");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should return a 64-character string (SHA-256 = 32 bytes = 64 hex chars)", () => {
    const sig = signPayload("any content here");
    expect(sig.length).toBe(64);
  });
});
