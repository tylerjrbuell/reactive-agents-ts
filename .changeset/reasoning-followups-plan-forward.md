---
"@reactive-agents/reasoning": patch
---

A loop-guard stop now rides `metadata.extensions.loopStop` on every kernel-backed strategy result, so non-durable and streamed runs can surface the stop summary. `appendGuidanceText` and `contributeGuidance` are exported. `ReasoningService.execute` and the strategy registry take an optional `plan` (core or strategy shape) that `blueprint` and `plan-execute-reflect` adopt; `adaptive` forwards it and runs `plan-execute-reflect` when its pick would not adopt a plan. The final plan returns in `metadata.extensions.plan` in core shape with each step's final status. The wrap-up reserve publishes its own `wrap_up_reserve` guard event. New kill switches for seeded-plan runs, both default on: `autoTick` (`RA_AUTO_TICK=0`) and `bookkeepingRefund` (`RA_BOOKKEEPING_REFUND=0`).
