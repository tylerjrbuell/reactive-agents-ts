---
"@reactive-agents/reasoning": patch
---

New harness switch `leanThinking` (default off; `RA_LEAN_THINKING=1` or `harness: { leanThinking: true }`). On a thinking-capable Ollama model, a tool-selection turn (native function calling, a domain tool on the wire, tool work outstanding, the last tool result not a failure) is requested with `thinking: false`, so qwen3-family and deepseek-r1 runs stop spending the turn's wall clock on a reasoning chain before a tool call. Other turns think as before, and the thinking-runaway recovery is unchanged. Each decision emits one `guard-fired` event (`guard: "lean-thinking"`). Boolean only: llm-provider has no per-turn thinking-token budget.

A model that only narrates a required tool call in prose is answered by the existing `actOrAnswer` forced retry; an end-to-end pin now covers that shape (forced call runs and the run succeeds on the tool receipt; a model that never complies ends the same honest required-tool outcome as before, with no new exit).
