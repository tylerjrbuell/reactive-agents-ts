---
type: implementation-plan
status: ACTIVE — the single running overhaul program (WIP = 1)
created: 2026-08-12
supersedes:
  - 2026-07-27-simplification-and-feedback-loop.md (ACTIVE → absorbed)
  - 2026-07-28-a-tier-gap-closure.md (OPEN → absorbed)
  - 2026-07-31-competitive-edge-structural-program.md (PROPOSED → absorbed)
  - 2026-08-08-move-1-single-loop.md (in-flight → becomes Phase 1 here)
governed-by: [[../../Architecture/Specs/09-UNIFIED-PROGRAM]]
---

# The Agentic Overhaul Program

**One running plan. It replaces four.** Three of the superseded plans each declared
themselves "the only active program (WIP=1)" — plan-level instance of the same
boundary-multiplicity disease the program exists to cure. Their content is absorbed
below; none of it is lost, and their commit history stands.

**Governing law:** 09 §2 (one owner + one grep-able script per subsystem; lift rule
≥3pp accuracy AND ≤15% tokens; instrument-before-conclusion). 09 §6 names the smells;
this plan says how each dies.

---

## 0. Standing rules for this program

1. **WIP = 1.** One phase in flight. A new finding files a row in §6, it does not
   open a parallel wave.
2. **Every fix names its failure mode and its red-on-cut script.** No script → not done.
3. **Measured beats reasoned.** Every claim in §2 carries its evidence or is marked
   HYPOTHESIS. Four findings have been retracted to one tool-surface confound; a
   fifth died on re-measurement 2026-08-12; three instrument faults were caught in a
   single bench the same day. Assume the instrument is wrong first.
4. **No new north-star doc, no fifth plan.** Amend 09; append to §6 here.

---

## 1. Phase 0 — MERGE FIRST (blocking; no new code before this lands)

`refactor/move-1-single-loop` is **17 ahead / 5 behind** `main` and contains
materially more than its name suggests. Building anything else on `main` first
guarantees a painful reconcile.

**What the branch actually holds** (from its own record, verified against commits):

| commit | content | state |
|---|---|---|
| `f0955987` | Step 1 — `runtime.ts` ALWAYS builds the reasoning layer (`createRuntime:723` + `createLightRuntime:1281`) via `bareReasoningConfig(maxIter)`; `enableReasoning` now gates only extras | shipped, inline arm NOT yet deleted (safe checkpoint) |
| `7e394a4e` | **P2 — domain-only FC array on native-FC.** `scope:"domain"\|"harness"` on `ToolSchema`; `wireToolSchemas` drops harness tools from `llmTools`; `check-domain-only-fc.sh` red-on-cut | shipped + **measured −9% tokens / −14pp**, 3/3, suites clean |
| `34c00fb4` | compaction budget reserves headroom for system+tools+output (was budgeting messages at full `window*4`) | shipped, survives Move 1 independently |
| docs | control-plane-vs-meta-tools design, grounding-ceiling verification, wire-probe corrections | — |

**Blockers to merging, in order:**

- **B1 — one REAL port (2 tests).** Provider faults are now CAPTURED to
  `success:false` instead of propagating as an Effect failure, so `run()` no longer
  throws and `withErrorHandler` never fires. **This is a public-behavior regression,
  not a test-wording issue.** Fix at `reactive-agent.ts:795` — map execution-error to
  an Effect failure rather than `success:false`.
- **B2 — 24 failing runtime tests, triaged:** ~9 are inline-capture instrumentation
  (behavior holds), ~13 are intentional new behavior needing re-pinned wording
  (`meta-loop-reachability`, terminal-gate, tool-surface — note the tool-surface
  ATTACK test **held; no leak, only the message differs**), 2 are B1.
- **B3 — rebase onto `main`** (5 behind; `main` gained the wide-surface bench + the
  09 rewrite).

**Exit:** branch merged, suite green, `check-domain-only-fc.sh` +
`check-success-authority.sh` + `check-cross-cutting.sh` all green.

---

## 2. The decision that gates everything (OWNER-GATED — needs your call)

Move 1's abort criterion was "the token tax must not be irreducible." It is now
measured on both tiers, and it is **not** the 2–6× that would auto-abort:

| model | old inline | new default (kernel) | delta |
|---|---:|---:|---:|
| `gemma4:12b` (native-FC) | 1,025t / **2 calls** | 1,809t / **3 calls** | **+76%** |
| `gemini-2.5-flash` | 760t / **2 calls** | 1,500t / **3 calls** | **+97%** |

Per-call overhead is close (589 vs 512t ≈ +15% scaffolding). **The bulk is one extra
LLM round-trip, and it is STRUCTURAL, not a local-model quirk** — the leaner frontier
model shows it worse. Diagnosed via phase trace: without `final-answer` anchoring
"done", the model spends iteration 1 on a non-terminal think and emits a clean
`end_turn` at iteration 2. The kernel over-iterates rather than honoring the first
no-tool `end_turn`; `gemini` additionally logged a token-delta-guard early exit.

**This is the "wasted turn" the whole program is chasing, isolated to one cause.**

Three options:

- **(A) Investigate and reduce the +1 call — RECOMMENDED.** Suspects, in order:
  `nextMovesPlanning:{enabled:true}` default; the kernel not treating a first
  no-tool `end_turn` as terminal; `looksLikeFinalAnswer` promotion (`think.ts:128`)
  being too conservative. Success target: **+15–32%**, which clears the judgment
  zone and unlocks every downstream phase.
- **(B) Accept ~2× on trivial tasks** on the argument that it amortizes on real work.
  Cheap, but it ships a known regression against this program's own 15% ceiling.
- **(C) Abort Move 1.** Keeps two loops forever. Not recommended — the correctness
  gap (§6 FM-1) is the reason the program exists.

**Nothing in Phases 2+ should start until this is answered.**

---

## 3. Priority order of operations

Ordered by (evidence strength × leverage) ÷ risk. Each phase is independently
shippable and independently revertible.

| # | Phase | Gate | Why here |
|---|---|---|---|
| 0 | Merge the branch (§1) | suite green | everything else builds on it |
| 1 | Resolve the +1 call (§2) | +15–32% | abort gate for the whole program |
| 2 | Forced fixes (§4) | deterministic tests | zero lift-gate risk, immediate |
| 3 | Delete the inline arm | `check-single-loop.sh` | needs Phase 1 verdict |
| 4 | One terminal outcome | run/stream parity test | kills 3 reconstruction sites |
| 5 | One execution boundary | policy/ledger parity | kills the batch bypass |
| 6 | Steering prose → typed control | control-decision ledger fact | the non-determinism cure |
| 7 | Profiles | cross-tier lift | where per-model adaptation lands |
| 8 | Reasoning policies (strategy dissolution) | replay byte-parity | needs 4+5 first |
| 9 | Context/allocator economy | token accounting | after one manager exists |
| 10 | Config/memory convergence | serialization round-trip | DX debt, last |

---

## 4. Phase 2 — forced fixes (no lift gate; ship as a bundle)

| id | fix | site | why forced |
|---|---|---|---|
| FF-1 | Stop printing the API-key prefix | `build-validation.ts:338-347` | security; one line |
| FF-2 | Validate trace JSON at load, don't cast | `trace/src/replay.ts:15-28` | this is the measurement substrate |
| FF-3 | Delete the `discover-tools` **tool**; keep pruning | `skills/discover-tools.ts` | 0 invocations / ~51 cells; see §5 |
| FF-4 | No-progress termination for repeated no-evidence loops | control resolver | F8 burns 6,691–8,397t at `evidenceDelta=0` |
| FF-5 | Real tier + input tokens in cost tracking | `cost-track.ts:20-48` | scoped to `.withCostTracking()`; still wrong |
| FF-6 | One path-confinement authority; delete the other | `path-resolver.ts:43-55` vs `file-operations.ts:371-386` | two authorities, different roots (F9) |

---

## 5. Tool disclosure — settled by measurement

**Keep progressive disclosure. Delete only the model-facing tool.**

Wide-surface ablation (`2026-08-12`, qwen3.5:latest, n=2, 12 vs 44 tools):

| size | arm | meanTok | correct | needed tools surfaced at iter 0 |
|---|---|---:|---:|---:|
| 12 | pruned (default) | 4,060 | 2/2 | 2/2 |
| 44 | pruned (default) | **6,217** | 2/2 | **2/2** (narrowed 45 → 20) |
| 44 | no-prune | **10,378** | 2/2 | 2/2 |

The free keyword heuristic found both needed tools among 42 MCP-style distractors in
**8/8 cells**. Pruning's saving **scales with roster size: 13% @ 12 tools → 40% @ 44.**
`discover-tools` fired **zero** times (record now ~51 cells, 4 datasets, 3 models).

Replacement for its escape-hatch role — deterministic, no round-trip:

```ts
// Assembly-time expansion. The harness already holds the catalog and the scorer.
function expandSurface(i: ToolSurfaceInputs): readonly ToolSchema[] {
  const ranked = rankByQuery(i.catalog ?? [], i.taskText ?? "")
    .filter(r => r.score >= RELEVANCE_FLOOR)
    .slice(0, i.profile.disclosureBudget);
  return dedupe([...requiredFloor(i), ...ranked, ...usedSoFar(i)]);
}

// Escape hatch becomes FAILURE-driven, not request-driven.
function onUnofferedCall(name: string, s: SurfaceState): SurfaceDecision {
  const known = s.catalog.find(t => t.name === name);
  return known
    ? { kind: "expand-and-retry", tool: known }   // executes now, widens next turn
    : { kind: "reject", remedy: listPermitted(s) }; // honest exhaustion
}
```

There is no state in which the model spends a turn asking and gets nothing — which is
exactly the F8 loop, removed structurally rather than guarded against.

---

## 6. Failure-mode register (root causes, each with its fix)

Every row verified against source 2026-08-11/12 unless marked HYPOTHESIS.

### FM-1 — Two agent loops; the default user gets the worse one
`execution-engine.ts:739-861` (kernel) vs `:862-1100` (inline). `_enableReasoning`
defaults `false` on `main`, so the default path is the inline arm, which is
filesystem-blind on success and sits **outside** `check-success-authority.sh`'s fence
(it scans `packages/reasoning/src` only). Every correctness fix shipped to the kernel
misses the majority population.
**Fix:** Phase 0 + 3. **Script:** `check-single-loop.sh`.

### FM-2 — Two context managers; the default takes the primitive one
Default (inline) uses `core/services/context-window-manager.ts` with
**`maxTokens: 100_000` hardcoded** — it ignores the real window
(`effectiveContextTokens` is in deps but never passed), so it **oversends on any
model under ~96k**. Truncation is naive drop-oldest whole-message and **can drop the
goal**; no refs, no preview, no protected classes. `inline-observe:147` appends full
tool results raw every iteration. The kernel meanwhile has the staged projector
(`assembly/project.ts`). **This is the single worst reliability defect on the default
path** and it dies as a side effect of FM-1.
**Fix:** Phase 3 deletes the primitive manager. **Script:** `check-single-context-manager.sh`
(cannot land until the inline arm is gone).

### FM-3 — The +1 structural LLM call
See §2. Both tiers, worse on the leaner model.

**INVESTIGATED 2026-08-12 — the +1 call is CONFIRMED and its two obvious causes are
FALSIFIED.** Controlled A/B, `gemma4:12b` native-FC, one-tool task, n=3 per arm,
every arm deterministic 3/3:

| arm | LLM round-trips |
|---|---:|
| A — P2 as shipped (harness tools off wire) | **3** |
| B — counterfactual (`final-answer` restored to wire) | **2** |
| C — deterministic `end_turn` promotion (bypass `looksLikeFinalAnswer`) | 3 |
| D — evidence-keyed terminal-gate exemption (not channel-keyed) | 3 |
| C+D | 3 |

So the extra call is exactly +1, perfectly reproducible, and **caused by neither**
`looksLikeFinalAnswer`'s gating (`state.iteration > 0`, 100-char floor, positive-signal
requirement) **nor** the terminal gate's channel-keyed exemption
(`isDeliberateToolExit === "final_answer_tool"`). Both were patched and measured; both
made no difference. This **retires the branch's stated "only lever"** (aggressive
`looksLikeFinalAnswer` promotion, which carried false-positive risk) — it is not the
lever. Root cause still OPEN; next probes are the post-tool-result projection and
whether the loop re-enters `think` before consulting the terminal gate at all.

### FM-4 — Terminal truth reconstructed three times
Kernel produces terminal state; `reactive-agent.ts:1458-1522` re-derives tool calls,
deliverables and goal-achieved from `reasoningSteps`; `execute-stream.ts:535-814` does
it again. `arbitrator.ts` (1,800 LOC, 84 branches) is a third post-condition site —
found by E2E after unit tests missed it.
**Fix:** Phase 4, one `RunOutcome`, everything else a projection (09 C7).

### FM-5 — Stream execution detached from its caller
`execute-stream.ts:811-814` `Effect.forkDaemon` on correctness-critical work;
`run-controller.ts:247-251` aborts only its own controller. Cancelling a stream does
not stop the run — observed: a second run overlapped the first mid-request.
**Fix:** Phase 4. **Test:** terminate, assert no subsequent provider call.

### FM-6 — Tool execution has two boundaries
`executeToolAndObserve()` owns policy/approval/observation/ledger/events; the kernel
parallel batch bypasses it for `executeNativeToolCall()` (`act.ts:621-703`) — the code
comment admits it.
**Fix:** Phase 5, batch-capable scheduler; `executeToolAndObserve` becomes its
single-call adapter.

### FM-7 — Requirement evidence means different things per caller
`terminal-gate.ts:26-35`: kernel counts a required tool covered when **attempted**,
plan-execute when **completed**. Same run, different verdict by strategy.
`final-answer` is exempt from grounding and coverage entirely (`:241-246`).
**Fix:** Phase 5, one ledger-backed `RequirementEvidence`.

### FM-8 — Deterministic facts become English instead of control
13 files implement "harness computes a fact → writes prose at the model → hopes."
`control-plane.ts` already has the typed vocabulary
(`veto|abstain|terminate|strategy-switch|redirect|steer|continue` × `RemedyKind`), but
`steer`'s own doc calls the remedy *"the seed of the guidance text"*. Every remedy kind
is deterministically actionable:

| remedy | today | should be |
|---|---|---|
| `required-tool` | "you must call X" | force X callable, or terminate |
| `loop` | "avoid repeating" | **block** the repeated call |
| `budget` | "wrap up now" | terminate |
| `tool-failure` | "fix the args" | error class → retry / alternate / abandon |
| `coverage` | "requirements remain" | name it, or terminate |

**This is the non-determinism cure.** Same disease as strategy multiplicity: the
harness declining to decide. Also note the control plane is `longHorizon`-gated —
**dark on the default path**, so this lands with FM-1.
**Fix:** Phase 6. Collapse `steer` to genuinely-ambiguous cases; every control result
appends one `control-decision` ledger fact.

### FM-14 — `final-answer` is a fabrication channel (measured 2026-08-12)
Same A/B as FM-3, but with a tool that only *claims* to write the file and does not:

- **Arm B (`final-answer` on the wire): exits in 3 calls reporting SUCCESS with no file
  on disk.** The `isDeliberateToolExit` exemption bypasses the deliverable gate entirely.
- **Arm A (P2, no `final-answer`): correctly refuses** — assessment holds
  `requirementsOutstanding:3, deliverablesMissing:1` for the whole run — **but then has no
  deterministic no-progress termination.** It burns 9 calls, re-invokes the same tool,
  fires three entropy `tool-inject` interventions, and finally exits via
  `loop_resolution → harness_synthesis`.

**Both arms are wrong, in opposite directions**, and which one you get depends only on
which channel the answer arrived through. This is the sharpest evidence yet for the
program's thesis, and it means P2 did not merely cost a call — it **closed a fabrication
hole** and exposed the missing no-progress control underneath (FF-4).
**Fix:** FF-4 (deterministic no-progress termination) + FM-7 (one evidence semantic).
**Do not "fix" FM-3 by restoring `final-answer` to the wire** — that re-opens this.

### FM-9 — Success is existence, never content (the grounding ceiling)
Verified by deterministic probe: the success authority accepts **wrong-content, empty,
and fabricated-claim** deliverables as MET. `ArtifactProduced` = file-exists;
`OutputContains` = substring-in-belief; there is **no execution/test/world grounding
anywhere**. Blast radius universal via `deriveConditions`. A contract slot already
exists — `RunContract.AcceptanceTier = "deterministic"|"checker"|"self-critique"` —
and `"checker"` is unbacked.
**HONEST CAVEAT:** incidence on the available corpus is 1/45, but that corpus is
trivial (haiku 15/15), so it is uninformative — this cannot be crowned the
needle-mover without a harder corpus.
**DESIGN FLAG:** exec-grounding is MET→UNMET, which **inverts Move 2's positive-only
rule** and would reopen the 88% false-fail if harness-inferred. Safe **only** as a
caller-supplied `"checker"` tier.
**Fix:** Phase 7 (profiles carry acceptance tier). **Prereq:** a harder corpus.

### FM-10 — Strategy multiplicity
7,628 LOC / 8 files. `reflexion` is 20% prompt-building; ToT 10%; both wrap kernel
capabilities (`verify/critique.ts`) that are **already extracted**. `plan-execute`
(1,584) and `blueprint` (755) carry real machinery and merge into one `plan` primitive.
**Fix:** Phase 8 — policies as data over `{kernel, llm, actuator, plan}` passes; prompts
move to procedure files on the existing skills rail (`dc8274fb`). Realistic target
**7,628 → ~1,500 LOC + 8 policy literals**, not zero.
**Gate:** replay-golden byte-parity on `reactive`-as-policy. If that diverges, the
abstraction is wrong.

### FM-13 — A provider factory exists; one provider reimplements it
`makeOpenAICompatProvider` (`providers/openai.ts:245`) is the shared OpenAI-compat
wire adapter, and `OpenAIProviderLive`, `GroqProviderLive` and `XAIProviderLive` are
all thin calls to it. **`litellm.ts` (766 LOC) does not import it** and reimplements
the same surface (15 openai-compat markers). `local.ts` (1,087 LOC) is also separate
but has genuine Ollama wire quirks, so it is not the same case.
**Fix:** fold `litellm` onto the factory; keep only its genuine deltas.
**Script:** extend `check-cross-cutting.sh` — one openai-compat wire assembly point.
**Risk:** low; behind the provider gateway, and `litellm` is not on the default path.

### FM-11 — Config represented seven ways
Builder fields → `BuilderState` → `BuilderRuntimeStateView` → `RuntimeOptions` →
`ReactiveAgentsConfig` → `AgentConfig` → hand serializer. **4,310 LOC** across
`types.ts` (998) + `runtime-types.ts` (1,002) + `builder/types.ts` (1,144) +
`agent-config.ts` (813) + `to-config.ts` (353). 83 public withers.
**Fix:** Phase 10. Deliberately last — DX debt, no measurable performance leg.

### FM-12 — Instrument integrity
`trace/src/replay.ts:15-28` casts arbitrary parsed JSONL to `TraceEvent` unchecked.
Rung-1 replay buckets `RA_LAZY_TOOLS`/`RA_TOOL_DISCOVERY` INERT for a **corpus**
reason (builtins sets too small to hide anything), not a mechanism reason — this must
be stated with every INERT verdict.
**Fix:** FF-2 + grow the golden corpus.

---

## 7. Open hunts (evidence not yet sufficient to plan a fix)

| id | lead | what would settle it |
|---|---|---|
| H-2 | `iterate-pass.ts` 1,642 + `think.ts` 1,788 + `kernel-state.ts` 1,458 | decompose after Phases 4-6 remove their reasons to exist |
| H-3 | Frontier native-FC domain-only-FC win (bigger schemas ⇒ likely bigger than −9%) | UNMEASURED — needs credits |
| H-4 | Harder golden corpus (current is trivial: haiku 15/15) | blocks FM-9 and the lift gate's accuracy leg |
| H-5 | Wide-roster disclosure on a frontier tier | only local tier measured |

---

## 8. What this program will not do

- Start a parallel wave program. WIP = 1.
- Ship `RunSupervisor`/`AgentSpec` as a greenfield seam — the diagnosis is 09 §6, the
  cure is Phases 3-6 incrementally, each with its own abort gate.
- Promote any mechanism on elegance. Eight lift attempts, zero passes; the one clean
  result to date is a **deletion** (FF-3).
- Cite retracted numbers: 555–640% overhead, or the 2/12-vs-11/12 pruning finding.
