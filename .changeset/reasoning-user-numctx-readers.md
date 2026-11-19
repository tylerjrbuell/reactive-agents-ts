---
"@reactive-agents/reasoning": patch
---

Reasoning's context-window readers take the agent's declared window per call. `resolveProfileWithWindow(model, provider, { userNumCtx })`, `applyCapabilityMaxTokens(..., userNumCtx)` and `makeObservableLLM({ userNumCtx })` pass it to the capability resolver. So an agent with `.withModel({ numCtx })` on a model id the capability table does not know keeps its profile window and its ContextPressure gauge, and no process-wide capability row is needed. Without the option, behavior is unchanged.
