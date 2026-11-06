---
"@reactive-agents/reactive-intelligence": minor
"@reactive-agents/reasoning": patch
---

Reactive Intelligence controller keeps only interventions that act (RI controller census over 966 traces, 2026-11-06).

- Removed six interventions that never changed a run: temperature-adjust (its patch never reached a model call, yet it used up the shared 5-fire budget and suppressed early-stop), context-compression (could never apply; its consumer was deleted), skill-activate and its `.agents/skills` loader (no input was ever wired), tool-inject and stall-detect (never passed their thresholds), and harness-harm (no producer). The kernel's `activate-skill` "queued" acknowledgement, which injected nothing, and the write-only verbosity detector are gone too. `ControllerDecision` is now `early-stop | switch-strategy | tool-failure-redirect`. `controller.contextCompression` still enables the controller layer but no longer has its own effect (deprecated).
- tool-failure-redirect: after its nudge, the run is early-stopped only when the model repeats an identical failing call (same tool, same arguments). Retrying with changed arguments, as the nudge asks, or a turn with no tool calls no longer ends the run.
- The controller decision log (`pulse`, handler re-fire counts) records only decisions that were applied, so a suppressed redirect no longer turns the next one into an early stop.
- switch-strategy is no longer proposed when strategy switching is disabled (the default) or exhausted; such a request used to end the run as `switching_exhausted`.
- When the near-cap early-stop stands down because the run is still producing evidence, a `GuardFiredEmitted` event (`guard: "ri-early-stop"`, `outcome: "block"`) and a `ReactiveDecision` (`early-stop-withheld`) now record it.
