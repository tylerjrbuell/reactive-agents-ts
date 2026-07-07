// Run: bun test packages/llm-provider/tests/params-cloud-timeout.test.ts
//
// F4 — resolveCloudTimeoutMs: single resolution chain replacing the eight
// hardcoded 120s literals in anthropic/openai/gemini/litellm complete().
// Chain mirrors resolveLocalTimeoutMs (providers/local.ts).

import { describe, it, expect } from "bun:test";
import {
  DEFAULT_CLOUD_TIMEOUT_MS,
  resolveCloudTimeoutMs,
} from "../src/params/cloud-timeout.js";

describe("resolveCloudTimeoutMs", () => {
  it("defaults to the named 120s constant when nothing is configured", () => {
    expect(DEFAULT_CLOUD_TIMEOUT_MS).toBe(120_000);
    expect(resolveCloudTimeoutMs({}, {})).toBe(120_000);
  });

  it("config.cloudTimeoutMs overrides the default", () => {
    expect(resolveCloudTimeoutMs({}, { cloudTimeoutMs: 240_000 })).toBe(240_000);
  });

  it("request.timeoutMs outranks config.cloudTimeoutMs", () => {
    expect(
      resolveCloudTimeoutMs(
        { timeoutMs: 15_000 },
        { cloudTimeoutMs: 240_000 },
      ),
    ).toBe(15_000);
  });
});
