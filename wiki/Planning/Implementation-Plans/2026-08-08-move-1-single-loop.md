# Move 1 — Collapse the two agent loops into one kernel path

**Status:** PLAN (vetted, pre-implementation). Branch: `refactor/move-1-single-loop`.
**Source:** [[2026-07-31-competitive-edge-structural-program|Competitive-Edge Program]] Move 1; [[../../Architecture/Specs/09-UNIFIED-PROGRAM|09]] §6 (one owner + one grep script; meta-loop-default-on is a lift decision, not wiring).
**Governing metric:** shrink + reliability, NOT speed. Verification is deterministic (replay-golden parity + existing inline-path test suite + reachability), per the owner's "measurement is sufficient" call — no new bench work in this branch.

---

## 1. The defect (grounded)

`execution-engine.ts:741` forks inside one 1,878-LOC function:
- `reasoningOpt._tag === "Some" && !cacheHit` → **reasoning/kernel arm** (`runReasoningThink` → kernel + `runReasoningPostThink`).
- `else if (!cacheHit)` → **inline arm** (`runInlineThink/Act/Observe` + `runInlineHarnessHooks`), a 1,579-LOC reimplementation of think-act-observe.

The bare builder (`_enableReasoning=false`, `builder.ts:360`) — the **default first-user path** — provides no ReasoningService, so `reasoningOpt` is `None` and it takes the **inline arm**. Consequences (all grounded this session):
- The inline arm is filesystem-blind on success (`check-success-authority.sh` scans `packages/reasoning/src` only). Today's F6 + all of Move 2, abstention, entropy — **none reach default users.**
- Reachability probe (`meta-loop-reachability.test.ts`): default emits **7 event kinds**, kernel **12**.
- Every kernel fix lands twice or bypasses default (4 findings historically retracted to this confound).

## 2. The reframe that de-risks it

Both arms **rejoin post-fork** into shared phases: `verify → verification-quality-gate → memory-flush → cost-track → audit → complete`. The reasoning arm's `runReasoningPostThink` already does episodic bridge / experience / synthetic act-observe hooks / semantic-cache store. Cache-check runs **before** the fork (`:735`); on hit both arms skip — cache is shared, not branch-coupled.

Therefore Move 1 is **not a 1,579-LOC port.** It is: **construct a minimal ReasoningService (running the `direct` strategy) for the default builder so `reasoningOpt` is always `Some` → the fork always takes the reasoning arm → the inline arm becomes unreachable → delete it.** `direct.ts` was purpose-built for this ("chat / streaming / no-reasoning fallback. Replaces the dual 'inline LLM-call'"; iteration cap forces single-turn; streaming callbacks + hook firing supported).

## 3. The equivalence table (built from code, not comments)

| Inline responsibility | Kernel-path equivalent | Verdict |
|---|---|---|
| think/act/observe loop (`runInline*`) | `direct` strategy → `runKernel(reactKernel)`, richer | **wiring** (seam exists) |
| single-turn streaming-chat UX | `direct` iteration cap = 1 + streaming callbacks (`direct.ts:12,60`) | **wiring** — VERIFY vs `execute-stream.ts` |
| semantic cache-check | shared, pre-fork (`:735`) | **no change** |
| verification-quality-gate retry | shared post-fork; routes through kernel when ReasoningService present (S3, `verification-retry-routes-through-kernel.test.ts`) | **improvement** — default gains kernel retry |
| verify / memory-flush / cost-track / audit / complete | shared post-fork | **no change** |
| episodic memory (H5), experience, act-observe hooks, cache store | `runReasoningPostThink` (`:850`) | **wiring** — provided by the arm |
| tool-surface policy (builtins opt-in, allowed/forbidden) | `prepareReasoningToolSchemas` — already run in BOTH arms (`inlinePrepared` :894) | **no change** |
| provider fallback emission (`inline-think`) | kernel adapter path — VERIFY emitted | **verify / conscious-drop** |
| sub-agent token/cost aggregation (`inline-observe`) | `runReasoningPostThink` / `reasoning-harness-hooks` — VERIFY | **verify** |

No row is a genuine "no kernel equivalent." Two rows (provider-fallback emission, sub-agent cost aggregation) need a read to confirm the kernel arm emits them; if one doesn't, that emission is the only real port and is scoped small.

## 4. THE central caution point (design tension)

Making `reasoningOpt` always `Some` must **NOT** turn the meta-loop on by default. 09 §6: meta-loop-default-on (contract compile / assessment / projection / guards — the 7→12 event jump) is a **lift-rule + ablation-warden decision**, not a wiring side effect. `direct` (minimal phases) is the needle: it routes through kernel *machinery* without the meta-loop *capabilities*.

**Guard A (events):** after Move 1 the default path must STILL emit ~7 event kinds, NOT 12. `meta-loop-reachability.test.ts` is the exact instrument — extend it to assert the default (now kernel-routed) does not compile a contract / compute assessment / render projection / fire guards. If it jumps to 12, the change is wrong and aborts.

**Guard B (tokens) — from Move-0-measured (2026-08-05, `46f81696`).** Kernel overhead is a **FIXED ~3300–3500t scaffolding tax** (inline vs kernel: +99% local gemma4, +469% cloud gemini). The tax = contract/assessment/projection + extra think/synthesize **+ dialect-blindness #2**: `system-prompt.ts:63 buildToolReference` renders tool schemas in-prompt gated on TIER not DIALECT, so a native-FC model gets schemas TWICE (prose + FC array). If default routing through `direct` uses native-FC, it may inherit that double-render tax even at minimal phases. **So event-parity (Guard A) is necessary but NOT sufficient — also assert the default's token count does not regress toward the kernel tax** (measure inline-vs-direct on the same task via `harness-cost-attribution.ts`, the tool that produced the Move-0 numbers). If `direct`+native-FC double-renders, dialect-blindness #2 is COUPLED to Move 1 and must be co-fixed (thread dialect into `buildToolReference`), or the default regresses on cost. This is the one place Move 1 legitimately touches an adjacent debt — because ignoring it silently taxes every default user.

## 5. Execution (ordered, each independently verifiable)

**Step 0 — confirm the two "verify" rows** (§3): read `reasoning-think.ts` / `reasoning-harness-hooks.ts` for provider-fallback emission + sub-agent cost aggregation. Mark each wiring or port.

**Step 1 — minimal ReasoningService for the default builder.** Wire the bare builder to construct a ReasoningService pinned to `direct` (minimal phases, no meta-loop). No deletion yet. `reasoningOpt` becomes `Some` for default runs.
- *Verify:* `meta-loop-reachability.test.ts` — default still ~7 events (§4 guard); `replay-golden` parity on the corpus; full inline-path suite green (`semantic-cache-hit`, `verification-retry-routes-through-kernel`, `think-context`, `pipeline-skip`, `model-routing-e2e`, `harness-profile`, `run-handle`, `prompt-singleton`, `allowed-tools-mismatch`, `builder-wither-discipline`).

**Step 2 — collapse the fork.** Delete the `else if (!cacheHit)` inline arm from `execution-engine.ts` (now unreachable). File shrinks from 1,878.
- *Verify:* same suite + build; the inline arm's absence must not change any green test.

**Step 3 — delete orphaned files.** `inline-{think,act,observe,harness-hooks}.ts` + any now-orphaned `verification-*`/`think-context` inline-only helpers (grep sole-caller before each delete). −~1,579 LOC.
- *Verify:* build + full runtime suite; `check-single-loop.sh` green.

**Step 4 — enforcement.** `scripts/check-single-loop.sh`: no `runInline*` / think-act-observe reimpl outside `kernel/loop/`; red-on-cut (proven to fail if the inline arm is reintroduced). Per 09 §6.

## 6. Verification net (all deterministic, all exist today)
- `packages/benchmarks/tests/replay-golden.test.ts` + `packages/benchmarks/golden` — control-flow parity (Rung 1).
- `meta-loop-reachability.test.ts` — the §4 event-count guard (extend it).
- The 11 inline-path tests enumerated in Step 1.
- `check-single-loop.sh` — the boundary lock.

## 7. Abort criteria (it's a branch — cheap to discard)
- **Abort** if replay-golden parity breaks in a way not attributable to a known behavior improvement (e.g., default gaining kernel verification retry is EXPECTED; a changed tool-call sequence is NOT).
- **Abort** if the §4 guard reddens (default jumps toward 12 events) and cannot be brought back to minimal-phase without special-casing — that means `direct` is dragging the meta-loop and the seam is wrong.
- **Abort** if a "verify" row (§3) turns out to be a genuine large port — re-scope, don't absorb.

## 8. Non-goals (explicit)
- **NO meta-loop default-on** — stays a lift-rule + ablation-warden decision (09 §6). Move 1 unifies machinery, not the default capability set.
- **NO Move 6** (iterate-pass decomp) and **NO inbound-threading collapse** in this branch — they become substantially cheaper *after* Move 1 (one hot path, one input surface) and land on separate branches. Bundling them makes the replay-parity signal uninterpretable.
- **NO provider dedup (Move 3)** here — independent, separate branch.

## 9. Strategic payoff
Move 1 is the enabler. Post-Move-1: one loop → one input-threading surface (the 34-field `CrossCuttingInput` Pick shrinks by construction), one hot path (Move 6 lands once), one place the success authority + all correctness fixes reach every user. The −1,579 LOC is the visible win; "every future fix lands once, for all users" is the compounding one.
