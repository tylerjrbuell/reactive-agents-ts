// Run: bun test packages/reasoning/tests/context/registry-first-tiering.test.ts --timeout 15000
/**
 * W2b — Registry-first tiering classification matrix (Review Focus #3).
 *
 * Design law #1: ONE capability arbiter. `resolveProfileWithWindow` (the
 * builder's auto-resolution seam) must tier by the Capability registry
 * (static table row OR probe row — persisted probe rows reach the sync
 * registry through the builder's prime, see local-probe store-first) BEFORE
 * any name-regex; the ollama `/(\d+)b/` size-regex branch is DELETED (the
 * qwen3:1.7b → "7b" → mid and qwen3:4b → mid bugs die by removal).
 * Registry miss ⇒ provisional name regex, marked `provisionalTier: true`.
 *
 * No live calls: the probe-row arms use the exported write-through +
 * test-reset seams on the process-wide registry.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  registerProbedCapability,
  _resetProbedRegistryForTesting,
  resolveCapability,
  type Capability,
} from "@reactive-agents/llm-provider";
import { resolveProfileWithWindow, resolveProfile } from "../../src/context/profile-resolver.js";

function probedRow(
  model: string,
  tier: Capability["tier"],
  nominal?: boolean,
): Capability {
  return {
    provider: "ollama",
    model,
    tier,
    maxContextTokens: 32_768,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "none",
    ...(nominal ? { nominal: true } : {}),
    source: "probe",
  };
}

beforeEach(() => {
  // Isolate the process-wide probe registry between arms.
  _resetProbedRegistryForTesting();
});

// ── Registry HIT arms: static rows decide the tier, regex never consulted ───

describe("W2b registry-first tiering — static-table rows", () => {
  it("qwen3:4b (ollama) → LOCAL from the registry (the flagship bug: regex said mid)", () => {
    const p = resolveProfileWithWindow("qwen3:4b", "ollama");
    expect(p.tier).toBe("local");
    // Registry hit ⇒ NOT provisional.
    expect(p.provisionalTier).toBeUndefined();
    // Window binding unchanged: still the row's recommendedNumCtx.
    expect(p.maxTokens).toBe(resolveCapability("ollama", "qwen3:4b").recommendedNumCtx);
  }, 15000);

  it("qwen3:14b + cogito:14b (ollama) → local (every registry-known ollama model obeys the arbiter)", () => {
    expect(resolveProfileWithWindow("qwen3:14b", "ollama").tier).toBe("local");
    expect(resolveProfileWithWindow("cogito:14b", "ollama").tier).toBe("local");
  }, 15000);

  it("'ollama:qwen3:4b' prefix form (no provider arg) → provider inferred, registry hit → local", () => {
    const p = resolveProfileWithWindow("ollama:qwen3:4b");
    expect(p.tier).toBe("local");
    expect(p.provisionalTier).toBeUndefined();
  }, 15000);

  it("'ollama/qwen3:4b' slash-prefixed model with provider=ollama → normalized, registry hit → local", () => {
    const p = resolveProfileWithWindow("ollama/qwen3:4b", "ollama");
    expect(p.tier).toBe("local");
  }, 15000);

  it("cloud registry hit (anthropic haiku) → tier equals the row's tier, never provisional", () => {
    const model = "claude-haiku-4-5-20251001";
    const p = resolveProfileWithWindow(model, "anthropic");
    expect(p.tier).toBe(resolveCapability("anthropic", model).tier);
    expect(p.provisionalTier).toBeUndefined();
  }, 15000);
});

// ── Probe-row arms: persisted/live probe rows reach the sync registry ───────

describe("W2b registry-first tiering — probe rows", () => {
  it("probe row (source 'probe') decides tier over any regex outcome", () => {
    registerProbedCapability(probedRow("tinygpt:7b", "local"));
    const p = resolveProfileWithWindow("tinygpt:7b", "ollama");
    // Regex (pre-W2b) would call any :7b model mid; the arbiter says local.
    expect(p.tier).toBe("local");
    expect(p.provisionalTier).toBeUndefined();
  }, 15000);

  it("probe row WINS over the static row (registry tier order: probe → static)", () => {
    registerProbedCapability(probedRow("qwen3:4b", "mid"));
    const p = resolveProfileWithWindow("qwen3:4b", "ollama");
    expect(p.tier).toBe("mid");
    expect(p.provisionalTier).toBeUndefined();
  }, 15000);
});

// ── Registry-MISS arms: provisional regex, marked; size regex never consulted ──

describe("W2b registry-first tiering — registry miss → provisional regex", () => {
  it("qwen3:1.7b (decimal, no row) → provisional fallback 'mid'; the '7b' inside '1.7b' can no longer flip anything (size regex deleted)", () => {
    const p = resolveProfileWithWindow("qwen3:1.7b", "ollama");
    expect(p.tier).toBe("mid");
    expect(p.provisionalTier).toBe(true);
  }, 15000);

  it("unregistered small tag myco:2b → mid + provisional (the ≤3 size heuristic is GONE; the live probe row restores local in real flows)", () => {
    const p = resolveProfileWithWindow("myco:2b", "ollama");
    expect(p.tier).toBe("mid");
    expect(p.provisionalTier).toBe(true);
  }, 15000);

  it("llama3.2:latest (tag form, no row) → mid + provisional", () => {
    const p = resolveProfileWithWindow("llama3.2:latest", "ollama");
    expect(p.tier).toBe("mid");
    expect(p.provisionalTier).toBe(true);
  }, 15000);

  it("cloud registry miss (openai gpt-6) → provider-pattern regex decides, marked provisional", () => {
    const p = resolveProfileWithWindow("gpt-6-mini", "openai");
    expect(p.tier).toBe("mid");
    expect(p.provisionalTier).toBe(true);
  }, 15000);

  it("garbage model string with provider → conservative mid + provisional", () => {
    const p = resolveProfileWithWindow("!!!weird###", "ollama");
    expect(p.tier).toBe("mid");
    expect(p.provisionalTier).toBe(true);
  }, 15000);

  it("no provider at all → registry unconsultable → regex path, marked provisional", () => {
    const p = resolveProfileWithWindow("mistral-7b");
    expect(p.tier).toBe("mid");
    expect(p.provisionalTier).toBe(true);
  }, 15000);

  it("stub 'test' provider is NOT tiered by its nominal static row — regex mid, provisional", () => {
    // GH #239: the mechanism is now registry-owned — the test/test row
    // carries `nominal: true` and tierFromRegistry refuses any nominal row
    // (no provider-name carve-out). Behavior identical to the W2b arm this
    // replaces: tiering by it would flip every scripted runtime run's
    // profile from the regex-mid to local tier defaults.
    const p = resolveProfileWithWindow("test", "test");
    expect(p.tier).toBe("mid");
    expect(p.provisionalTier).toBe(true);
  }, 15000);

  it("GH #239: ANY registry row marked `nominal` cannot arbitrate tier — marker, not provider name", () => {
    // The stub-truth must travel ON THE DATA so every consumer gets it for
    // free (the W2b provider-name carve-out was per-consumer duplication
    // waiting to happen — Wave 3b was about to add a second carve-out).
    // A probe-registered nominal row must fall to the provisional regex,
    // exactly like the static test row does.
    registerProbedCapability(probedRow("stub-nominal:v1", "local", true));
    const p = resolveProfileWithWindow("stub-nominal:v1", "ollama");
    expect(p.tier).toBe("mid");
    expect(p.provisionalTier).toBe(true);
    // Control: the SAME tier row without the marker IS the arbiter.
    _resetProbedRegistryForTesting();
    registerProbedCapability(probedRow("stub-nominal:v1", "local"));
    const q = resolveProfileWithWindow("stub-nominal:v1", "ollama");
    expect(q.tier).toBe("local");
    expect(q.provisionalTier).toBeUndefined();
  }, 15000);
});

// ── Non-ollama regex behavior byte-unchanged (ruling #2) ────────────────────

describe("W2b — resolveProfile (name-regex) semantics preserved", () => {
  it("non-ollama global patterns untouched", () => {
    expect(resolveProfile("mistral-7b").tier).toBe("mid");
    expect(resolveProfile("llama-3.3-70b").tier).toBe("mid");
    expect(resolveProfile("qwen-2b").tier).toBe("local");
    expect(resolveProfile("tinyllama").tier).toBe("local");
    expect(resolveProfile("claude-opus-4-8").tier).toBe("frontier");
    expect(resolveProfile("gpt-4o-mini").tier).toBe("mid");
    expect(resolveProfile("gemini-2.5-flash", undefined, "gemini").tier).toBe("large");
  }, 15000);

  it("ollama branch keeps LOCAL_PATTERNS but no longer size-matches: 'ollama:qwen3:14b' still mid via regex-only resolveProfile, while the WINDOW seam (registry) says local", () => {
    // resolveProfile stays the pure name-regex function for internal
    // callers; the registry arbiter lands in resolveProfileWithWindow (the
    // builder auto-resolution seam named by the plan).
    expect(resolveProfile("ollama:qwen3:14b").tier).toBe("mid");
    expect(resolveProfile("myco:2b", undefined, "ollama").tier).toBe("mid"); // size heuristic gone
    expect(resolveProfile("tinyllama:1b", undefined, "ollama").tier).toBe("local"); // LOCAL_PATTERNS kept
  }, 15000);

  it("explicit tier/quality inputs bypass registry AND provisional marking", () => {
    expect(resolveProfileWithWindow("qwen3:4b", "ollama").provisionalTier).toBeUndefined();
    expect(resolveProfile("large").tier).toBe("large");
    expect(resolveProfile(0.95).tier).toBe("frontier");
  }, 15000);
});
