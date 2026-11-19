---
"@reactive-agents/reasoning": patch
---

Reflexion: the final pass decides the run's status. An improve pass that continues the run (it judges the run contract over the run ledger so far) now supersedes the passes before it, so earlier capped passes no longer veto a verified final answer (`terminal_status_override` with authority `envelope-outstanding`). A final answer the critique never judged is `completed` when its pass passed the shared verify gate; an answer the critique judged UNSATISFIED stays `partial`. An empty generate pass is now seeded by the kernel's shared terminal synthesis over the pass's tool results, with meta-tool results (e.g. `todo` call instructions) excluded, so the tool-less call no longer shows tool instructions (Gemini answered those with `UNEXPECTED_TOOL_CALL` and the run failed).
