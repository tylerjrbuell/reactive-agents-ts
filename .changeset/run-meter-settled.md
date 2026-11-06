---
"@reactive-agents/reasoning": patch
---

The run budget meter can now be settled. `settleRunMeter(meter)` marks the run's spend as reported, and every later `applyRunSpend` / `addRunSpend` on that meter is ignored, so LLM work after settlement (such as the forked debrief synthesis) cannot change a total already copied onto the result. `isRunMeterSettled(meter)` reads the flag. `finalizeStrategyResult` is now documented as `@internal`.
