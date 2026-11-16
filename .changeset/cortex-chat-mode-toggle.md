---
"@reactive-agents/cortex": minor
---

Cortex chat gets a persistent Plan | Execute mode toggle in the composer. The mode is stored with the chat session (`PUT /api/chat/sessions/:id/mode`) and passed to the framework session mode, so Plan is reasoning only with no tools until you Execute. A Plan reply renders as a plan card whose Execute button switches mode and sends the follow-up in one step; `/plan` and `/execute` (`/go`) flip the same session mode and Shift+Tab toggles it. Provider and model now share one quick-bar chip whose two parts open `/provider` and `/model`.
