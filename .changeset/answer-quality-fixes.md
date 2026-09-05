---
"@reactive-agents/reasoning": patch
"@reactive-agents/runtime": patch
---

Fix a set of answer-quality regressions found in live-model QA: the fabrication guard now catches invented named entities, not just fabricated numbers; a raw tool-scaffolded dump no longer ships as the answer when output-gate synthesis fails; a no-tool-needed conversational reply is now auto-promoted instead of being forced through tool-output framing; and the output gate no longer forces file-shaped formatting onto plain chat replies. Behavioral-contract enforcement (`.withContract()`), previously silently dead on the kernel execution path, is now wired.
