---
"@reactive-agents/core": patch
"@reactive-agents/reasoning": patch
---

GH #206: honest abstention synthesis on effort exhaustion. A run that stops after effort (iteration/tool budget exhausted, or its terminal was rejected) with no verified answer now ships a deterministic, harness-authored abstention naming what was attempted (tool calls / successes) instead of empty output. `success` stays false; infrastructure faults (`llm_error`/`kernel_error`) are excluded so their real cause is never masked. New canonical sentinel reason `budget_exhausted_no_output`.
