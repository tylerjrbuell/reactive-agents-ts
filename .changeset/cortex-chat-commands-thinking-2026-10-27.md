---
"@reactive-agents/cortex": minor
"@reactive-agents/runtime": patch
"@reactive-agents/ui-core": patch
---

Runtime and ui-core: a `ContextPressure` stream event (prompt tokens used and remaining per model call) so UIs can show a live context meter. Cortex chat: slash commands (`/compact`, `/clear`, `/fork`, `/rerun`, `/rewind`, `/copy`, `/rename`, `/model`, `/provider`, `/thinking`, `/skills`, `/docs`), skills queued from the `/` menu for the next message only, a context ring with a usage popover, a trace drawer, loading skeletons and entrance animations, per-message provider and model, editable compaction summaries, and fixes so a message starting with a path or typed through an IME is no longer intercepted. Cortex builder: a Thinking control (Auto, On, Off) with per-model support flags, one-click selection of an MCP server's tools, wrapped section pills, and consistent spacing and readable type; thinking is passed through to chat, Lab and gateway agents.
