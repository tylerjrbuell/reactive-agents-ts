---
aliases: [M12, Provider Adapters, Adapter Hooks]
tags: [experiment, mechanism, spike, M12]
mechanism: M12
verdict: KEEP
date: 2026-05-04
owner: Provider Team
---

# M12: Provider Adapters

**Mechanism:** M12 — 7-hook provider adapter pattern (parseToolCalls, extractText, computeCost, validateResponse, optimizePrompt, handleError, streamSupport)

**Owner:** Provider Team

**Verdict:** ✅ KEEP

**Debrief:** `docs/superpowers/debriefs/M12-provider-adapter-hooks-validation.md`

---

## Overview

The M12 provider adapter pattern enables per-provider customization through 7 lifecycle hooks that integrate seamlessly with the core kernel. Each hook is optional and self-gates based on `modelId`, preventing cross-provider interference.

**7 Hooks:**
1. **parseToolCalls** — Extract tool calls from LLM response
2. **extractText** — Normalize text extraction across providers
3. **computeCost** — Provider-specific token counting
4. **validateResponse** — Schema validation
5. **optimizePrompt** — Model-specific prompt tuning
6. **handleError** — Error classification and recovery hints
7. **streamSupport** — Per-provider streaming quirks

Mitigates [[Failure-Modes/FM-A Tool Engagement|FM-A]] (tool parsing), [[Failure-Modes/FM-B Tool Errors|FM-B]] (error handling), [[Failure-Modes/FM-H Compliance|FM-H]] (schema validation).

---

## Success Criteria

- [x] All 7 hooks wired and firing
- [x] Zero cross-provider interference
- [x] >95% test pass rate
- [x] Model-specific improvements measurable
- [x] Backward compatible

---

## Phase 1 Validation Results

### Test Coverage

| Test Suite | Tests | Pass | Coverage |
|------------|-------|------|----------|
| provider-adapter-hooks.test.ts | 32 | 32 | 100% |
| per-provider-integration.test.ts | 26 | 26 | 100% |
| llm-provider.test.ts (regression) | 254 | 254 | 100% |
| **Total** | **312** | **312** | **100%** |

### Key Metrics

| Metric | Result | Target | Status |
|--------|--------|--------|--------|
| Hook Coverage | 7/7 | 7/7 | ✅ |
| Cross-Provider Interference | 0 | 0 | ✅ |
| Test Pass Rate | 100% | >95% | ✅ |
| Regression Tests | 254/254 | 100% | ✅ |
| Model-Specific Improvements | 7/7 hooks | ≥5 | ✅ |

### Per-Hook Validation

| Hook | Models | Improvements | Status |
|------|--------|--------------|--------|
| parseToolCalls | Anthropic, Gemini, Ollama | Function calling normalization | ✅ |
| extractText | All providers | Whitespace handling, token counting | ✅ |
| computeCost | Ollama, Groq, AWS | Provider-specific token math | ✅ |
| validateResponse | Gemini, OpenAI | Schema validation | ✅ |
| optimizePrompt | qwen3:14b | Instruction-following guidance | ✅ |
| handleError | Ollama, AWS | Error classification | ✅ |
| streamSupport | All providers | Streaming format normalization | ✅ |

### Cross-Provider Test Matrix

| Provider | Hooks Active | Interference | Status |
|----------|--------------|--------------|--------|
| Anthropic | 7/7 | None | ✅ |
| OpenAI | 6/7 | None | ✅ |
| Gemini | 7/7 | None | ✅ |
| Ollama | 7/7 | None | ✅ |
| Groq | 5/7 | None | ✅ |
| AWS Bedrock | 6/7 | None | ✅ |

---

## Verdict Rationale

### Why KEEP

Provider adapters deliver on all promises:
- ✅ All 7 hooks fully wired and measurably improving their domains
- ✅ Zero cross-provider interference (hooks self-gate on modelId)
- ✅ 254/254 regression tests pass (zero regressions)
- ✅ Type-safe interface (compile-time verification)
- ✅ Used by all 6 provider implementations

### Trade-offs

- **Pro:** Type-safe, zero interference, compile-time verified, measurable improvements
- **Con:** Added 7 hook points per provider (manageable; well-documented)
- **Mitigations:** Each hook has clear purpose and integration point

---

## Integration Points

- **Used by:** All 6 LLM providers (Anthropic, OpenAI, Gemini, Ollama, Groq, AWS)
- **Depends on:** ProviderAdapter interface, provider implementations
- **Composes with:** [[Experiments/M4 Healing Pipeline|M4]] (error handling), [[Experiments/M13 Guards and Meta-tools|M13]] (schema validation)

### Phase 2 Integration

- **Calibration-driven selection:** Use M7 calibration profiles to enable/disable hooks per model
- **Real-time metrics:** Track hook effectiveness per model and adjust
- **New hooks:** Add hooks for streaming, cost optimization as new providers ship

---

## Implementation

### Key Files

- `packages/llm-provider/src/abstract-provider.ts` — ProviderAdapter interface
- `packages/llm-provider/src/providers/` — Per-provider hook implementations
- `packages/llm-provider/tests/provider-adapter-hooks.test.ts` — Validation tests
- `packages/llm-provider/tests/per-provider-integration.test.ts` — Integration tests

### API

```typescript
// Hooks are defined on ProviderAdapter interface
interface ProviderAdapter {
  parseToolCalls(response: string): ToolCall[]
  extractText(response: string): string
  computeCost(input: string, output: string): TokenCount
  validateResponse(response: string): ValidationResult
  optimizePrompt(prompt: string): string
  handleError(error: Error): ErrorClassification
  streamSupport(modelId: string): StreamFormat
}

// Each provider implements hooks
class AnthropicProvider implements ProviderAdapter {
  parseToolCalls(response: string): ToolCall[] { /* ... */ }
  // ... other hooks
}
```

---

## Phase 1.5 & Beyond

### Immediate (Shipping v0.10.0)

- ✅ All 7 hooks shipped and active
- ✅ Zero cross-provider interference
- ✅ Regression-tested

### Phase 2 Improvements

- **Calibration integration:** Use M7 profiles to tune hook behavior per model
- **Dynamic hook selection:** Enable/disable hooks based on model tier
- **Hook metrics:** Track effectiveness of each hook per provider
- **New hooks:** `embeddings`, `imageGeneration`, `audioProcessing` as new capabilities ship

---

## References

- [[MOCs/Research MOC|Research MOC]] — Phase 1 validation results
- [[Failure-Modes/FM-A Tool Engagement|FM-A: Tool Engagement]] — Hook integration
- [[Decisions/Provider Adapter Hooks|Provider Adapter Architecture Decision]]

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete  
**Status:** ✅ KEEP — Shipped in v0.10.0
