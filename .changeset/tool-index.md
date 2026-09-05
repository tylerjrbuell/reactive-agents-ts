---
"@reactive-agents/reasoning": minor
---

Add a lightweight tool index (opt-in, off by default): a compact, listed-only view of available tools for large tool catalogs, controlled via `ContextProfile.toolDisclosureMode` and `RA_TOOL_INDEX_MAX_ENTRIES`. Fix two bugs found while building it: tool-index-listed tools are now promoted into the real function-calling callable set (they were previously listed but not actually callable), and the discover-tools catalog dump no longer gets silently truncated and re-paraphrased by the model.
