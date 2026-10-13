---
"@reactive-agents/llm-provider": minor
"@reactive-agents/core": patch
"@reactive-agents/reasoning": patch
---

Wave 2a — capability probe ladder + derived tool-calling claim.

`Capability` gains two optional probe-ladder fields: `parameterSizeBillions` (parsed from Ollama /api/show `details.parameter_size`, decimals supported: "1.7B" → 1.7) and `toolTemplateEmitsTokens` (tri-state chat-template tool-token emission scan: true/false = measured, undefined = never measured). The deferred S2.4 CalibrationStore write-through lands as `capability-store.ts`: probe results persist per (provider, model) under `~/.reactive-agents/capabilities/`, re-validated through `CapabilitySchema` on read (corrupt rows fall through to a fresh probe); the process-Map probe cache collapses onto the store (memory → store → live probe, write-through to both), and a duck-typed store (e.g. a `CalibrationStore`) can be injected via `setCapabilityStore()` without a reactive-intelligence dependency. The Ollama thinking-probe cache now reads off the same store-backed Capability record instead of re-querying /api/show.

The Ollama `capabilities()` endpoint's `supportsToolCalling` is DERIVED, not constant: template emission ∧ dialect posterior, fail-safe ordered — unmeasured models stay permissive (true, provisional-marked), a measured no-emission template is a strict false (cogito/qwen3-class "advertises tools, template drops them" lie detector).

Tier budgets fixed for D-2026-07-30-H: `CONTEXT_PROFILES.local.toolResultMaxChars` 4000 → 1200 (local ≤ mid) with the `core` mirror `TIER_TOOL_RESULT_PRESERVE` moved in lockstep, guarded by a new whole-table monotone-budget ratchet test.

Review round 1 (2026-10-13): template-emission scan also recognizes `function_call`/`.FunctionCall` (old ChatML/OpenAI-era templates in converted GGUF builds no longer measure a stranding false); store rows are endpoint-scoped (`(provider, model, baseUrl)` key — two Ollama servers publishing the same tag can never cross-serve; legacy baseUrl-less rows are a miss and self-heal); `REACTIVE_AGENTS_CAPABILITY_STORE_DISABLE=1` skips all store reads/writes (in-memory only) as the cross-suite test-contamination seam; store keys sanitized against path escape and writes made atomic (tmp+rename).
