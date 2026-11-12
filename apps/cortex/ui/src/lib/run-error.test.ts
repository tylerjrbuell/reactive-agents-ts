import { describe, expect, it } from "bun:test";
import { isOllamaAuthError, OLLAMA_AUTH_LINE, runErrorLine } from "./run-error.js";

describe("Ollama authentication failures", () => {
  const cloud401 = "LLM stream failed at iteration 0: ollama call failed (ollama:gpt-oss:120b): ollama request failed: 401 unauthorized";
  it("reads 'Ollama Cloud key missing or invalid' and points at Settings", () => {
    expect(isOllamaAuthError(cloud401)).toBe(true);
    expect(runErrorLine(cloud401)).toBe(OLLAMA_AUTH_LINE);
    expect(OLLAMA_AUTH_LINE.startsWith("Ollama Cloud key missing or invalid")).toBe(true);
    expect(OLLAMA_AUTH_LINE).toContain("Settings · Providers");
  });
  it("leaves other providers' 401s and other Ollama failures alone", () => {
    expect(isOllamaAuthError("anthropic request failed: 401 invalid x-api-key")).toBe(false);
    expect(isOllamaAuthError("ollama request failed: model not found")).toBe(false);
    expect(runErrorLine("anthropic request failed: 401 bad")).toContain("401 bad");
  });
});

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
