---
"@reactive-agents/cortex": minor
"@reactive-agents/core": patch
"@reactive-agents/reasoning": patch
"@reactive-agents/runtime": minor
"@reactive-agents/tools": patch
"@reactive-agents/judgment": patch
"@reactive-agents/guardrails": patch
"@reactive-agents/ui-core": minor
---

Durable resume: recovered tool effects are consume-once, consulted before the approval gate, and seeded only from rows at or after the checkpoint iteration. Judgment: the LLM backend rejects prototype-key choices and non-finite self-reports; `jev-primary` guardrail strictness degrades to additive on an uncalibrated backend. Runtime: continuation passes (`withMinIterations`, custom termination, output validators, reflect-revise) fold the prior answer and the instruction into one goal instead of restarting blind, so tool calls are no longer repeated; `ToolCallCompleted` stream events carry args/result/error and a new `ThinkingEmitted` event carries provider thinking. ui-core: shared `foldTurnTrace` turn-trace fold. Tools: the `<|tool_call>call:NAME{...}<tool_call|>` dialect is parsed, and unparsed tool-call markup is never accepted as a final answer. Cortex: persisted, inspectable thinking and tool calls; chat fork / rewind / rerun / clear / compact; chat auto-naming; Tools on/off switch; per-chat memory (off by default; clear rotates agent identity); raw JSONL trace download; rerun for any agent; Frames-first trace tab with bounded rendering of large results; superseded paused runs no longer stack approval toasts; Signal image pins signal-cli 0.14.9.
