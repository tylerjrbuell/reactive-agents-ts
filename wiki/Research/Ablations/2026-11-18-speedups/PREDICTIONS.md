---
type: experiment
status: pre-registered
created: 2026-11-17
tags: [ablation, parallel-tool-hint, lean-final-turn, h3, predictions]
---

# Predictions: parallelToolHint and leanFinalTurn vs off

Written 2026-11-17 23:25, after the smoke (6 cells, discarded: Ollama was shared with a foreign `bun test` run) and before any matrix cell was read.

Arms: `off`, `pth` (`RA_PARALLEL_TOOL_HINT=1`), `lft` (`RA_LEAN_FINAL_TURN=1`). Tiers: gemma4:e4b (k=5), cogito:14b (k=3, cut from 5 for wall time). Tasks: h3-todo-heavy, h3-required-tools, h3-continuation, h3-exact-value, ab-trap-5, golden-moons. Worktree pinned at `dbee89b57`.

1. **Both levers fire on both tiers.** Both calibrations rate `parallelCallCapability: "reliable"` and the local-tier prompt lacks the batching sentence, so `pth` should render on every tool turn. `lft` needs a contract tool-work requirement. It should fire on golden-moons, todo-heavy and required-tools. It is less certain on continuation and exact-value, and should not fire on ab-trap-5, because there the tool work never settles (the file never exists).
2. **pth cuts turns where calls are independent.** That means golden-moons (2 writes), todo-heavy (6 reads, 6 writes) and exact-value (2 reads). It should be flat on continuation and required-tools (one read, then a dependent write). Accuracy within noise.
3. **lft cuts billed tokens and wall time on the final turn, not turn count.** It still takes the answer turn, just without tools or thinking. Accuracy within noise. Risk: a lean turn that answers too early on required-tools (the write is the deliverable) would show as a regression there.
4. **Gate verdict: `opt-in` for both, by "within noise", not by a proven efficiency win.** The gate's promotion leg is accuracy lift of at least 3pp at the 95% band. Both tiers sit near ceiling on most of these tasks, so a speed lever cannot clear it. A `default-on` verdict would surprise me. A `reject` would mean real harm (for lft, a status or accuracy regression on a tier).
