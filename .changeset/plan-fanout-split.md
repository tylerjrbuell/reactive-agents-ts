---
"@reactive-agents/reasoning": patch
---

plan-execute and blueprint: when one analysis step's whole output is written to two or more different files (`content: "{{from_step:sN}}"` on each write), the plan now gets one copy of that step per file, and each write reads its own copy. Before this, the single step was told "your entire reply becomes the content of X" once per file, so the first file received every file's text. The split happens once, at plan validation, and emits `guard-fired{guard:"plan-fanout-split"}` with the producer, the new step ids and the target files. Steps are renumbered `s1..sN` and every reference is rewritten; tool-call producers, single-target plans and plans with a reference to a missing step are left unchanged.
