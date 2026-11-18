## S4 trigger census

Saved cells scanned: 3203; with a traceFile path: 3144; unique traces that resolve on disk and parse: 2866.
Tasks: 20; tiers: 12.

### All mechanism keys (rate = cells where the key occurred / all resolvable cells)

| key | cells | rate | tasks fired | top task (rate) | < 5%? |
| --- | --- | --- | --- | --- | --- |
| requirement:question-answered@floor | 2816/2866 | 98.3% | 20/20 | ab-trap-4 (100.0%) |  |
| guard-any:terminal_decision | 2814/2866 | 98.2% | 20/20 | ab-trap-4 (100.0%) |  |
| guard:terminal_decision:terminate | 2814/2866 | 98.2% | 20/20 | ab-trap-4 (100.0%) |  |
| requirement:tool-coverage@required-tools | 2756/2866 | 96.2% | 18/20 | ab-trap-4 (100.0%) |  |
| guard-any:wire-request | 2341/2866 | 81.7% | 19/20 | ab-trap-5 (100.0%) |  |
| guard-any:tool_call_extracted | 2187/2866 | 76.3% | 19/20 | golden-moons (100.0%) |  |
| guard-any:deliverable_decision | 1930/2866 | 67.3% | 19/20 | golden-moons (100.0%) |  |
| guard-any:exit_gate | 1589/2866 | 55.4% | 19/20 | golden-moons (100.0%) |  |
| requirement:artifact-produced@task-text | 1537/2866 | 53.6% | 12/20 | golden-moons (100.0%) |  |
| end:end_turn | 1485/2866 | 51.8% | 19/20 | golden-moons (100.0%) |  |
| guard-any:terminal_status_override | 777/2866 | 27.1% | 14/20 | ab-trap-4 (100.0%) |  |
| guard:terminal_status_override:warn | 777/2866 | 27.1% | 14/20 | ab-trap-4 (100.0%) |  |
| requirement:tool-coverage@floor | 638/2866 | 22.3% | 4/20 | rw-2 (100.0%) |  |
| signal:redirect@capabilities/decide/arbitrator.ts:890:applyGroundedTerminalGate | 618/2866 | 21.6% | 16/20 | ab-trap-5 (96.6%) |  |
| guard:exit_gate:block | 429/2866 | 15.0% | 15/20 | lh-pipeline-stages (69.4%) |  |
| end:abstained | 411/2866 | 14.3% | 12/20 | ab-trap-4 (100.0%) |  |
| guard:deliverable_decision:block | 351/2866 | 12.2% | 14/20 | umami-explore (66.7%) |  |
| end:final_answer | 341/2866 | 11.9% | 9/20 | rw-3 (84.8%) |  |
| guard:exit_gate:terminate | 340/2866 | 11.9% | 14/20 | lh-pipeline-stages (63.9%) |  |
| signal:redirect@unresolved-tool-call-guard | 329/2866 | 11.5% | 14/20 | rw-4 (54.3%) |  |
| guard:tool_call_extracted:warn | 327/2866 | 11.4% | 14/20 | rw-4 (54.3%) |  |
| end:harness_deliverable | 267/2866 | 9.3% | 12/20 | lh-pipeline-stages (63.9%) |  |
| guard-any:loop_resolution | 256/2866 | 8.9% | 12/20 | lh-pipeline-stages (38.9%) |  |
| guard-any:stall_deliverable | 232/2866 | 8.1% | 13/20 | lh-pipeline-stages (61.1%) |  |
| guard:stall_deliverable:terminate | 203/2866 | 7.1% | 11/20 | lh-pipeline-stages (61.1%) |  |
| guard-any:dispatcher_early_stop | 199/2866 | 6.9% | 14/20 | h3-todo-heavy (28.6%) |  |
| guard:dispatcher_early_stop:terminate | 194/2866 | 6.8% | 14/20 | h3-todo-heavy (28.6%) |  |
| guard:loop_resolution:terminate | 147/2866 | 5.1% | 12/20 | h3-todo-heavy (17.5%) |  |
| guard:loop_resolution:block | 134/2866 | 4.7% | 12/20 | lh-debug-green (26.8%) | yes |
| signal:other@head-truncation-guard | 131/2866 | 4.6% | 13/20 | umami-explore (36.7%) | yes |
| strategy-switch:reactive->plan-execute-reflect | 123/2866 | 4.3% | 9/20 | h3-todo-heavy (17.5%) | yes |
| signal:redirect@runner.ts | 122/2866 | 4.3% | 10/20 | rw-7 (19.4%) | yes |
| signal:redirect@loop/iterate-pass.ts:710:repeated-identical-failure | 120/2866 | 4.2% | 8/20 | ab-trap-5 (34.1%) | yes |
| signal:redirect@thinking-runaway | 117/2866 | 4.1% | 11/20 | rw-4 (31.4%) | yes |
| end:controller_early_stop:dispatcher_early_stop | 110/2866 | 3.8% | 8/20 | h3-todo-heavy (18.5%) | yes |
| signal:nudge@runner.ts | 103/2866 | 3.6% | 8/20 | rw-7 (23.4%) | yes |
| guard-any:act-or-answer | 92/2866 | 3.2% | 5/20 | lh-debug-green (21.8%) | yes |
| guard:act-or-answer:redirect | 92/2866 | 3.2% | 5/20 | lh-debug-green (21.8%) | yes |
| guard-any:tool-gate | 71/2866 | 2.5% | 8/20 | rw-7 (8.6%) | yes |
| guard:tool-gate:block | 71/2866 | 2.5% | 8/20 | rw-7 (8.6%) | yes |
| guard:stall_deliverable:block | 56/2866 | 2.0% | 12/20 | lh-debug-green (7.0%) | yes |
| end:harness_synthesis | 49/2866 | 1.7% | 7/20 | lh-enumerate-audit (13.0%) | yes |
| guard-any:pending_batch | 49/2866 | 1.7% | 6/20 | rw-7 (10.5%) | yes |
| guard-any:solve-evidence | 49/2866 | 1.7% | 2/20 | rw-3 (12.2%) | yes |
| guard:dispatcher_early_stop:block | 49/2866 | 1.7% | 6/20 | rw-7 (9.9%) | yes |
| end:stall_deliverable | 48/2866 | 1.7% | 5/20 | rw-2 (10.9%) | yes |
| signal:nudge@parallel-tool-hint | 48/2866 | 1.7% | 6/20 | golden-moons (33.3%) | yes |
| guard:pending_batch:warn | 47/2866 | 1.6% | 5/20 | rw-7 (10.5%) | yes |
| guard-any:lean_final_turn | 45/2866 | 1.6% | 5/20 | golden-moons (33.3%) | yes |
| guard:lean_final_turn:redirect | 45/2866 | 1.6% | 5/20 | golden-moons (33.3%) | yes |
| guard-any:plan-fanout-split | 44/2866 | 1.5% | 1/20 | h3-plan-only (18.3%) | yes |
| guard:plan-fanout-split:redirect | 44/2866 | 1.5% | 1/20 | h3-plan-only (18.3%) | yes |
| guard-any:required_tool_quota | 42/2866 | 1.5% | 3/20 | rw-7 (13.2%) | yes |
| guard:required_tool_quota:terminate | 42/2866 | 1.5% | 3/20 | rw-7 (13.2%) | yes |
| requirement:write-coverage@task-text | 40/2866 | 1.4% | 2/20 | lh-debug-green (14.1%) | yes |
| requirement:input-coverage@task-text | 38/2866 | 1.3% | 3/20 | lh-enumerate-audit (21.7%) | yes |
| requirement:action-required@task-text | 36/2866 | 1.3% | 2/20 | lh-debug-green (23.9%) | yes |
| signal:block@unresolved-tool-call-guard | 35/2866 | 1.2% | 6/20 | rw-4 (34.3%) | yes |
| end:tool_call_unresolved | 34/2866 | 1.2% | 6/20 | rw-4 (31.4%) | yes |
| guard-any:strategy_delivery_gate | 32/2866 | 1.1% | 2/20 | h3-plan-only (10.4%) | yes |
| guard:strategy_delivery_gate:block | 32/2866 | 1.1% | 2/20 | h3-plan-only (10.4%) | yes |
| guard-any:low_delta_guard | 29/2866 | 1.0% | 4/20 | lh-debug-green (9.2%) | yes |
| guard-any:plan-ref-normalized | 25/2866 | 0.9% | 2/20 | h3-plan-only (7.9%) | yes |
| guard:plan-ref-normalized:redirect | 25/2866 | 0.9% | 2/20 | h3-plan-only (7.9%) | yes |
| signal:redirect@exit-gate-answer-turn | 25/2866 | 0.9% | 4/20 | rw-7 (4.6%) | yes |
| guard:low_delta_guard:block | 21/2866 | 0.7% | 3/20 | lh-debug-green (7.0%) | yes |
| end:dispatcher-early-stop | 17/2866 | 0.6% | 6/20 | h3-continuation (2.1%) | yes |
| end:loop_detected:all_tools_called | 17/2866 | 0.6% | 2/20 | h3-plan-only (5.0%) | yes |
| guard-any:loop_guidance | 14/2866 | 0.5% | 5/20 | h3-todo-heavy (2.0%) | yes |
| guard:loop_guidance:redirect | 14/2866 | 0.5% | 5/20 | h3-todo-heavy (2.0%) | yes |
| end:max_iterations | 9/2866 | 0.3% | 3/20 | h3-todo-heavy (2.0%) | yes |
| end:required_tool_quota | 9/2866 | 0.3% | 1/20 | rw-7 (3.0%) | yes |
| guard-any:strategy_switch | 8/2866 | 0.3% | 4/20 | rw-9 (1.1%) | yes |
| guard:low_delta_guard:terminate | 8/2866 | 0.3% | 3/20 | ab-trap-5 (2.2%) | yes |
| guard:strategy_switch:warn | 8/2866 | 0.3% | 4/20 | rw-9 (1.1%) | yes |
| end:loop_graceful | 7/2866 | 0.2% | 5/20 | h3-exact-value (0.9%) | yes |
| guard-any:ri-early-stop | 7/2866 | 0.2% | 1/20 | h3-todo-heavy (2.4%) | yes |
| guard:ri-early-stop:block | 7/2866 | 0.2% | 1/20 | h3-todo-heavy (2.4%) | yes |
| guard:strategy_delivery_gate:terminate | 7/2866 | 0.2% | 2/20 | h3-plan-only (2.5%) | yes |
| guard-any:progress_aware_exit | 6/2866 | 0.2% | 2/20 | lh-debug-green (3.5%) | yes |
| guard:progress_aware_exit:block | 6/2866 | 0.2% | 2/20 | lh-debug-green (3.5%) | yes |
| end:loop_resolution | 4/2866 | 0.1% | 2/20 | rw-6 (1.9%) | yes |
| end:llm_error | 2/2866 | 0.1% | 2/20 | lh-1 (2.0%) | yes |
| end:controller_early_stop_ungrounded | 1/2866 | 0.0% | 1/20 | h3-todo-heavy (0.3%) | yes |
| end:switching_exhausted | 1/2866 | 0.0% | 1/20 | rw-9 (0.6%) | yes |

Keys: 85; firing in < 5% of cells: 57 (67.1%).

### Named mechanisms (union of matching keys; per-task top rate)

| mechanism | matching keys | cells fired | rate | top task (rate) | effect-given-trigger needed for +3pp whole-suite | < 5%? |
| --- | --- | --- | --- | --- | --- | --- |
| parallelToolHint (signal) | 1 | 48/2866 | 1.7% | golden-moons (33.3%) | 179pp (impossible) | yes |
| leanFinalTurn (guard) | 2 | 45/2866 | 1.6% | golden-moons (33.3%) | 191pp (impossible) | yes |
| exit gate | 3 | 1589/2866 | 55.4% | wide-metric (100.0%) | 5pp |  |
| dispatcher_early_stop ending | 1 | 110/2866 | 3.8% | h3-todo-heavy (18.5%) | 78pp | yes |
| loop detection | 13 | 500/2866 | 17.4% | lh-pipeline-stages (61.1%) | 17pp |  |
| strategy switching | 1 | 123/2866 | 4.3% | h3-todo-heavy (17.5%) | 70pp | yes |
| forcing / act-or-answer | 2 | 92/2866 | 3.2% | lh-debug-green (21.8%) | 93pp | yes |
| abstention / honesty | 1 | 411/2866 | 14.3% | ab-trap-4 (100.0%) | 21pp |  |
| budget / wrap-up | 0 | 0/2866 | 0.0% | rw-2 (0.0%) | inf | yes |
| tool gate | 2 | 71/2866 | 2.5% | rw-7 (8.6%) | 121pp (impossible) | yes |
| input / write coverage requirement | 2 | 78/2866 | 2.7% | lh-debug-green (23.2%) | 110pp (impossible) | yes |
| loop guidance | 2 | 14/2866 | 0.5% | h3-todo-heavy (2.0%) | 614pp (impossible) | yes |
| verifier / delivery check | 10 | 2008/2866 | 70.1% | wide-metric (100.0%) | 4pp |  |

### Opt-in mechanism signature per comparison (candidate arm vs baseline arm, trace-resolvable cells)

| comparison | base runs | cand runs | top changed keys (base -> cand runs) | candidate-arm cells with the top key | per-task firing of the top key in the candidate arm |
| --- | --- | --- | --- | --- | --- |
| lft | 48 | 48 | guard-any:lean_final_turn 0->40; guard:lean_final_turn:redirect 0->40; signal:redirect@loop/iterate-pass.ts:710:repeated-identical-failure 3->6 | 40/48 (83.3%) | h3-todo-heavy 8/8, h3-required-tools 8/8, h3-continuation 8/8, h3-exact-value 8/8, ab-trap-5 0/8, golden-moons 8/8 |
| pth | 48 | 48 | signal:nudge@parallel-tool-hint 0->48; end:end_turn 32->40; end:controller_early_stop:dispatcher_early_stop 8->0 | 48/48 (100.0%) | h3-todo-heavy 8/8, h3-required-tools 8/8, h3-continuation 8/8, h3-exact-value 8/8, ab-trap-5 8/8, golden-moons 8/8 |
| aoa-gpt4omini | 6 | 6 | end:controller_early_stop:dispatcher_early_stop 0->1; guard-any:dispatcher_early_stop 0->1; guard-any:pending_batch 0->1 | 1/6 (16.7%) | rw-7 1/3, lh-1 0/3 |
| calib-v3 | 36 | 36 | signal:redirect@capabilities/decide/arbitrator.ts:890:applyGroundedTerminalGate 6->3; end:end_turn 25->27; guard:exit_gate:block 5->3 | 3/36 (8.3%) | rw-2 1/6, rw-3 1/6, rw-9 0/6, h3-required-tools 0/6, h3-continuation 0/6, h3-exact-value 1/6 |
| v019-rerun | 120 | 120 | guard:stall_deliverable:terminate 0->4; guard-any:exit_gate 72->76; guard:exit_gate:block 6->10 | 4/120 (3.3%) | rw-2 0/10, rw-3 0/10, rw-6 0/10, rw-7 1/10, rw-9 0/10, ab-trap-4 0/10, ab-trap-5 0/10, h3-plan-only 0/10, h3-todo-heavy 3/10, h3-required-tools 0/10, h3-continuation 0/10, h3-exact-value 0/10 |
| v019-vs-v018 | 70 | 70 | guard-any:solve-evidence 0->9; guard-any:terminal_decision 67->63; guard:terminal_decision:terminate 67->63 | 9/70 (12.9%) | ab-trap-4 0/10, ab-trap-5 0/10, h3-plan-only 9/10, h3-todo-heavy 0/10, h3-required-tools 0/10, h3-continuation 0/10, h3-exact-value 0/10 |
| recent-head | 72 | 72 | guard:exit_gate:block 8->21; guard:exit_gate:terminate 5->18; guard-any:stall_deliverable 6->18 | 21/72 (29.2%) | rw-2 4/6, rw-3 0/6, rw-6 2/6, rw-7 0/6, rw-9 0/6, ab-trap-4 0/6, ab-trap-5 2/6, h3-plan-only 0/6, h3-todo-heavy 1/6, h3-required-tools 0/6, h3-continuation 6/6, h3-exact-value 6/6 |
| recent-fixhead | 72 | 72 | guard:exit_gate:block 8->22; guard:exit_gate:terminate 5->19; guard-any:deliverable_decision 39->30 | 22/72 (30.6%) | h3-continuation 6/6, h3-exact-value 6/6, rw-2 3/6, rw-3 0/6, rw-6 0/6, rw-7 2/6, rw-9 1/6, ab-trap-4 0/6, ab-trap-5 3/6, h3-plan-only 0/6, h3-todo-heavy 1/6, h3-required-tools 0/6 |
| recent-fix2 | 72 | 72 | guard-any:deliverable_decision 39->44; end:end_turn 33->38; guard-any:exit_gate 43->47 | 44/72 (61.1%) | rw-2 3/6, rw-3 1/6, rw-6 5/6, rw-7 5/6, rw-9 6/6, ab-trap-4 0/6, ab-trap-5 0/6, h3-plan-only 3/6, h3-todo-heavy 4/6, h3-required-tools 6/6, h3-continuation 6/6, h3-exact-value 5/6 |
| strat-switch | 26 | 28 | guard:deliverable_decision:block 13->7; strategy-switch:reactive->plan-execute-reflect 0->7; guard-any:terminal_status_override 14->10 | 7/28 (25.0%) | rw-2 1/6, rw-6 1/6, rw-7 3/5, rw-9 0/6, h3-todo-heavy 2/5 |
| strat-switch-k8 | 16 | 16 | strategy-switch:reactive->plan-execute-reflect 0->14; guard-any:loop_resolution 8->2; guard:loop_resolution:terminate 8->2 | 14/16 (87.5%) | rw-7 7/8, h3-todo-heavy 7/8 |
| 2f-lh | 35 | 34 | guard-any:deliverable_decision 34->24; end:tool_call_unresolved 0->9; signal:block@unresolved-tool-call-guard 0->9 | 24/34 (70.6%) | rw-4 2/5, rw-7 5/6, lh-1 5/6, lh-debug-green 5/5, lh-enumerate-audit 3/6, lh-pipeline-stages 4/6 |
| pae-a1 | 30 | 30 | guard-any:stall_deliverable 7->10; guard:stall_deliverable:terminate 7->10; guard:tool_call_extracted:warn 10->12 | 10/30 (33.3%) | rw-4 0/6, rw-7 1/6, lh-debug-green 2/6, lh-enumerate-audit 3/6, lh-pipeline-stages 4/6 |
| pae-a2 | 30 | 30 | end:harness_synthesis 1->4; guard-any:progress_aware_exit 0->3; guard:progress_aware_exit:block 0->3 | 4/30 (13.3%) | lh-debug-green 1/6, rw-4 0/6, rw-7 0/6, lh-enumerate-audit 1/6, lh-pipeline-stages 2/6 |
| pae-a3 | 30 | 30 | end:harness_synthesis 1->5; end:harness_deliverable 10->6; guard:deliverable_decision:block 10->6 | 5/30 (16.7%) | rw-4 0/6, rw-7 0/6, lh-debug-green 2/6, lh-enumerate-audit 2/6, lh-pipeline-stages 1/6 |
| aoa-local | 45 | 45 | guard-any:act-or-answer 0->16; guard:act-or-answer:redirect 0->16; signal:redirect@capabilities/decide/arbitrator.ts:890:applyGroundedTerminalGate 8->0 | 16/45 (35.6%) | rw-7 5/15, lh-1 8/15, lh-debug-green 3/15 |
| ic | 27 | 28 | requirement:input-coverage@task-text 0->28; guard:exit_gate:block 4->10; guard-any:loop_resolution 2->7 | 28/28 (100.0%) | rw-7 10/10, lh-debug-green 9/9, lh-enumerate-audit 9/9 |
| wc | 30 | 30 | requirement:write-coverage@task-text 0->30; guard-any:loop_resolution 1->10; guard:loop_resolution:block 1->10 | 30/30 (100.0%) | rw-7 15/15, lh-debug-green 15/15 |
| bat-custom | 0 | 0 | (no resolvable traces) | | |
| bat-h3mi2 | 0 | 0 | (no resolvable traces) | | |
| stl-h3 | 94 | 95 | guard-any:tool-gate 6->19; guard:tool-gate:block 6->19; signal:nudge@runner.ts 6->1 | 19/95 (20.0%) | rw-2 1/8, rw-3 0/6, rw-6 4/8, rw-7 5/8, rw-9 4/8, ab-trap-4 0/8, ab-trap-5 1/8, h3-plan-only 0/9, h3-todo-heavy 4/8, h3-required-tools 0/8, h3-continuation 0/8, h3-exact-value 0/8 |
| stl-wide | 30 | 30 | guard-any:terminal_status_override 8->12; guard:deliverable_decision:block 8->12; guard:terminal_status_override:warn 8->12 | 12/30 (40.0%) | wide-metric 0/15, umami-explore 12/15 |
| fam-nofam | 0 | 0 | (no resolvable traces) | | |
| fam-nocon | 0 | 0 | (no resolvable traces) | | |
