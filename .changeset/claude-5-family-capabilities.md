---
"@reactive-agents/llm-provider": patch
---

Fixed: `claude-haiku-5-5` calls failed with a 400 "temperature is deprecated for this model", because the Anthropic adapter always sent `temperature`. Capability rows now carry an optional `rejectsTemperature` flag. The adapter omits `temperature` on `complete()`, `stream()` and `completeStructured()` for flagged models. Only `claude-haiku-5-5` is flagged so far.

Added static capability rows for `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`. These ids used to fall back to a 2048-token context window, which starved context assembly. The window and output values copy each model's 4.x predecessor. Fable gets a conservative 200K window and 64K output cap. None of these values are confirmed against Anthropic's docs yet.
