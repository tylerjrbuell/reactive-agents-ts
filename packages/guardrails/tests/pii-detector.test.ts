import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { detectPii } from "../src/detectors/pii-detector.js";

describe("PiiDetector", () => {
  it("should detect SSN", async () => {
    const result = await Effect.runPromise(
      detectPii("My SSN is 123-45-6789"),
    );
    expect(result.detected).toBe(true);
    expect(result.severity).toBe("critical");
    expect(result.message).toContain("SSN");
  });

  it("should detect email addresses", async () => {
    const result = await Effect.runPromise(
      detectPii("Contact me at user@example.com for details"),
    );
    expect(result.detected).toBe(true);
    expect(result.message).toContain("Email");
  });

  it("should detect credit card numbers", async () => {
    const result = await Effect.runPromise(
      detectPii("Card number: 4111 1111 1111 1111"),
    );
    expect(result.detected).toBe(true);
    expect(result.severity).toBe("critical");
  });

  it("should detect API keys", async () => {
    const result = await Effect.runPromise(
      detectPii("key: sk-1234567890abcdefghijklmnop"),
    );
    expect(result.detected).toBe(true);
    expect(result.severity).toBe("critical");
  });

  it("should pass safe text", async () => {
    const result = await Effect.runPromise(
      detectPii("The quick brown fox jumps over the lazy dog"),
    );
    expect(result.detected).toBe(false);
  });
});
