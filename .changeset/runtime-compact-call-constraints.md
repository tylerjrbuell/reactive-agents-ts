---
"@reactive-agents/runtime": patch
---

Two new `.withHarness()` fields.

- `.withHarness({ compactCallConstraints: true })` turns on compact call constraints (same as `RA_COMPACT_CALL_CONSTRAINTS=1`). Compact tool profiles then keep the sentences that limit a parameter's values, and the compact tool reference lists enum values as `a|b|c`. Default off. The `run-started` trace event records it under `config.mechanisms.compactCallConstraints`.
- `.withHarness({ llmRecoveryBudget: n })` sets how many recoverable provider failures on think turns one run may retry instead of ending with `llm_error`. Default 2; `0` turns recovery off. Config only, no env var.

Both fields survive `toConfig()` / `fromConfig()` JSON.
