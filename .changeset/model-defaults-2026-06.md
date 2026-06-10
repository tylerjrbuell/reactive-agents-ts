---
"@reactive-agents/llm-provider": patch
"@reactive-agents/runtime": patch
"reactive-agents": patch
---

Refresh cloud-provider model support to the 2026-06 lineup and remove all retiring model defaults. `claude-sonnet-4-20250514` (retires 2026-06-15) is replaced by `claude-sonnet-4-6` in every default path: `provider-defaults.ts`, `getLLMConfig()`, and the `createRuntime()`/`createLightRuntime()` terminal fallbacks. Retired ids removed from presets (`claude-3-5-haiku-20241022`, `gemini-2.0-flash/pro`); new capability entries for `claude-opus-4-8`, `claude-sonnet-4-5`, `gpt-5.5`/`gpt-5.4`/`gpt-5.4-mini`, `gemini-2.5-pro/flash/flash-lite`, `gemini-3.5-flash` with corrected context windows. Two consistency guard tests now pin every default and preset to the static capability table so retired-id drift fails CI loudly.
