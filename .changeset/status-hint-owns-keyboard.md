---
"@reactive-agents/observability": patch
---

The live status line shows the `[t: collapse]` and `[t: collapse thinking]` hints only when the `t` key works. That is when stdin is a terminal and nothing else reads it. Runs with piped stdin (StackBlitz, IDE panes, `rax` with piped input) no longer advertise a key that does nothing.
