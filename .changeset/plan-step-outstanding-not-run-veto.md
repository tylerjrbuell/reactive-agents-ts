---
"@reactive-agents/reasoning": patch
---

Plan-execute no longer fails a verified delivery because one step's own pass left its `answer` requirement open. When the strategy holds its own delivery verdict, a step pass's outstanding criteria stay step-scoped and are not forwarded to the run result, so the runtime success veto reads only the run's own contract coverage.
