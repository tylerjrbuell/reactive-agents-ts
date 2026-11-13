---
"@reactive-agents/reasoning": patch
---

Loop detection now measures state change, not call classification, and answers a detection with graduated guidance before it can stop a run. A state-mutating meta tool (`todo`, `checkpoint`) whose result differs from its previous result counts as progress, so a run that calls `todo` many times with different arguments while the list moves is no longer terminated as a loop (Cortex run `01M78GC3H6JW5RWNRS7FCSC7X3` ended `loop-after-work` that way). An identical call whose results keep changing (polling) is no longer a repeated-tool-call loop. The first detections get a model-visible loop warning (budget `2 + floor(maxIterations/20)`, max 6; +2 for long-horizon runs, max 8; override with `loopDetection.guidanceCycles`, `0` = stop on first detection); only sustained zero progress reaches the strategy switch or stop path, and any progress action resets the count.
