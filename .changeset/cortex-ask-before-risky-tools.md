---
"@reactive-agents/cortex": minor
---

Cortex agents now ask before risky tools by default. Writing files, running code and the full shell wait for your approval in chat and desk runs (gateway agents refuse them, since nobody is watching). Switch it off per agent with "Ask before risky tools" in Lab · Tools, or `/approvals` · Turn approvals off in chat (`askBeforeRiskyTools: false`). The framework's own default is unchanged.

The chat composer now has one command surface: typing `/` and the Config button open the same list, anchored to the composer, with each setting shown beside its slash command and current value. A command with options (`/model`, `/tools`, `/agent`, `/approvals`, ...) opens in place under a Back row; Esc goes back one level, then closes. `/agent` gained an On/Off panel.
