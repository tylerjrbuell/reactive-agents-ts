---
"@reactive-agents/llm-provider": patch
---

GH #243 review discharge — truthful full-suite v2 calibration refresh (data only, produced by the shipped `calibration-runner --commit` probe seam; runner source untouched). All fields of qwen3:4b, qwen3:14b, cogito:14b, and qwen2.5-coder:14b priors are now v2 measurements (probeVersion 2, runsAveraged 3), removing hand-merged v1 carry-overs whose suite metadata described partially-stub data.

Measured changes: qwen2.5-coder:14b `toolCallDialect` ABSENT->"none" (3/3 behavioral probes emitted no parseable tool_calls — corroborates the #243 audit) so `deriveSupportsToolCalling` now returns false for it as a confident measured posterior, not a phantom claim; Wave 3's S4 text-mode arm has a real measured target. qwen3:14b + cogito:14b `optimalToolResultChars` 4000->2000 — 2000 is the current probe ladder's cap, so this is a censored ">=2000" measurement, disclosed in the W2 fix report. No dialect movement for the three native-fc models (static-table reconciliation from 354b6aef8 stands).
