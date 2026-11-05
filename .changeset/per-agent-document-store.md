---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

Each built agent now owns its document store. Documents from `.withDocuments()` and `agent.ingest()` go into that agent's store, and `find` searches only it, so two agents in one process no longer see each other's documents. To share documents between agents, pass one store to each builder: `.withDocuments(docs, { store })` with `store = createDocumentStore()` (exported from `reactive-agents` and `@reactive-agents/runtime`). `agent.ingest()` now also works on agents built with only `.withTools()`, as its error message already claimed.
