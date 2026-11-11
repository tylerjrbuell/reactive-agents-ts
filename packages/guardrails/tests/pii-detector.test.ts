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

const run = (text: string) => Effect.runPromise(detectPii(text));

describe("PiiDetector — regex precision (false positives)", () => {
  it("does not flag a bare 9-digit number as an SSN", async () => {
    const result = await run("Order 482910375 shipped; population was 331000000.");
    expect(result.detected).toBe(false);
  });

  it("does not flag a 16-digit number that fails the Luhn check as a credit card", async () => {
    const result = await run("Tracking id 1234 5678 9012 3456 is in transit.");
    expect(result.detected).toBe(false);
  });
});

describe("PiiDetector — regex recall (false negatives and retained catches)", () => {
  it("still flags an undashed SSN when SSN context is present", async () => {
    for (const text of ["SSN: 123456789", "my social security number is 123456789"]) {
      const result = await run(text);
      expect(result.detected).toBe(true);
      expect(result.message).toContain("SSN");
    }
  });

  it("still flags a Luhn-valid 16-digit card with no separators", async () => {
    const result = await run("card 4111111111111111 exp 12/29");
    expect(result.detected).toBe(true);
    expect(result.message).toContain("Credit card");
    expect(result.severity).toBe("critical");
  });

  it("flags a 15-digit Amex number in its 4-6-5 grouping", async () => {
    const result = await run("Amex 3782 822463 10005");
    expect(result.detected).toBe(true);
    expect(result.message).toContain("Credit card");
  });

  it("flags an international phone number", async () => {
    const result = await run("Call our London office on +44 20 7946 0958.");
    expect(result.detected).toBe(true);
    expect(result.message).toContain("Phone number");
  });

  it("still flags a US phone number", async () => {
    const result = await run("Call (555) 123-4567 today");
    expect(result.detected).toBe(true);
    expect(result.message).toContain("Phone number");
  });

  it("flags UK postcodes whose outward code ends in a letter", async () => {
    for (const text of ["Send it to SW1A 1AA", "Office at EC1A 1BB", "BBC, W1A 0AX"]) {
      const result = await run(text);
      expect(result.detected).toBe(true);
      expect(result.message).toContain("UK postcode");
    }
  });
});
