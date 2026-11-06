---
"@reactive-agents/cortex": patch
---

The builder panel (Lab builder and the chat new-session config) has a Tool disclosure select in its Tools section (`.withTools({ disclosure })`: tier default, all, index, discover). It shares its choices with the chat `/tools` picker. The Tools quick picks list capability tools only, so meta-tools such as `recall` appear once, in the Meta tools section.
