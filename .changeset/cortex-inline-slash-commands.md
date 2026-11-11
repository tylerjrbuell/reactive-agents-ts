---
"@reactive-agents/cortex": minor
---

Chat: name a skill anywhere in a message (`summarize this repo /codebase-health-sweep`). A recognized skill token is highlighted as you type, used for that message on send, and left out of the prompt; `/skills <name>` mid-message pins it for the chat. Typing `/` after a space opens the skill list at the cursor. Paths, links, unknown `/words` and code spans stay as typed, and `\/name` sends a skill name literally. Picking a skill from the menu or the skills chip now inserts it at the cursor instead of clearing the draft, and prompt-library picks go in at the cursor too.
