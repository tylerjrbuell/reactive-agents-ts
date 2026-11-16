// Run: bun run repo test apps/cortex/server/tests/cortex-auto-shadow.test.ts
//
// Judgment unchecked must mean no judgment traffic. The framework's `build()` auto-enables an
// observation-only Ollama judgment backend when a local Ollama answers /api/tags, unless
// REACTIVE_AGENTS_NO_AUTO_SHADOW=1 (packages/runtime/src/builder/build/build-agent.ts). That
// fanned out thousands of POST /v1/systemone calls (about a third failed) against the same
// Ollama the chat turn uses. Cortex opts out at startup; an explicit user value still wins.
import { describe, expect, it } from "bun:test";
import { applyCortexProcessDefaults } from "../env-config.js";

describe("applyCortexProcessDefaults", () => {
  it("opts out of framework auto-shadow judgment when the variable is unset", () => {
    const env: Record<string, string | undefined> = {};
    applyCortexProcessDefaults(env);
    expect(env.REACTIVE_AGENTS_NO_AUTO_SHADOW).toBe("1");
  });
  it("keeps an explicit user value", () => {
    const env: Record<string, string | undefined> = { REACTIVE_AGENTS_NO_AUTO_SHADOW: "0" };
    applyCortexProcessDefaults(env);
    expect(env.REACTIVE_AGENTS_NO_AUTO_SHADOW).toBe("0");
  });
});
