---
tags: [decision, ratification, wave-c, ledger, c1]
date: 2026-07-25
status: RATIFIED (Wave C.2 slice 3b-ii, owner-directed 2026-07-25)
amends: wiki/Decisions/2026-07-22-c1-equivalence-invariant (adds enforcement of half 2)
relates: wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md §3 C1, §6
---

# C1's write-path half is now enforced: one announced ledger seam

## Why this is a decision and not an edit-in-passing

The 2026-07-22 ratification defined C1's containment form and stated its goal as
*"READER convergence + a single write path"*. Reader convergence was enforced.
**The write-path half had no enforcement at all** — it was a stated property, not
a guarded one. Closing that changes what the codebase is permitted to do, so per
09 §5's conflict rule it is recorded here rather than folded silently into the
status board.

## What was found (measured, not inferred)

`check-ledger-writes.sh` fenced the append API (`appendEntry`/`appendEntries`) to
`kernel/ledger/`. But `projectStepsToLedger` **calls that API from inside the
fence**, so it passed the gate while remaining callable from anywhere — and the
script's `SEARCH_DIR` was `packages/reasoning/src` only, so the engine's inline
agent loop in `packages/runtime` was never examined.

Four ledger factories existed where the invariant assumes one. Three announced
nothing. Measured on the real engine (`test` provider, tracing on):

| factory | object view (`metadata.runLedger`) | stream view (`ledger-entry`) |
|---|---|---|
| `transitionState` (kernel) | 2 | 2 — announced by the runner's C.1 tap |
| `inline-act` (runtime) | `[tool-invocation, tool-result]` | `[]` |
| `code-action` | `[tool-invocation, tool-result×2]` | `[]` |
| `reflexion` | `[tool-result×2]` | `[requirement, verdict]×2` — **disjoint** |

`reflexion`'s two views shared no entry: the kernel passes announced their
`requirement`/`verdict` entries while the strategy's own step projection went
only to result metadata. Neither view contained the other, so a reader could not
choose a "more complete" one — there wasn't one.

This is **GH #188's three-way stream divergence**, which 09 §3 C1 explicitly says
"dies here", still live in the tree. It mattered because trace-side readers
(`analyze`, `debrief`, `cohort`) consume serialized JSONL and structurally cannot
reach `TaskResult.metadata` — so `code-action` and default-path runs were
invisible to every one of them.

## Decision

**1. Outside `kernel/ledger/`, `growRunLedger` is the only sanctioned way to grow
a run ledger.** It lives in `kernel/ledger/ledger-sink.ts` and makes projection
and publication a single act: a caller cannot obtain the grown ledger without the
delta having been published.

**2. Announcement happens at CONSTRUCTION, not at finalize.** A terminal
reconciler (publish the un-streamed remainder at run end) was considered and
**rejected**: it would make trace consumers wait for run end and would
re-introduce a second, lagging store — the exact thing C1 forbids. Liveness is a
property of the seam, not an optimization layered on it.

**3. The gate enforces it.** `check-ledger-writes.sh` confines
`projectStepsToLedger(` to the ledger home across **both** `packages/reasoning`
and `packages/runtime`. One exemption, named in the script:
`kernel/state/kernel-state.ts` — the `transitionState` chokepoint, whose growth
is announced by a different sanctioned mechanism (the runner's `onLedgerAppend`
tap). **No further exemptions**; a new ledger factory belongs behind
`growRunLedger`.

**4. The invariant is pinned per-strategy, not per-call-site.**
`ledger-announced-seam.test.ts` asserts `object ⊆ stream` for each strategy that
grows a ledger, each with a control assertion so it cannot pass vacuously on two
empty sets. A new strategy that grows a ledger without announcing fails the test
as well as the grep gate.

## Consequences

- Satisfies 09 §6 ("one owner module + one grep-able enforcement script") for the
  ledger's write path, which previously had the module but not the script.
- The 2026-07-22 decision's point 3 ("the ledger is CANONICAL for all new
  readers — receipt, **stream**, journal") is now actually achievable for the
  stream: before this, the stream could not be canonical because three paths
  never reached it.
- Containment is `object ⊆ stream`, NOT equality — consistent with the 07-22
  reading. The ledger is a strict superset of step projection, and auxiliary
  kernel passes announce entries the terminal object view does not carry
  (`reflexion` post-fix: stream 6 ⊇ object 2).
- Does not revisit the literal write-direction flip. 07-22's "why not the literal
  flip" reasoning stands unchanged.

## Method note (binding on future ledger work)

Every defect here was found by **probe with a control arm**, not by reading code.
The structural read was right about `inline-act` and **wrong about `reflexion`**
(it predicted a lossy subset; the actual state was disjoint views, needing a
different fix). A mid-slice probe also printed a confident verdict from a
malformed arm — `toolcall=0`, i.e. the tool never executed — the same trap that
cost a long stretch in slice 2.

**A ledger probe or test without a control assertion proves nothing.** Both
shipped tests carry one.
