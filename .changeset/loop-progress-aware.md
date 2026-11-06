---
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": patch
---

New opt-in harness switch `.withHarness({ loopProgressAware: true })` (Plan 9 item 2f). When an identical tool call repeats and the loop guard fires, the run is redirected with the outstanding work instead of ending, provided a new artifact or substantive tool result landed since the previous loop verdict. A repeat with no progress still ends the run as before. Default off pending a cross-tier measurement.
