---
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": minor
---

Wave 7.4 verification collapse: the `VerifierTier` ladder is deleted (it had
no consumer — nothing outside the policy compiler read it). Tier-1
pure-compute checks (semantic entropy, NLI) now serve the single result
boundary as recorded-but-never-enforced shadow checks, so the verification
package feeds the one gate instead of a parallel stack.
