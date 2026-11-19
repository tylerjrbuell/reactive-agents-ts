---
"@reactive-agents/runtime": patch
"reactive-agents": patch
---

A failed `agent.run()` (for example a 401 from a bad API key) now rejects with `AgentRunError`, exported from `reactive-agents` and `@reactive-agents/runtime`. Left uncaught at a top-level await, it prints as one line: `AgentRunError: <message>` under Bun (no runtime source excerpt) and `[AgentRunError: <message>]` under Node (no `_RunBoundaryError` internal name). The full error, with its remediation hint and the original tagged error, is still on `err.cause`. `RA_DEBUG_ERRORS=1` still rejects with the full error and stack.
