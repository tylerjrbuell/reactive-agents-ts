---
"@reactive-agents/trace": minor
"@reactive-agents/diagnose": minor
---

`rax-diagnose attribute` no longer calls a tool's refusal of the model's own content an environment fault. Three new reasons: `harness:refused-repairable` (the refused JSON was deterministically repairable), `harness:misleading-refusal` (the refusal carried a contradicting hint), and `model:invalid-content` (the refusal was correct and the content was not repairable).
