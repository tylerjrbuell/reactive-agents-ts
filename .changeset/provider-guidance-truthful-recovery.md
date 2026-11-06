---
"@reactive-agents/llm-provider": patch
---

Truthful local-tier adapter guidance. After a tool argument error (missing parameter, wrong type, invalid input), `errorRecovery` now tells the model to fix the arguments and call the same tool again, naming the failing parameter when the error states it. Previously it told the model to "use a different tool to get the information". Only errors that say the tool cannot do the request suggest another tool. `synthesisPrompt` no longer orders "That is enough. Do NOT search again." It states how many results were gathered and asks the model to call the output tool if they cover the task.
