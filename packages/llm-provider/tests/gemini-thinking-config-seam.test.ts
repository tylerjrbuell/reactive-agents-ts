// Run: bun test packages/llm-provider/tests/gemini-thinking-config-seam.test.ts --timeout 15000
//
// Cortex trace 01M7T8MNTKB5BHP9100MBPY9GT: code-action on gemma-4-26b-a4b-it
// via the gemini provider failed with "Thinking budget is not supported for
// this model." Gemma ids now resolve supportsThinkingMode=false, the config
// builder omits thinkingConfig for them, and a thinking-field rejection is
// retried once without it (gemini-thinking-fallback.ts).

import { afterEach, describe, expect, it } from "bun:test";
import { resolveCapability } from "../src/capability-resolver.js";
import {
  _resetReportedMetadataForTesting,
  registerReportedModelMetadata,
} from "../src/capability-reported.js";
import { buildGenerationConfig } from "../src/providers/gemini.js";
import {
  isThinkingConfigRejection,
  makeThinkingConfigFallback,
  type GeminiGenerationConfig,
  type ThinkingConfigRetry,
} from "../src/providers/gemini-thinking-fallback.js";

const REJECTION = {
  message:
    '{"error":{"code":400,"message":"Thinking budget is not supported for this model.","status":"INVALID_ARGUMENT"}}',
};

afterEach(() => _resetReportedMetadataForTesting());

describe("Gemma capability on the Gemini provider", () => {
  it("gemma-4-26b-a4b-it resolves without thinking and with the gemma-4 window", () => {
    const cap = resolveCapability("gemini", "gemma-4-26b-a4b-it");
    expect(cap.supportsThinkingMode).toBe(false);
    expect(cap.source).toBe("inferred");
    expect(cap.recommendedNumCtx).toBe(262_144);
    expect(cap.maxOutputTokens).toBe(32_768);
    expect(cap.toolCallDialect).toBe("native-fc");
  });

  it("other gemma generations get the conservative window, still no thinking", () => {
    const cap = resolveCapability("gemini", "models/gemma-3-27b-it");
    expect(cap.supportsThinkingMode).toBe(false);
    expect(cap.recommendedNumCtx).toBe(32_768);
  });

  it("listing metadata claiming thinking:true does not turn thinking on for gemma", () => {
    registerReportedModelMetadata("gemini", "gemma-4-26b-a4b-it", {
      maxContextTokens: 262_144,
      maxOutputTokens: 32_768,
      supportsThinkingMode: true,
    });
    const cap = resolveCapability("gemini", "gemma-4-26b-a4b-it");
    expect(cap.supportsThinkingMode).toBe(false);
    expect(cap.recommendedNumCtx).toBe(262_144);
  });

  it("image/tts/embedding ids without metadata resolve without thinking", () => {
    for (const id of ["gemini-2.5-flash-image", "gemini-2.5-flash-preview-tts", "gemini-embedding-001"]) {
      expect(resolveCapability("gemini", id).supportsThinkingMode).toBe(false);
    }
  });
});

describe("buildGenerationConfig thinkingConfig gate", () => {
  it("gemma request body carries no thinkingConfig, even with thinking opted in", () => {
    for (const thinking of [undefined, false, true]) {
      const cfg = buildGenerationConfig({ model: "gemma-4-26b-a4b-it", maxTokens: 1000 }, thinking, undefined);
      expect(cfg.thinkingConfig).toBeUndefined();
      expect(cfg.maxOutputTokens).toBe(1000);
    }
  });

  it("thinking-capable models still get thinkingBudget 0 when thinking is off", () => {
    const cfg = buildGenerationConfig({ model: "gemini-2.5-pro", maxTokens: 1000 }, undefined, undefined);
    expect(cfg.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });
});

describe("thinking-config fallback seam", () => {
  const withThinking: GeminiGenerationConfig = { maxOutputTokens: 100, thinkingConfig: { thinkingBudget: 0 } };

  it("matches the live rejection message and nothing broader", () => {
    expect(isThinkingConfigRejection(REJECTION)).toBe(true);
    expect(isThinkingConfigRejection({ message: "thinking_config is not supported" })).toBe(true);
    expect(isThinkingConfigRejection({ message: "API key not valid" })).toBe(false);
    expect(isThinkingConfigRejection({ message: "Function calling is not enabled for this model." })).toBe(false);
  });

  it("retries once without thinkingConfig, records it, then skips the field up front", async () => {
    const retries: ThinkingConfigRetry[] = [];
    const fallback = makeThinkingConfigFallback((r) => retries.push(r));
    const sent: GeminiGenerationConfig[] = [];
    const send = (cfg: GeminiGenerationConfig): Promise<string> => {
      sent.push(cfg);
      return cfg.thinkingConfig === undefined ? Promise.resolve("ok") : Promise.reject(REJECTION);
    };

    expect(await fallback.run("m", withThinking, send)).toBe("ok");
    expect(sent.map((c) => c.thinkingConfig)).toEqual([{ thinkingBudget: 0 }, undefined]);
    expect(sent[1]?.maxOutputTokens).toBe(100);
    expect(retries).toEqual([{ provider: "gemini", model: "m", reason: REJECTION.message }]);

    expect(await fallback.run("m", withThinking, send)).toBe("ok");
    expect(sent.length).toBe(3);
    expect(sent[2]?.thinkingConfig).toBeUndefined();
    expect(retries.length).toBe(1);
  });

  it("does not retry other errors or configs without thinkingConfig", async () => {
    const retries: ThinkingConfigRetry[] = [];
    const fallback = makeThinkingConfigFallback((r) => retries.push(r));
    let calls = 0;
    const failing = (): Promise<string> => {
      calls += 1;
      return Promise.reject({ message: "quota exceeded" });
    };
    await expect(fallback.run("m", withThinking, failing)).rejects.toEqual({ message: "quota exceeded" });
    expect(calls).toBe(1);

    calls = 0;
    const rejectsThinking = (): Promise<string> => {
      calls += 1;
      return Promise.reject(REJECTION);
    };
    await expect(fallback.run("m2", { maxOutputTokens: 1 }, rejectsThinking)).rejects.toEqual(REJECTION);
    expect(calls).toBe(1);
    expect(retries.length).toBe(0);
  });

  it("retries at most once: a second rejection surfaces", async () => {
    const fallback = makeThinkingConfigFallback(() => undefined);
    let calls = 0;
    const send = (): Promise<string> => {
      calls += 1;
      return Promise.reject(REJECTION);
    };
    await expect(fallback.run("m", withThinking, send)).rejects.toEqual(REJECTION);
    expect(calls).toBe(2);
  });
});
