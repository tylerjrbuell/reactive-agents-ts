---
"@reactive-agents/reasoning": patch
"@reactive-agents/reactive-intelligence": patch
---

Harness polish before v0.19.0:

- An advisory verifier verdict (the answer is kept) now logs at debug level, so a correct answer no longer prints a warning line at normal verbosity. The verdict event is still recorded in the trace.
- A run stopped on request before any answer now reports the stop as its cause ("the run was stopped on request ... before an answer was produced") instead of a generic "no grounded answer" sentence. A stop on a run the fabrication guard already failed keeps the guard's cause and its `abstained` terminal.
- The no-tools carve-out now counts tools that relevance pruning hid but `discover-tools` can still surface, so a pruned-but-discoverable run with no evidence is not reported as success.
- The to-do wrap-up deferral in the exit gate now runs only when `todoWrapUp` is on.
- Curator `compressed` trace events are emitted once per result per run, not on every turn.
- `ContextProfile.recentObservationsLimit` is documented as accepted with no effect (slated for deprecation).
- Semantic entropy (opt-in) embeds only the new thought once the prior thought's embedding is cached, and keeps that cache in the sensor instead of writing into the caller's kernel state.
