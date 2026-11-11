---
"@reactive-agents/cortex": patch
---

Lab builder settings each have one home a builder would look in. Approvals moved from Reasoning to Tools (they gate tool calls), with a link to the durable-runs switch. Dynamic sub-agents moved from Tools to Sub-agents and gained a **Nested spawning depth** field (`dynamicSubAgents.maxRecursionDepth`; empty keeps the framework default, where spawned agents cannot spawn their own). Durable execution, token and cost caps, structured output and lifecycle webhooks moved from Reasoning to Execution; documents moved to Memory and cost-aware model routing to Model. Reasoning now holds only the strategy, iterations and how the agent checks its work. Variables is its own nav entry instead of sitting under Persona. **Find a setting** follows: `approval` finds Tools, `spawn` finds Sub-agents, `durable` and `webhook` find Execution, `variable` and `template` find Variables. Every control works as before.
