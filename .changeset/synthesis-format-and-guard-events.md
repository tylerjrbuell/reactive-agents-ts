---
"@reactive-agents/reasoning": patch
---

Terminal synthesis no longer rewrites answers as prose when the task names no detected output format. The synthesis prompt now states a format only when one was detected, and otherwise asks for the format the request names. Format detection now also recognizes "markdown report", "markdown document", "markdown summary" and "as a markdown ..." phrasings. Every act-phase guard refusal (repetition, duplicate, side-effect, unavailable tool, meta-tool dedup, unconsumed evidence, write-before-read) now emits a `GuardFiredEmitted` event with `outcome: "block"` (for example `guard: "repetition_guard"`), so traces and `mechanismActivity` count those guards (`guard:repetition_guard:block`).
