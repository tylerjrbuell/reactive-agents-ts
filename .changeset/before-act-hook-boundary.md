---
"@reactive-agents/reasoning": patch
---

**Security:** a `before act` hook can now stop a parallel tool batch. With parallel batching on (`nextMovesPlanning.allowParallelBatching`), the kernel used to fire `before act` hooks only after the batch's tools had already run, so a killswitch such as `requireApprovalFor` could not block them. Block-mode approval was not affected.

`before act` hooks now fire once per tool call, before any call of the turn executes, on every path (serial, parallel batch, meta-tools). During each fire, `state.meta.pendingToolCalls` holds exactly that one call, with its healed name, so a misspelled tool name cannot get past a deny list. A hook that aborts stops the whole turn: no call of that turn runs, including calls listed before the denied one. Before this change each serial call fired the hook twice, once before it ran and once more after the turn.

Strategy results now carry `metadata.kernelIterations`: the kernel turns the run took, summed over its kernel passes and relayed through delegating strategies. `stepsCount` is unchanged.
