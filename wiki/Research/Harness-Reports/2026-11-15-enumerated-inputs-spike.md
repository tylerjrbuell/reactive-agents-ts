---
type: research
status: complete
created: 2026-11-15
tags: [harness, spike, input-coverage, enumerated-inputs, verification, kernel, lh-enumerate-audit]
---

# Spike: how often does a run finish while a task-listed input was never read?

Zero tokens. Read-only scan of the `.jsonl` traces under `/home/tylerbuell/campaign-traces/traces/` (623 files, all subdirs incl. `enum/`, `verify/`, `p2`, `p3a`, `p3b`, per-model dirs), joined with the task specs in `packages/benchmarks/src/h3/{tasks,long-horizon-tasks}.ts`. Scripts are throwaway (scratchpad, not committed). Unit of count: one run (one `.jsonl` with an `eval-graded` event). "Read" = a `file-read` `tool-call-start` whose path basename equals a listed input. Input sets: `lh-enumerate-audit` inv-01..12 (task text lists them), `lh-debug-green` the 6 `src/*.ts` modules, `h3-todo-heavy` notes-1..6 (range phrasing, set reconstructed), `h3-exact-value` a.json + b.json (`ab-count` variant).

## Counts

| Task | runs | wrote deliverable before all listed inputs read | never read all listed inputs | never-read runs graded < 1 | never-read runs ending `status: success` |
|---|---|---|---|---|---|
| lh-enumerate-audit | 26 | 12 | 9 | 9 of 9 | 9 of 9 (all 26 ended success) |
| lh-debug-green (src modules) | 13 | n/a (edit in place) | 5 | 5 of 5 | 4 of 5 |
| h3-todo-heavy | 35 | n/a (per-item write order is legitimate) | 3 | 3 of 3 | not extracted |
| h3-exact-value, a.json + b.json variant | 61 | n/a (answer is the reply) | 6 | 6 of 6 | not extracted |

Excluded as instrument artifact: `lh-pipeline-stages` (14 runs). `pipeline.json` decides which listed batches are used, so "read all listed" is not a valid requirement there; my first pass showed 14/14 and that was the parse, not behavior.

Totals: 23 runs across 4 distinct tasks ended with a listed input never read, and all 23 were graded wrong (< 1). On `lh-enumerate-audit` alone, 12 of 26 runs wrote the audit before reading every invoice; 3 of those read the rest afterward (grades 1.0, 1.0, 0.857), the other 9 never did (grades 0.00 to 0.857, worst 11 of 12 invoices unread). Caveats: the corpus is dominated by small local models (qwen3:4b, gpt-oss, cogito), runs are not independent draws, and the guard name matching is by basename.

## Bar

The brief's bar (fires in at least 3 distinct runs/tasks) is cleared on every cut (23 runs, 4 tasks).

## But the mechanism already exists, and was already ablated

`inputCoverage` (DEBT #39; `RA_INPUT_COVERAGE=1` or `harness.inputCoverage`) is exactly this: `verify/derive-inputs.ts` `deriveListedInputs` turns each listed input into an `input-coverage` requirement (`run-contract.ts` step 2a, provenance `task-text` so `requirementBasis` = `evidence`, blocks); the exit gate and act-or-answer name each unread input. The traces above all ran with it OFF (`run-started.config.mechanisms.inputCoverage:false`, `contract-compiled` has no `input:` requirements). It is default OFF: [[../Ablations/2026-11-07-input-coverage/README]] verdict OPT-IN-ONLY (listed inputs read 40% to 93%, but accuracy -5.3 pp aggregate, +101% billed tokens), because reads happened AFTER the writes (cogito `lh-debug-green` read 36/36 and still scored 0) and the unread-input list pulled act-or-answer forcing away from a missing write (cogito `rw-7` 0.67 to 0.33). [[2026-11-14-partial-answer-root-causes]] lever L4 records the same, "finish the existing rework", already in the kernel-warden queue.

## Decision

Did not build a second mechanism. A new evidence-basis input requirement would duplicate `inputCoverage` (canonical-per-failure-class rule). What the spike adds: the trigger is real and large, and the remaining defect is ORDER, not coverage. Rework items from the ablation, unchanged and still open:

1. Surface unread listed inputs BEFORE the first deliverable write (write-time PendingGuidance naming the unread input), not only at exit.
2. Exclude `input:` items from proactive forcing's outstanding list, or add per-target write coverage so "fix X" stays outstanding.
3. Owner call: are the 6 test files "inputs" for `lh-debug-green` (doubles forced reads)? Narrower rule = files the task asks to fix.

Update 2026-11-15 (owner-approved): item 1 implemented as `kernel/loop/iterate-input-order-seam.ts`, wired into the `ics-nudge` turn operation; a pass that writes while listed inputs are unread appends one `icsGuidance` line naming them. Inert unless `inputCoverage` is on. Not yet measured; ablation-warden next. Items 2 and 3 not done.

Original note: item 1 touches the guard/turn-operations seam and changes model-visible guidance, so it needs a placement decision plus an ablation (>= 2 tiers) before default-on; it should land as a flagged extension of `inputCoverage`, not a new flag.
