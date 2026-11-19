---
"@reactive-agents/reasoning": patch
---

code-action reads tool results more reliably and answers in the form the task asks for:

- When generated code fails after some tool calls succeeded, the repair prompt now shows the actual shape of each result (key names and value types, no data values), so the next attempt reads real fields instead of guessing.
- When the program returns an object or array, one answer-writing call (the shared quality gate every strategy uses) turns it into the answer the task asked for, such as a report. Tasks that ask for JSON or CSV keep the raw result.
- A "nothing found" result (or an empty value) is no longer graded success when a successful tool call in the same run returned data about it. The run retries with the contradiction stated, and fails if no attempts remain.
