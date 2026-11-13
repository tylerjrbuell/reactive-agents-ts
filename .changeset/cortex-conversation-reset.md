---
"@reactive-agents/cortex": patch
---

Owner `/new` (and `/reset`) in a Telegram route served by the channel hub now clears that conversation's saved history, so the next message starts fresh. Routes gain a `resetCommands` setting (route editor: "Start a new conversation"; empty keeps `/new` and `/reset`, turning it off disables them), and the hub activity feed shows each reset as ok or failed without any message text. If the history cannot be cleared the owner is told instead of getting a false fresh start.
