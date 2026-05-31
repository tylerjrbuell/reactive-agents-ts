---
title: Cutover Critical Path + Efficiency Reframe
date: 2026-05-31
branch: overhaul/agentic-core-2026-05-31
status: ACTIVE — sequencing decision (stop serial-discovery; sequence by capability)
---

# Cutover Critical Path + Efficiency Reframe

Written after the 2026-05-31 reflection. Two problems named: (1) the plan kept
**fragmenting under inspection** (#1 → #2 → "actually #4") — serial framing-discovery,
a treadmill risk; (2) nearly all work was on the **cleanliness** axis (assembly
substrate) while the **capability** axis (the convergence plan: post-conditions,
recitation, experience-reuse, `pass^k`) sat **parked**. The goal is *clean AND
highly performant*; we were measuring clean, assuming performant.

This doc fixes both: map the whole remaining graph **once** (below), and **sequence
by capability-unblocked, not architectural purity.**

## The remaining graph (mapped once, not discovered serially)

| Node | Real scope (trace-grounded) | Axis | Blast radius |
|---|---|---|---|
| **FLIP** RA_ASSEMBLY default-on (reactive) | gate = cross-tier grid (running N=3). Then remove the `else`-branch in `think.ts`. | cleanliness+capability (proven lift on overflow) | think.ts only |
| **DEL** delete `curate()` | 1 caller (`think.ts:353`); dies the moment FLIP lands. | cleanliness | think.ts + curator module |
| **#7** `RA_POST_CONDITIONS` default-on | state-grounded *done* verifier (the convergence-plan core). Flag-gated, EXISTS. Gate = its own cross-tier ablation. | **CAPABILITY** (highest available lift) | kernel verify/ (warden) |
| **#5** scaffoldProfile governance | capability→scaffoldProfile spine + the deferred window-source fix (`from-kernel-state.ts:112`, mid capped 32768 not 200k). | cleanliness, small/additive | assembly/ + from-kernel-state |
| **#4** ResultStore = LIVE store | unify scratchpad(`Ref<Map>`) + ResultStore into ONE store type so the resolver (`write_result_to_file`/`recall`) AND `project()` read it; extends `result_ref` resolution across plan-execute. The reverted projector lands here. | cleanliness (deep) | tool-execution.ts (warden) + tool-capabilities + write-result-to-file + recall + plan-execute |
| **#3** EventLog sole-record | make EventLog the record the kernel APPENDS to; `messages[]`/`steps[]` become projections OF it (today `fromKernelState` only adapts at projection). | cleanliness (deepest) | whole kernel loop (warden) |
| **#8** KV-cache-friendly assembly | reorder `project()` output for prefix stability. | performance | assembly/ |

## The sequencing decision (the efficiency win)

**Old implied order:** FLIP → #4 → #3 (grind the substrate pure first). This is the
treadmill — deep cleanliness with payoff in *future tractability*, not measurable
capability, while the capability track stays parked.

**New order — sequence by capability, gate by scoreboard:**

1. **FLIP + DEL** (now, pending grid). The first real strangle: new core *replaces*
   legacy, `curate()` deleted. Proven lift. ~1 session.
2. **#7 post-conditions default-on** (next). The convergence-plan core, the **highest
   capability lift available**, and SEPARABLE from the substrate collapse (it's a
   flag-gated verifier). Reconnects clean→performant fastest. Gate: cross-tier
   ablation under the same grid harness (now faithfulness-instrumented).
3. **#5 scaffoldProfile** (cheap, additive; folds in the window-source fix).
4. **#4 → #3** (deep substrate) — defer until the capability scoreboard *demands*
   it (e.g. a lift blocked by the two-store split or the dual-record cost). Do not
   grind substrate purity ahead of capability payoff. The reverted projector waits
   here.
5. **#8** KV-cache — performance pass, late.

**Why faster:** the goal is *highly performant agentic systems*. #7 moves that
needle now; #3/#4 move *tractability* (they make future steps cheaper, not the agent
better). Front-loading #7 means every subsequent substrate step is justified by a
capability it unblocked, not by purity for its own sake.

## Clock

kernel-warden pilot **expires 2026-06-15**. FLIP/DEL/#7/#4/#3 all touch kernel.
The capability-first order spends the window on the highest-lift kernel work (#7)
rather than the deepest-cleanliness work (#3) that may not finish in-window anyway.

## Efficiency working-rules (distilled from this session)

1. **Verify the contract before building, not after.** The projector was built then
   reverted because resolution/caller wasn't checked first. Trace the resolver +
   the caller BEFORE writing the helper. (Cost this session: one build+revert cycle.)
2. **Batch the traces, then propose the plan once.** Three advisor round-trips each
   corrected a framing. One grounded investigation pass → advisor validates once.
   (This doc IS that pass for the remaining graph.)
3. **Instrument before measuring.** Read the harness/script against recent changes
   first — the grid shipped a stale `summref` grep (post-#1 rename) and no
   per-cell deliverable snapshot, both found at run-time. Now fixed.
4. **The flag is not the file.** Grade the deliverable (section-coverage), never the
   success flag. Baked into the grid now.
5. **Every substrate step states its capability payoff** before it starts. If the
   answer is only "future tractability," it sequences AFTER a capability node.

## Standing scoreboard

The faithfulness-instrumented grid (`apps/examples/assembly-ab-grid.sh` +
`section-coverage-grade.ts`) is now the cross-tier capability gate. Every default-on
flip (FLIP, #7) runs it: ≥ no-regression on faithfulness + success, token overhead
within the project lift rule (≤15% for default-on). Re-light it per step — that is
how *clean* stays in service of *performant*.
