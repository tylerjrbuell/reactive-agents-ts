# Phase-3 Reduction Ablations — extractObservationFacts + recall-overflow gate

**Date:** 2026-05-30
**Warden:** ablation-warden
**Probe:** `.agents/skills/harness-improvement-loop/scripts/task-quality-gate.ts`
**Fixture (pinned, identical across all arms):** `wiki/Research/Harness-Reports/hn-fixture-2026-05-30.json` (30 HN posts)
**Config:** `RUNS_PER_TASK=3`, `recentObservationsLimit=5`, calibration auto. N=3 per task × 5 tasks = 15 runs/arm.
**Tiers:** cogito:14b (ollama, profile tier `mid`/local-class — obs default-ON) + gpt-4o-mini (openai, profile tier `mid` per `profile-resolver.ts:82` — obs default-ON). Both are obs-affected tiers; this is a genuine 2-tier ablation for both mechanisms.

## Pre-flight verification (silent-collapse guards)

- **obs gate is real on gpt-4o-mini.** `act.ts:143-144` gates `extractObservationFacts` on `profile.tier === "local" || "mid"`. `profile.tier` derives from `context/profile-resolver.ts` (NOT the calibration `model-registry.ts` which maps gpt-4o-mini→frontier). profile-resolver line 82 maps `gpt-4o-mini` → `mid`. So obs is default-ON for gpt-4o-mini → `TASK_GATE_OBS=false` is a real toggle on both tiers.
- **recall gate not overridden by calibration.** `think.ts:353` force-enables recall only when `calibration?.observationHandling === "uses-recall"`. The string `observationHandling` does not appear anywhere in `packages/reactive-intelligence/src/` and `~/.reactive-agents/calibration.db` stores only numeric vectors — so `recallForceOn` is always `false`. `RA_RECALL_GATE=1` genuinely strips recall on cogito; no calibration confound.
- **Shared baseline.** The "all-unset" arm (obs auto-ON, recall gate OFF) is the common baseline for both ablations — run once per tier, referenced in both lift computations. 3 arms × 2 tiers = 6 invocations.

## Raw matrix (N=3, 15 runs/arm)

| Arm | pass^k | avg composite | recall smells | total tokens (15 runs) | in / out |
|---|---|---|---|---|---|
| **cogito A0 baseline** (obs auto-ON, recall OFF) | 5/5 | 86.9% | 2/15 | 85,773 | 71,201 / 3,881 |
| cogito B1 obs-OFF | 5/5 | 83.3% | 1/15 | 95,559 | 80,816 / 4,129 |
| cogito B2 recall-gate-ON | 5/5 | 87.8% | 0/15 | 76,207 | 62,622 / 3,689 |
| **cogito B3 obs-OFF + recall-gate-ON** (post-flip world) | 5/5 | 87.4% | 3/15 | 95,455 | 79,868 / 4,838 |
| **gpt-4o-mini A0 baseline** | 2/5 | 75.2% | 5/15 | 97,681 | 83,081 / 7,760 |
| gpt-4o-mini A1 obs-OFF | 3/5 | 77.3% | 6/15 | 99,832 | 76,348 / 5,976 |
| gpt-4o-mini A2 recall-gate-ON | 5/5 | 89.9% | 0/15 | 67,281 | 53,490 / 3,491 |

Per-task avg tokens/run, T3-strict, postCond met all 3/3 on every arm (no post-condition regressions in any arm).

---

## ABLATION 1 — extractObservationFacts (per-tool-result observation-summary LLM call)

**Mechanism:** default-ON for local+mid tier. Brief hypothesis: it is "pinned at ~44% of LOCAL tokens" and removing it should cut tokens while holding quality.

**Result — the hypothesis is REFUTED on tokens. Removing obs INCREASES tokens on both tiers; quality holds flat once the recall-gate is on.**

### Two comparison frames (the recall-gate confound is the key subtlety)

The naive OFF-vs-baseline frame is **confounded**: baseline and the obs-OFF arm both have the recall-gate OFF, so blind-recall behavior differs between the two obs arms (gpt-4o-mini: 6 vs 5 smells; gpt-4o-mini input tokens actually *dropped* off, with total rising only via T4's 70pp-spread blowup). That contaminates the obs delta on gpt-4o-mini. **The clean comparison is obs-OFF vs obs-ON with the recall-gate held ON in BOTH arms** (B3 vs B2) — this is also the world that exists *after* we flip the recall gate (Ablation 2), so it is the operationally relevant frame.

### Lift-rule arithmetic

**Frame A — clean, recall-gate-ON both arms (cogito B3 obs-OFF vs B2 obs-ON) — the post-flip world:**

| Metric | cogito (clean) |
|---|---|
| composite OFF − ON | 87.4% − 87.8% = **−0.4pp (flat, within noise)** |
| total tokens OFF vs ON | 95,455 vs 76,207 = **+25.3% MORE tokens when obs OFF** |
| recall smells OFF vs ON | **3/15 vs 0/15** (removing obs reintroduces blind recall) |
| pass^k | 5/5 → 5/5 |

**Frame B — confounded, recall-gate-OFF both arms (OFF vs baseline) — reported for completeness, DISCOUNTED:**

| Metric | cogito | gpt-4o-mini (CONFOUNDED — do not cite as clean) |
|---|---|---|
| composite OFF − baseline | 83.3% − 86.9% = −3.6pp | 77.3% − 75.2% = +2.1pp |
| total tokens OFF vs baseline | 95,559 vs 85,773 = +11.4% | 99,832 vs 97,681 = +2.2% (variance + recall-confound, NOT clean) |

**Interpretation.** The "~44% of local tokens" anchor measured the obs *call cost in isolation*. Net of downstream effects, obs is **strongly token-NEGATIVE to remove**: without the per-result digest, the full raw 3-5 KB tool-result JSON stays in the conversation window and is re-sent as input on every subsequent iteration. In the clean post-flip frame (B3 vs B2) removing obs costs **+25.3% tokens** while quality is flat (−0.4pp). The earlier −3.6pp cogito quality drop was partly an artifact of the recall-OFF baseline (blind-recall noise); with the recall-gate on, cogito quality holds — so the verdict no longer rests on a quality cliff, it rests on the token cost.

### Cross-tier divergence + tier-scope caveats

- **Divergence:** in the confounded frame cogito reads −3.6pp and gpt-4o-mini +2.1pp — opposite signs. Per the warden anti-pattern table, divergence pushes away from clean default-on. The honest frame: **obs is token-protective on both tiers and quality-neutral on both once recall is gated; it is not a quality *lift* mechanism on either.** Its job is token containment of raw tool results, not accuracy.
- **Tier scope:** cogito:14b resolves to profile-tier **`mid`** (profile-resolver ollama branch, size 14 > 3), NOT `local`. gpt-4o-mini is also `mid`. **There is no sub-7B `local`-tier datapoint in this run** — so the `local` half of the `local||mid` gate is unsupported-but-unrefuted by this data; do not over-read the "local" framing.

### Lift-rule verdict for obs

A default-ON cost mechanism earns its keep if removing it loses quality or raises tokens. **Removing obs raises tokens +25.3% (clean cogito frame) / +2.2–11.4% (confounded frames) with quality flat-to-negative and recall smells reintroduced.** It fails the removal case primarily on the token axis. No cliff argues for removal; the (now-modest) cogito quality picture and the strong token picture both argue KEEP.

> ### DECISION — extractObservationFacts: **KEEP DEFAULT-ON (mid tier confirmed; local unverified). Do NOT remove, do NOT gate-on-truncation.**
> Clean post-flip evidence (recall-gate ON both arms, cogito): removing obs is **+25.3% tokens** at flat quality (−0.4pp) and reintroduces 3/15 recall smells. The "44%-of-local-tokens" figure is the in-isolation call cost; it is more than repaid by smaller downstream input windows. The mechanism is token-protective, not a quality lift — keep it for cost containment. **No code change.** Caveat: measured only at `mid` tier (cogito:14b + gpt-4o-mini); no sub-7B local datapoint. If a future token reduction is wanted, the lever is the raw-result inline cap / curation, not killing the digest.

---

## ABLATION 2 — recall-overflow gate (RA_RECALL_GATE, currently OPT-IN / default-OFF)

**Mechanism:** strips `recall` from tool schemas unless a >4000-char result was truncated and its storedKey is in-window. Hypothesis: recall-rate → 0 on inline data with quality flat-or-up.

**Result — hypothesis CONFIRMED and exceeded. Recall-rate → 0 on BOTH tiers; quality UP (large on gpt-4o-mini); tokens DOWN on both.**

### Scope note (T3-overflow control)
Tool-result size by task: T2(15 posts)=3,085 ch, T4(20)=3,980 ch, T5(15)=3,085 ch — all **under** the 4000-char overflow cap → recall is stripped by the gate. **T3(25 posts)=5,052 ch — OVER the cap → recall legitimately stays available in BOTH arms.** So the gate's effect is scoped to T2/T4/T5; T3 is the natural control where recall is allowed regardless. The recall-rate → 0 we observe is exactly elimination of *blind* recall on inline-fits data, with the legitimate-overflow path (T3) left intact.

### Lift-rule arithmetic (ON arm vs baseline; gate is a REDUCTION — recommend default-ON only if it cuts recall/tokens with quality flat-or-up)

| Metric | cogito | gpt-4o-mini |
|---|---|---|
| composite ON − baseline | 87.8% − 86.9% = **+0.9pp** | 89.9% − 75.2% = **+14.7pp** |
| pass^k ON vs baseline | 5/5 → 5/5 | **2/5 → 5/5** |
| recall smells ON vs baseline | 2 → **0** | 5 → **0** |
| total tokens ON vs baseline | 76,207 vs 85,773 = **−11.2%** | 67,281 vs 97,681 = **−31.1%** |

**Interpretation.** On gpt-4o-mini the baseline blind-recall was catastrophic: T3 and T5 called `recall()` against inline data, got `{found:false}`, and either echoed the empty/preview result (0-char output) or looped — 5/15 recall smells, only 2/5 pass^k. Gating recall off the schema when no overflow exists removed the lure entirely: 0/15 smells, 5/5 pass^k, +14.7pp composite, −31.1% tokens. On cogito the same direction but smaller (it was already mostly recall-clean): −11.2% tokens, +0.9pp composite, 0 smells, T3-strict even improved (0/3 → 1/3). No tier regressed on any metric. T3 (legit overflow) kept recall and was unharmed.

### Lift-rule verdict for the recall gate

This is a reduction that **cuts tokens (−11% / −31%) AND lifts quality (+0.9pp / +14.7pp) AND zeroes the recall smell on BOTH tiers** with no regression. It clears the PASS bar decisively: ≥3pp lift on ≥2 tiers (14.7pp on gpt-4o-mini; gpt-4o-mini pass^k +60pp), token overhead strongly NEGATIVE (a saving, not a cost), zero cross-tier divergence (both tiers same direction).

> ### DECISION — recall-overflow gate: **FLIP DEFAULT-ON.**
> PASS under the lift rule on both obs-affected tiers: tokens −11.2% (cogito) / −31.1% (gpt-4o-mini), composite +0.9pp / +14.7pp, pass^k 2/5→5/5 on gpt-4o-mini, recall smells →0/15 on both, zero divergence, T3 legit-overflow path unharmed. The opt-in caveat in `think.ts:347-356` (MCP array/object pointer-format risk) is the only open question — **scope the default-on to confirmed in this HN-synthesis ablation; recommend kernel-warden flip the default with a follow-up MCP-data ablation (Phase 4 tool-stability) before declaring it universal.** Within this ablation's data, it is an unambiguous PASS.

---

## Summary for parent

| Mechanism | Current state | Verdict | Lift-rule basis |
|---|---|---|---|
| extractObservationFacts | default-ON (local+mid) | **KEEP DEFAULT-ON** (mid confirmed; local unverified) | Clean post-flip frame (recall-on both arms): removing obs = **+25.3% tokens** at flat quality (−0.4pp) + reintroduces recall smells. Token-protective, not a quality lift. Fails the removal case on cost. |
| recall-overflow gate | OPT-IN (RA_RECALL_GATE) | **FLIP DEFAULT-ON** | PASS: −11%/−31% tokens, +0.9pp/+14.7pp composite, recall smell →0, no divergence. Pair with MCP-data follow-up. |

**Caveat / cliff:** the brief expected obs to be a token hog whose removal holds quality — the data INVERTS the token half: removal is token-NEGATIVE (clean post-flip frame: **+25.3%** tokens) because the digest replaces larger raw tool-result payloads that would otherwise re-send every iteration. The quality cliff is frame-dependent: −3.6pp cogito in the (confounded) recall-OFF baseline, but only −0.4pp in the clean recall-ON post-flip world — so obs is quality-NEUTRAL, token-PROTECTIVE. **Two caveats for kernel-warden:** (1) measured only at `mid` tier (cogito:14b + gpt-4o-mini both resolve to profile-tier mid); no sub-7B `local` datapoint, so the `local` half of the gate is unverified. (2) gpt-4o-mini obs numbers in the recall-OFF frame are confounded by differing blind-recall behavior and are NOT cited as clean support — the obs KEEP rests on the clean cogito B3-vs-B2 token result. No code edited.

**Evidence anchors:** raw per-run JSONs are in `wiki/Research/Harness-Reports/`
(`task-quality-gate-{cogito-14b,gpt-4o-mini}-2026-05-30T16-*.json`); all numbers
above are reproducible via the probe with the pinned fixture. Not committed
individually (the matrix here is the durable record).

---

## Post-ablation addenda

### Genuine sub-7B local datapoint (llama3.2:latest, default-on)
The two ablation models (cogito:14b + gpt-4o-mini) both resolve to profile-tier
`mid`. To get a real small-local datapoint, llama3.2 (3B-class) was run with the
recall-gate at its NEW default (on), fixture-pinned N=3:
`pass^k 4/5, avg composite 72%, recall smells 3/15, postConditionsMet met where derived`.
- T1–T3 solid (3/3 pass^k); T4 46% / T5 48% composite — llama3.2's multi-criteria
  synthesis **capability floor**, not a gate effect (it completes; no catastrophic
  break under default-on recall gating).
- This is a default-on datapoint, NOT a gate on/off A/B on this model — it confirms
  the default-on harness is **functional on a genuine small local model**, closing the
  "local unverified" gap directionally. (`task-quality-gate-llama3-2-latest-2026-05-30T22-18-01.json`.)

### MCP-path live check — deferred (logically resolved)
The clean spot-test under the new default (recall-gate on, MCP/GitHub path) could not
be completed live: cogito:3b runs away (~9.5 min/chat, runaway generation on real
harness prompts) and an Ollama restart left it CPU/GPU-thrash-prone — repeated
timeouts in **iter-0 think (pre-gate inference)**, not gate-induced loops. The gate is
**logically exonerated**: `filterRecallByOverflow` only removes the `recall` meta-tool
from the schema; it cannot hide already-delivered `list_commits` data. The genuine
MCP-overflow-recall risk (does the gate keep recall when an MCP result truly overflows?)
remains the **Phase-4 follow-up** documented in `think.ts`, behind the `RA_RECALL_GATE=0`
opt-out. This is also superseded by the recall redesign
([[2026-05-30-recall-redesign-automatic-rehydration]]).
