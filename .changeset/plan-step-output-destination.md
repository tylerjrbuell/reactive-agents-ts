---
"@reactive-agents/reasoning": patch
---

Plan-execute and blueprint now tell an analysis step where its output goes. When a later tool call in the plan uses the step's output through `{{from_step:<id>}}`, the step prompt names that consumer: for example "Your entire reply becomes the content of low-stock.txt … Output only that content — no file names, labels or other files." When the output fills part of a larger argument, the prompt quotes the template and says which slot it fills. Before, an analysis step saw only the overall goal and could answer all of it, so one file received the contents meant for several. Steps whose output no tool argument uses get the same prompt as before.
