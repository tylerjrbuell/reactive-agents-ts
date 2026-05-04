---
aliases: [llm-provider package, Provider Adapters]
tags: [package, foundation, providers]
layer: Foundation
owner: Provider Team
status: Stable (v0.10.0)
validation: M12 (7/7 hooks wired)
---

# Package: llm-provider

**Layer:** Foundation (no dependencies)

**Owner:** Provider Team

**Status:** ✅ Stable (v0.10.0) — M12 provider adapters validated

---

## Purpose

The `llm-provider` package provides abstraction for 6 LLM providers with customizable behavior via 7 lifecycle hooks:
- **Providers:** Anthropic, OpenAI, Google Gemini, Ollama, Groq, AWS Bedrock
- **Hooks:** parseToolCalls, extractText, computeCost, validateResponse, optimizePrompt, handleError, streamSupport

---

## Supported Providers

| Provider | Streaming | Native FC | Custom Hooks | Status |
|----------|-----------|-----------|--------------|--------|
| Anthropic | ✅ | ✅ | All 7 | ✅ |
| OpenAI | ✅ | ✅ | 6/7 | ✅ |
| Gemini | ✅ | ✅ | All 7 | ✅ |
| Ollama | ✅ | ❌ | All 7 | ✅ |
| Groq | ✅ | ✅ | 5/7 | ✅ |
| AWS Bedrock | ✅ | ✅ | 6/7 | ✅ |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/abstract-provider.ts` | ProviderAdapter interface (7 hooks) |
| `src/providers/anthropic-provider.ts` | Anthropic implementation |
| `src/providers/openai-provider.ts` | OpenAI implementation |
| `src/providers/gemini-provider.ts` | Google Gemini implementation |
| `src/providers/ollama-provider.ts` | Ollama (local) implementation |
| `src/providers/groq-provider.ts` | Groq implementation |
| `src/providers/aws-bedrock-provider.ts` | AWS Bedrock implementation |

---

## Tests

| Test Suite | Coverage | Pass Rate |
|------------|----------|-----------|
| provider-adapter-hooks.test.ts | 7 hooks validation | 100% (32/32) |
| per-provider-integration.test.ts | Per-provider tests | 100% (26/26) |
| llm-provider.test.ts (regression) | Regression suite | 100% (254/254) |
| **Total** | 312 tests | 100% |

---

## 7 Lifecycle Hooks

### 1. parseToolCalls

Extracts tool calls from LLM response. Provider-specific parsing:
```typescript
parseToolCalls(response: string): ToolCall[]
```

**Anthropic:** Native tool_use blocks → ToolCall array
**Ollama:** Text parsing → ToolCall array with JSON extraction
**Gemini:** Function calling → normalized ToolCall array

---

### 2. extractText

Normalizes text extraction across providers:
```typescript
extractText(response: string): string
```

Handles whitespace, line breaks, special characters per provider.

---

### 3. computeCost

Provider-specific token counting:
```typescript
computeCost(input: string, output: string): TokenCount
```

Each provider has different pricing models (Anthropic: fixed, OpenAI: variable, Ollama: none).

---

### 4. validateResponse

Schema validation on provider response:
```typescript
validateResponse(response: string): ValidationResult
```

Ensures response format matches expected schema (tool calls, text, streaming delimiters).

---

### 5. optimizePrompt

Model-specific prompt tuning:
```typescript
optimizePrompt(prompt: string): string
```

**qwen3:14b:** Add explicit instruction clarity signals
**Frontier models:** Keep as-is

---

### 6. handleError

Error classification and recovery hints:
```typescript
handleError(error: Error): ErrorClassification
```

Classify: unrecoverable vs recoverable; suggest mitigation.

---

### 7. streamSupport

Per-provider streaming format:
```typescript
streamSupport(modelId: string): StreamFormat
```

Anthropic: event stream; OpenAI: SSE; Ollama: JSON lines.

---

## M12 Validation Results

**From docs/superpowers/debriefs/M12-provider-adapter-hooks-validation.md:**

- ✅ All 7 hooks wired (7/7)
- ✅ Zero cross-provider interference
- ✅ 312/312 tests pass (100%)
- ✅ 254/254 regression tests pass
- ✅ Measurable per-hook improvements in domain

**Verdict:** ✅ KEEP — Adapter hooks earn their keep

---

## Phase 2 Improvements

- **Calibration integration:** Use M7 calibration to tune hook behavior per model
- **Dynamic hook selection:** Enable/disable hooks based on model tier
- **New hooks:** `embeddings`, `imageGeneration` as capabilities expand

---

## Architecture Notes

- Foundation layer; no internal dependencies
- Used by all layers (reasoning, tools, runtime)
- Per-model hooks self-gate on modelId (no interference)
- Streaming patterns per provider well-tested

---

## References

- [[MOCs/Research MOC|Research MOC]] — M12 validation results
- [[Experiments/M12 Provider Adapters|M12 Provider Adapters]] — Full mechanism details
- [[Decisions/Provider Adapter Hooks|Provider Adapter Architecture]]

---

**Last Updated:** 2026-05-04  
**Layer:** Foundation  
**Status:** ✅ Stable — M12 validated, all hooks wired
