---
"@reactive-agents/reasoning": patch
---

**Two opt-in harness switches for faster runs (both off by default, pending an ablation).**

`parallelToolHint` adds one sentence to the system prompt asking the model to make independent tool calls together in one reply. The kernel already runs every call of a reply before the next turn. `true` adds it only when the model's calibration rates parallel calls `reliable`. `"always"` adds it for any model. The default mid, large and frontier prompts already end with this sentence, so the switch changes the local tier and custom system prompts. It is never added twice. It is not added with text-parse tool calling, on a turn without tools, under plan posture, or when parallel tool calls are off. Env: `RA_PARALLEL_TOOL_HINT=1` or `RA_PARALLEL_TOOL_HINT=always`. Trace: a `harness-signal-injected` event with origin `parallel-tool-hint`.

`leanFinalTurn` applies when the run contract declared tool work (a required tool, a file, an action), all of it is done, and only the answer is left. The next model call then ships with no tools and `thinking: false`. Its output budget drops the thinking allowance. If that reply is not the final answer, the next call has its tools again. A second lean turn needs another tool call first. Native function calling only. Env: `RA_LEAN_FINAL_TURN=1`. Trace: a `guard-fired` event with guard `lean_final_turn`.

The unused internal `buildToolElaborationInjection` helper is removed. It had no caller.
