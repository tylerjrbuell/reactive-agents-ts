---
"@reactive-agents/tools": patch
"@reactive-agents/reasoning": patch
"@reactive-agents/runtime": patch
---

Fixed — scratchpad disk-spill correctness and robustness (pre-release health sweep)

The scratchpad disk-spill feature (this release) had 3 read sites that
bypassed its marker-resolution helper — most notably the deterministic-
grounding guard, which could inject the literal `[SPILLED_TO_DISK:...]`
marker string into the model-facing evidence prompt instead of the real
content once the spill threshold triggered. Fixed at all 3 sites.

Also: `setScratchpadBounded`'s disk write and the `code-action` sandbox
Worker's message-listener teardown could each turn a recoverable condition
(a disk write failure, a termination race) into a crashed fiber or an
unhandled promise rejection. Both now degrade gracefully instead.

Fixed — `ToolDefinitionError` gets a proper remediation suggestion

A malformed custom tool definition's error now names the tool and the
offending field consistently with every other builder-surfaced error,
instead of falling through to a generic "Unexpected error" message.
