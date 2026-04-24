// Run: bun test packages/observability/tests/redaction.test.ts --timeout 15000
//
// S0.3 — default log redactor. Proves zero-leakage on a known-secrets corpus
// and validates the composition contract (defaults + user-supplied patterns).

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  applyRedactors,
  defaultRedactors,
  type Redactor,
} from "../src/redaction/index.js";
import fixtures from "./fixtures/known-secrets.json" with { type: "json" };

describe("default redactor (S0.3)", () => {
  it("redacts every known secret pattern (per-fixture)", async () => {
    for (const [name, secret] of Object.entries(fixtures)) {
      const message = `User token (${name}): ${secret} appended at end`;
      const redacted = await Effect.runPromise(
        applyRedactors(message, defaultRedactors),
      );
      expect(redacted).not.toContain(secret);
      expect(redacted).toMatch(/\[redacted-/);
    }
  }, 15000);

  it("preserves surrounding content", async () => {
    const msg = `User 'alice' logged in with token ${fixtures.github_pat} at 12:00:01`;
    const redacted = await Effect.runPromise(
      applyRedactors(msg, defaultRedactors),
    );
    expect(redacted).toContain("User 'alice' logged in");
    expect(redacted).toContain("at 12:00:01");
    expect(redacted).toContain("[redacted-github-token]");
  }, 15000);

  it("zero-leakage corpus assertion", async () => {
    const corpus = Object.values(fixtures).join("\n");
    const redacted = await Effect.runPromise(
      applyRedactors(corpus, defaultRedactors),
    );
    for (const secret of Object.values(fixtures)) {
      expect(redacted).not.toContain(secret);
    }
  }, 15000);

  it("custom redactors compose with defaults", async () => {
    const custom: Redactor = {
      name: "internal-key",
      pattern: /internal-\w+/g,
      replacement: "[redacted-internal]",
    };
    const msg = `key: internal-abc123, ${fixtures.github_pat}`;
    const redacted = await Effect.runPromise(
      applyRedactors(msg, [...defaultRedactors, custom]),
    );
    expect(redacted).toContain("[redacted-internal]");
    expect(redacted).toContain("[redacted-github-token]");
  }, 15000);

  it("returns input unchanged when no patterns match", async () => {
    const msg = "no secrets here, just lowercase ascii words";
    const redacted = await Effect.runPromise(
      applyRedactors(msg, defaultRedactors),
    );
    expect(redacted).toBe(msg);
  }, 15000);

  it("longer-prefix patterns (anthropic) redact before shorter overlapping ones (openai-legacy)", async () => {
    // Anthropic keys start with `sk-ant-api03-...`; OpenAI legacy uses `sk-...`.
    // The default ordering must place anthropic BEFORE openai-legacy so the
    // anthropic replacement tag appears (not partial-match by the openai rule).
    const msg = `token: ${fixtures.anthropic}`;
    const redacted = await Effect.runPromise(
      applyRedactors(msg, defaultRedactors),
    );
    expect(redacted).toContain("[redacted-anthropic-key]");
    expect(redacted).not.toContain("[redacted-openai-key]");
  }, 15000);
});
