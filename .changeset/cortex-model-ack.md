---
"@reactive-agents/cortex": patch
---

Channel hub routes with `ack.source: "model"` now send model-written acknowledgements: the hub resolver forwards the agent's pre-tool narration and offers the tool-less `acknowledge` side completion, falling back to the canned text on failure. New Telegram routes (API create, import from agent config, the editor's new draft) default to a model ack unless the owner set `ack`. The activity feed shows `ChannelTurnAcknowledged` with its source.
