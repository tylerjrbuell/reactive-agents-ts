---
"@reactive-agents/reasoning": minor
---

Wave 3 rung-2 mechanism: `REACTIVE_AGENTS_FORCE_TEXT_PARSE=1` forces the
text-parse driver (and suppresses the native resolver, avoiding the 482c11e4
divergence) so the taught grammar can be exercised on capable frontier models.
Unset/invalid values leave capability-based routing unchanged. Bench arms
(`forceTextParse`) pin it per run; the triad test pins both directions.
