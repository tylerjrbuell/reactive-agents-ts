---
"@reactive-agents/runtime": patch
---

`.withHarness({ wrapUpReserve: true })` is now a typed, serializable harness key (default off; config beats `RA_WRAPUP_RESERVE`) and is recorded in the run-started mechanism record.
