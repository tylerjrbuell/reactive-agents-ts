---
"@reactive-agents/runtime": patch
---

`.withHarness({ stableToolList: true })` turns on the reasoning `stableToolList` switch from the builder. The field is part of the `AgentConfig` harness schema, so it survives `toConfig()`, JSON, and `fromConfig()`. `run-started.config.mechanisms.stableToolList` records whether a run had it on. Default off until an ablation measures it.
