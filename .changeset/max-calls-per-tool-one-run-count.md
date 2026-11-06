---
"@reactive-agents/reasoning": patch
---

`maxCallsPerTool` is now counted once per run. The kernel tool gate and the direct-dispatch budget (plan `tool_call` steps, code-action's sandbox bridge) share one count, so a run with several kernel passes cannot go over a cap. Before this, each kernel pass that did not continue an earlier pass started its count at zero. Examples are plan-execute composite steps, a strategy switch and a second strategy run. A 1-call cap then allowed one call per pass. A call now uses the cap when the gate admits it, not only when it succeeds. A sub-agent's run keeps its own count. A strategy function called directly, without `ReasoningService`, now opens its own run scope, so its passes share one run state.
