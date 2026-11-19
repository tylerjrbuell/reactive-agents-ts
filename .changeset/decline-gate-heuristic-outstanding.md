---
"@reactive-agents/reasoning": patch
---

An honest decline is no longer blocked by heuristic-basis outstanding items (for example "the last text was narration around a tool call") when the required tool never succeeded and the model's own decline text follows the evidence; declared and evidence items still block. The `exit_gate` event now carries a `declineCheck` field (missing tools, the text the check judged, the clause that rejected it) so one traced run explains a handoff.
