---
"@reactive-agents/reasoning": patch
---

Opt-in progress-aware exit gate: `HarnessConfig.progressAwareExit` (default OFF). The exit gate denies one soft guard exit per run (deny-once). With the switch on, once that nudge is spent, a later soft guard exit (stall, dispatcher early-stop, low-delta, loop, ...) with work outstanding is denied again when the run ledger recorded a new artifact or substantive tool result since the gate's previous denial. At most 3 such grants per run, and only with room under the iteration cap. Cap and model proposals are unchanged. Each grant emits a `progress_aware_exit` guard-fired event (reason `progress_since_last_exit`) and records `exitGate.grant` on the gate step. Default behavior is byte-identical.
