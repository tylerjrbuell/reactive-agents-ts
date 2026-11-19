---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

`.withModel(modelId, params)` is now a typed overload: `.withModel("gemma4:e4b", { numCtx: 8000 })` is the same as `.withModel({ model: "gemma4:e4b", numCtx: 8000 })` and applies `numCtx`, `temperature`, `maxTokens` and `thinking`. Before, the second argument matched no overload and was silently dropped, so Ollama loaded the model at its default context window.

`.withModel()` now throws `ModelOptionError` (exported) instead of dropping a setting: for a `params` value that is not an object, a key that is not a `ModelParams` field (for example `num_ctx`, or `provider`, which belongs in `.withProvider()`), a second argument after the object form, or a first argument that is neither a string nor an object. TypeScript callers already got compile errors for these; plain-JS callers now get the error at the call.
