---
"@reactive-agents/reasoning": patch
---

A control-plane `abstain` for a stalled enumeration requirement ("expects N items, found 0, no progress") is now acted on instead of being resolved and ignored every iteration. The run ends through the exit gate once the stall passes its patience (the larger of 4 and 10% of `maxIterations`): the model's draft ships as a partial with an `Unfinished:` list, or the run fails naming the incomplete requirement with the gathered evidence attached. An enumeration that is still advancing never abstains.
