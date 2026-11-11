---
"@reactive-agents/runtime": patch
---

Telemetry and local learning now record the same outcome as the run's result and debrief. Before this fix, a run the runtime failed after the kernel finished (for example, no call to a required tool succeeded, or a declared deliverable was not produced) was sent in the telemetry `RunReport` as `outcome: "success"`, and its applied procedural skill was credited with a success. Both lanes now read the debrief's outcome, which includes runtime vetoes and the verifier gate. A run paused at an approval gate or a pending interaction now gets no debrief, no telemetry record and no learning update. The resumed run records its outcome when it ends.
