---
"@reactive-agents/core": patch
---

Checklist rows now take their tool from the step text. An `add` item with no structured `tool` whose title names one (`tool: x`, `(tool: x)`, `tools: a, b`) gets `row.tool` set when the checklist folds, so model todo steps, harness-derived steps and imported plans show their tool. An explicit `tool` still wins and titles are unchanged. New pure helpers `planStepToolHint` and `planStepToolHints` are exported.
