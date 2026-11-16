---
"@reactive-agents/runtime": patch
---

`.withHarness({ computeOffload: true })` (or `RA_COMPUTE_OFFLOAD=1`, default off) is now wired through the runtime: the harness schema accepts the field, the run-config `mechanisms` record shows it, and for an aggregation task over data the run reads, `code-execute` is added to the permitted tool surface even without a `builtins` opt-in. An explicit `allowedTools` list that omits `code-execute` and the contract's forbidden list still win. Behavior is unchanged with the flag off.
