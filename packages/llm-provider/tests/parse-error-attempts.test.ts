import { describe, it, expect } from "bun:test";
import { LLMParseError, type ParseAttemptError } from "../src/errors.js";

describe("LLMParseError attempts accumulation (HS-16 / #75)", () => {
  it("carries an attempts[] history when constructed with it", () => {
    const attempts: ParseAttemptError[] = [
      { attempt: 0, error: new Error("first parse failed: unexpected token") },
      { attempt: 1, error: new Error("second parse failed: schema mismatch") },
      { attempt: 2, error: "third parse failed: raw string" },
    ];

    const err = new LLMParseError({
      message: "Failed to parse structured output after 3 attempts",
      rawOutput: "third parse failed: raw string",
      expectedSchema: "<schema-stringified>",
      attempts,
    });

    expect(err.attempts).toBeDefined();
    expect(err.attempts!.length).toBe(3);
    expect(err.attempts![0]!.attempt).toBe(0);
    expect(err.attempts![2]!.error).toBe("third parse failed: raw string");
    // back-compat: rawOutput still surfaces final attempt verbatim
    expect(err.rawOutput).toContain("third parse failed");
  });

  it("attempts is optional — back-compat with pre-HS-16 construction", () => {
    const err = new LLMParseError({
      message: "Failed to parse",
      rawOutput: "garbage",
      expectedSchema: "<schema>",
    });
    expect(err.attempts).toBeUndefined();
    expect(err.rawOutput).toBe("garbage");
  });

  it("ParseAttemptError accepts any unknown error shape", () => {
    const attempts: ParseAttemptError[] = [
      { attempt: 0, error: { _tag: "ParseError", message: "schema fail" } },
      { attempt: 1, error: null },
      { attempt: 2, error: 42 },
    ];
    const err = new LLMParseError({
      message: "x",
      rawOutput: "x",
      expectedSchema: "x",
      attempts,
    });
    expect(err.attempts!.map((a) => a.attempt)).toEqual([0, 1, 2]);
  });
});
