---
"@reactive-agents/runtime": patch
---

Security fix: a `.withAgentTool()` sub-agent now runs under the parent's approval policy, task contract, fabrication guard and grounding, as the docs already said. Before, only dynamic `spawn-agent` children got these. A `.withAgentTool()` child could call a tool the parent's `.withApprovalPolicy()` gates and run it without approval. The child's policy is coerced to block mode (deny by default, `onApprove` honored), the same as `spawn-agent` children. Both kinds now share one mapping (`inheritedSafetyRails`).
