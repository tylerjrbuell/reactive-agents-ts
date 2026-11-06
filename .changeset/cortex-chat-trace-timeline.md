---
"@reactive-agents/cortex": patch
---

Fixed: the chat turn inspector's Run trace **Timeline** view was always empty ("Reasoning 0, LLM calls 0, Tools 0 … No events match the active filters"), even when the Frames view showed the run's loops. The chat trace only fed frames to the trace panel. It now also builds the timeline from the same tracer JSONL, with LLM calls, tool calls, guards, verifier verdicts, the model's text and the final answer grouped by iteration. Each run header in the inspector (main run and sub-agents) now links to that run's page in the run view.
