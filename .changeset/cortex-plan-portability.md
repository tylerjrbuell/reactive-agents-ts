---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": minor
---

Cortex's chat plan card can take a plan out and bring one in. **Export** copies the saved plan as Markdown or downloads it as Markdown, a self-contained web page or JSON; **Import** replaces the plan from a file or pasted Markdown or JSON, records it as a user edit, and shows the reason when the text cannot be read (no steps, invalid JSON, wrong shape, newer version). The formats and parsers are the framework's (`planToMarkdown`, `planFromMarkdown`, `planToJSON`, `planFromJSON`, `planToHtml`); new routes `GET /api/chat/sessions/:id/plan/export` and `POST .../plan/parse`, and `PUT .../plan` takes an optional `goal`. A step's tool is now a dropdown of the tools the chat offers (its own tools, MCP tools grouped by server), reading the quick bar's catalog; a hint the chat no longer offers stays visible. Tool hints and plan origin now ride the to-do rows (the framework's own seed row) instead of a Cortex-only copy in the plan meta; older sessions are read as before. A user plan edit is no longer held for the next run's event feed (the framework stamps plan events with the session id).

`@reactive-agents/ui-core` exports the pure plan-editing rules a chat UI needs to edit a plan's step list: `addStep`, `removeStep`, `moveStep`, `setStepTitle`, `setStepTool`, `nextStepId`, `planEdited`, `planProgressLine`, `stepStatusLabel` and the `PlanDraftStep` type.
