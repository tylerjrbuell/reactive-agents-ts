# Framework Architecture Index

> **Status:** 🟢 LIVING SPINE — the canonical, navigable map of how Reactive Agents actually works, grounded in code.
> **Verified against:** `main` @ 2026-06-03 (commit `aed8a8a2`). Every claim carries a `file:line` anchor and a one-line **verify** command.
> **Claim tags:** `[verified]` = read in code this session · `[from-spec]` = asserted by a spec, not re-verified here · `[aspirational]` = designed, not yet on `main`.
> **Companions:** [[2026-06-03-full-potential-realization-plan]] (impact-ranked plan) · [[2026-06-03-architecture-drift-register]] (debt/drift) · [[05-DESIGN-NORTH-STAR]] (vision).

This index is the answer to "how does this framework function?" for both AI agents and humans. It is intentionally anchored so it can be **re-verified, not just re-read** — that is the discipline that keeps it from becoming the next stale doc (drift has shipped 4× per the project's own count; see Drift Register).

---

## 0. Mandate (one line)

> **Built for control, not magic. Reliable, observable, composable agents for any model, any tier.** ([[00-VISION]]) — delivered as observable, gate-pinned, empirically-validated agent behavior.

---

## 1. The Two-Loop Shape

Reactive Agents runs **two nested loops**. Understanding this split is the key to the whole codebase.

```
ExecutionEngine (outer, runtime)            ReAct Kernel (inner, reasoning)
 packages/runtime/src/execution-engine.ts    packages/reasoning/src/kernel/
 ──────────────────────────────────────      ────────────────────────────────────
 BOOTSTRAP → GUARDRAIL → STRATEGY-SELECT  →   runner.ts → iterate-pass.ts (per-turn):
 THINK ───────────────────────────────────►    context-builder → think → guard → act
 ACT(synth) → OBSERVE(synth) → MEMORY-FLUSH      + per-iter: recall, learn, reflect
 → VERIFY → AUDIT → COMPLETE                     terminate.ts (single owner) → arbitrator
```

- **Outer loop** = lifecycle orchestration (bootstrap memory, guardrail input, pick strategy, run reasoning, flush memory, verify, audit, finalize). `[verified]` phase modules: `packages/runtime/src/engine/phases/{bootstrap,guardrail,strategy-select,agent-loop/,verify,audit,complete,memory-flush,cost-route,cost-track}.ts`.
  - **verify:** `ls packages/runtime/src/engine/phases/`
- **Inner loop** = the reasoning kernel. Each strategy delegates to the kernel; the kernel iterates think→guard→act with per-iter recall/learn/reflect until `terminate.ts` + arbitrator decide.
  - **verify:** `ls packages/reasoning/src/kernel/loop/`

> ⚠️ The skills `architecture-reference` and `architecture-audit` still describe the kernel at `packages/reasoning/src/strategies/kernel/` — **that path no longer exists** (Stage-5 move). Canonical path is `packages/reasoning/src/kernel/`. See Drift Register D1.

---

## 2. The Cognitive Spine — 10 Capabilities → Owner Files

The North Star's agent model (Sense→Attend→Comprehend→Recall→Reason→Decide→Act→Verify→Reflect→Learn) is implemented as one owner directory per capability under `packages/reasoning/src/kernel/capabilities/`. **All 10 dirs exist and have owner files `[verified]`** — including `learn/` and `recall/`, which North Star §4.3 still calls "currently missing."

| # | Capability | Owner | Wired? |
|---|-----------|-------|--------|
| 1 | **Sense** | `capabilities/sense/step-utils.ts` | `[verified]` |
| 2 | **Attend** | `capabilities/attend/context-utils.ts` | `[verified]` |
| 3 | **Comprehend** | `capabilities/comprehend/task-classification.ts` | `[verified]` |
| 4 | **Recall** | `capabilities/recall/recall-service.ts` (202 LOC) | `[verified]` per-iter at `loop/iterate-pass.ts:401` via `Effect.serviceOption(RecallService)` |
| 5 | **Reason** | `capabilities/reason/think.ts` (+ `assumption-detector.ts`, `stream-parser.ts`) | `[verified]` |
| 6 | **Decide** | `capabilities/decide/arbitrator.ts` | owner `[verified]`; "sole verdict path" `[from-spec]` (termination tokens appear in ~8 files) |
| 7 | **Act** | `capabilities/act/act.ts` (+ tool-execution, guard, tool-gating, tool-parsing) | `[verified]` |
| 8 | **Verify** | `capabilities/verify/verifier.ts` (+ critique, evidence-grounding, requirement-state) | `[verified]` |
| 9 | **Reflect** | `capabilities/reflect/loop-detector.ts` (+ reactive-observer, strategy-evaluator) | `[verified]` |
| 10 | **Learn** | `capabilities/learn/learning-pipeline.ts` (119 LOC) | `[verified]` per-iter at `loop/iterate-pass.ts:939` via `Effect.serviceOption(LearningPipeline)` |

**verify:** `for c in sense attend comprehend recall reason decide act verify reflect learn; do ls packages/reasoning/src/kernel/capabilities/$c/*.ts; done`

> **Tracing honesty:** in-loop per-iter invocation was traced for **reason/guard/act** (the `iterate-pass.ts` pipeline) + **recall/learn** (`:401/:939`) `[verified]`. **sense/attend/comprehend/decide/verify/reflect** are confirmed by owner-file existence; their exact per-iter call sites are `[from-spec]`, not re-traced this pass.

**Design contract** (`[from-spec]` §4.2): Sensors are pure `state→Observation`; Arbitrator is the *only* termination decider; Effectors execute verdicts but cannot decide termination or strategy; Loop Controller is the only state mutator. The **single termination owner** is `kernel/loop/terminate.ts` `[verified]`.

> **Learn/Recall optional-layer pattern:** both resolve via `Effect.serviceOption` — the kernel runs correctly with no layer provided (returns `None`). This is the clean seam that lets memory be absent in tests yet wired in production. `[verified]`

---

## 3. Kernel Internals (inner loop, deep)

```
packages/reasoning/src/kernel/
├── state/      kernel-state.ts (KernelState: messages[] + steps[]), kernel-hooks.ts, kernel-constants.ts
├── loop/       runner.ts (771 LOC), iterate-pass.ts (per-turn body), terminate.ts (single owner),
│               react-kernel.ts (makeKernel factory), runner-helpers/{deliverable,stall-deliverable,state-queries}.ts
├── capabilities/  (the 10 dirs above)
└── utils/      diagnostics.ts, ics-coordinator.ts, lane-controller.ts, service-utils.ts
```

**Two independent state records** (do not conflate) `[verified]`:
- `state.messages[]` — what the **LLM sees** (the multi-turn FC conversation thread).
- `state.steps[]` — what **systems observe** (entropy, metrics, debrief).
- **verify:** `grep -n "messages\|steps" packages/reasoning/src/kernel/state/kernel-state.ts | head`

**Per-turn pipeline** (`loop/iterate-pass.ts`) `[verified]`:
1. **context-builder** — pure data: system prompt, conversation messages, tool schemas (no LLM, no side-effects).
2. **think** (`capabilities/reason/think.ts`) — LLM stream, FC parsing, loop detection, oracle gate.
3. **guard** (`capabilities/act/guard.ts`) — `Guard[]` chain; any guard can block a tool call.
4. **act** (`capabilities/act/act.ts`) — meta-tool registry + tool dispatch + final-answer gate.
5. per-iter **recall** write/read, **learn** write, **reflect** (loop-detector streak rule: only ACTION steps reset the streak, observations do not — `maxConsecutiveThoughts: 3`).

**Deliverable assembly — TWO coexisting systems** `[verified]` (active migration, see §4):
- *Older, 2-source:* `loop/runner-helpers/deliverable.ts` `assembleDeliverable` → `Deliverable { content, source: "model_synthesis" | "raw_artifacts" }`. Used in `runner.ts:65`, `loop-resolution.ts:144,179`, `stall-deliverable.ts:126,224`.
- *Newer, 4-source (canonical):* `core/contracts/deliverable.ts` `modelSynthesisDeliverable`/`sentinelDeliverable`/`deliverableToContent` (`model_synthesis | tool_artifact | harness_synthesis | sentinel`). Used in `runner.ts:529,538`, `iterate-pass.ts:351,357`.
- **⚠️ `runner.ts` imports BOTH.** The intended single-writer `commitDeliverable` was never built; `state.output` has ~6 writers. → Drift Register S5/S6 / Plan P1.

**6 strategies + adaptive** delegate to the kernel `[verified]`: `direct, reactive, reflexion, tree-of-thought, plan-execute, code-action` + `adaptive` (router).
- **verify:** `ls packages/reasoning/src/strategies/*.ts`

---

## 4. Canonical Contracts Layer (the trust/measurement spine)

The `overhaul/agentic-core-2026-05-31` branch (the 4-sprint canonical-contracts arc, North Star §6.5) is **fully merged into main** (main is 38 commits past it). **verify:** `git rev-list --left-right --count main...origin/overhaul/agentic-core-2026-05-31` → `38 0`.

It landed **unevenly** — the *infrastructure + types* are wired, but the *saturation* (making each contract the sole/complete path) is incomplete across the board:

| Contract | Location | State |
|----------|----------|-------|
| `Capability` (source-tagged) + `effectiveWindowChars` | `core/contracts/capability.ts` | `[verified]` **WIRED** — consumed by `llm-provider/src/canonical-resolver.ts:43` (~65%×4 effective-window rule). |
| `PreFlight.validate` | `core/contracts/preflight.ts` → `runtime/src/build-validation.ts` | type + validator exist `[verified]`; runs-at-`build()` `[from-spec]` (not re-traced). |
| `TaskContract` | `core/contracts/task-contract.ts` | `[verified]` **BENCH-ONLY** — referenced only in `benchmarks/*`; never threaded into the runtime agent build (Sprint-1 C1.3 incomplete). |
| `Deliverable` provenance (4-source) | `core/contracts/deliverable.ts` | `[verified]` **PARTIALLY WIRED** — `modelSynthesisDeliverable`/`sentinelDeliverable`/`deliverableToContent` are called at `runner.ts:529,538` + `iterate-pass.ts:351,357` ("Sprint-1 B2: typed DeliverableProvenance channel"). |
| `commitDeliverable` (intended sole writer) | `core/contracts/deliverable.ts` | `[verified]` **NEVER IMPLEMENTED** — appears only in the file's own `@example` JSDoc (`:20,:27`); no `export function`. The §6.5 "every output through `commitDeliverable`" claim is **literally false** (no such function exists). |
| `projectResultForPrompt` | (context-assembly spec) | `[verified]` **DEAD** — 0 callers; built then reverted. |

**verify (commitDeliverable unbuilt):** `grep -rn "commitDeliverable" packages/*/src` → only `core/contracts/deliverable.ts` JSDoc `@example` lines; no `export function commitDeliverable`.

> **The single highest-leverage finding:** the provenance migration is **in progress, not complete**. Core's 4-source `Deliverable` is partially adopted but **coexists** with the older 2-source `assembleDeliverable` (`runner-helpers/deliverable.ts`) — `runner.ts` imports *both* (`:65` and `:529`). And `state.output` still has **~6 writers** (`runner.ts:344,463,503,538,717,723`) mixing typed deliverables with raw strings (`synthContent`, `state.output ?? ''`). The intended single-writer (`commitDeliverable`) was never built, so "errors-leaked-as-output constructively impossible" is **not yet true**. Completing this migration is [[2026-06-03-full-potential-realization-plan]] P1. **verify:** `grep -rn "output:" packages/reasoning/src/kernel/loop/runner.ts`

---

## 5. Compose API (harness injection — Phase B: infra landed, coverage partial)

`.compose((harness) => …)` injects behavior at kernel chokepoints. **The infrastructure landed; chokepoint saturation did not.**
- **Infra (wired) `[verified]`:** `HarnessPipeline` registry (`core/services/harness-pipeline.ts`, `harness-types.ts`), builder `.compose()` + `.withX()` desugaring + `HarnessProfile` (`runtime/src/builder.ts:402,421,497,823`), and the 6 killswitches (`packages/compose/src/killswitches/`: budgetLimit, timeoutAfter, maxIterations, requireApprovalFor, watchdog, confidenceFloor).
- **Coverage (partial) `[verified]`:** the kernel→compose emit bridge `emitToCompose` is called in **1 file** (`capabilities/act/act.ts`), and only **~4 distinct tags** are referenced in kernel/runtime: `lifecycle.failure`, `nudge.healing-failure`, `observation.tool-result`, `prompt.system`. The North Star Phase-B target of **24 injection points is NOT met** — ~4/24 emit on `main`.
- **verify (real coverage, not line-count):** `grep -rln "emitToCompose(" packages/reasoning/src packages/runtime/src` (→ 1 file); `grep -rhoE '"(prompt|message|nudge|tool|observation|lifecycle|control)\.[a-z-]+"' packages/reasoning/src packages/runtime/src | sort -u`

> **Correction note:** an earlier draft claimed "24 chokepoints verified" — that was a multi-pattern `grep | wc -l` line-count that *coincidentally* matched the spec's number (confirmation bias, the exact drift this index exists to prevent). The honest count is ~4 emitting tags. Expanding chokepoint coverage is a real backlog item — see Drift Register **S10** (tag-emit coverage) + D6 (read-vs-mutate) / Plan P4 (M14 needs `lifecycle.failure` + `control.strategy-evaluated`; the latter is **not yet emitted**). Note: killswitches and phase-hooks (`.before`/`.after`) are *distinct live mechanisms* from tag-emit — the thin number is **tag-emit coverage**, not "compose barely wired."

---

## 6. Package Topology (layer stack, 35 dirs)

Build/dependency order (lower builds first). One-line purpose each.

**L0 — zero internal deps:** `core` (EventBus, types, Agent/Task, **contracts/**), `runtime-shim` (Bun/Node primitives).
**L1 — core only:** `llm-provider` (6 adapters), `observability`, `identity`, `a2a`, `interaction`, `observe` (OTel/OpenInference), `trace` (telemetry events).
**L2 — core+llm-provider:** `memory` (4-layer), `tools` (built-ins + MCP), `guardrails`, `cost`, `eval` (frozen judge), `prompts`.
**L3:** `reasoning` (kernel + 7 strategies), `verification`, `orchestration` (multi-agent), `gateway` (persistent chat), `reactive-intelligence` (RI dispatcher + learning + skills).
**L3.5:** `replay` (deterministic trace replay), `compose` (harness + killswitches).
**L4 facade:** `runtime` (`createRuntime()` composes all layers) → `reactive-agents` (public re-export).
**Private:** `testing`, `benchmarks`, `scenarios`, `health`, `judge-server`.
**Frameworks:** `react`, `vue`, `svelte`.
**Other:** `channels` (external triggers; partly remote-only), `gateway`, `diagnose` (rax-diagnose CLI), `guardrails`, `create-reactive-agent` (CLI generator).

**verify:** `ls packages/` (35 dirs) — North Star §5.1 target is ~22 after consolidation; **not yet executed** (Plan P5).

### Subsystem anchors (index-depth)

| Subsystem | Owner | verify |
|-----------|-------|--------|
| **Providers** (6) | `llm-provider/src/providers/{anthropic,openai,gemini,litellm,local}.ts` + `local-probe.ts` | `ls packages/llm-provider/src/providers/` |
| **Memory** (4-layer) | `memory/src/services/{episodic,semantic,procedural}-memory.ts` + `experience-store, debrief-store, plan-store, memory-consolidator` | `ls packages/memory/src/services/` |
| **Canonical resolver** | `llm-provider/src/canonical-resolver.ts` (capability source-tagging) | `grep -n effectiveWindowChars packages/llm-provider/src/canonical-resolver.ts` |
| **RI dispatcher** | `reactive-intelligence/src/controller/dispatcher-service.ts` + `learning/learning-engine.ts` + `skills/skill-distiller.ts` | `ls packages/reactive-intelligence/src/controller/` |
| **Tools + MCP** | `tools/src/mcp/mcp-client.ts` (docker lifecycle, two-phase naming) | `ls packages/tools/src/` |
| **Orchestration** | `orchestration/src/` (sub-agent delegation, A2A) | `ls packages/orchestration/src/` |

---

## 7. Cross-Cutting Concerns

| Concern | Where | verify |
|---------|-------|--------|
| **State** | `kernel/state/` | `ls packages/reasoning/src/kernel/state/` |
| **Telemetry** | `core/services/event-bus.ts` + `packages/trace` | `grep -n "publish" packages/core/src/services/event-bus.ts \| head` |
| **Safety** | `guardrails` + `cost` (budgets) + `identity` | `ls packages/guardrails/src` |
| **Time** | mockable clock in `core` | `grep -rn "Clock" packages/core/src \| head` |
| **Provenance** | `Capability.source` (wired) + `Deliverable` (4-source, partially wired; single-writer unbuilt) | §4 above |

---

## 8. How Systems *Should* Interact But Don't (interaction gaps)

This is the user-requested lens — declared surfaces lacking a live emit+consumer (North Star §4.4 principle). Full ranking in the Plan.

1. **Output path: incomplete provenance migration.** Two `Deliverable` models coexist (2-source `assembleDeliverable` + 4-source core contract), both live in `runner.ts`; the intended single-writer `commitDeliverable` was never built; `state.output` has ~6 mixed-provenance writers. The trust guarantee is *partially* wired, not complete. → **Plan P1.**
2. **Runtime agent build ↛ `TaskContract`.** Contract exists but only bench consumes it; the runtime never enforces a task contract at `agent.build()`. → **Plan P2.**
3. **Calibration fields ↛ consumers.** ~5 of 14 calibration fields have live consumers (`[from-spec]` G-7); `parallelCallCapability`, `interventionResponseRate`, `tokenEfficiency`, `reasoningDepth`, `knownToolAliases` defined but dormant. → **Plan P3.** **verify:** `grep -rn "parallelCallCapability" packages/*/src | grep -v calibrations`
4. **Compose chokepoint coverage ~4/24.** Only `lifecycle.failure`, `nudge.healing-failure`, `observation.tool-result`, `prompt.system` emit; `control.strategy-evaluated` (M14 prereq) does **not** emit yet. → **Plan P4.**
5. **Self-evolution (M14) not implemented.** Acceptance-gated attempt-narrowing has no `composeNarrowRetry` on main (and lacks its `control.strategy-evaluated` emit prereq). → **Plan P4.**

---

## 9. Validation Discipline (how change is gated)

- **N=3 corpus rule:** every architectural change validated by running the failure corpus 3× vs baseline (single runs are not evidence). `[from-spec]` §7.1.
- **§4.4 surface rule:** no declared surface ships without a live emit/consumer in the same commit. This index's §4/§8 are direct measurements of where that rule was violated.
- **Lift rule (ablation):** default-on requires ≥3pp lift AND ≤15% token overhead, else opt-in, else remove. `[from-spec]` ablation-warden.

---

## 10. Reading Order for New Contributors

1. This index (§1 two-loop shape → §2 cognitive spine).
2. [[05-DESIGN-NORTH-STAR]] §3–§4 (the model + contracts) — **but trust this index over §4.3/§5.2 where they conflict; those are stale.**
3. [[2026-06-02-canonical-contracts-and-invariants]] (the contract intent).
4. [[2026-06-03-architecture-drift-register]] (what's stale/dead/parallel — so you don't build on it).
5. [[2026-06-03-full-potential-realization-plan]] (where to put effort next).

---
*Maintenance: re-run the §-level verify commands before trusting any claim older than one sprint. If a verify command's output diverges from the table, update the table in the same commit — that is the contract that keeps this from becoming drift.*
