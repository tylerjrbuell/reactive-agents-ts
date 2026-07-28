---
tags: [audit, system-map, orientation, evidence]
date: 2026-07-28
status: EVIDENCE — measured; open questions named as open
extends: "[[00-SYSTEM-MAP]] (which was LOC + tier-gating only — a partial view)"
---

# Full System Picture

Written because the previous map was LOC and tier-gating only, and acting on a partial view
is how this project has repeatedly published wrong conclusions. **§7 lists what is still
unknown, including one probe that failed today and must not be read as a finding.**

---

## 1. Scale

| | LOC |
|---|---|
| `packages/` (31 published + private) | **~160,000** |
| `apps/` | **~59,000** |
| — of which `apps/cortex` | **37,115** |

`apps/cortex` is **larger than the entire `runtime` package** and had not appeared in any
analysis this session. Any "simplify the framework" plan that ignores it is scoped wrong.

---

## 2. Dependency layering (measured from workspace manifests)

```
L0  core · runtime-shim · ui-core                      (zero workspace deps)
L1  memory · prompts · observability · identity · gateway · compose
L2  llm-provider · tools · trace · verification · guardrails
L3  reasoning · reactive-intelligence · cost · replay
L4  runtime                                            ← integrates 15 packages
L5  reactive-agents (facade) · testing · benchmarks · eval
L6  apps: cortex · cli · advocate · examples · docs
    bindings: react · svelte · vue  → ui-core (isolated, clean)
```

The layering is **clean** — no cycles, `core` depends on nothing, UI bindings are isolated.
This is real architectural health and should be said plainly: the problem is not tangle, it
is **mass and unconditionality**.

`runtime` is the integrator (a2a, channels, core, cost, gateway, guardrails, health,
llm-provider, memory, observability, prompts, reactive-intelligence, reasoning, tools, trace,
verification). It is where every policy decision lands, and why it is 34,657 LOC.

---

## 3. Subsystem inventory — what each thing actually does

### The two big ones

**`reasoning` — 46,950**
| Part | LOC | Role |
|---|---|---|
| `kernel/capabilities` | 15,228 | act 3,809 · reason 2,800 · decide 2,572 · verify 2,315 · reflect 1,023 · comprehend 907 · attend 831 · sense 620 · **recall 219** · **learn 132** |
| `kernel/loop` | 7,128 | runner, react-kernel, terminate (single owner), auto-checkpoint |
| `kernel/state` | 2,414 | `transitionState` chokepoint |
| `kernel/utils` | 1,755 | |
| `kernel/ledger` | 1,071 | the evidence substrate + `growRunLedger` announced seam |
| `assessment · control · policy · contract · envelope` | 2,470 | the meta-loop — **9% of the kernel** |
| `strategies` | 9,302 | 9 strategies |
| `structured-output · assembly · context · services` | 4,856 | |

**`runtime` — 34,657**
| Part | LOC | Role |
|---|---|---|
| `engine/` | 8,770 | phase pipeline, agent-loop (inline + reasoning think/act), finalize (debrief, telemetry, local-learning), durable-resume |
| `builder/` | 6,125 | the 83-wither surface + build-effect layers |
| top-level | 16,190 | `reactive-agent.ts` 2,656 · `builder.ts` 2,647 · `execution-engine.ts` 1,820 · `runtime.ts` 1,434 |
| `agent · services · server · capability` | 3,000 | |

### The rest

| Package | LOC | What it does |
|---|---|---|
| `tools` | 13,119 | **skills 5,489** · mcp 776 · adapters 767 · tool-calling 702 · rag 531 · execution 526. ~25 built-in tools |
| `llm-provider` | 11,631 | 8 providers (4,558), adapters/tiers, calibration, token counting, test provider |
| `reactive-intelligence` | 5,883 | controller 1,411 · sensor 1,163 · skills 899 · learning 690 · calibration 545 |
| `observability` | 5,615 | logging 1,457 · exporters 1,275 · telemetry 716 |
| `core` | 5,558 | services 2,782 (EventBus, harness-pipeline) · types · contracts |
| `memory` | 5,296 | 4-layer (working/semantic/episodic/procedural), SQLite+FTS5, sqlite-vec |
| `verification` | 1,269 | |
| `trace` / `replay` | 2,355 / — | normalize, analyze, recorder / deterministic replay |

---

## 4. The two execution paths — and the asymmetry between them

`_enableReasoning` defaults **false**. So there are two paths, and the default is the thin one.

Identical scripted work, identical env, measured today:

| | INLINE (default) | KERNEL (`.withReasoning()`) |
|---|---|---|
| Trace file | `llm-direct.jsonl` (**not run-scoped**) | ULID `.jsonl` |
| Trace events | **2** (`llm-exchange` ×2) | **35** across **17 kinds** |
| Kinds present | llm-exchange only | + run-started/completed, contract-compiled, assessment, projection-rendered, tool-surface-resolved, entropy-scored, kernel-state-snapshot, guard-fired, verifier-verdict, ledger-entry, tool-call-start/end, decision-evaluated, intervention-dispatched, harness-signal-injected |

**Controlled** — this is not "the inline run did less work":

- the tool **actually executed** (file on disk verified)
- `metadata.runLedger` has **3 entries** — Wave C.2 slice 3b-i's inline ledger is real
- `receipt` present, `stepsCount: 3`
- output identical (`"done."`)

**So: on the default path the evidence exists on the RESULT OBJECT but does not reach the
TRACE.** Trace-side consumers — `analyze`, `debrief`, cohort, `rax diagnose <runId>` — read
serialized JSONL and cannot reach `TaskResult.metadata`. By the same argument Wave C.2 slice
3b-ii used to justify its own fix, **every default-path run is structurally invisible to
them.**

The `llm-direct` placeholder is a known hazard with a documented history: `pipeline.ts`
carries a comment about an audit finding *"110k+ events… a hidden per-run LLM call lived
there for months, invisible to `rax diagnose <runId>`."* The correlation fix there is
conditional on `initialCtx.taskId`.

**This is the single most consequential finding of the deep dive**, because Vision pillar #2
is *"Observability as Foundation"* and the default configuration has almost none of it.

*(Mechanism not fully established — see §7.1.)*

---

## 5. Tier-scaling reach (from `00-SYSTEM-MAP`, restated for completeness)

Tier-gated: `loop` 8 · `act` 5 · `reason` 4 · `assembly` 2 · `strategies` 1 · RI 3.
Tier-gated in `decide` (2,572) · `verify` (2,315) · `reflect` (1,023) · `comprehend` (907) ·
`attend` (831) · `sense` (620) · `assessment` (664) · `control` (640) · `contract` (507):
**zero.**

And resolution is **binary**: `midModelAdapter` and `defaultAdapter` set an identical hook
set; only `local` differs.

---

## 6. Interaction seams (where systems actually meet)

These are the load-bearing joints. A change that does not respect one of these is how a
cross-cutting field gets silently dropped — the defect class the register tracks.

| Seam | Owner | Note |
|---|---|---|
| **LLM gateway** | `kernel/llm-gateway.ts` | sole mediator of kernel model calls; stamps `purpose` + budget |
| **Ledger write path** | `kernel/ledger/ledger-sink.ts` `growRunLedger` | growth + publication are one act; gated by `check-ledger-writes.sh` |
| **State chokepoint** | `kernel/state` `transitionState` | announced by the runner tap |
| **Tool execution** | `executeToolAndObserve` | policy gate + ledger mint live here (B1) |
| **Strategy → engine** | `extraMetadata` / `CompletionEnvelope` | B2/B4; where `terminatedBy`/abstention cross |
| **Engine → result** | `normalizeReasoningResult` + `TaskResult.metadata` | hand-enumerated whitelists; historic silent-drop source |
| **Run-wide fields** | `RunEnvelope` | 7 cross-cutting fields, 2 sanctioned provision seams |
| **EventBus → trace** | `toTraceEvent` (`trace/normalize.ts`) | `AgentStarted` → `run-started`; a missing case = silent invisibility (this is exactly how 3a's bug worked) |
| **Terminal authority** | `kernel/loop/terminate.ts` | single owner — but **6 guards propose into it** |
| **Adapter/tier** | `selectAdapter` | tier base + calibration composed (never early-return — P0-2) |

---

## 7. What I do NOT know — stated so nothing here is over-read

### 7.1 A probe failed today and its result must be discarded
I attempted to compare **EventBus** traffic per path via `.withEvents({ onEvent })`. It
returned **0 events on BOTH paths — including the kernel path that demonstrably wrote a
35-event trace.** The subscription shape is wrong, not the system. **No conclusion may be
drawn from it.** Consequently the *mechanism* behind §4 is not established: I know the trace
outcome differs, I do **not** know whether `AgentStarted` fails to publish on the inline path
or publishes and fails to reach the recorder. That distinction changes the fix, so it must be
settled before anyone acts on §4.

### 7.2 No token attribution
`purpose` is stamped on the wire request but every `llm-exchange` in a real trace reads
`UNSTAMPED`. LOC and event counts are **proxies, not token prices**. Nothing here prices a
subsystem.

### 7.3 Unexamined
`apps/cortex` (37,115 LOC) — structure unknown. `builder/` internals (6,125). The 83 withers
have not been mapped to the subsystems they gate. `memory` behaviour (default-off since
v0.12) unmeasured. `guardrails`, `identity`, `interaction`, `a2a` not inspected this pass.

### 7.4 Not a defect until shown otherwise
Zero tier-gating in `decide`/`verify`/`sense` is a **finding, not a verdict**. Some logic
*should* be universal — the ledger, the terminal authority, the receipt. The claim is only
that universality there was never a decision; it is the default nobody revisited.

---

## 8. Revised read

Three things are true at once, and previous documents in this session each over-weighted one:

1. **The architecture is sound.** Clean layering, no cycles, real chokepoints with gates.
   The problem is not tangle.
2. **The mass is unconditional.** ~10,000 LOC of decide/verify/sense/control runs identically
   for every model tier, and the tier mechanism that could condition it stops at the prompt
   layer.
3. **The default path is thin *and* nearly unobservable.** Users get the inline path, which
   carries evidence on the object but writes almost nothing to the trace.

Point 3 changes the priority order. Extending tier-gating (§5) optimises a path most users
never take, while the path they *do* take cannot be diagnosed at all. **Fixing default-path
observability plausibly outranks the tier-gating extension** — but §7.1 must be resolved
first, because I do not yet know the mechanism.

**Recommended immediate step, unchanged and now better motivated:** land `purpose` on the
`llm-exchange` trace event (§7.2) and settle §7.1 in the same pass. Both are small, both are
instrument work, and every argument after them gets sharper.
