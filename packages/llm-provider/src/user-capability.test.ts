// Run: bun test packages/llm-provider/src/user-capability.test.ts
//
// `.withModel({ model, numCtx })` is the caller stating the model's context
// window. Until now the capability layer ignored it: if the live probe could not
// run (air-gapped host, a gateway that doesn't expose /api/show, an endpoint
// typo) the model still resolved at the conservative 2048-token
// `source: "fallback"` entry — which `.withStrictValidation()` then failed the
// build over, telling the user to edit STATIC_CAPABILITIES in the framework.
// The user had already supplied the missing fact.
import { describe, it, expect, beforeEach } from "bun:test";
import {
  resolveCapability,
  _resetProbedRegistryForTesting,
  registerProbedCapability,
} from "./capability-resolver.js";
import { registerUserSuppliedCapability } from "./user-capability.js";
import { registerReportedModelMetadata, _resetReportedMetadataForTesting } from "./capability-reported.js";

const MODEL = "ghost-model:1b";

beforeEach(() => {
  _resetProbedRegistryForTesting();
  _resetReportedMetadataForTesting();
});

describe("registerUserSuppliedCapability", () => {
  it("lifts a model off the 2048 fallback using the caller's numCtx", () => {
    expect(resolveCapability("ollama", MODEL).source).toBe("fallback");

    registerUserSuppliedCapability("ollama", MODEL, 8192);

    const cap = resolveCapability("ollama", MODEL);
    expect(cap.recommendedNumCtx).toBe(8192);
    expect(cap.maxContextTokens).toBe(8192);
    // Not "probe": nothing was probed. The honesty gate accepts anything that
    // is not "fallback", so the build proceeds without the source lying.
    expect(cap.source).toBe("user");
  });

  it("does not claim a tool dialect the caller never asserted", () => {
    registerUserSuppliedCapability("ollama", MODEL, 8192);
    // The caller told us the window, not that the model speaks native FC.
    expect(resolveCapability("ollama", MODEL).toolCallDialect).toBe("none");
  });

  it("never overwrites a live probe — the probe knows more", () => {
    registerProbedCapability({
      ...resolveCapability("ollama", MODEL),
      recommendedNumCtx: 32_768,
      maxContextTokens: 32_768,
      toolCallDialect: "native-fc",
      source: "probe",
    });

    registerUserSuppliedCapability("ollama", MODEL, 8192);

    const cap = resolveCapability("ollama", MODEL);
    expect(cap.source).toBe("probe");
    expect(cap.recommendedNumCtx).toBe(32_768);
  });

  it("never overwrites a static-table row", () => {
    registerUserSuppliedCapability("anthropic", "claude-haiku-4-5", 8192);

    const cap = resolveCapability("anthropic", "claude-haiku-4-5");
    expect(cap.source).toBe("static-table");
    expect(cap.recommendedNumCtx).toBe(200_000);
  });

  it("DOES override an inferred row, keeping the inferred dialect and thinking", () => {
    // A discovered hosted model (no probe, no static row) carries the
    // provider-reported shape. The caller's numCtx is a better window than the
    // reported one, and the dialect/thinking facts are worth keeping.
    registerReportedModelMetadata("openai", "gpt-6-sol", {
      maxContextTokens: 200_000,
      supportsThinkingMode: true,
    });
    expect(resolveCapability("openai", "gpt-6-sol").source).toBe("inferred");

    registerUserSuppliedCapability("openai", "gpt-6-sol", 400_000);

    const cap = resolveCapability("openai", "gpt-6-sol");
    expect(cap.source).toBe("user");
    expect(cap.maxContextTokens).toBe(400_000);
    expect(cap.recommendedNumCtx).toBe(400_000);
    expect(cap.toolCallDialect).toBe("native-fc");
    expect(cap.supportsThinkingMode).toBe(true);
    expect(cap.chatToolsRequireNoReasoning).toBe(true);
  });

  it("refuses to override a row the caller already registered", () => {
    registerUserSuppliedCapability("openai", "gpt-6-luna", 300_000);
    registerUserSuppliedCapability("openai", "gpt-6-luna", 12_000);

    const cap = resolveCapability("openai", "gpt-6-luna");
    expect(cap.source).toBe("user");
    expect(cap.recommendedNumCtx).toBe(300_000);
  });

  it("ignores a non-positive window rather than registering nonsense", () => {
    registerUserSuppliedCapability("ollama", MODEL, 0);
    expect(resolveCapability("ollama", MODEL).source).toBe("fallback");
  });
});
