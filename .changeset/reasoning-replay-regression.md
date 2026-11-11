---
"@reactive-agents/reasoning": patch
---

A run that ends on a harness-assembled deliverable and is then rewritten by the output gate's synthesis call now returns that synthesized answer. Before, the kernel kept the `harnessAuthoredOutput` label on the result after the synthesis replaced the text, so the runtime treated the model-written answer as harness text and returned `output: ""`. The synthesis now clears the label. `verificationWarning` still records that the model's own turn never answered. When the synthesis comes back empty, the de-scaffolded fallback text keeps the label as before.
