---
"@reactive-agents/llm-provider": patch
---

GH #243 — confidence floor for calibration dialect priors (first program self-caught regression: wave-2 close capture measured S3 qwen3:4b 5/5 → 0/5 because a 2026-05-24 runsAveraged:1 prior flipped W2a's derived supportsToolCalling to false on a model whose live template evidence says native-FC).

`deriveSupportsToolCalling` now ships an explicit precedence (JSDoc + cited constant): a `toolCallDialect: "none"` prior can flip live routing ONLY when it is an explicit field in the calibration file (schema-default "none" is no longer a claim — four shipped priors were phantom claims) AND `runsAveraged >= DIALECT_PRIOR_CONFIDENCE_FLOOR` (2). Below floor, contradicted-by-evidence, or absent, the derivation stays fail-safe-permissive. Confident priors are also honored in the template-unmeasured arm (previously priors never governed there). Root-cause fix: the calibration-runner shipped a hardcoded `toolCallDialect: "none"` stub into every generated prior (probe suite v1 never measured dialect); v2 adds a real behavioral probe (required-tool chat call, parseable `tool_calls` ⇒ native-fc).

Audit (live /api/show + behavioral, 2026-10-13): qwen3:4b, qwen3:14b, cogito:14b priors REFRESHED to native-fc via the probe path (3/3 majority each; probeVersion 2; dated; STATIC_CAPABILITIES entries re-reconciled to match). gemma4-e4b / llama3.2-3b / qwen2.5-coder-14b / -7b / cogito-8b KEPT — the absent-field priors are inert under the explicit-presence rule. Plugin-model template stubs (gemma4's 13-char passthrough) now measure UNMEASURED instead of a stranding false (>= 64 scannable chars required).
