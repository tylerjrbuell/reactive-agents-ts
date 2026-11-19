---
"@reactive-agents/reasoning": patch
---

The between-turn environment notice (`RunEnvelope.rails.environmentUpdate`, e.g. "the to-do list was edited") is now shown to the model at most once per run. Multi-pass strategies (reflexion's improve pass, plan-execute steps, a strategy switch) used to repeat it once per kernel pass, because each pass started with an empty signal ledger. Consumption is now latched in a run slot (`reasoning.environmentUpdateShown`; sub-agents get their own).
