---
type: harness-report
status: complete
created: 2026-11-04
tags: [h3, completeness, contract, todo-heavy, feedback-loop]
---
# H3 todo-heavy: completeness signal (bound template expansion)

**Weakness.** h3-todo-heavy names its outputs only as a template ("for each notes-N.txt, write out-N.txt"). The contract listed no deliverables, so nothing held the run to all six files; qwen3:4b stopped after 1-3. Attribution: `harness:completeness-blind` (new reason, `76c8714d3`).

**Fix.** `expandBoundTemplate` (`derive-conditions.ts`): a template output path expands into task-explicit per-item deliverables only when the task binds the variable by an enumerated input family ("notes-1.txt through notes-6.txt"), matched by file name so absolute paths bind. Unbound or ambiguous templates are still dropped.

**First attempt was INERT.** The first live measurement compiled no deliverables: the bench runner rewrites inputs to absolute paths and the binder refused a `/` before the file name. The new mechanism-activity check (`verdict.ts --mechanism`) reported `INERT` at once; the zero-token audit had compiled the raw prompt instead of the as-run text.

## Verdicts (k=5, `--mechanism requirement:artifact-produced@task-text`)

| Tier | Verdict | completeness-blind | Pass | Mechanism fired |
|---|---|---|---|---|
| qwen3:4b | FIXED | 2 → 0 | 3/5 → 4/5 (run 0 timed out, no trace) | 0/5 → 4/5 |
| cogito:8b | SHIFTED | 2 → 0 | 2/5 → 0/5 (within noise) | 0/5 → 5/5 |

**cogito:8b failures are pre-existing defects the contract now exposes, not the expansion:**
- `never-engaged` (2): cogito prints tool calls as text (```json blocks, `file-read(path=...)`) and the harness does not run them. Present before the change too. Queue item: tool-call extraction P2.
- `terminal-mislabel` (2): after a switch to plan-execute the kernel ended "done" with files missing; the runtime unproduced-deliverable veto then failed the run. Plan-execute is not on the shared terminal verify gate. Queue item: D9.
- `harness:tool-call-corrupted` (1, new reason in the after arm).

**Cost seen in activity (qwen3:4b):** solved runs now use 13-14 iterations (cap 14), switch to plan-execute in 3/5 and end on a dispatcher early-stop in 4/5. The run is held to the work, but the path to it is long.

Results JSONs here; ledger entries 9-10 in `improvement-ledger.json`. Traces stayed local.
