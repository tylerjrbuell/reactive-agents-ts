---
"@reactive-agents/tools": patch
---

Embedded-form gate (D7c) reprompts now name the exact call to restate. When a printed tool call on a non-low-risk tool is refused because it sits inside an expression (e.g. `const x = fileRead("/abs/a.txt", "utf-8")`) but its arguments parse as literals, the refusal reason the model sees ends with the canonical standalone call, e.g. `call it on its own: file-read {"path":"/abs/a.txt","encoding":"utf-8"}`. The gate still refuses; nothing executes. Calls whose arguments do not parse keep their existing reason.
