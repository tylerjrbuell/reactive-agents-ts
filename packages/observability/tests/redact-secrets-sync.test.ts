// Run: bun test packages/observability/tests/redact-secrets-sync.test.ts --timeout 15000
//
// F8 — sync redactor used at non-Effect content boundaries (OTel span
// setAttribute, Cortex WebSocket payloads) so secrets don't leave the machine.
import { describe, test, expect } from "bun:test";
import { redactSecrets, defaultRedactors } from "../src/index.js";

describe("F8 — redactSecrets (sync)", () => {
  test("redacts provider keys and bearer tokens", () => {
    const key = "sk-ant-api03-" + "A".repeat(95);
    const opaqueToken = "abc123DEF456ghi789JKL012mno";
    const bearer = `Bearer ${opaqueToken}`;
    const out = redactSecrets(
      JSON.stringify({ prompt: `use ${key}`, headers: bearer }),
      defaultRedactors,
    );
    expect(out).not.toContain(key);
    expect(out).not.toContain(opaqueToken);
    expect(out).toContain("[redacted-anthropic-key]");
    expect(out).toContain("Bearer [redacted]");
  });

  test("leaves non-secret content untouched", () => {
    const out = redactSecrets("the tool returned 42 rows", defaultRedactors);
    expect(out).toBe("the tool returned 42 rows");
  });
});
