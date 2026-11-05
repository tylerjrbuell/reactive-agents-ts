---
"@reactive-agents/reasoning": patch
"@reactive-agents/memory": patch
"@reactive-agents/diagnose": patch
"@reactive-agents/replay": patch
---

Backlog sweep fixes. Reasoning: tool-relevance keyword expansion ignores 1-2 letter task words, so generic tools no longer leak into the primary set and suppress preflights; the action-need detector recognises more phrasings (text/ping, SMS/Discord/Telegram/WhatsApp/Teams, standup/sync/demo/webinar). Memory: the episodic schema now admits the `strategy-outcome` and `reflexion-critique` event types the runtime already wrote. Diagnose and replay: string-thrown errors are now tagged (`DiagnoseUsageError`, `GrepExpressionError`, `TraceNotFoundError`, `ReplayLoadError`) with unchanged messages; `diagnose` now depends on `effect` directly.
