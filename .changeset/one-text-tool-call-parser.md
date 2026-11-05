---
"@reactive-agents/tools": minor
---

Tool calls written as text are parsed by one parser with one argument grammar (`parseAssistantToolCalls`, `parseCallArgs`). Models that print calls like `file-read({ path: "./a.txt" })`, `fileRead(...)`, `key=value` or `--path ./a.txt` in a shell fence now get a correct call instead of a mangled one. A call whose arguments are not plain values (for example `x.toString()`) is never guessed into a string: the model is asked to restate it. A text literal can no longer be healed into a `path` argument. Well-formed native tool calls are unchanged.
