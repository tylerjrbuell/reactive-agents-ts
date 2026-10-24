---
"@reactive-agents/runtime": minor
---

Canonical chat engine: one `ChatEngine` in `packages/runtime/src/chat/engine.ts` now backs `agent.chat()`, `agent.session()`, and `GatewayChatManager`, fixing seven catalogued chat defects under existing signatures.

- New `session.runStream(message, { density?, signal? })` streams a conversational turn, records it into session history, and persists it when `persist: true`. Returns a `RunHandle`.
- `ChatEngine` is now exported from `@reactive-agents/runtime`.
- Direct-LLM path now applies the agent persona (previously dropped), windowing is on by default (40 turns / 8,000 chars), recording is symmetric across direct and tool paths, and `ChatOptions.maxIterations` is honored on the tool path (was ignored).
- Session and gateway ids are canonical (`sess_agent_*`, `sess_session_*`, `sess_gateway_*`); legacy `gateway-chat-<agentId>-<sender>` keys remain readable via fallback, and new saves switch to canonical without losing loaded turns.
- Configurable direct-path token budget via `ChatEngineOptions.maxDirectTokens` (default 4096); the previous hardcoded 1024 is gone.
- `SessionOptions.persistOnEnd` removed (documented-dead knob); use `persist` + `session.end()`.

Semantics are non-breaking for existing `agent.chat()` / `agent.session()` callers; `SessionOptions.persistOnEnd` consumers must drop the field.
