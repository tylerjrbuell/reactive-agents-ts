---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": patch
---

Cortex chat shows a live card for the running reasoning strategy (tree of thought as a real tree with pruned and selected nodes, reflexion rounds with critique verdicts, code action with code, output and verification, plan strategies as phase rows), and the "Thinking" status line names the current phase. Reasoning now leads each turn as a collapsible "Thinking" pill that streams live and collapses when done, and a leaked `thought` preface no longer opens the answer. Code Action with an approval gate is refused up front with a plain message and one-click ways out, instead of failing mid-run. ui-core adds `strategy-phases` (phase table, fold, tree helpers), `strategy-conflict`, and `splitReasoning`; the transcript gains a `thinking` segment.
