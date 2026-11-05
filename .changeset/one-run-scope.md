---
"@reactive-agents/core": minor
"@reactive-agents/tools": minor
"@reactive-agents/runtime": minor
"@reactive-agents/reasoning": patch
---

Per-run state now lives in one run scope that each run opens once. Every way to start a run (`run`, `runStream`, `resume`, approve/deny, `respondToInteraction`, `fork`, and gateway events) goes through one entry, so a new piece of run state cannot be missed at one of them. Sub-agents get a child scope: they keep the parent's file root and documents and get fresh tool stores.

User-visible effects:
- Gateway runs (heartbeat, cron, channel events) now honor the caller's file root, like `run()` already did.
- Calling `ReasoningService` directly, outside an agent, still isolates each run's tool stores.

Breaking for code that imported low-level tools internals: `withDocumentStore`, `DocumentStoreRef`, `bindFileRoot`, `FileRootRef`, `RunToolStoresRef`, `withRunToolStores`, `defaultRunToolStores` and the deprecated `scratchpadStoreRef` / `checkpointStoreRef` / `discoveredToolsStoreRef` are removed from `@reactive-agents/tools`. Use `.withDocuments(docs, { store })` to share a document store between agents and `withFileRoot(root, fn)` to set a file root; both are unchanged.
