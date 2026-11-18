# gate-v2 acceptance: power vs cells (single-stage confirm rule at uniform k per cell, generated, zero tokens)

22 task-tier pairs (cogito:8b 11 tasks + qwen3:4b 11 tasks). cells = 22 x k x 2 arms (+10 per veto rerun). Reps 300. Uniform allocation: confirmMinDiscRuns relaxed to 0. At k<12 the rule cannot promote (confirmMinRuns), so promote % there is 0 by construction; read the axis column.


## Single-stage confirm rule at fixed k=5 per cell (cells = 22 tasks x 5 x 2 arms = 220, plus reruns)
| scenario | promote % | axis (last stage run) | reject % | mean cells | verdict mix (%) |
| --- | --- | --- | --- | --- | --- |
| AA: A/A: identical | 0.0 | NI 38.0 / SAVES 0.0; N*1.2 acc 29 eff 9 | 4.7 (screen 0.0) | 232 | need-more-cells 95.3, reject 4.0, reject-cost 0.7 |
| Hc-10+T-30: as Hc-10 AND tokens x0.70 per run | 0.0 | NI 8.3 / SAVES 57.7; N*1.2 acc 30 eff 9 | 20.7 (screen 0.0) | 239 | need-more-cells 79.3, reject 20.7 |
| H-20: accuracy -20pp on every task | 0.0 | NI 2.3 / SAVES 0.0; N*1.2 acc 31 eff 9 | 72.7 (screen 0.0) | 265 | reject 67.7, need-more-cells 27.3, reject-cost 5.0 |
| T-30: equal accuracy, tokens x0.70 every task | 0.0 | NI 38.0 / SAVES 74.3; N*1.2 acc 29 eff 9 | 4.0 (screen 0.0) | 232 | need-more-cells 96.0, reject 4.0 |
| T-15: equal accuracy, tokens x0.85 every task | 0.0 | NI 38.0 / SAVES 6.0; N*1.2 acc 29 eff 9 | 4.3 (screen 0.0) | 232 | need-more-cells 95.7, reject 4.0, reject-cost 0.3 |
| Tcs-15: as Tc-15 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 0.0 | NI 38.0 / SAVES 43.3; N*1.2 acc 29 eff 9 | 4.0 (screen 0.0) | 232 | need-more-cells 96.0, reject 4.0 |
| Tcs-30: as Tc-30 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 0.0 | NI 38.0 / SAVES 81.0; N*1.2 acc 29 eff 9 | 4.0 (screen 0.0) | 232 | need-more-cells 96.0, reject 4.0 |
| S+10: accuracy +10pp on discriminative tasks, tokens equal | 0.0 | NI 71.7 / SAVES 0.0; N*1.2 acc 27 eff 9 | 0.7 (screen 0.0) | 227 | need-more-cells 99.3, reject-cost 0.3, reject 0.3 |
| Col-100: one discriminative task collapses to 0, rest equal | 0.0 | NI 6.3 / SAVES 0.0; N*1.2 acc 30 eff 9 | 89.0 (screen 0.0) | 247 | reject 88.3, need-more-cells 11.0, reject-cost 0.7 |
| Col-50: one discriminative task halves, rest equal | 0.0 | NI 17.3 / SAVES 0.0; N*1.2 acc 31 eff 9 | 26.7 (screen 0.0) | 240 | need-more-cells 73.3, reject 24.0, reject-cost 2.7 |

## Single-stage confirm rule at fixed k=12 per cell (cells = 22 tasks x 12 x 2 arms = 528, plus reruns)
| scenario | promote % | axis (last stage run) | reject % | mean cells | verdict mix (%) |
| --- | --- | --- | --- | --- | --- |
| AA: A/A: identical | 0.7 | NI 51.3 / SAVES 0.0; N*1.2 acc 31 eff 9 | 4.3 (screen 0.0) | 530 | opt-in 50.7, need-more-cells 44.3, reject 3.7, default-on 0.7, reject-cost 0.7 |
| Hc-10+T-30: as Hc-10 AND tokens x0.70 per run | 7.0 | NI 7.0 / SAVES 60.0; N*1.2 acc 32 eff 9 | 38.7 (screen 0.0) | 532 | need-more-cells 54.3, reject 38.7, default-on 7.0 |
| H-20: accuracy -20pp on every task | 0.0 | NI 0.0 / SAVES 0.0; N*1.2 acc 33 eff 9 | 99.7 (screen 0.0) | 544 | reject 99.3, need-more-cells 0.3, reject-cost 0.3 |
| T-30: equal accuracy, tokens x0.70 every task | 50.7 | NI 51.3 / SAVES 94.3; N*1.2 acc 31 eff 9 | 3.7 (screen 0.0) | 530 | default-on 50.7, need-more-cells 45.0, reject 3.7, opt-in 0.7 |
| T-15: equal accuracy, tokens x0.85 every task | 10.3 | NI 51.3 / SAVES 19.0; N*1.2 acc 31 eff 9 | 3.7 (screen 0.0) | 530 | need-more-cells 45.0, opt-in 41.0, default-on 10.3, reject 3.7 |
| Tcs-15: as Tc-15 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 45.0 | NI 51.3 / SAVES 85.3; N*1.2 acc 31 eff 9 | 3.7 (screen 0.0) | 530 | default-on 45.0, need-more-cells 45.0, opt-in 6.3, reject 3.7 |
| Tcs-30: as Tc-30 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 51.3 | NI 51.3 / SAVES 96.0; N*1.2 acc 31 eff 9 | 3.7 (screen 0.0) | 530 | default-on 51.3, need-more-cells 45.0, reject 3.7 |
| S+10: accuracy +10pp on discriminative tasks, tokens equal | 20.0 | NI 91.7 / SAVES 0.0; N*1.2 acc 29 eff 9 | 0.3 (screen 0.0) | 528 | opt-in 71.3, default-on 20.0, need-more-cells 8.3, reject-cost 0.3 |
| Col-100: one discriminative task collapses to 0, rest equal | 0.0 | NI 3.7 / SAVES 0.0; N*1.2 acc 31 eff 9 | 94.7 (screen 0.0) | 547 | reject 94.7, need-more-cells 4.7, opt-in 0.7 |
| Col-50: one discriminative task halves, rest equal | 0.3 | NI 17.3 / SAVES 0.0; N*1.2 acc 32 eff 9 | 38.0 (screen 0.0) | 538 | need-more-cells 48.3, reject 37.7, opt-in 13.3, default-on 0.3, reject-cost 0.3 |

## Single-stage confirm rule at fixed k=20 per cell (cells = 22 tasks x 20 x 2 arms = 880, plus reruns)
| scenario | promote % | axis (last stage run) | reject % | mean cells | verdict mix (%) |
| --- | --- | --- | --- | --- | --- |
| AA: A/A: identical | 0.7 | NI 69.7 / SAVES 0.0; N*1.2 acc 31 eff 9 | 2.3 (screen 0.0) | 880 | opt-in 70.7, need-more-cells 26.3, reject 2.3, default-on 0.7 |
| Hc-10+T-30: as Hc-10 AND tokens x0.70 per run | 5.3 | NI 5.3 / SAVES 41.3; N*1.2 acc 32 eff 9 | 58.3 (screen 0.0) | 882 | reject 58.3, need-more-cells 34.7, default-on 5.3, opt-in 1.7 |
| H-20: accuracy -20pp on every task | 0.0 | NI 0.0 / SAVES 0.0; N*1.2 acc 33 eff 9 | 100.0 (screen 0.0) | 889 | reject 100.0 |
| T-30: equal accuracy, tokens x0.70 every task | 69.3 | NI 69.7 / SAVES 97.3; N*1.2 acc 31 eff 9 | 2.3 (screen 0.0) | 880 | default-on 69.3, need-more-cells 26.3, reject 2.3, opt-in 2.0 |
| T-15: equal accuracy, tokens x0.85 every task | 34.0 | NI 69.7 / SAVES 48.3; N*1.2 acc 31 eff 9 | 2.3 (screen 0.0) | 880 | opt-in 37.3, default-on 34.0, need-more-cells 26.3, reject 2.3 |
| Tcs-15: as Tc-15 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 68.7 | NI 69.7 / SAVES 96.7; N*1.2 acc 31 eff 9 | 2.3 (screen 0.0) | 880 | default-on 68.7, need-more-cells 26.3, opt-in 2.7, reject 2.3 |
| Tcs-30: as Tc-30 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 69.7 | NI 69.7 / SAVES 97.7; N*1.2 acc 31 eff 9 | 2.3 (screen 0.0) | 880 | default-on 69.7, need-more-cells 26.3, reject 2.3, opt-in 1.7 |
| S+10: accuracy +10pp on discriminative tasks, tokens equal | 29.3 | NI 98.7 / SAVES 0.0; N*1.2 acc 29 eff 9 | 0.0 (screen 0.0) | 880 | opt-in 69.3, default-on 29.3, need-more-cells 1.3 |
| Col-100: one discriminative task collapses to 0, rest equal | 0.0 | NI 5.7 / SAVES 0.0; N*1.2 acc 31 eff 9 | 96.3 (screen 0.0) | 898 | reject 96.3, need-more-cells 3.7 |
| Col-50: one discriminative task halves, rest equal | 0.0 | NI 19.7 / SAVES 0.0; N*1.2 acc 32 eff 9 | 42.7 (screen 0.0) | 889 | reject 42.3, need-more-cells 38.0, opt-in 19.3, reject-cost 0.3 |

## Single-stage confirm rule at fixed k=30 per cell (cells = 22 tasks x 30 x 2 arms = 1320, plus reruns)
| scenario | promote % | axis (last stage run) | reject % | mean cells | verdict mix (%) |
| --- | --- | --- | --- | --- | --- |
| AA: A/A: identical | 0.7 | NI 77.0 / SAVES 0.0; N*1.2 acc 31 eff 9 | 3.3 (screen 0.0) | 1320 | opt-in 83.7, need-more-cells 12.3, reject 3.3, default-on 0.7 |
| Hc-10+T-30: as Hc-10 AND tokens x0.70 per run | 3.3 | NI 3.3 / SAVES 32.7; N*1.2 acc 32 eff 9 | 67.3 (screen 0.0) | 1320 | reject 67.3, need-more-cells 18.3, opt-in 11.0, default-on 3.3 |
| H-20: accuracy -20pp on every task | 0.0 | NI 0.0 / SAVES 0.0; N*1.2 acc 33 eff 9 | 100.0 (screen 0.0) | 1325 | reject 100.0 |
| T-30: equal accuracy, tokens x0.70 every task | 77.0 | NI 77.0 / SAVES 96.7; N*1.2 acc 31 eff 9 | 3.3 (screen 0.0) | 1320 | default-on 77.0, need-more-cells 12.3, opt-in 7.3, reject 3.3 |
| T-15: equal accuracy, tokens x0.85 every task | 49.3 | NI 77.0 / SAVES 60.7; N*1.2 acc 31 eff 9 | 3.3 (screen 0.0) | 1320 | default-on 49.3, opt-in 35.0, need-more-cells 12.3, reject 3.3 |
| Tcs-15: as Tc-15 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 77.0 | NI 77.0 / SAVES 96.7; N*1.2 acc 31 eff 9 | 3.3 (screen 0.0) | 1320 | default-on 77.0, need-more-cells 12.3, opt-in 7.3, reject 3.3 |
| Tcs-30: as Tc-30 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 77.0 | NI 77.0 / SAVES 96.7; N*1.2 acc 31 eff 9 | 3.3 (screen 0.0) | 1320 | default-on 77.0, need-more-cells 12.3, opt-in 7.3, reject 3.3 |
| S+10: accuracy +10pp on discriminative tasks, tokens equal | 43.7 | NI 100.0 / SAVES 0.0; N*1.2 acc 29 eff 9 | 0.0 (screen 0.0) | 1320 | opt-in 56.3, default-on 43.7 |
| Col-100: one discriminative task collapses to 0, rest equal | 0.0 | NI 4.3 / SAVES 0.0; N*1.2 acc 31 eff 9 | 99.3 (screen 0.0) | 1338 | reject 99.3, opt-in 0.7 |
| Col-50: one discriminative task halves, rest equal | 0.0 | NI 22.7 / SAVES 0.0; N*1.2 acc 32 eff 9 | 56.7 (screen 0.0) | 1328 | reject 56.7, opt-in 28.7, need-more-cells 14.7 |

## Single-stage confirm rule at fixed k=50 per cell (cells = 22 tasks x 50 x 2 arms = 2200, plus reruns)
| scenario | promote % | axis (last stage run) | reject % | mean cells | verdict mix (%) |
| --- | --- | --- | --- | --- | --- |
| AA: A/A: identical | 0.7 | NI 88.0 / SAVES 0.0; N*1.2 acc 32 eff 9 | 1.7 (screen 0.0) | 2200 | opt-in 96.7, reject 1.7, need-more-cells 1.0, default-on 0.7 |
| Hc-10+T-30: as Hc-10 AND tokens x0.70 per run | 2.0 | NI 2.0 / SAVES 15.7; N*1.2 acc 33 eff 9 | 84.3 (screen 0.0) | 2200 | reject 84.3, opt-in 12.0, default-on 2.0, need-more-cells 1.7 |
| H-20: accuracy -20pp on every task | 0.0 | NI 0.0 / SAVES 0.0; N*1.2 acc 34 eff 9 | 100.0 (screen 0.0) | 2201 | reject 100.0 |
| T-30: equal accuracy, tokens x0.70 every task | 87.3 | NI 88.0 / SAVES 98.3; N*1.2 acc 32 eff 9 | 1.7 (screen 0.0) | 2200 | default-on 87.3, opt-in 10.0, reject 1.7, need-more-cells 1.0 |
| T-15: equal accuracy, tokens x0.85 every task | 72.0 | NI 88.0 / SAVES 81.0; N*1.2 acc 32 eff 9 | 1.7 (screen 0.0) | 2200 | default-on 72.0, opt-in 25.3, reject 1.7, need-more-cells 1.0 |
| Tcs-15: as Tc-15 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 87.3 | NI 88.0 / SAVES 98.3; N*1.2 acc 32 eff 9 | 1.7 (screen 0.0) | 2200 | default-on 87.3, opt-in 10.0, reject 1.7, need-more-cells 1.0 |
| Tcs-30: as Tc-30 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 87.3 | NI 88.0 / SAVES 98.3; N*1.2 acc 32 eff 9 | 1.7 (screen 0.0) | 2200 | default-on 87.3, opt-in 10.0, reject 1.7, need-more-cells 1.0 |
| S+10: accuracy +10pp on discriminative tasks, tokens equal | 64.7 | NI 100.0 / SAVES 0.0; N*1.2 acc 31 eff 9 | 0.0 (screen 0.0) | 2200 | default-on 64.7, opt-in 35.3 |
| Col-100: one discriminative task collapses to 0, rest equal | 0.0 | NI 6.0 / SAVES 0.0; N*1.2 acc 32 eff 9 | 100.0 (screen 0.0) | 2217 | reject 100.0 |
| Col-50: one discriminative task halves, rest equal | 0.0 | NI 21.7 / SAVES 0.0; N*1.2 acc 33 eff 9 | 70.3 (screen 0.0) | 2208 | reject 70.3, opt-in 27.7, need-more-cells 2.0 |

