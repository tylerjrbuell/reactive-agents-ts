---
"@reactive-agents/llm-provider": patch
"@reactive-agents/reasoning": patch
---

GH #239 — nominal stub rows can no longer arbitrate tier. `Capability` gains an optional `nominal: boolean` marker; the `test/test` bench-window static row carries it (its own comment already said "values describe the stub, not a model"). `tierFromRegistry` (W2b registry-first tiering) now refuses ANY nominal row generically, replacing the per-consumer `providerKey === "test"` name carve-out — so Wave 3b's second registry-tier consumer inherits stub-truth from the data instead of duplicating a provider-string special case. Behavior identical for every existing input (the W2b matrix arm stays green); new arms pin that a probe-registered nominal row falls to the provisional regex path while the identical unmarked row stays the arbiter.
