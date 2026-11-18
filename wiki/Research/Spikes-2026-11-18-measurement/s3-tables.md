## A. Comparisons: v1 (real evaluateLiftGate) vs v2 (pre-registered rules)

| id | tiers | tasks | cells/arm | v1 | v1 lift pp | v1 tok% | v2 | v2 RD pp [CI] | disc tasks | eff: state, geo tok ratio [t-CI], tokens/solved ratio | b / c (McNemar p) | MDE pp | n/cell for NI | known | v1 | v2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lft | 2 | 6 | 24 | reject | -10.4 | -3.9 | reject-veto-pending | 66.7 [-,-]; -53.3 [-156.8,50.1] | 1/3 | F0.96 [0.80,1.16] tps0.89; F0.87 [0.61,1.23] tps1.32 | 8/2 (p=0.11) | 17.7 | 275/103 | HARMFUL (high) | reject | reject |
| pth | 2 | 6 | 24 | opt-in | -0.9 | -35.9 | need-more-cells | - [-,-]; 0.0 [-86.1,86.1] | 0/3 | F0.85 [0.47,1.57] tps0.61; F0.87 [0.47,1.62] tps0.67 | 2/2 (p=1.00) | 11.7 | -/81 | EFFICIENCY-ONLY (high) | hold | hold |
| aoa-gpt4omini | 1 | 2 | 6 | reject | -29.6 | 2.6 | reject-veto-pending | -16.7 [-652.0,618.6] | 2 | F1.05 [0.08,13.40] tps2.05 | 2/1 (p=1.00) | 78.6 | 116 | HARMFUL (medium) | reject | reject |
| calib-v3 | 2 | 6 | 18 | opt-in | -2.0 | 1.9 | need-more-cells | -33.3 [-,-]; -33.3 [-,-] | 1/1 | F0.97 [0.64,1.48] tps1.17; F1.01 [0.87,1.17] tps1.09 | 2/0 (p=0.50) | 10.7 | 172/172 | NEUTRAL (medium) | hold | hold |
| v019-rerun | 2 | 12 | 60 | underpowered | 2.5 | 4.2 | reject-veto-pending | 20.0 [-25.0,65.0]; -5.4 [-81.3,70.5] | 4/3 | F1.05 [0.91,1.21] tps0.91; F0.94 [0.88,1.02] tps1.01 | 5/9 (p=0.42) | 9.1 | 78/97 | NEUTRAL (medium) | hold | reject |
| v019-vs-v018 | 2 | 7 | 35 | underpowered | 5.1 | -4.1 | need-more-cells | 20.0 [-234.1,274.1]; - [-,-] | 2/0 | F0.95 [0.83,1.09] tps0.90; F1.16 [1.07,1.27] tps1.02 | 2/4 (p=0.69) | 11.2 | 149/- | unlabelled | hold | hold |
| recent-head | 2 | 12 | 36 | underpowered | 2.8 | -4.7 | need-more-cells | 33.3 [-390.2,456.9]; 1.8 [-59.5,63.0] | 2/4 | F1.10 [0.78,1.55] tps0.83; F1.18 [0.83,1.69] tps1.07 | 3/5 (p=0.73) | 11.1 | 155/60 | NEUTRAL (low) | hold | hold |
| recent-fixhead | 2 | 12 | 36 | underpowered | 5.6 | 25.7 | need-more-cells | 66.7 [-356.9,490.2]; 2.4 [-80.4,85.2] | 2/3 | F1.37 [1.01,1.88] tps0.98; F1.36 [0.98,1.88] tps1.21 | 2/6 (p=0.29) | 11.0 | 138/95 | unlabelled | hold | hold |
| recent-fix2 | 2 | 12 | 36 | underpowered | 6.9 | 13.8 | need-more-cells | 25.0 [-41.7,91.7]; -29.8 [-104.8,45.2] | 4/4 | F1.04 [0.89,1.22] tps0.94; F1.15 [0.90,1.48] tps1.38 | 6/6 (p=1.00) | 13.7 | 77/76 | unlabelled | hold | hold |
| strat-switch | 2 | 5 | 15 | underpowered | -9.9 | 8.2 | reject-veto-pending | 0.0 [-847.1,847.1]; 50.0 [-,-] | 2/1 | F0.95 [0.60,1.49] tps1.08; F0.99 [0.51,1.91] tps0.89 | 2/2 (p=1.00) | 22.4 | 155/232 | unlabelled | hold | reject |
| strat-switch-k8 | 1 | 2 | 16 | opt-in | -6.2 | 28.1 | need-more-cells | -12.5 [-,-] | 1 | F1.24 [0.24,6.33] tps- | 1/0 (p=1.00) | 16.9 | 73 | unlabelled | hold | hold |
| 2f-lh | 2 | 6 | 18 | reject | -15.6 | -39.7 | need-more-cells | - [-,-]; 25.9 [-821.1,873.0] | 0/2 | F0.57 [0.31,1.04] tps-; F0.70 [0.43,1.15] tps0.32 | 1/2 (p=1.00) | 14.2 | -/123 | unlabelled | reject | hold |
| pae-a1 | 2 | 5 | 15 | underpowered | -8.0 | 11.2 | need-more-cells | - [-,-]; 0.0 [-423.5,423.5] | 0/2 | F1.11 [0.86,1.44] tps-; F0.97 [0.57,1.63] tps1.03 | 1/1 (p=1.00) | 13.7 | -/138 | unlabelled | hold | hold |
| pae-a2 | 2 | 5 | 15 | underpowered | 5.5 | 7.8 | need-more-cells | - [-,-]; 0.0 [-423.5,423.5] | 0/2 | F1.13 [0.78,1.64] tps-; F1.14 [0.84,1.55] tps1.15 | 1/1 (p=1.00) | 13.7 | -/138 | unlabelled | hold | hold |
| pae-a3 | 2 | 5 | 15 | underpowered | -0.2 | 12.4 | need-more-cells | - [-,-]; 0.0 [-,-] | 0/1 | F1.11 [0.84,1.46] tps-; F0.99 [0.58,1.68] tps1.01 | 1/1 (p=1.00) | 13.7 | -/275 | unlabelled | hold | hold |
| aoa-local | 5 | 3 | 9 | opt-in | 13.8 | 11.5 | need-more-cells | - [-,-]; 16.7 [-618.6,652.0]; - [-,-]; 16.7 [-618.6,652.0]; 50.0 [-161.8,261.8] | 0/2/0/2/2 | F0.90 [0.28,2.91] tps-; F1.41 [0.25,7.77] tps1.19; F0.95 [0.70,1.29] tps-; F1.33 [0.40,4.50] tps0.98; F1.22 [0.83,1.81] tps0.30 | 2/7 (p=0.18) | 18.1 | -/151/-/116/151 | unlabelled | hold | hold |
| ic | 3 | 3 | 9 | underpowered | -11.9 | 131.3 | need-more-cells | - [-,-]; -33.3 [-75.6,17.4]; -33.3 [-668.6,602.0] | 0/2/2 | F2.11 [0.21,21.54] tps-; F1.16 [0.35,3.84] tps1.94; F1.48 [0.00,452.98] tps6.34 | 3/1 (p=0.63) | 28.7 | -/149/130 | unlabelled | hold | hold |
| wc | 3 | 2 | 10 | opt-in | 13.3 | 88.9 | need-more-cells | - [-,-]; - [-,-]; 40.0 [-,-] | 0/0/1 | F2.67 [0.01,1213.21] tps-; F2.43 [0.00,33674.21] tps2.16; F1.01 [0.07,14.52] tps- | 0/2 (p=0.50) | 14.1 | -/-/198 | unlabelled | hold | hold |
| bat-custom | 3 | 3 | 18 | opt-in | -0.6 | -3.9 | need-more-cells | -16.7 [-,-]; - [-,-]; - [-,-] | 1/0/0 | F0.95 [0.64,1.41] tps-; F0.81 [0.49,1.32] tps-; F1.07 [0.31,3.70] tps- | 1/0 (p=1.00) | 5.1 | 95/-/- | unlabelled | hold | hold |
| bat-h3mi2 | 3 | 2 | 12 | opt-in | 5.6 | -13.0 | need-more-cells | 0.0 [-,-]; - [-,-]; 33.3 [-,-] | 1/0/1 | F0.93 [0.55,1.55] tps0.93; F0.74 [0.57,0.97] tps0.74; F0.94 [0.69,1.27] tps0.73 | 1/3 (p=0.63) | 15.3 | 172/-/275 | unlabelled | hold | hold |
| stl-h3 | 2 | 12 | 48 | underpowered | 0.0 | 0.0 | reject-veto-pending | -8.7 [-31.6,15.2]; 9.5 [-33.0,52.1] | 5/7 | C1.32 [1.15,1.51] tps1.32; F0.92 [0.72,1.17] tps0.94 | 9/9 (p=1.00) | 13.7 | 43/44 | unlabelled | hold | reject |
| stl-wide | 3 | 2 | 10 | opt-in | -1.1 | 10.9 | reject-veto-pending | - [-,-]; -40.0 [-,-]; -40.0 [-,-] | 0/1/1 | F1.65 [0.02,123.54] tps1.45; F0.92 [0.43,1.99] tps1.88; F0.92 [0.30,2.80] tps- | 4/0 (p=0.13) | 17.4 | -/297/198 | unlabelled | hold | reject |
| fam-nofam | 3 | 1 | 9 | reject | 6.7 | 4.4 | need-more-cells | -10.0 [-,-]; 25.0 [-,-]; 12.5 [-,-] | 1/1/1 | U0.97 [0.00,-] tps-; U1.07 [0.00,-] tps0.36; U1.10 [0.00,-] tps0.55 | 2/4 (p=0.69) | 26.0 | 59/232/189 | unlabelled | reject | hold |
| fam-nocon | 2 | 1 | 8 | opt-in | 39.6 | 24.6 | need-more-cells | 37.5 [-,-]; 25.0 [-,-] | 1/1 | U1.25 [0.00,-] tps-; U1.24 [0.00,-] tps- | 0/5 (p=0.06) | 32.4 | 189/136 | unlabelled | hold | hold |

### Concordance against known outcomes

| id | known | v1 decision | v2 verdict | v2 reason | v1 correct? | v2 correct? |
| --- | --- | --- | --- | --- | --- | --- |
| lft | HARMFUL (high) | reject | reject-veto-pending | task delta <= -40pp: gemma4:e4b:h3-exact-value+ab-trap-5 (rerun to confirm) | yes | yes |
| pth | EFFICIENCY-ONLY (high) | opt-in | need-more-cells | accuracy unresolved on cogito:14b(disc=0), gemma4:e4b(disc=3) | partial (hold, no efficiency credit) | partial (hold, no efficiency credit) |
| aoa-gpt4omini | HARMFUL (medium) | reject | reject-veto-pending | task delta <= -40pp: gpt-4o-mini:rw-7 (rerun to confirm) | yes | yes |
| calib-v3 | NEUTRAL (medium) | opt-in | need-more-cells | accuracy unresolved on cogito:8b(disc=1), qwen3:4b(disc=1) | yes | yes |
| v019-rerun | NEUTRAL (medium) | underpowered | reject-veto-pending | task delta <= -40pp: qwen3:4b:rw-6 (rerun to confirm) | yes | NO (false reject) |
| recent-head | NEUTRAL (low) | underpowered | need-more-cells | accuracy unresolved on cogito:8b(disc=2), qwen3:4b(disc=4) | yes | yes |

### Every v1 vs v2 flip (coarse class: promote / reject / hold)

| id | v1 | v2 | v2 reason |
| --- | --- | --- | --- |
| v019-rerun | underpowered (hold) | reject-veto-pending (reject) | task delta <= -40pp: qwen3:4b:rw-6 (rerun to confirm) |
| strat-switch | underpowered (hold) | reject-veto-pending (reject) | task delta <= -40pp: cogito:8b:rw-6 (rerun to confirm) |
| 2f-lh | reject (reject) | need-more-cells (hold) | accuracy unresolved on cogito:8b(disc=0), qwen3:4b(disc=2) |
| stl-h3 | underpowered (hold) | reject-veto-pending (reject) | task delta <= -40pp: mimo-v2.6@16384:h3-continuation (rerun to confirm) |
| stl-wide | opt-in (hold) | reject-veto-pending (reject) | task delta <= -40pp: mimo-v2.6@16384:wide-metric, mimo-v2.6@8192:wide-metric (rerun to confirm) |
| fam-nofam | reject (reject) | need-more-cells (hold) | accuracy unresolved on grok-4(disc=1), mimo-v2.6@16384(disc=1), mimo-v2.6@8192(disc=1) |

v2 resolved (not need-more-cells): 6/24.

## B. Clustering: naive unpaired SE of the pass-rate difference vs task-clustered paired SE

Cluster-robust SE = sd(task-level differences)/sqrt(T), task means as the unit (Miller 2411.00640 with runs averaged within task).

| comparison | tier | tasks | cells/arm | naive SE pp | clustered paired SE pp | ratio (clustered/naive) |
| --- | --- | --- | --- | --- | --- | --- |
| lft | cogito:14b | 6 | 18 | 10.3 | 11.1 | 1.08 |
| lft | gemma4:e4b | 6 | 30 | 10.9 | 16.1 | 1.47 |
| pth | cogito:14b | 6 | 18 | 12.4 | 0.0 | 0.00 |
| pth | gemma4:e4b | 6 | 30 | 8.8 | 8.9 | 1.02 |
| aoa-gpt4omini | gpt-4o-mini | 2 | 6 | 24.5 | 50.0 | 2.04 |
| calib-v3 | cogito:8b | 6 | 18 | 16.6 | 5.6 | 0.33 |
| calib-v3 | qwen3:4b | 6 | 18 | 16.0 | 5.6 | 0.35 |
| v019-rerun | cogito:8b | 12 | 60 | 9.1 | 5.1 | 0.56 |
| v019-rerun | qwen3:4b | 12 | 56 | 7.7 | 3.9 | 0.50 |
| v019-vs-v018 | cogito:8b | 7 | 34 | 11.9 | 5.7 | 0.48 |
| v019-vs-v018 | qwen3:4b | 7 | 32 | 0.0 | 0.0 | - |
| recent-head | qwen3:4b | 12 | 36 | 10.3 | 5.8 | 0.56 |
| recent-head | cogito:8b | 12 | 36 | 11.6 | 5.6 | 0.48 |
| recent-fixhead | qwen3:4b | 12 | 36 | 10.3 | 4.1 | 0.40 |
| recent-fixhead | cogito:8b | 12 | 36 | 11.6 | 8.5 | 0.73 |
| recent-fix2 | qwen3:4b | 12 | 36 | 10.9 | 8.5 | 0.78 |
| recent-fix2 | cogito:8b | 12 | 36 | 11.6 | 7.3 | 0.62 |
| strat-switch | cogito:8b | 5 | 15 | 14.6 | 21.1 | 1.44 |
| strat-switch | qwen3:4b | 4 | 11 | 19.8 | 12.5 | 0.63 |
| strat-switch-k8 | cogito:8b | 2 | 16 | 6.1 | 6.3 | 1.03 |
| 2f-lh | cogito:8b | 6 | 18 | 0.0 | 0.0 | - |
| 2f-lh | qwen3:4b | 6 | 17 | 10.0 | 18.6 | 1.85 |
| pae-a1 | cogito:8b | 5 | 15 | 0.0 | 0.0 | - |
| pae-a1 | qwen3:4b | 5 | 15 | 12.8 | 10.5 | 0.82 |
| pae-a2 | cogito:8b | 5 | 15 | 0.0 | 0.0 | - |
| pae-a2 | qwen3:4b | 5 | 14 | 13.2 | 10.5 | 0.80 |
| pae-a3 | cogito:8b | 5 | 15 | 0.0 | 0.0 | - |
| pae-a3 | qwen3:4b | 5 | 15 | 12.8 | 0.0 | 0.00 |
| aoa-local | cogito:8b | 3 | 9 | 0.0 | 0.0 | - |
| aoa-local | gemma4:e4b | 3 | 9 | 21.0 | 29.4 | 1.40 |
| aoa-local | llama3.2:3b | 3 | 9 | 0.0 | 0.0 | - |
| aoa-local | qwen3:14b | 3 | 9 | 23.4 | 29.4 | 1.25 |
| aoa-local | qwen3:4b | 3 | 9 | 19.6 | 19.2 | 0.98 |
| ic | cogito:8b | 3 | 9 | 0.0 | 0.0 | - |
| ic | qwen3:14b | 3 | 8 | 23.8 | 11.1 | 0.47 |
| ic | qwen3:4b | 2 | 5 | 29.3 | 50.0 | 1.71 |
| wc | cogito:8b | 2 | 10 | 0.0 | 0.0 | - |
| wc | qwen3:14b | 2 | 9 | 23.8 | 0.0 | 0.00 |
| wc | qwen3:4b | 2 | 10 | 12.6 | 20.0 | 1.58 |
| bat-custom | cogito:8b | 3 | 18 | 5.4 | 5.6 | 1.03 |
| bat-custom | grok-4 | 3 | 18 | 0.0 | 0.0 | - |
| bat-custom | mimo-v2.6@16384 | 3 | 18 | 0.0 | 0.0 | - |
| bat-h3mi2 | cogito:8b | 2 | 12 | 20.1 | 0.0 | 0.00 |
| bat-h3mi2 | grok-4 | 2 | 12 | 0.0 | 0.0 | - |
| bat-h3mi2 | mimo-v2.6@16384 | 2 | 12 | 18.9 | 16.7 | 0.88 |
| stl-h3 | grok-4 | 12 | 57 | 8.8 | 2.2 | 0.25 |
| stl-h3 | mimo-v2.6@16384 | 11 | 33 | 12.2 | 10.8 | 0.89 |
| stl-wide | grok-4 | 2 | 10 | 22.4 | 0.0 | 0.00 |
| stl-wide | mimo-v2.6@16384 | 2 | 10 | 20.0 | 20.0 | 1.00 |
| stl-wide | mimo-v2.6@8192 | 2 | 10 | 12.6 | 20.0 | 1.58 |

## C. Baseline arms: pass^k = mean over tasks of C(c,k)/C(n,k) (tau-bench), pass@k, ICC(1) one-way ANOVA form (MSB-MSW)/(MSB+(n0-1)MSW), SE inflation

| arm | tier | tasks | k | pass rate | pass^1 | pass^2 | pass^3 | pass^4 | pass^5 | pass@5 | ICC(1) | naive SE pp | clustered SE pp | inflation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 11-03 baseline | cogito:8b | 12 | 5 | 28% | 0.28 | 0.20 | 0.18 | 0.17 | 0.17 | 0.50 | 0.61 | 5.8 | 11.1 | 1.91 |
| 11-03 baseline | qwen3:4b | 12 | 5 | 67% | 0.67 | 0.63 | 0.62 | 0.60 | 0.60 | 0.80 | 0.85 | 6.2 | 13.2 | 2.14 |
| 11-04 baseline | cogito:8b | 12 | 5 | 35% | 0.35 | 0.30 | 0.27 | 0.25 | 0.25 | 0.42 | 0.80 | 6.2 | 13.1 | 2.12 |
| 11-04 baseline | qwen3:4b | 12 | 5 | 66% | 0.62 | 0.57 | 0.56 | 0.51 | 0.50 | 0.80 | 0.77 | 6.3 | 12.7 | 2.01 |
| 11-04 d9 | cogito:8b | 12 | 5 | 35% | 0.35 | 0.28 | 0.23 | 0.20 | 0.17 | 0.50 | 0.69 | 6.2 | 12.3 | 2.00 |
| 11-04 d9 | qwen3:4b | 11 | 5 | 67% | 0.64 | 0.55 | 0.55 | 0.52 | 0.50 | 0.90 | 0.58 | 6.5 | 11.8 | 1.82 |
| 11-05 a698 | cogito:8b | 12 | 5 | 44% | 0.43 | 0.39 | 0.37 | 0.35 | 0.36 | 0.55 | 0.84 | 6.5 | 13.9 | 2.16 |
| 11-05 a698 | qwen3:4b | 11 | 5 | 69% | 0.69 | 0.65 | 0.62 | 0.58 | 0.55 | 0.73 | 0.84 | 6.2 | 13.6 | 2.18 |
| 11-05 77b6 | cogito:8b | 12 | 5 | 43% | 0.43 | 0.39 | 0.37 | 0.35 | 0.33 | 0.50 | 0.84 | 6.4 | 13.9 | 2.17 |
| 11-05 77b6 | qwen3:4b | 12 | 5 | 68% | 0.63 | 0.60 | 0.64 | 0.64 | 0.86 | 0.86 | 0.90 | 6.4 | 13.3 | 2.08 |
| 11-05 plan9 | cogito:8b | 12 | 5 | 44% | 0.43 | 0.38 | 0.35 | 0.33 | 0.36 | 0.55 | 0.81 | 6.5 | 13.7 | 2.12 |
| 11-05 plan9 | qwen3:4b | 12 | 5 | 64% | 0.62 | 0.54 | 0.54 | 0.49 | 0.40 | 0.80 | 0.67 | 6.4 | 12.3 | 1.92 |
| 11-06 6a6a | cogito:8b | 12 | 5 | 43% | 0.43 | 0.38 | 0.35 | 0.33 | 0.33 | 0.50 | 0.81 | 6.4 | 13.7 | 2.14 |
| 11-06 6a6a | qwen3:4b | 12 | 5 | 63% | 0.62 | 0.58 | 0.54 | 0.52 | 0.55 | 0.73 | 0.83 | 6.3 | 13.4 | 2.13 |
| 11-18 final | cogito:8b | 12 | 5 | 47% | 0.47 | 0.39 | 0.37 | 0.35 | 0.33 | 0.67 | 0.72 | 6.4 | 13.1 | 2.03 |
| 11-18 final | qwen3:4b | 12 | 5 | 80% | 0.75 | 0.78 | 0.76 | 0.75 | 0.70 | 0.90 | 0.78 | 5.4 | 11.0 | 2.03 |
| 11-18 rerun | cogito:8b | 12 | 5 | 53% | 0.53 | 0.49 | 0.46 | 0.43 | 0.42 | 0.58 | 0.84 | 6.4 | 14.0 | 2.17 |
| 11-18 rerun | qwen3:4b | 12 | 5 | 77% | 0.73 | 0.69 | 0.74 | 0.73 | 0.73 | 0.91 | 0.77 | 5.6 | 11.1 | 1.99 |
| 11-10 stl base grok-4 | grok-4 | 12 | 5 | 68% | 0.66 | 0.60 | 0.57 | 0.58 | 0.60 | 0.80 | 0.78 | 6.2 | 12.6 | 2.05 |
| 11-06 bonsai-27b | bonsai-2:27b | 11 | 5 | 79% | 0.75 | 0.69 | 0.74 | 0.78 | 0.75 | 0.88 | 0.80 | 5.9 | 11.7 | 1.99 |

Median SE inflation (clustered/naive) over 20 arms: 2.07. Median ICC(1): 0.80. Median pass^5/pass^1: 0.80.

## D. Task discriminativeness (cells pooled over every baseline arm per tier; ranked by p(1-p))

**cogito:8b**: 12 tasks; always-pass/always-fail 6; pass rate in [0.1,0.9] 3.

| task | n | pass rate | class | p(1-p) |
| --- | --- | --- | --- | --- |
| rw-6 | 45 | 38% | discriminative | 0.24 |
| rw-9 | 45 | 69% | discriminative | 0.21 |
| h3-exact-value | 45 | 82% | discriminative | 0.15 |
| rw-3 | 45 | 9% | discriminative | 0.08 |
| ab-trap-5 | 45 | 93% | discriminative | 0.06 |
| h3-todo-heavy | 45 | 4% | discriminative | 0.04 |
| ab-trap-4 | 45 | 100% | saturated | 0.00 |
| h3-continuation | 45 | 100% | saturated | 0.00 |
| h3-plan-only | 45 | 0% | floor | 0.00 |
| h3-required-tools | 45 | 0% | floor | 0.00 |
| rw-2 | 45 | 0% | floor | 0.00 |
| rw-7 | 43 | 0% | floor | 0.00 |

**qwen3:4b**: 12 tasks; always-pass/always-fail 5; pass rate in [0.1,0.9] 3.

| task | n | pass rate | class | p(1-p) |
| --- | --- | --- | --- | --- |
| h3-plan-only | 44 | 45% | discriminative | 0.25 |
| h3-todo-heavy | 43 | 67% | discriminative | 0.22 |
| rw-6 | 43 | 72% | discriminative | 0.20 |
| h3-required-tools | 44 | 95% | discriminative | 0.04 |
| rw-3 | 45 | 4% | discriminative | 0.04 |
| ab-trap-5 | 45 | 96% | discriminative | 0.04 |
| rw-9 | 45 | 98% | discriminative | 0.02 |
| ab-trap-4 | 45 | 100% | saturated | 0.00 |
| h3-continuation | 45 | 100% | saturated | 0.00 |
| h3-exact-value | 45 | 100% | saturated | 0.00 |
| rw-2 | 40 | 0% | floor | 0.00 |
| rw-7 | 17 | 0% | floor | 0.00 |

**grok-4**: 12 tasks; always-pass/always-fail 9; pass rate in [0.1,0.9] 3.

| task | n | pass rate | class | p(1-p) |
| --- | --- | --- | --- | --- |
| h3-plan-only | 3 | 33% | discriminative | 0.22 |
| rw-6 | 5 | 80% | discriminative | 0.16 |
| rw-9 | 5 | 80% | discriminative | 0.16 |
| ab-trap-4 | 5 | 100% | saturated | 0.00 |
| ab-trap-5 | 5 | 100% | saturated | 0.00 |
| h3-continuation | 5 | 100% | saturated | 0.00 |
| h3-exact-value | 5 | 100% | saturated | 0.00 |
| h3-required-tools | 5 | 100% | saturated | 0.00 |
| h3-todo-heavy | 5 | 100% | saturated | 0.00 |
| rw-2 | 5 | 0% | floor | 0.00 |
| rw-3 | 4 | 0% | floor | 0.00 |
| rw-7 | 5 | 0% | floor | 0.00 |

**bonsai-2:27b**: 11 tasks; always-pass/always-fail 9; pass rate in [0.1,0.9] 2.

| task | n | pass rate | class | p(1-p) |
| --- | --- | --- | --- | --- |
| rw-6 | 2 | 50% | discriminative | 0.25 |
| ab-trap-5 | 5 | 80% | discriminative | 0.16 |
| ab-trap-4 | 5 | 100% | saturated | 0.00 |
| h3-continuation | 5 | 100% | saturated | 0.00 |
| h3-exact-value | 5 | 100% | saturated | 0.00 |
| h3-plan-only | 5 | 0% | floor | 0.00 |
| h3-required-tools | 5 | 100% | saturated | 0.00 |
| h3-todo-heavy | 5 | 100% | saturated | 0.00 |
| rw-2 | 3 | 0% | floor | 0.00 |
| rw-3 | 3 | 100% | saturated | 0.00 |
| rw-9 | 5 | 100% | saturated | 0.00 |

## E. A/A splits (identical code halves; every reject is a false reject)

| source | half runs | v1 reject | v1 underpowered | v1 opt-in | v1 default-on | v1 reject @minRuns=2 | v2 reject (any) | v2 reject (no veto) | v2 need-more | v2 neutral | v2 promote |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 11-05 plan9 | 2 | 0% | 100% | 0% | 0% | 1% | 4% | 4% | 96% | 0% | 0% |
| 11-06 6a6a | 2 | 0% | 100% | 0% | 0% | 3% | 2% | 2% | 98% | 0% | 0% |
| 11-18 final | 2 | 0% | 100% | 0% | 0% | 4% | 5% | 5% | 95% | 0% | 0% |
| 11-10 stl base grok-4 | 2 | 0% | 100% | 0% | 0% | 0% | 0% | 0% | 98% | 2% | 0% |
| 11-10 bat off matrix (k=6) | 3 | 5% | 0% | 95% | 0% | 5% | 0% | 0% | 100% | 0% | 0% |
| 11-05 switch k8 noswitch cogito | 4 | 0% | 0% | 100% | 0% | 0% | 1% | 1% | 99% | 0% | 0% |
| 11-18 speedups off (gemma k=5) | 2 | 0% | 100% | 0% | 0% | 0% | 0% | 0% | 100% | 0% | 0% |
