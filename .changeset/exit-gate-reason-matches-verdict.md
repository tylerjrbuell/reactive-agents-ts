---
"@reactive-agents/reasoning": patch
---

The exit gate's record of a model answer now names the same reason the run ends with. For a termination-oracle exit on `content_stable` or `entropy_converged`, the gate step and the `exit_gate` guard event recorded `content_stable` / `entropy_converged`, while the Arbitrator ended the run as `llm_end_turn`. Both now come from one mapping, so the gate record, the event and `terminatedBy` agree. A strict-dependency tool-gate block no longer adds its own system observation; each refused call's `tool_result` already says why it did not run.
