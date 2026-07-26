# Wave C.2 — the ledger becomes run-scoped

**Status:** WAVE C.2 COMPLETE (slices 1–3 shipped 2026-07-24/25)
**Program:** [[../../Architecture/Specs/09-UNIFIED-PROGRAM]] §7 — C1 "one event store"
**Predecessor:** [[2026-07-22-wave-c1-ledger-convergence]] (slices 1–3 shipped 2026-07-22)
**Register:** [[../../Architecture/DEBT-REGISTER]] §3

## The gap C.2 closes

C.1 made the RunLedger real inside ONE reasoning pass: steps ≡ ledger projection
(red-on-cut), all 8 strategies forward `runLedger`, the receipt reads ledger
queries, and appends publish live as `LedgerEntryAppended`.

But a *run* is not a pass. The engine executes a reasoning pass up to three
ways — the terminal pass (`reasoning-think.ts`), the verification retry
(`verification-think-retry.ts`), and the post-think continuation
(`reasoning-harness-hooks.ts`) — and **each is a separate kernel execution with
its own `state.ledger` starting at `seq 0`.** Only one survives onto
`result.metadata.runLedger`. Every fact a sibling pass recorded is discarded.

Three open items are the same missing substrate:

| Open item | What it actually needs |
|---|---|
| Auxiliary-pass fence has no run-level evidence store (register §3) | a ledger the mint can read ACROSS passes, so a fragment can be judged honestly instead of exempted |
| Engine-side facts are not ledger entries (C.2 named scope) | somewhere run-scoped for a non-kernel actor to record into |
| A sub-agent's work leaves no trace in its parent | the child's ledger merged into the parent's, attributed |

The engine sits *outside* `KernelState`, so none of them can be built until the
ledger outlives a single kernel call. That is slice 1.

## Design

### The accumulator lives in the ledger's home

`check-ledger-writes.sh` pins the append primitives to
`packages/reasoning/src/kernel/ledger/`. The merge is an append operation, so it
lives there too — `run-scope.ts`, exporting one function. No caller outside the
home ever hand-builds an entry or calls `appendEntry`.

### Merging re-bases `seq`

A pass ledger is `seq 0..n`; the run ledger already holds `m` entries. Merged
entries are re-assigned `m..m+n`, preserving the append-only, dense, monotonic
contract (DAG law). This is sound **today** because no production code writes a
seq-based cross-reference — the only `evidenceRef` of the form `"seq:N"` in the
tree is a test fixture (verified 2026-07-24), and nothing reads `.seq` outside
the append primitives.

That is a real constraint, not a happy accident, so it is pinned: a test asserts
no production entry carries a `seq:`-shaped ref, and the merge is documented as
the place that must grow a ref-remap if one is ever introduced.

### Provenance, so a merged fact stays attributable

Every entry gains an optional `pass` field naming which pass produced it
(`"terminal" | "verification-retry" | "continuation" | "sub-agent:<name>"`).
Absent on entries minted by the run's primary pass, so existing entries and
their tests are byte-identical.

### One seam, enforced

The three pass sites each call `reasoningService.execute(...)` and read the
result. Absorption must happen at every one or the ledger silently loses a pass
— the exact defect class the cascade exists to end. So absorption is not a line
each site remembers to write: the sites go through one runtime helper that
builds the request *and* absorbs the result, and the gate tightens from
"every execute request carries an envelope" to "no direct `.execute(` outside
the helper".

## Slices

**Slice 1 — run-scoped ledger (this one).**
`run-scope.ts` merge + `pass` provenance + the absorbing helper at all three
pass sites + run-level `runLedger` on the result. Gate: `check-ledger-writes.sh`
stays green; cross-cutting check tightens to the single execute seam.

**Slice 2 — engine + sub-agent entries.**
First non-kernel clients: sub-agent dispatch/result (the child's ledger merged
into the parent's under `sub-agent:<name>`), then engine-phase facts (guardrail
block, cost-route decision, verification outcome). `run_events` becomes a pure
ledger journal.

**Slice 3 — ledger onto the trace stream (SHIPPED 2026-07-25), then tool-call convergence.**

_Premise correction (2026-07-25)._ The original framing — "`packages/trace`,
`packages/replay`, `packages/diagnose`, `packages/benchmarks` read ledger queries
instead of their own event kinds, re-basing **llm-exchange / replay**" — was
false. Mapping the surface showed llm-exchange carries raw prompts/responses for
**byte-exact golden replay**; that is genuinely NOT ledger data and must not be
re-based onto a ledger query. The re-baseable surface is the **tool-call** events
(diagnose/receipt reads), and that is gated on the ledger first *reaching* the
trace stream at all — which it did not.

Slice 3 therefore splits:

- **3a (shipped `416cfccd`).** Wire the existing C.1 `LedgerEntryAppended`
  bus tap into the trace bridge as a new `ledger-entry` TraceEvent. Before this
  the tap published on the EventBus but `toTraceEvent` returned `null` for it, so
  the ledger was siloed from the trace JSONL. Now the run's append-only record
  (tool-invocation / tool-result / artifact / requirement / claim / verdict, plus
  merged `sub-agent:<name>` provenance) rides the same bridge every other trace
  event uses. Files: `packages/trace/src/events.ts` (`LedgerEntryTraceEvent`),
  `packages/trace/src/normalize.ts` (the `case`). Pinned unit (mapping +
  iter-from-entries) and e2e (bus→bridge→recorder, red-on-cut). Non-behavioural
  for replay/diagnose — purely adds a stream.
- **3b-i (shipped `ab6b3571`).** The inline path publishes its ledger. Closes the
  registered `runLedger`-on-the-live-engine-path drop.
- **3b-ii (shipped `c168ee57`) — the C1 write-path hole.** Investigating 3b-i's
  scope surfaced that the defect was structural, not a missing call. C1's "no
  second store" has two halves; only reader convergence was enforced.
  `check-ledger-writes.sh` fenced the append API to `kernel/ledger/`, but
  `projectStepsToLedger` calls that API from *inside* the fence and was callable
  from anywhere — and the script only searched `packages/reasoning`, so the
  engine's inline loop was never covered. Four ledger factories where the
  invariant assumes one; three announced nothing. Measured on the real engine:

  | path | object | stream |
  |---|---|---|
  | `code-action` | `[tool-invocation, tool-result×2]` | `[]` |
  | `reflexion` | `[tool-result×2]` | `[requirement, verdict]×2` — **disjoint** |
  | `inline-act` | `[tool-invocation, tool-result]` | `[]` |

  That is GH #188's stream divergence, which C1 exists to kill, alive in the tree.
  Fix: ONE announced seam, `kernel/ledger/ledger-sink.ts` `growRunLedger` — growth
  and publication are a single act, so a caller cannot obtain the grown ledger
  without the delta being published. Announced at CONSTRUCTION, keeping the stream
  **live**; a terminal reconciler (considered and rejected) would have made trace
  consumers wait for run end and re-introduced a second, lagging store.
  Gate extended to fence `projectStepsToLedger` across both packages. Pinned
  per-strategy (`ledger-announced-seam.test.ts`), red-on-cut at gate and test.
- **3c (shipped `27e81ca8`).** tool-call convergence: `analyze.ts` reads the ledger
  for tool facts. `tool-call-*` events record only what a run invoked DIRECTLY, so
  a delegating parent showed `[spawn-agent]` against a 9-entry ledger spanning two
  children — and `deliverableProduced` reported "no deliverable-file write seen"
  for a run whose delegate HAD written it. Ledger-preferred with an event fallback
  (historical JSONL + golden fixtures byte-stable), declining the ledger view when
  it carries no tool entries so a richer substrate cannot regress. `tools[]` stays
  event-based (transport-level `calls`/`truncated`). Replay's llm-exchange is
  explicitly **out of scope** (not ledger data).

**Close-out (2026-07-26) — the success authority reads ONE substrate.**
Slice 3c converged the trace-side READER onto the ledger; the close-out converged
the run's success authority, and closing the two residuals the delegated-deliverable
fix had *named* surfaced two more defects rather than tidiness:

| Defect | Fix |
|---|---|
| A DELEGATED deliverable was refused (`success:false`, file on disk) — `ArtifactProduced` judged from `steps`, which cannot contain a child's work | judge from the run-scoped ledger's `artifact` entries; generic over delegation depth, no sub-agent special-casing (`ec4880bb`) |
| The ledger carried NO `artifact` facts on the inline (default) path — `deriveArtifactEntries` lived only in the kernel's `act.ts` | `inline-act` derives them and hands them to the announced seam (`growRunLedger` gained `extraEntries`), so the published delta stays the whole growth (`36665b8f`) |
| The receipt could report a DELETED file as produced — the ledger was flattened to a path list, dropping `op` | pass the ledger WHOLE to the same `verify()` gate; the duplicate path-matching in `deliverable-report.ts` is deleted |
| `ToolCalled` judged delegation from `delegatedToolsUsed`, which is one level deep by construction | read the ledger first (a grandchild's tools now count); steps scan kept as the no-ledger fallback — both are sound positive evidence, so the union cannot false-met |
| The runtime's structural mirror of a ledger entry was hand-copied at FOUR sites, each with a different field subset | declared once in `runtime/src/types.ts`, imported |

Residual left standing, deliberately: `isArtifactProduced` keeps its steps scan for
callers with no ledger. With the inline path now minting artifacts, no ledger-bearing
run depends on it; collapsing it entirely belongs to C-final, where `steps[]` itself
becomes a projection.

### Method note (worth keeping)

Both defects in this slice were found by **probe with a control arm**, not by
reading code. The structural read said "inline publishes nothing" and was right;
it also said "reflexion's object view is lossy", which was **wrong** — the probe
showed the two views were disjoint, a different defect needing a different fix.
An earlier probe in this slice reported a clean-looking verdict that was actually
a malformed arm (`toolcall=0` ⇒ the tool never ran) — the same trap that cost a
long stretch in slice 2. Every ledger probe here carries a control assertion, and
so does every test written from one.

## Non-goals

- steps[] becoming a ledger projection (that is C-final, not C.2).
- Compaction / re-projection (C4).
- Any change to how a pass is *judged* — slice 1 only makes sibling evidence
  reachable; using it to retire the auxiliary-pass exemption is slice 2+ work,
  and is a behaviour change that needs its own pins.


## End-to-end verification (2026-07-25)

One real delegating run (nested `spawn-agent`, `test` provider, tracing on),
checked across every view. 8 of 9 checks pass:

| # | Check | Result |
|---|---|---|
| 1 | slice 1 — run-scoped ledger, seq dense + monotonic | PASS (`seqs 0..8`) |
| 2 | slice 2 — child AND grandchild attributed | PASS (`sub-agent:child-one`, `sub-agent:child-two`) |
| 3 | slice 2 control — parent's OWN call present, unstamped | PASS |
| 4 | slice 3a — ledger reached the trace JSONL as `ledger-entry` | PASS (9 entries) |
| 5 | slice 3b — `object ⊆ stream` (announced seam holds) | PASS (obj 9 / stream 9) |
| 6 | slice 3b — no duplicate seq (single live publisher) | PASS |
| 7 | slice 3c — analyzer sees MORE tool calls than direct events | PASS (`{spawn-agent: 2}` vs 1 direct event; the 2nd came from `sub-agent:child-one`) |
| 8 | overall — run succeeded | PASS |
| 9 | slice 3c — a LEAF (non-spawn) child tool reaches the analyzer | **NOT VERIFIED e2e** — see below |

**Check 9 is a fixture limitation, not a defect.** Two attempts to make a
delegated child execute a real tool (`scratchpad-write`) failed the CONTROL: the
child terminated `end_turn` with no `[act]` phase at all and an empty ledger, so
its scenario `match` guard never fired. This is the known
`withTestScenario` behaviour where a delegated child's match guard is consumed
against a truncated parent-context prefix / the tool-relevance classifier prompt
— the same reason `ledger-merge.test.ts` deliberately pushes its trigger past
char 200 and uses nested spawns rather than leaf tools.

What check 7 *does* establish is the substance of 3c: a tool invocation that
exists ONLY in the merged ledger (`spawn-agent` under `sub-agent:child-one`,
absent from the parent's `tool-call-*` events) is counted by the analyzer. The
leaf-tool case is covered by `ledger-tool-facts.test.ts` against a synthetic
ledger, red-on-cut verified.

Recorded rather than quietly dropped: an unverified check reported as passing is
the failure mode this whole wave exists to prevent.