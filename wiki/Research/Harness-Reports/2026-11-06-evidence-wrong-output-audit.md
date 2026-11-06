---
type: harness-report
status: complete
created: 2026-11-06
tags: [attribution, rax-diagnose, had-evidence-wrong-output, h3, long-horizon, zero-token, instrument-audit]
---

# Audit: what `model:had-evidence-wrong-output` really contains

Zero model tokens. This audit re-reads every long-horizon A0 run that `rax-diagnose attribute` labels `model:had-evidence-wrong-output` (19 of 33 failed runs). It also re-reads a tier-balanced sample of 20 H3 runs with that label (current code, 8 qwen3:4b, 8 cogito:8b, 4 bonsai-2:27b). That label covers 203 of 498 failed H3 runs (41%), and 79 of 175 failed runs on current code (45%: qwen 28/57, cogito 40/91, bonsai 11/27).

Scripts and raw output: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/evidence-audit/` (`scan.ts` gives the mechanical checks, `detail.ts` gives per-run timelines, `batch-drops.ts`, `spike.ts` gives the trigger census, `classify.ts` gives the hand classification and tally).

## Verdict (read first)

1. **The label is right for fewer than half the runs.** Only 18 of 39 (46%) are true "had the evidence, wrote the wrong output" model errors. 11 (28%) never gathered the evidence the failing check needed. The owner is still the model, but the label is wrong, and several were catchable. 6 (15%) are harness-primary. 4 (10%) are grader/task-text mismatches.
2. **Context projection is not the leak.** Only 1 of 39 runs (probable) lost decisive evidence to compression. In every other decisive turn checked, the curator logged `kept full`. Do not build a projection fix.
3. **The harness causes that matter are elsewhere.** They are: act-time evidence withholding (gate refusals and the repetition guard), plan-execute output fan-out, and the exit gate accepting an end that the model did not claim as finished. Terminal synthesis rewriting changed no grade: every grader reads files, not the final answer.
4. **The instrument has 6 faults that inflate the model share.** Fix those first, in `packages/trace`, which has no domain warden. Otherwise every later attribution tally repeats this mistake.

## Cause table (primary cause, counts sum to the runs examined)

| Primary cause | LH cogito | LH qwen | H3 qwen | H3 cogito | H3 bonsai | Total |
|---|---|---|---|---|---|---|
| M1 model: wrong output with the evidence in context (label correct) | 5 | 2 | 3 | 6 | 2 | **18** |
| M2 model: evidence for the failing check never gathered (label wrong) | 5 | 4 | 1 | 1 | 0 | **11** |
| H-gate: run ended with task-listed work untouched, and the model did not claim completion | 1 | 1 | 0 | 0 | 0 | **2** |
| H-withheld: gate or guard refused or replaced the evidence read at act time | 0 | 0 | 1 | 0 | 0 | **1** |
| H-assembly: the model's correct content was written into the wrong file shape | 0 | 0 | 1 | 0 | 1 | **2** |
| H-ctx: decisive evidence compressed out of the divergence turn (probable) | 1 | 0 | 0 | 0 | 0 | **1** |
| G: the expected format or behavior cannot be reached from the task text | 0 | 0 | 2 | 1 | 1 | **4** |
| **Runs** | 12 | 7 | 8 | 8 | 4 | **39** |

Harness-contributing (not primary, but present in the trace):
- The gate accepted while listed items were untouched or the content was a placeholder: 4 runs.
- The INPUT `pipeline.json` was compiled as a deliverable: 4 of 4 lh-pipeline-stages runs. The model overwrote the input in 2 of them.
- `repetitionGuard` fired on calls that had only been refused, never run: 1 run.
- An intra-batch write drop flipped 1 check: 1 run.
- Plan-execute's LLM verify said `SATISFIED` on wrong files: 3 runs.
- 10 empty-output turns: 1 run.

The `20/36 runs ended by end_turn early` question: 10 of the 19 audited LH runs ended by `end_turn`. The gate recorded `outstanding: []` every time. 1 run is H-gate. In 3 more the model falsely claimed it was done while listed files were never written (M2, catchable).

## Harness causes: decisive run ids, trace seq, owning file, verdict

Owner for every `packages/reasoning` anchor: **kernel-warden** (`bun run repo scope`).

### H-withheld: evidence refused or replaced at act time. BUILD (a), spike (b)
- **01M6Q4JE73TF** (qwen, h3-todo-heavy): the reads of notes-5/6 were refused twice. The first refusal was `deferred-required-batch` at seq 805/806, a refusal kind that 94f0c9ea5 removed. The second was `required-first` at seq 858/860, and that path is still live. The model then wrote out-5/out-6 as the guessed value `12` (seq 930/934). out-1..4 were correct. Hand-verified.
- **01M6Q2W4XTCW** (qwen, todo-heavy, contributing): `repetitionGuard` returned "You have already called file-read 13 times" for notes-3..6 (seq 1076-1100), which were first-time reads. It also blocked 5 writes. The prior "calls" were gate refusals.
- (a) `packages/reasoning/src/kernel/capabilities/act/guard.ts:55-64` (`buildActionToolCallCounts`) and `:142-158` (`hasDistinctTarget`) count refused action steps. Refusals are real `action` steps (`decide/tool-call-refusals.ts:41` -> `utils/observation-helpers.ts:45`). Census: 5 runs, all failed. They include lh-a0 on afbac9af7, which is after 94f0c9ea5, so the defect is live. **BUILD**: skip action steps whose observation is a tool-gate refusal (`isToolGateRefusal` exists). This is one predicate. Pin it with 01M6Q2W4XTCW.
- (b) `packages/reasoning/src/kernel/capabilities/decide/tool-gating.ts:412-417`: `required-first` runs only the calls to the missing required tool. A mixed batch `[read notes-5, write out-5]` runs the guessed write and refuses the read. **Spike before build**: count mixed read+write batches where a refused read targets a listed input.

### H-assembly: plan-execute `{{from_step}}` fan-out. BUILD after a 1-line check
- **01M6Q4Z1Z7F6** (qwen, h3-plan-only): analysis step s2 was correct at seq 716 (5 SKUs, totalUnits 461, skuCount 24). The plan wrote `{{from_step:s2}}` into all 3 file-writes, so low-stock.txt received the 3-file blob (seq 733). The file-write JSON check rejected only totals.json. The verify step said `SATISFIED` (seq 769). Hand-verified.
- **01M6Q9TECD4F** (bonsai, h3-plan-only): same shape, `=== low-stock.txt ===` sections. Blob written at seq 776, verify `SATISFIED` at seq 812.
- `packages/reasoning/src/types/plan.ts:173-207` (`resolveStepReferences`) passes an analysis result whole into every arg. Census: 14 runs wrote the same content (40 chars or more) to 2 or more files, and **14/14 failed** (bonsai 5/74 on current code). **BUILD**: when one step result fills content for 2 or more distinct file paths, either extract the section named for each file or refuse the write with a model-facing reason. The plan-execute verify LLM's false `SATISFIED` is a second, separate issue; do not fix both in one cycle.

### H-gate: the gate accepts an end the model did not claim as finished. BUILD (a), spike (b)
- **01M6RFTETPXB** (cogito, lh-debug-green): the final output ends "Would you like me to proceed with fixing the bugs in the remaining modules?" (seq 881). The gate accepted (seq 885). `output-not-continuation-intent` passed (seq 892). 5 of 6 modules were never read. Hand-verified.
- **01M6RFAD6P6C** (qwen, lh-debug-green): `loop_resolution` terminated at iteration 5 (seq 154). The gate accepted with `outstanding=[]` (seq 155). 4 of 6 modules were never read. The output talks about slugify only.
- (a) `packages/reasoning/src/kernel/capabilities/verify/quality-utils.ts:48` (`detectContinuationIntent`) is terminal-clause only. It misses an offer-to-continue question. Census: 8 shipped-as-success runs, 6 failed, all cogito. **BUILD** (small, deterministic). Pin it with 01M6RFTETPXB and 01M6KM5MFTR0.
- (b) The contract has no deliverables for in-place-edit and read-every-input tasks. lh-debug-green compiles `deliverables: []` plus a phantom `action:create-ticket`: "test **file** ... one **bug**" matches `run-contract.ts:335-339`. So nothing can hold the run to the 6 listed modules. **DON'T BUILD yet**: spike a listed-input coverage signal at the gate first. The model-claimed-done cases (M2) are model errors that this signal would also catch.

### H-ctx: compression in the decisive turn. DON'T BUILD
- **01M6REK7BVNF** (cogito, rw-4): the 164,800-char comments result took the budget, so the posts result shrank 2836 -> 1202 chars in the write turn (seq 86-92). output.ts became `[...]`. Classified probable, not decisive, because the model also had a ref to recall.
- No second run. qwen 01M6REYNWQ1H and cogito 01M6RFP9NW27 had posts `kept full` in the write turn. The rw-2 runs (01M6Q2JGZSJW, 01M6PZZ41N8W, 01M6QAX0Z3C9) had the CSV `kept full`.

### G: grader or task text. Not a harness fix
- `packages/benchmarks/src/tasks/real-world.ts:640-643` (rw-3, `contains a data table`). The task text never asks for a table. Runs: 01M6PWRBP4FG, 01M6PXBN78NS, 01M6PZSGVC7M (each also missed the salary grounding). Fix: put the table in the prompt, or drop the check. No owner (`packages/benchmarks`).
- rw-6 (01M6QB5C72DT, `sort.ts was not rewritten`) is a deliberate inverted trap. Keep it, but attribution should not book it as "had evidence".

### Also found (contributing, not grade-flipping here)
- **Input compiled as a deliverable.** `artifact:.//home/.../pipeline.json` appears in all 4 lh-pipeline-stages runs. The model overwrote the input in 01M6RFVT8X12 (seq 1207) and 01M6RFM47XY2 (seq 172). 01M6RGCZHQM7 took 4 denials and a `harness_deliverable` failure label. Source: `packages/reasoning/src/kernel/capabilities/verify/derive-conditions.ts:482-529` via `kernel/contract/run-contract.ts:461`. The id is also malformed (`./` prefixed to an absolute path). **BUILD** (clear bug, tiny).
- **Intra-batch drop.** In 01M6PY66QWK3 (qwen, rw-7, sha 77b6d6122) the model emitted 3 file-writes at seq 718 and only 1 ran, with no refusal recorded. The dropped processor.ts write was a correct fix. Re-measure at HEAD before acting: 94f0c9ea5 changed batch execution.
- **Empty outputs.** 01M6RGJKYFHN has 10 think turns with `content: ""`, about 1.2k output tokens each, and no tool calls (seq 858-1050). lh-a0 overall: 14 of 36 runs contain such turns. The trace cannot say what was emitted. Add an instrument (raw output length plus a reason for stripping) before diagnosing.

## Instrument faults in `rax-diagnose attribute` (fix first; no domain warden for `packages/trace`)

| # | Fault | Anchor | Effect in this audit |
|---|---|---|---|
| I1 | The `run-writes` target fallback picks a written file whose checks PASSED (`eval-graded` records only failed checks) | `packages/trace/src/attribution-facts.ts:182-185` | 01M6RFTETPXB targets clamp.ts (passed); all 5 rw-7 runs target validator.ts (passed) |
| I2 | `ruleHadEvidence` asks "were all prior results present", never "was the failing item's evidence ever gathered" | `packages/trace/src/attribution.ts:557-572` | all 11 M2 runs |
| I3 | `droppedCalls` matches by tool name, so 1 file-write running hides 2 dropped ones | `packages/trace/src/attribution.ts:240` | 01M6PY66QWK3 |
| I4 | `presence()` tests the recorded result, which is itself the compressed preview, and structured previews carry no `...N more lines` marker, so `present` does not mean the model saw the payload; curator decisions are ignored | `packages/trace/src/attribution-facts.ts:287-311` | 01M6REK7BVNF booked as had-evidence |
| I5 | Results replaced by a guard notice are dropped from the evidence set instead of counted as withheld | `packages/trace/src/attribution-facts.ts:314,323` | 01M6Q2W4XTCW |
| I6 | Tool-gate refusals of evidence reads are not counted as withheld evidence | `packages/trace/src/attribution.ts:557` (no rule) | 01M6Q4JE73TF |

## Method and hand verification

- `scan.ts` imports the trace package's own `attributeFailure`, `presence`, `requestView` and `evidenceBefore`. For each run it records: target and whether a failed check names it; listed inputs never read; per-write source turn and evidence presence; compressions and curator drops before the last exchange; output authorship (last think verbatim, synth exchange, or assembled); exit-gate decisions; and the assessment's outstanding count before the gate.
- Scan faults found during hand checks and corrected by hand:
  - `targetPassing` is always false, because the trace records failed checks only.
  - The listed-input count misses the `notes-1 through notes-6` templates.
  - Presence inherits I4.
- Hand-verified end to end (timeline, request messages, tool args, grader checks): 01M6RFTETPXB, 01M6Q4JE73TF, 01M6Q4Z1Z7F6. Also checked by hand: 01M6PY66QWK3 (batch args), 01M6REK7BVNF (curator decisions), and 01M6Q2W4XTCW (raw results).
- The census (`spike.ts`) covers 966 traces: 930 H3 plus 36 lh-a0.
- Limits:
  - The recorder caps each message at 2000 chars. So "kept full" comes from curator-decision events, not request text.
  - The H3 sample is current-code only. The 6a6a7f4d5 runs predate 94f0c9ea5.
  - Single-trace H-ctx is probable, not decisive.

## Planned actions (need approval; one fix per cycle)

1. Instrument first (I1-I6, `packages/trace`): no owner, so escalate. Then re-run `rax-diagnose attribute --all` on both corpora to re-measure the split.
2. kernel-warden: `repetitionGuard` ignores refused calls (`guard.ts:55-64,142-158`). Then run the before/after H3 todo-heavy, qwen and cogito, k=5.
3. kernel-warden: plan-execute fan-out guard (`types/plan.ts:173-207`). Then run the before/after h3-plan-only, qwen, cogito and bonsai.
4. kernel-warden: offer-to-continue in `detectContinuationIntent`. Also the input-as-deliverable derive fix (`derive-conditions.ts:482-529`).
5. Benchmarks owner: the rw-3 table check.
6. Spikes only (no build): `required-first` mixed-batch reads, listed-input coverage at the gate, and the empty-output instrument.
