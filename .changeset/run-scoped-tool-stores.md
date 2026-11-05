---
"@reactive-agents/tools": minor
"@reactive-agents/reasoning": patch
---

Meta-tool stores are now run-scoped. The scratchpad (`recall`), checkpoint and discovered-tools stores used to be single process-wide values shared by every agent and run, so `recall` could return another run's tool results and concurrent runs raced. Each reasoning run now gets fresh stores (`withRunToolStores`, applied at `ReasoningService.execute`); sub-agents get their own. New exports from `@reactive-agents/tools`: `withRunToolStores`, `makeRunToolStores`, `RunToolStoresRef`, `currentRunToolStores`, `currentScratchpadStore`, `currentCheckpointStore`, `currentDiscoveredToolsStore`, `defaultRunToolStores`. `scratchpadStoreRef`, `checkpointStoreRef` and `discoveredToolsStoreRef` are deprecated aliases of the default (un-wrapped) stores.
