# Move 1 — Collapse the two agent loops into one kernel path

**Status:** PLAN v2 (REVIEWED, scope corrected by code — see §2). Branch: `refactor/move-1-single-loop`.
**Source:** [[2026-07-31-competitive-edge-structural-program|Competitive-Edge Program]] Move 1; [[../../Architecture/Specs/09-UNIFIED-PROGRAM|09]] §6.
**Verdict (§7): STILL WORTH DOING. Not "wiring + delete" — the deletion is the capstone. The one real prerequisite is the token tax (P2); it is also the sole abort criterion.**

---

## 1. The defect (grounded)

`execution-engine.ts:741` forks inside one 1,878-LOC function: `reasoningOpt._tag === "Some" && !cacheHit` → kernel arm; `else if (!cacheHit)` → **inline arm** (1,579-LOC reimplementation of think-act-observe). The bare builder (`_enableReasoning=false`, `builder.ts:360`) — the **default first-user path** — has no ReasoningService → takes the inline arm.

**The benefit that survives every correction below:** the inline arm is filesystem-blind on success and lives OUTSIDE `check-success-authority.sh`'s fence (it scans `packages/reasoning/src` only). So today's F6 + all of Move 2, abstention, entropy reach `.withReasoning()` users but NOT the default majority. No amount of kernel-side fixing closes that; only routing the default through the kernel does. That is why Move 1 is worth doing.

## 2. Superseded premise + the falsification (kept visible on purpose)

**v1 premise (WRONG):** "route the default through the kernel via the `direct` strategy = minimal phases, staying at ~7 events, no meta-loop." Two code facts kill it:

1. **Seam was wrong.** The inline path is MULTI-TURN: `execution-engine.ts:~955` `while (!isComplete && ctx.iteration <= ctx.maxIterations)` (default `maxIterations ?? 10`). `direct` caps at 1–3 → routing default to `direct` truncates multi-step agents. **Correct seam: `reactive`** (the multi-turn `runKernel(reactKernel)` strategy).
2. **"Minimal phases" is not reachable via strategy choice.** `runner.ts:396` compiles the RunContract in an **UNCONDITIONAL block** inside `runKernel` — upstream of any strategy-specific phase composition. Every kernel run compiles a contract, records requirements, emits `contract-compiled`, and seeds `state.meta.postConditions`. So the reachability "7 vs 12" gap exists ONLY because the default never touches the kernel. You cannot route the default through the kernel and keep it at 7.

The v1 reframe (both arms rejoin post-fork; `runReasoningPostThink` already does episodic/experience/hooks/cache-store; cache-check is pre-fork shared) still holds and still de-risks the *deletion*. What changed is that routing forces two default deltas v1 ignored — analyzed next.

## 3. The two default deltas, correctly classified

Reading the consumers (not the comments):

### 3a. Terminal-gate turns on for deliverable tasks — this is the BENEFIT, not a regression
`applyTerminalPostConditionGate` (`terminate.ts:127`) is a HARD gate (unmet → `status:"failed"`), BUT:
- **Conditionally armed:** `:135` empty `postConditions` → `null` (no-op). `deriveConditions` returns `[]` for tasks with no deliverable path and no required tools → **pure-chat/Q&A default runs are UNCHANGED.**
- **Disk-grounded:** `:142` routes through `verifyDelivery`, `fileExists` defaults to `nodeFileExists`, positive-only — a real deliverable on disk flips UNMET→MET before the gate can fail. The only new failure mode is "claimed done, nothing produced, disk agrees nothing produced" = the exact correctness gap §1 exists to close, arriving on the default path.

**Classification:** a deliberate default-behavior change, blast radius bounded to deliverable tasks, safety resting on Move 2's disk grounding (in place + verified this session). **Handled by ablation-warden sign-off per 09 §6 — NOT by gating it off (that would delete the benefit and leave only the cost). No code prerequisite.**

### 3b. The token tax — the ONE real prerequisite (P2) — RE-DIAGNOSED FROM A FRESH RUN (2026-08-08)

The plan's original P2 premise (double-render + synthesize) is **FALSIFIED by measurement on HEAD:**
- The Move-0 numbers (+99% local / +469% cloud, `46f81696` @ 18:54 2026-08-05) **predate the dialect-#2 fix** (`4438a800` @ 21:06 same day) — they include the double-render that was removed 2h later. Stale.
- `system-prompt.ts:28` already gates the in-prompt tool ref off for native-FC (`check-dialect-aware.sh` enforces). Double-render is NOT the current tax.

**Fresh `harness-cost-attribution.ts`, gemma4:12b (native-fc), HEAD, n=1, file-write task:**

| arm | tokens | LLM calls | tools offered | ~per-call |
|---|---|---|---|---|
| inline | 1103t | 2 | `file-write` (1) | ~551t |
| kernel (`.withReasoning`) | 1903t | 2 | `file-write, recall, discover-tools`, +`final-answer` (~4) | ~951t |

**+73%, SAME call count.** The tax is ~400t MORE PER CALL, not extra calls (do NOT cite `it=6` vs `it=3` — iterations ≠ LLM round-trips). Driver: the kernel injects **meta-tools (`recall`, `discover-tools`, `final-answer`) into the FC array on every call** — a **"meta-floor"** (`tool-surface.ts:232`, documented at `:62`) that fires regardless of task need. Confirmed NOT a bench-arm artifact: the arm enables neither memory nor discovery (`builtins:"file-write"`, only `.withReasoning`), yet `recall` was offered **with memory OFF**.

**This IS dialect-blindness #1** (catalogued OPEN: "meta-tools flattened into domain tool list… flat map of ALL schemas incl. meta into provider `tools:`"). The measurement independently confirms it and gives it a number.

**The fix converges the user's two asks (tax + extra steps) into one:** gate each meta-tool on actual need — `recall` only when memory is enabled (fix the memory-off leak); `discover-tools` only when tools are actually pruned/hidden (not on a small full-surface task); `final-answer` per the existing dynamic-injection logic. Removing them from the FC array on trivial runs cuts the per-call tax AND removes the extra-step temptation (agent can't thrash `discover-tools`/`recall` if not offered).

**Caveats (honest):** n=1, one local model, one simple task; % may differ on cloud/native-FC frontier (Move-0 suggested worse on leaner models) and on multi-tool tasks. The "extra steps" claim is not yet demonstrated on a thrash task — the meta-floor is the *mechanism/temptation*; a task where the agent actually calls a needless meta-tool would evidence the behavior. **P2 target:** a `reactive`-kernel run offers only task-needed tools; token count approaches inline on the trivial task. **Abort criterion unchanged:** tax irreducible ⇒ Move 1 doesn't ship.

## 4. Execution (ordered)

**P2 — reduce the token tax to competitive on a minimal kernel run.** Scope tightly: (a) does a `reactive`-kernel run double-render tool schemas — confirm `system-prompt.ts:63` fires for the default's dialect; if native-FC, gate that ONE site by dialect (drop the in-prompt tool ref when the model gets an FC array). (b) Characterize what the synthesize step adds vs the inline single-call. 
- *Verify:* `harness-cost-attribution.ts`, inline vs `reactive`-minimal-kernel, same task, the tool that produced the Move-0 numbers. Target: default token count does not materially regress vs today's inline.
- *Non-goal:* dialect-blindness #1/#3/#4 — separate class, separate branch. P2 touches only the double-render site + synthesize.

**Step 1 — route the default builder through `reactive`.** Construct a ReasoningService for the bare builder pinned to `reactive` (multi-turn, `maxIterations` preserved). `reasoningOpt` becomes `Some`; the reasoning arm always wins.
- *Verify:* the 11 inline-path tests (`semantic-cache-hit`, `verification-retry-routes-through-kernel`, `think-context`, `pipeline-skip`, `model-routing-e2e`, `harness-profile`, `run-handle`, `prompt-singleton`, `allowed-tools-mismatch`, `builder-wither-discipline`, `discover-tools-respects-surface`); `replay-golden` parity on the corpus; **NEW test: a default chat run through the kernel seeds zero post-conditions** (pins "no behavior change for the majority population" — §3a — the first thing ablation-warden will ask).

**Step 2 — collapse the fork.** Delete the `else if (!cacheHit)` inline arm from `execution-engine.ts` (now unreachable).
- *Verify:* same suite + build; no green test changes.

**Step 3 — delete orphaned files.** `inline-{think,act,observe,harness-hooks}.ts` + now-orphaned inline-only helpers (grep sole-caller before each). −~1,579 LOC.
- *Verify:* build + full runtime suite; `check-single-loop.sh` green.

**Step 4 — enforcement.** `scripts/check-single-loop.sh`: no `runInline*` / think-act-observe reimpl outside `kernel/loop/`; red-on-cut. Per 09 §6.

**Sign-off — ablation-warden** on the §3a default-behavior change (terminal gate default-on for deliverable tasks) before merge to main.

## 5. Verification net (deterministic, exists today)
- `harness-cost-attribution.ts` — P2's inline-vs-minimal-kernel token check.
- `replay-golden.test.ts` + `packages/benchmarks/golden` — control-flow parity.
- The 11 inline-path tests + the new zero-post-conditions chat test.
- `meta-loop-reachability.test.ts` — documents the event-profile change (control plane stays OFF; contract/assess now present — expected, not a failure).
- `check-single-loop.sh` — the boundary lock.

## 6. Abort criteria (it's a branch)
- **Singular hard abort:** P2 proves the token tax irreducible on a minimal kernel path (default cost cannot be brought near today's inline) ⇒ Move 1 does NOT ship. The correctness benefit does not justify a 2–6× default cost regression.
- Re-scope (not abort) if a Step-1 "verify" row turns out to need real behavior porting.

## 7. Verdict — worth it?
**Yes.** The value was never the 1,579 LOC — it is that the default path is filesystem-blind on success and outside the enforcement fence, a correctness gap for the majority population that only loop-unification closes. The review corrected the SCOPE (P2 is a real prerequisite; seam is `reactive`; the terminal-gate change is a declared benefit under ablation-warden, not a silent regression), not the VALUE. **P2 is the gate on whether it can be delivered without a cost regression — and the single reason it might not ship.** The code told us the obvious approach doesn't work before a line was written; that is the plan working.

## 8. Non-goals (explicit)
- **NO** dialect-blindness #1/#3/#4 (P2 touches only #2's double-render site).
- **NO** Move 6 (iterate-pass decomp), inbound-threading collapse, or Move 3 (providers) in-branch — each cheaper AFTER Move 1, separate branches.
- **NO** control-plane default-on (stays `longHorizon`-gated — untouched).
- **NO** gating contract/assess off — they are ~free and the terminal gate they feed is the benefit (§3a).
