// Per-agent `numCtx` reaches reasoning's context-window readers as a per-call
// resolver option (`resolveCapability(p, m, { userNumCtx })`), never through
// the process-wide capability registry. v0.19.0 gate NO-GO: a global
// `registerUserSuppliedCapability` row leaked one agent's window into another.
// The ContextPressure-gauge half (makeObservableLLM) is pinned in the
// co-located src/kernel/observable-llm.test.ts, reusing its stub LLM.
import { beforeEach, describe, expect, it } from "bun:test";
import { _resetProbedRegistryForTesting, resolveCapability } from "@reactive-agents/llm-provider";
import { resolveContextWindow } from "../../src/kernel/utils/context-window-fallback.js";
import { resolveProfileWithWindow, tierFromRegistry } from "../../src/context/profile-resolver.js";
import { applyCapabilityMaxTokens, CONTEXT_PROFILES } from "../../src/context/context-profile.js";

const PROVIDER = "openai";
const FALLBACK_MODEL = "zz-proxy-model-numctx-8000";

beforeEach(() => {
  _resetProbedRegistryForTesting();
});

describe("precondition", () => {
  it("the model id resolves the conservative fallback with no registry row", () => {
    expect(resolveCapability(PROVIDER, FALLBACK_MODEL).source).toBe("fallback");
  });
});

describe("resolveContextWindow — per-agent userNumCtx", () => {
  it("userNumCtx 8000 on a fallback model id resolves 8000", () => {
    expect(resolveContextWindow(undefined, PROVIDER, FALLBACK_MODEL, 8000)).toBe(8000);
  });

  it("without userNumCtx the fallback model id stays unknown (0)", () => {
    expect(resolveContextWindow(undefined, PROVIDER, FALLBACK_MODEL)).toBe(0);
  });

  it("writes nothing process-wide: the next reader without it still sees fallback", () => {
    resolveContextWindow(undefined, PROVIDER, FALLBACK_MODEL, 8000);
    expect(resolveCapability(PROVIDER, FALLBACK_MODEL).source).toBe("fallback");
    expect(resolveContextWindow(undefined, PROVIDER, FALLBACK_MODEL)).toBe(0);
  });

  it("provider-set window still wins over userNumCtx", () => {
    expect(resolveContextWindow(4096, PROVIDER, FALLBACK_MODEL, 8000)).toBe(4096);
  });
});

describe("resolveProfileWithWindow / tierFromRegistry — per-agent userNumCtx", () => {
  it("userNumCtx 8000 binds the profile window to 8000", () => {
    const profile = resolveProfileWithWindow(FALLBACK_MODEL, PROVIDER, { userNumCtx: 8000 });
    expect(profile.maxTokens).toBe(8000);
  });

  it("without userNumCtx the profile window is the fallback recommendation", () => {
    const fallbackWindow = resolveCapability(PROVIDER, FALLBACK_MODEL).recommendedNumCtx;
    expect(fallbackWindow).not.toBe(8000);
    expect(resolveProfileWithWindow(FALLBACK_MODEL, PROVIDER).maxTokens).toBe(fallbackWindow);
  });

  it("the user row is a registry hit for tiering only when userNumCtx is passed", () => {
    expect(tierFromRegistry(FALLBACK_MODEL, PROVIDER)).toBeNull();
    expect(tierFromRegistry(FALLBACK_MODEL, PROVIDER, 8000)).not.toBeNull();
  });

  it("applyCapabilityMaxTokens: caller maxTokens still wins over userNumCtx", () => {
    const p = applyCapabilityMaxTokens(
      { ...CONTEXT_PROFILES.mid, maxTokens: 12_000 },
      PROVIDER,
      FALLBACK_MODEL,
      12_000,
      8000,
    );
    expect(p.maxTokens).toBe(12_000);
  });

  it("two agents on the same model id do not share a window", () => {
    const a = resolveProfileWithWindow(FALLBACK_MODEL, PROVIDER, { userNumCtx: 8000 });
    const b = resolveProfileWithWindow(FALLBACK_MODEL, PROVIDER);
    expect(a.maxTokens).toBe(8000);
    expect(b.maxTokens).not.toBe(8000);
  });
});
