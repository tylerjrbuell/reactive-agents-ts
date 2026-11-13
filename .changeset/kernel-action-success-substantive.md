---
"@reactive-agents/reasoning": patch
---

An action-required task ("send an email ...") can no longer end `success` on meta-tool calls alone. The run contract's `action-required` requirement is checker-tier, so with no domain tool on the surface the exit gate saw nothing outstanding and a successful `recall` save let a fabricated "email sent" ship. The gate now lists a declared action requirement as outstanding until a successful substantive (non-meta, non-retrieval) tool result lands, the same rule `SideEffectLanded` uses.
