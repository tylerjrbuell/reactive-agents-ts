---
"@reactive-agents/reasoning": patch
---

New opt-in harness switch `stableToolList` (`RA_STABLE_TOOL_LIST=1`). A kernel pass picks its tool list on the first think turn and keeps it. Tools are only added, by `discover-tools` or when the model uses a tool, and new tools go at the end. The tool block at the head of the prompt therefore stays the same between turns, and the provider prompt cache keeps working. A listed tool that is not ready yet is refused when called, with a note saying what to do first. Examples: `recall` before anything is saved, `discover-tools` when every allowed tool is already listed, `abstain` on the first turn. Required-tool steering uses `Guidance:` and the existing call-time gate; the FC tool list is not narrowed. On Ollama, the head-truncation guard may drop tools only on the first turn. Later turns shrink history instead. Default off until an ablation measures it.

Always on:
- `tool-surface-resolved` now records a reason for a withheld `final-answer` or `abstain`. Before, 179 removals in the 2026-11-10 census had no reason.
- In strict discover mode, a discovered tool now reports `discovered` instead of `allowed-floor`.
- Kernel `ReasoningStepCompleted` events now include `iteration`.
- Blueprint plan verification heals tool names with the canonical healer from `@reactive-agents/tools`. Very short names and tied matches are no longer guessed.
