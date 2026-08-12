---
tags: [plan, simplification, feedback-loop, canonical]
date: 2026-07-27
status: ACTIVE — the simplification program
governed-by: "[[../../Architecture/Specs/09-UNIFIED-PROGRAM|09 §6 lift rule]]"
---

> **SUPERSEDED 2026-08-12 — absorbed into [[2026-08-12-agentic-overhaul-program|The Agentic Overhaul Program]].**
> This plan is retained for provenance only. Do not execute from it; its content,
> including any still-open items, is carried in that program's failure-mode register.
> Three plans each declared themselves the sole active program — that is why one
> running plan now replaces them.

# Simplification + the Feedback Loop That Makes It Affordable

**One sentence:** we cannot simplify what we cannot measure, measurement currently
costs a multi-hour live campaign per question, and that is why 76 of 83 withers are
unmeasured — so build the cheap middle tier first, then let it decide what dies.

This plan is deliberately short. A register row should not be longer than the fix it
describes; neither should a plan.

---

## 1. The diagnosis (evidence, not impression)

| Fact | Number | Source |
|---|---|---|
| Lift measurements in 2 months | **6** | `improvement-ledger.json` |
| …that cleared the promotion bar | **0** | 1 reject, 3 opt-in, 2 underpowered |
| Full-harness token overhead vs bare LLM | **555–640%** | ledger, 2026-07-07 |
| The lift rule's own ceiling | **15%** | 09 §6 |
| Public withers | 83 | `builder.ts` |
| …with any lift evidence | **~7** | this audit |
| `pass^8` on the canonical baseline | **0%** on all 3 tasks | 2026-07-11 rebaseline |
| Commits since v0.14.0 (5 days) | 145 — **20 fix / 17 docs / 7 feat** | `git log` |

Two readings follow, and both matter:

1. **Applied to itself, `ra-full` fails its own promotion gate by ~40×.** That number
   has sat in the ledger since 07-07 filed as a footnote on three "opt-in" rows. It is
   the central fact about the framework.
2. **The measured base rate for "a guard is a misfire" is 1 of 1.** The only guard ever
   measured, `low_delta_guard`, killed 11 of 12 runs mid-progress — graded accuracy
   `0.000` across every baseline run. On rw-7 the harness was **worse than no harness**.
   The other guards are unmeasured.

The default path makes this worse, not better: `_enableReasoning` defaults `false`, so a
default `createAgent()` run compiles no contract, computes no assessment, renders no
projection and fires no guards. **Waves B/D/E/F are dark for every real user.**

---

## 2. Why measurement is expensive (the actual bottleneck)

Two modes, nothing between them:

| Tier | Cost | Answers |
|---|---|---|
| **0 — deterministic cells** | free, ~1s | does the mechanism *fire*? is it reachable? |
| **2 — live arms** | hours + dollars | does it *help*? accuracy, tokens |

Every "does this help?" question jumps straight to tier 2. `low_delta_guard` cost a
multi-hour campaign **and three VOID arm-sets** before producing an answer.

The test suite is *not* the bottleneck: full monorepo is **112s / 8636 pass / 0 fail**.

---

## 3. Tier 1 — replay ablation (the missing middle)

`packages/replay` + `bench:replay` already rebuild a **real agent** over a recorded LLM
table with no provider. It was pointed at two regression fixtures. Point it at ablation.

**The signal is table consumption.**

| Observation | Meaning |
|---|---|
| `dispensed < tableSize` | the variant **terminated early** — the guard-misfire detector |
| table exhausted / miss | the variant ran **further** than the recording |
| tool-sequence divergence | the variant changed control flow, and where |
| output mismatch | the variant changed the deliverable |

**Proven, 2026-07-27** (`62213316`), on the new `terse-tool-loop` golden:

```
legacy (default)                        ok=true   dispensed=4/4   304ms
REACTIVE_AGENTS_EVIDENCE_DELTA_RESET=1  ok=false  table exhausted 316ms
```

That is the `low_delta_guard` result — the reset lets the run continue past where the
guard killed it — reproduced at **zero tokens in ~300ms**. Recording the golden on the
DEFAULT config also captures the misfire itself as a committed fixture: the trace carries
`guard-fired {guard: low_delta_guard}` and consumes 4 of 6 scripted turns.

**Scope limit — do not overread.** Replay measures **control-flow** effect, not accuracy.
A mechanism that changes the *prompt* makes the model say something different, which a
fixed table cannot simulate.

- **Replay-ablatable:** guards, terminators, tool policy, routing, budget, approval,
  deliverable verification, gating. *Most of what is currently dark.*
- **Needs live arms:** anything altering prompt content (e.g. `#38` thought-continuity).

Goldens record on the **deterministic test provider** — keyless, free. Corpus is 4
(`answer-only`, `tool-write`, `terse-tool-loop`, `abstain`); lane runs in **934ms**.

---

## 4. The simplification path

### Step 1 — grow the corpus (free)
Add goldens for the remaining mechanism-relevant shapes: delegation/sub-agent,
max-iterations terminal, forbidden-tool policy, approval gate, multi-pass verification.
Zero tokens. Ceiling is scenario-authoring time.

**Recording gotcha, paid once:** the task text must contain whatever the first turn's
`match` guard tests. Miss it and the provider skips the turn, the run degrades, and the
golden records the degraded behavior as if it were the harness's. See the comment on
`terse-tool-loop`.

### Step 2 — sweep every mechanism through replay (free)
All 55 `RA_*`/`REACTIVE_AGENTS_*` flags and every guard, one variant per replay, across
the corpus. Output is a three-bucket triage:

| Bucket | Verdict | Action |
|---|---|---|
| **Zero divergence on every golden** | INERT | delete, or demote to opt-in with the evidence attached |
| **Diverges, outcome worse** | HARMFUL | root-fix, or default-off |
| **Diverges, outcome better** | CANDIDATE | earns a live arm — and only these do |

This is the simplification engine. It replaces taste with evidence, and it is the only
honest way to shrink 83 withers.

### Step 3 — live arms only for candidates
Tier 2 becomes affordable because tier 1 already discarded the inert majority.

### Step 4 — the composite
`bare` vs `lean` vs `full` on current HEAD, ≥2 tiers. Confronts the 640% overhead. This
is the measurement that has been deferred since 07-07 and it gates any honest claim.

### Step 5 — ship
138 commits are unpushed. Wave C is real correctness work (one ledger, one write path,
one classifier, one approval type, a real sub-agent boundary). Cut v0.15.

---

## 5. Ordering, and what NOT to do

**Do not** build further into Waves D/E/F/G or Arc 2 before the composite exists. Those
waves already shipped structurally and are dark by default; adding mechanisms to a stack
whose net effect is unmeasured, and whose measured token cost fails our own rule, is how
we got here.

**Do not** grow the register. It is 269 lines with rows running 800 words. A finding
earns a row, a gate and a mutation test — not an essay.

---

## 6. Dev-loop fixes landed 2026-07-27

| Fix | Effect | Commit |
|---|---|---|
| `with-channels-gateway` polled a heartbeat that could never fire (`intervalMs: 999_999`) | runtime suite **54s → 39s** | `7f7547d6` |
| `WebhookChannelAdapter.isSubscribed` — the real readiness signal (docs had told users to `setTimeout`) | closes an API gap | `7f7547d6` |
| **RTK removed** — silently truncating (`git log` 50 of 145, `find` 5 of 1510, `git status` dropped a file, no markers) | stops fabricated counts | `7f7547d6` |
| graphify demoted to orientation-only; guards + post-commit rebuild removed | grep beat it 15ms vs 572ms with zero relevant nodes | `62213316` |

**The RTK lesson generalises.** A "token savings" metric measured by output size rewards
deleting the answer. On a project whose entire discipline is counting and verifying, a
lossy-by-default tool is a fabricated-measurement generator — and the register's long tail
of *"corrected: was a miscount of N"* rows is consistent with exactly that.

---

## 7. First sweep — result, and what it actually proved

`bun run packages/benchmarks/src/replay-ablate-sweep.ts` — 19 flags × 4 goldens,
**~19s, zero tokens** (`3f2a3259`).

| Bucket | n | Meaning |
|---|---|---|
| **LIVE** | 1 | `REACTIVE_AGENTS_EVIDENCE_DELTA_RESET` — diverges on exactly `terse-tool-loop` |
| **no divergence** | 13 | toggled, code ran, nothing moved **on this corpus** |
| **UNTESTABLE** | 5 | the code never ran — shadowed or unexercised |

**The 13 are not 13 deletion candidates.** The corpus is four `reactive` runs with
explicit tool config: most of those verdicts probably reflect corpus poverty, not
mechanism inertness. Growing the corpus is a *prerequisite* for acting on any of them.

**The sweep's first pass was wrong, and that is the reusable finding.** Setting every
flag to `"1"` reported **18 of 19 INERT**. The tell was `MAX_ITERATIONS=1` coming back
inert — a hard iteration cap cannot be. Three fault classes:

1. **Wrong polarity** — `RA_LAZY_TOOLS` reads `!== "0"`, so it is ON by default and
   `"1"` is a no-op.
2. **Wrong literal** — `DISABLE_STATUS_MODE` wants `"true"`; `RA_SANDBOX` wants `"docker"`.
3. **Shadowed / unexercised** — `MAX_ITERATIONS` is overridden by every sidecar
   (`builder.ts:263` reads the env var only as a *default*); `MAX_RECURSION_DEPTH`,
   `RA_TOT_EXPLORE_BUDGET_MS`, `RA_HTTP_ALLOW_PRIVATE`, `RA_SANDBOX` are unreachable
   from a corpus with no delegation, no ToT and no network.

**A wrong toggle produces a silent false INERT** — exactly the evidence someone would
later cite to delete a working mechanism. Hence: the flag table carries the real
comparison per row, and **UNTESTABLE is its own bucket**. *"The code never ran"* and
*"the code ran and did nothing"* are different findings; only the second can justify a
deletion. Same doctrine as [[../../..//.claude/memory|instrument-before-conclusion]] —
caught here by an anomaly that could not be true, not by review.

**The UNTESTABLE list is the corpus backlog**: sub-agent/delegation, a ToT run, a network
call, a golden whose sidecar omits `maxIterations`.

---

## 8. Status

- [x] Dev-loop instrumented and the waste removed (suite 127s → 86s)
- [x] Tier 1 proven end to end, zero tokens
- [x] Golden corpus seeded (4)
- [x] Step 2 — sweep instrument built, controls green, first pass run + self-corrected
- [ ] Step 1 — corpus grown (blocks acting on the 13; UNTESTABLE names the shapes)
- [ ] Step 2b — re-sweep on the grown corpus → actionable triage
- [ ] Step 3 — live arms for candidates only
- [ ] Step 4 — composite ablation on HEAD
- [ ] Step 5 — v0.15 cut (owner-gated)
