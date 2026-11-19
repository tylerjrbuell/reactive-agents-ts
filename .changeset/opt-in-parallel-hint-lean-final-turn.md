---
"@reactive-agents/reasoning": patch
"@reactive-agents/runtime": patch
---

**Two harness switches for faster runs: `parallelToolHint` (on by default, calibration-gated) and `leanFinalTurn` (opt-in).**

`parallelToolHint` adds one sentence to the system prompt asking the model to make independent tool calls together in one reply. The kernel already runs every call of a reply before the next turn. It is on by default: the default (`true`) adds it only when the model's calibration rates parallel calls `reliable`. `"always"` adds it for any model. Turn it off with `.withHarness({ parallelToolHint: false })` or `RA_PARALLEL_TOOL_HINT=0`; `RA_PARALLEL_TOOL_HINT=always` forces it. The default mid, large and frontier prompts already end with this sentence, so the switch changes the local tier and custom system prompts. It is never added twice. It is not added with text-parse tool calling, on a turn without tools, under plan posture, or when parallel tool calls are off. Trace: a `harness-signal-injected` event with origin `parallel-tool-hint`. Measured on two local Ollama models (gemma4:e4b, cogito:14b; `wiki/Research/Ablations/2026-11-18-speedups/`): same pass rate, 37% fewer turns, 33% to 39% fewer billed tokens. Ollama generates batched calls one after another, so wall time gains are small. The lift gate scored it opt-in (within noise, no non-inferior-plus-savings path); the default is an owner decision on that efficiency evidence.

`leanFinalTurn` stays opt-in (off by default); its ablation was a reject and it needs rework before any default change. It applies when the run contract declared tool work (a required tool, a file, an action), all of it is done, and only the answer is left. The next model call then ships with no tools and `thinking: false`. Its output budget drops the thinking allowance. If that reply is not the final answer, the next call has its tools again. A second lean turn needs another tool call first. Native function calling only. Env: `RA_LEAN_FINAL_TURN=1`. Trace: a `guard-fired` event with guard `lean_final_turn`.

The unused internal `buildToolElaborationInjection` helper is removed. It had no caller.
