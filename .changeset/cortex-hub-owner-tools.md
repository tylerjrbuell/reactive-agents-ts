---
"@reactive-agents/cortex": patch
---

Channel hub: a routed chat turn now takes the tool loop whenever the built agent has tools. Before, `session.chat` guessed from the message wording, so an owner asking "what is bitcoin worth?" got an answer from the model alone ("I have no tools") although the saved agent had `crypto-price`.
