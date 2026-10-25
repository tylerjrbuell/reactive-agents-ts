---
"@reactive-agents/runtime": minor
"@reactive-agents/cortex": minor
---

feat(runtime): add `initialHistory` to `ChatEngineOptions` and `SessionOptions`, and record streamed turns when the terminal event is observed (so a consumer closing on `StreamCompleted` cannot drop the turn). Cortex chat now runs the canonical per-session ChatEngine.

feat(cortex): overhaul chat to use the canonical ChatEngine (engine-backed sessions, server-side cancellation, live tool-call chips, config parity for budget/grounding/fabricationGuard/modelRouting/outputSchema/auditRationale/skills.activate, deleted dead `useReasoning` toggle). Sync batch: config-parity coverage guard over every builder wither, skill-lifecycle strip in run view, MCP OAuth 2.1 auth config, `withHarness()` advanced control surface, minimal RAG `withDocuments` ingestion, and a decision doc excluding production-hardening withers.