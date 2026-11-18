# gate-v2 acceptance results: two-stage pipeline (generated; zero tokens)

Reproduce: `bun wiki/Research/Audits-2026-11-18-measurement/gate-v2-acceptance/sim.ts all --reps 500 --kdisc 30` (spec) and `--kdisc 0` (owner-literal uniform k=12; promotion then relaxed to confirmMinDiscRuns=0). Fixed seeds. promote = default-on; reject includes screen kills and reject-cost. Axis column = share of runs whose LAST evaluated stage had accuracy NI-or-better / efficiency SAVES on every tier.

## A. SPEC: screen k=5 everywhere, confirm k=12 + discriminative tasks topped up to 30

## A/A and false-promote (two-stage pipeline: screen k=5, confirm k=12)
| scenario | promote % | axis (last stage run) | reject % | mean cells | verdict mix (%) |
| --- | --- | --- | --- | --- | --- |
| AA: A/A: identical | 0.2 | NI 35.8 / SAVES 0.0; N*1.2 acc 30 eff 9 | 2.0 (screen 0.8) | 615 | dropped-at-screen 52.6, opt-in 35.2, need-more-cells 10.0, reject 1.0, killed-at-screen 0.8, default-on 0.2, reject-cost 0.2 |
| H-10: accuracy -10pp on every task | 0.0 | NI 1.6 / SAVES 0.0; N*1.2 acc 30 eff 9 | 25.8 (screen 13.8) | 377 | dropped-at-screen 70.2, killed-at-screen 13.8, reject 12.0, need-more-cells 3.0, opt-in 1.0 |
| H-20: accuracy -20pp on every task | 0.0 | NI 0.4 / SAVES 0.0; N*1.2 acc 30 eff 9 | 60.8 (screen 55.8) | 308 | killed-at-screen 55.8, dropped-at-screen 39.2, reject 5.0 |
| Hc-10: accuracy -10pp on every task the gate classifies discriminative (NI boundary calibration: false-NI must be <= 5%) | 0.0 | NI 0.8 / SAVES 0.0; N*1.2 acc 30 eff 9 | 21.8 (screen 9.8) | 376 | dropped-at-screen 73.4, reject 12.0, killed-at-screen 9.8, need-more-cells 4.2, opt-in 0.6 |
| Hc-10+T-30: as Hc-10 AND tokens x0.70 per run | 4.0 | NI 4.0 / SAVES 27.8; N*1.2 acc 32 eff 9 | 68.4 (screen 8.4) | 948 | reject 60.0, need-more-cells 21.6, killed-at-screen 8.4, dropped-at-screen 6.0, default-on 4.0 |
| Hc-20+T-30: as Hc-20 AND tokens x0.70 per run | 0.0 | NI 0.0 / SAVES 5.6; N*1.2 acc 32 eff 9 | 90.0 (screen 35.6) | 705 | reject 54.4, killed-at-screen 35.6, dropped-at-screen 9.4, need-more-cells 0.6 |
| H-10+T-30: accuracy -10pp AND tokens x0.70 per run (cheap because worse) | 3.0 | NI 4.4 / SAVES 15.8; N*1.2 acc 32 eff 9 | 80.0 (screen 11.4) | 936 | reject 68.6, need-more-cells 11.6, killed-at-screen 11.4, dropped-at-screen 5.4, default-on 3.0 |

## Efficiency power at equal accuracy (two-stage pipeline)
| scenario | promote % | axis (last stage run) | reject % | mean cells | verdict mix (%) |
| --- | --- | --- | --- | --- | --- |
| T-5: equal accuracy, tokens x0.95 (the SAVES null boundary: P(SAVES) must be <= 5%) | 1.0 | NI 39.2 / SAVES 0.0; N*1.2 acc 30 eff 9 | 3.2 (screen 2.0) | 648 | dropped-at-screen 47.2, opt-in 37.4, need-more-cells 11.2, killed-at-screen 2.0, reject 1.2, default-on 1.0 |
| T-10: equal accuracy, tokens x0.90 (exactly the SAVES boundary: P(SAVES) must be <= 5%) | 4.4 | NI 48.0 / SAVES 3.8; N*1.2 acc 30 eff 9 | 3.8 (screen 1.8) | 758 | opt-in 43.2, dropped-at-screen 34.0, need-more-cells 14.6, default-on 4.4, reject 2.0, killed-at-screen 1.8 |
| T-15: equal accuracy, tokens x0.85 every task | 22.6 | NI 59.8 / SAVES 28.4; N*1.2 acc 31 eff 9 | 3.8 (screen 1.8) | 877 | opt-in 36.8, default-on 22.6, dropped-at-screen 19.6, need-more-cells 17.2, reject 2.0, killed-at-screen 1.8 |
| T-30: equal accuracy, tokens x0.70 every task | 71.4 | NI 71.4 / SAVES 94.2; N*1.2 acc 31 eff 9 | 4.4 (screen 1.8) | 1014 | default-on 71.4, need-more-cells 21.2, dropped-at-screen 3.0, reject 2.6, killed-at-screen 1.8 |
| Tc-15: equal accuracy, -15% total tokens carried by the heaviest task only (pth-like) | 4.8 | NI 60.8 / SAVES 4.4; N*1.2 acc 31 eff 9 | 4.0 (screen 1.8) | 888 | opt-in 55.6, dropped-at-screen 18.2, need-more-cells 17.4, default-on 4.8, reject 2.2, killed-at-screen 1.8 |
| Tc-30: equal accuracy, -30% total tokens carried by the heaviest task only | 15.6 | NI 67.8 / SAVES 17.8; N*1.2 acc 31 eff 9 | 4.2 (screen 1.8) | 978 | opt-in 52.2, need-more-cells 20.6, default-on 15.6, dropped-at-screen 7.4, reject 2.4, killed-at-screen 1.8 |
| Tcs-15: as Tc-15 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 63.8 | NI 71.4 / SAVES 82.4; N*1.2 acc 31 eff 9 | 4.4 (screen 1.8) | 1014 | default-on 63.8, need-more-cells 21.2, opt-in 7.6, dropped-at-screen 3.0, reject 2.6, killed-at-screen 1.8 |
| Tcs-30: as Tc-30 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 72.0 | NI 72.0 / SAVES 94.8; N*1.2 acc 31 eff 9 | 4.4 (screen 1.8) | 1019 | default-on 72.0, need-more-cells 21.2, reject 2.6, dropped-at-screen 2.4, killed-at-screen 1.8 |
| C+30: equal accuracy, tokens x1.30 | 0.6 | NI 27.4 / SAVES 0.0; N*1.2 acc 30 eff 9 | 54.0 (screen 27.0) | 468 | dropped-at-screen 44.2, killed-at-screen 27.0, reject-cost 26.0, opt-in 1.2, reject 1.0, default-on 0.6 |
| S+10: accuracy +10pp on discriminative tasks, tokens equal | 25.8 | NI 72.4 / SAVES 0.0; N*1.2 acc 29 eff 9 | 0.4 (screen 0.4) | 821 | opt-in 46.0, dropped-at-screen 27.4, default-on 25.8, killed-at-screen 0.4, need-more-cells 0.4 |

## Task collapse (veto path)
| scenario | promote % | axis (last stage run) | reject % | mean cells | verdict mix (%) |
| --- | --- | --- | --- | --- | --- |
| Col-100: one discriminative task collapses to 0, rest equal | 0.0 | NI 4.0 / SAVES 0.0; N*1.2 acc 30 eff 9 | 86.8 (screen 83.8) | 272 | killed-at-screen 83.8, dropped-at-screen 13.2, reject 3.0 |
| Col-50: one discriminative task halves, rest equal | 0.0 | NI 7.2 / SAVES 0.0; N*1.2 acc 31 eff 9 | 29.0 (screen 18.4) | 426 | dropped-at-screen 59.6, killed-at-screen 18.4, reject 10.2, need-more-cells 7.2, opt-in 4.2, reject-cost 0.4 |


## B. Owner-literal: confirm k=12 uniform, no top-up

## A/A and false-promote (two-stage pipeline: screen k=5, confirm k=12)
| scenario | promote % | axis (last stage run) | reject % | mean cells | verdict mix (%) |
| --- | --- | --- | --- | --- | --- |
| AA: A/A: identical | 1.0 | NI 26.6 / SAVES 0.0; N*1.2 acc 29 eff 9 | 3.2 (screen 0.8) | 478 | dropped-at-screen 52.6, opt-in 25.0, need-more-cells 18.2, reject 2.4, default-on 1.0, killed-at-screen 0.8 |
| H-10: accuracy -10pp on every task | 0.0 | NI 2.6 / SAVES 0.0; N*1.2 acc 29 eff 9 | 22.6 (screen 13.8) | 331 | dropped-at-screen 70.2, killed-at-screen 13.8, reject 8.2, need-more-cells 6.8, reject-cost 0.6, opt-in 0.4 |
| H-20: accuracy -20pp on every task | 0.0 | NI 0.4 / SAVES 0.0; N*1.2 acc 30 eff 9 | 60.8 (screen 55.8) | 293 | killed-at-screen 55.8, dropped-at-screen 39.2, reject 4.8, reject-cost 0.2 |
| Hc-10: accuracy -10pp on every task the gate classifies discriminative (NI boundary calibration: false-NI must be <= 5%) | 0.0 | NI 2.0 / SAVES 0.0; N*1.2 acc 29 eff 9 | 14.4 (screen 9.8) | 328 | dropped-at-screen 73.4, need-more-cells 10.4, killed-at-screen 9.8, reject 4.6, opt-in 1.8 |
| Hc-10+T-30: as Hc-10 AND tokens x0.70 per run | 5.4 | NI 5.4 / SAVES 52.8; N*1.2 acc 31 eff 9 | 42.6 (screen 8.4) | 695 | need-more-cells 46.0, reject 34.2, killed-at-screen 8.4, dropped-at-screen 6.0, default-on 5.4 |
| Hc-20+T-30: as Hc-20 AND tokens x0.70 per run | 0.0 | NI 0.0 / SAVES 13.0; N*1.2 acc 31 eff 9 | 82.2 (screen 35.6) | 544 | reject 46.6, killed-at-screen 35.6, dropped-at-screen 9.4, need-more-cells 8.4 |
| H-10+T-30: accuracy -10pp AND tokens x0.70 per run (cheap because worse) | 2.6 | NI 6.0 / SAVES 33.8; N*1.2 acc 31 eff 9 | 59.0 (screen 11.4) | 690 | reject 47.6, need-more-cells 33.0, killed-at-screen 11.4, dropped-at-screen 5.4, default-on 2.6 |

## Efficiency power at equal accuracy (two-stage pipeline)
| scenario | promote % | axis (last stage run) | reject % | mean cells | verdict mix (%) |
| --- | --- | --- | --- | --- | --- |
| T-5: equal accuracy, tokens x0.95 (the SAVES null boundary: P(SAVES) must be <= 5%) | 1.4 | NI 29.4 / SAVES 0.0; N*1.2 acc 30 eff 9 | 3.2 (screen 2.0) | 500 | dropped-at-screen 47.2, opt-in 27.2, need-more-cells 21.0, killed-at-screen 2.0, default-on 1.4, reject 1.2 |
| T-10: equal accuracy, tokens x0.90 (exactly the SAVES boundary: P(SAVES) must be <= 5%) | 3.8 | NI 36.0 / SAVES 3.2; N*1.2 acc 30 eff 9 | 3.2 (screen 1.8) | 571 | dropped-at-screen 34.0, opt-in 31.8, need-more-cells 27.2, default-on 3.8, killed-at-screen 1.8, reject 1.4 |
| T-15: equal accuracy, tokens x0.85 every task | 11.4 | NI 44.8 / SAVES 16.6; N*1.2 acc 30 eff 9 | 3.6 (screen 1.8) | 647 | opt-in 33.0, need-more-cells 32.4, dropped-at-screen 19.6, default-on 11.4, reject 1.8, killed-at-screen 1.8 |
| T-30: equal accuracy, tokens x0.70 every task | 54.2 | NI 55.0 / SAVES 92.6; N*1.2 acc 30 eff 9 | 4.4 (screen 1.8) | 735 | default-on 54.2, need-more-cells 37.6, dropped-at-screen 3.0, reject 2.6, killed-at-screen 1.8, opt-in 0.8 |
| Tc-15: equal accuracy, -15% total tokens carried by the heaviest task only (pth-like) | 11.6 | NI 46.2 / SAVES 14.8; N*1.2 acc 30 eff 9 | 3.8 (screen 1.8) | 655 | opt-in 34.2, need-more-cells 32.2, dropped-at-screen 18.2, default-on 11.6, reject 2.0, killed-at-screen 1.8 |
| Tc-30: equal accuracy, -30% total tokens carried by the heaviest task only | 27.0 | NI 52.0 / SAVES 43.4; N*1.2 acc 30 eff 9 | 4.4 (screen 1.8) | 712 | need-more-cells 36.2, default-on 27.0, opt-in 25.0, dropped-at-screen 7.4, reject 2.6, killed-at-screen 1.8 |
| Tcs-15: as Tc-15 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 50.0 | NI 55.2 / SAVES 82.2; N*1.2 acc 30 eff 9 | 4.2 (screen 1.8) | 735 | default-on 50.0, need-more-cells 37.6, opt-in 5.2, dropped-at-screen 3.0, reject 2.4, killed-at-screen 1.8 |
| Tcs-30: as Tc-30 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it | 55.4 | NI 55.6 / SAVES 94.6; N*1.2 acc 30 eff 9 | 4.4 (screen 1.8) | 738 | default-on 55.4, need-more-cells 37.6, reject 2.6, dropped-at-screen 2.4, killed-at-screen 1.8, opt-in 0.2 |
| C+30: equal accuracy, tokens x1.30 | 1.0 | NI 23.4 / SAVES 0.0; N*1.2 acc 30 eff 9 | 49.4 (screen 27.0) | 384 | dropped-at-screen 44.2, killed-at-screen 27.0, reject-cost 22.0, opt-in 4.2, need-more-cells 1.2, default-on 1.0, reject 0.4 |
| S+10: accuracy +10pp on discriminative tasks, tokens equal | 17.6 | NI 67.2 / SAVES 0.0; N*1.2 acc 29 eff 9 | 0.4 (screen 0.4) | 608 | opt-in 49.0, dropped-at-screen 27.4, default-on 17.6, need-more-cells 5.6, killed-at-screen 0.4 |

## Task collapse (veto path)
| scenario | promote % | axis (last stage run) | reject % | mean cells | verdict mix (%) |
| --- | --- | --- | --- | --- | --- |
| Col-100: one discriminative task collapses to 0, rest equal | 0.0 | NI 4.2 / SAVES 0.0; N*1.2 acc 30 eff 9 | 86.6 (screen 83.8) | 264 | killed-at-screen 83.8, dropped-at-screen 13.2, reject 2.8, need-more-cells 0.2 |
| Col-50: one discriminative task halves, rest equal | 0.2 | NI 6.4 / SAVES 0.0; N*1.2 acc 30 eff 9 | 25.8 (screen 18.4) | 360 | dropped-at-screen 59.6, killed-at-screen 18.4, need-more-cells 12.0, reject 7.0, opt-in 2.4, reject-cost 0.4, default-on 0.2 |


## C. Robustness: point estimates of p (no Beta resampling), spec allocation

## A/A and false-promote (two-stage pipeline: screen k=5, confirm k=12)
| scenario | promote % | axis (last stage run) | reject % | mean cells | verdict mix (%) |
| --- | --- | --- | --- | --- | --- |
| AA: A/A: identical | 0.2 | NI 36.2 / SAVES 0.0; N*1.2 acc 38 eff 9 | 3.0 (screen 1.8) | 602 | dropped-at-screen 50.4, opt-in 35.8, need-more-cells 10.6, killed-at-screen 1.8, reject 1.2, default-on 0.2 |
| H-20: accuracy -20pp on every task | 0.0 | NI 0.0 / SAVES 0.0; N*1.2 acc 39 eff 9 | 61.6 (screen 57.4) | 296 | killed-at-screen 57.4, dropped-at-screen 38.4, reject 4.2 |
| Hc-10+T-30: as Hc-10 AND tokens x0.70 per run | 4.2 | NI 4.2 / SAVES 35.6; N*1.2 acc 41 eff 9 | 61.0 (screen 9.8) | 892 | reject 51.2, need-more-cells 28.4, killed-at-screen 9.8, dropped-at-screen 6.4, default-on 4.2 |
| Hc-20+T-30: as Hc-20 AND tokens x0.70 per run | 0.0 | NI 0.0 / SAVES 6.6; N*1.2 acc 42 eff 9 | 88.4 (screen 32.4) | 688 | reject 56.0, killed-at-screen 32.4, dropped-at-screen 11.2, need-more-cells 0.4 |

