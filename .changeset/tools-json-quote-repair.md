---
"@reactive-agents/tools": minor
---

`file-write` now saves a `.json` file whose only defect is unescaped double quotes inside string values, for example `{"q": "What is the "component model"?"}`, instead of refusing it. The healing pipeline's value-shape stage inserts a backslash before each inner quote and changes nothing else. It accepts the repair only when the result parses, removing the backslashes gives back the original text, the keys match the keys visible in the original text, and exactly one set of escapes parses. The repair is recorded as a `value-shape` healing action (`content:invalid-json` to `content:json-quotes-escaped(N)`). Any other invalid JSON (trailing commas, prose, truncation, ambiguous quotes) is still refused with the same message as before. Replayed on the benchmark cohorts, 34 of 45 refused `.json` writes now parse, in 17 of 22 runs.

The tools package now has one JSON repair primitive, `healing/json-repair.ts`. The lenient repair used for tool-call arguments in assistant text moved there, with no change in behavior. New exports: `repairJsonQuotes`, `repairJsonLenient`, `isJsonFilePath`, `JSON_FILE_EXTENSIONS`, and the types `JsonRepairResult`, `JsonRepairEdit`, `JsonRepairRefusal`.
