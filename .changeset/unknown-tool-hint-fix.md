---
"@reactive-agents/reasoning": patch
"@reactive-agents/observability": patch
---

Fixed — calling a nonexistent tool now suggests the tools you actually have

When a model called a tool name that doesn't exist, the recovery hint used
to narrow its suggestion to whichever available tools had "search"/"fetch"/
"get"/"browse" in their name — even when those tools had nothing to do with
what the model needed. Found via a live-model QA pass: a model hallucinating
a `typescript-checker` tool got steered toward `web-search`/`http-get`
instead of being told about `code-execute`, which it actually had, and
burned its whole retry budget re-hallucinating tool names with no way to
recover. Now always names the real available tools.

Improved — verbose tool-call log lines no longer misread as a numbering bug

`call N` labeled the kernel loop's iteration index, not a per-call sequence
— two tools called in the same iteration both printed `call 0`. Relabeled
to `iter N`.
