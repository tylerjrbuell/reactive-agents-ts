---
"@reactive-agents/reasoning": patch
---

Only declared requirements and literal anchors checked against a receipt can block a run's success; semantic guesses read from task prose now advise. An action requirement inferred from prose (and the derived `SideEffectLanded` condition) no longer fails a run; the verifier's continuation-intent check and percent-only fabricated-measurement findings warn instead of rejecting (a unit-bearing number that no observation holds still rejects). A completed outward-action claim ("I've sent the email") with no successful non-meta tool call is now unbacked even when the run has no tools. `all_tools_called` counts successful tool results, not attempts, and a guard's synthesized reply is no longer recorded as a successful tool call in the trace or ledger. The exit-gate trace records a `basis` (`declared`, `evidence`, `heuristic`) for each outstanding item and lists advisory items.
