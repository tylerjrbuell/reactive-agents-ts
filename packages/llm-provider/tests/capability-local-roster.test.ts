// Run: bun test packages/llm-provider/tests/capability-local-roster.test.ts --timeout 15000
//
// Local-model campaign roster (2026-11-13): every tag must resolve through the
// static table (no fallback) so bench preflight does not mark them INCONCLUSIVE.
import { describe, it, expect } from "bun:test";
import { resolveCapability } from "../src/capability-resolver.js";

const ROSTER = [
  "llama3.1:latest",
  "llama3.2:3b",
  "gemma4:e4b",
  "gemma4:12b",
  "granite4:tiny-h",
  "granite3.3:latest",
  "qwen2.5:14b",
  "deepseek-r1:14b",
  "mimo-v2.6:latest",
  "ornith:latest",
  "phi4-mini-reasoning:latest",
] as const;

describe("local-model campaign roster capabilities", () => {
  for (const tag of ROSTER) {
    it(`ollama/${tag} resolves from the static table`, () => {
      const cap = resolveCapability("ollama", tag);
      expect(cap.source).toBe("static-table");
      expect(cap.model).toBe(tag);
      expect(cap.toolCallDialect).toBe("native-fc");
      expect(cap.recommendedNumCtx).toBeLessThanOrEqual(32_768);
      expect(cap.recommendedNumCtx).toBeLessThanOrEqual(cap.maxContextTokens);
    });
  }
});
