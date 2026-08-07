import { describe, it, expect } from "bun:test";
import { ToolExecutionError, toToolError } from "../src/errors.js";

describe("toToolError", () => {
  it("uses the Error's `.message`, not its `.toString()` (no double 'Error:' prefix)", () => {
    const build = toToolError("file-write", "File write");
    const err = build(new Error("ENOENT: no such file or directory"));

    expect(err).toBeInstanceOf(ToolExecutionError);
    expect(err.message).toBe(
      "File write failed: ENOENT: no such file or directory",
    );
    expect(err.message).not.toContain("Error: Error:");
  });

  it("uses a string thrown-value directly", () => {
    const build = toToolError("http-get", "HTTP GET");
    const err = build("connection refused");

    expect(err.message).toBe("HTTP GET failed: connection refused");
  });

  it("falls back to String(e) for non-Error, non-string values", () => {
    const build = toToolError("crypto-price", "Crypto price lookup");
    const err = build({ code: 500 });

    expect(err.message).toBe("Crypto price lookup failed: [object Object]");
  });

  it("sets toolName and cause correctly", () => {
    const cause = new Error("boom");
    const build = toToolError("web-search", "Web search");
    const err = build(cause);

    expect(err.toolName).toBe("web-search");
    expect(err.cause).toBe(cause);
  });
});
