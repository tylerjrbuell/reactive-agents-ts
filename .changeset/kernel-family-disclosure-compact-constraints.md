---
"@reactive-agents/reasoning": patch
---

Tool descriptions keep what a call needs.

- Tool index promotion: a hidden tool that the tool index (`toolIndex`) promotes onto the provider wire now keeps the sentences that limit a parameter's values (for example "type is one of url, referrer, …"), after its first sentence. Before, it kept only the first sentence, so a promoted tool lost its valid values and models sent invalid arguments. Visible tools and promoted tools now share one description trimmer.
- New opt-in harness switch `compactCallConstraints` (`RA_COMPACT_CALL_CONSTRAINTS=1`). Compact tool profiles (`names-only`, `names-and-types`, the local tier) still drop description prose. With the switch on, they keep the value-constraint sentences in the prompt tool reference, the driver listing and the wire description, and the compact reference lists enum values as `a|b|c`. Default off: the measured gain on one local model was below the promotion bar. With it off, compact profiles ship the same schemas as before.
- Blueprint: when the SOLVE call fails, the joined step results now ship as `partial` with `harnessAuthoredOutput` and a verification warning. Before, they shipped as `completed`.
