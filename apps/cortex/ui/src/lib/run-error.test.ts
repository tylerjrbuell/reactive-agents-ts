import { describe, expect, it } from "bun:test";
import { runErrorLine } from "./run-error.js";

/** The cause observed live (2026-11-10) on a failed Anthropic chat turn. */
const PROVIDER_ERROR =
  "LLM stream failed at iteration 0: anthropic call failed (anthropic:claude-sonnet-4-6): anthropic request failed: 400 Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";

describe("runErrorLine", () => {
  it("keeps the provider's message from the observed failure", () => {
    expect(runErrorLine(PROVIDER_ERROR)).toContain("400 Your credit balance is too low to access the Anthropic API");
  });
  it("keeps only the first non-blank line", () => {
    expect(runErrorLine("\n  boom \n    at stack (x.ts:1)")).toBe("boom");
  });
  it("redacts credential-shaped tokens", () => {
    const out = runErrorLine("401 bad key sk-ant-api03-ABCDEFGHIJKL; Authorization: Bearer abcdefghijklmnop; url https://x/v1?key=AIzaSECRETSECRETSECRETSECRET&alt=sse")!;
    expect(out).not.toContain("ABCDEFGHIJKL");
    expect(out).not.toContain("abcdefghijklmnop");
    expect(out).not.toContain("SECRET");
    expect(out).toContain("Bearer [redacted]");
    expect(out).toContain("?key=[redacted]&alt=sse");
  });
  it("caps a long line", () => {
    const out = runErrorLine("x".repeat(1_000))!;
    expect(out.length).toBe(280);
    expect(out.endsWith("…")).toBe(true);
  });
  it("is undefined for blank or non-string input", () => {
    expect(runErrorLine("  \n ")).toBeUndefined();
    expect(runErrorLine(undefined)).toBeUndefined();
    expect(runErrorLine({ message: "x" })).toBeUndefined();
  });
});
