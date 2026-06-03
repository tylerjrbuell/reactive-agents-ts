# Architecture Drift & Debt Register

> **Date:** 2026-06-03 · **Baseline:** `main` @ `aed8a8a2` · **Companion:** [[Framework-Architecture-Index]] · [[2026-06-03-full-potential-realization-plan]]
>
> Inventory of doc-reality drift, dead/scaffolded surfaces, and parallel systems found while building the architecture index. Each row has a `file:line` anchor + verify command + fix size. **Severity:** 🔴 misleads architecture decisions · 🟡 stale but harmless · 🟢 cosmetic.

## D-series: doc/spec drift (cheap fixes)

| ID | Sev | Drift | Anchor | Verify | Fix |
|----|-----|-------|--------|--------|-----|
| **D1** | 🔴 | `architecture-reference` + `architecture-audit` skills describe kernel at `packages/reasoning/src/strategies/kernel/` — **path deleted** (Stage-5 move to `kernel/`) | `.claude/skills/architecture-reference/SKILL.md`, `.claude/skills/architecture-audit/SKILL.md` | `ls packages/reasoning/src/strategies/kernel/` → not found | Edit both skills → `kernel/`. ≤2 files. |
| **D2** | 🟡 | Skills reference `FRAMEWORK_INDEX.md` (root) — **file does not exist** | `architecture-reference` SKILL "Quick Navigation" | `ls FRAMEWORK_INDEX.md` → absent | Repoint to [[Framework-Architecture-Index]] or create. |
| **D3** | 🔴 | North Star §4.3 says LearningPipeline "currently missing"; §5.2 says `runner.ts` 1,706 LOC | `05-DESIGN-NORTH-STAR.md` §4.3, §5.2 | `ls .../capabilities/learn/`; `wc -l .../loop/runner.ts` (771) | Patch both lines (Learn wired; LOC 771). |
| **D4** | 🟡 | Context-assembly spec cites `projectResultForPrompt` — **0 callers** (reverted) | `2026-05-31-canonical-context-assembly.md` | `grep -rn projectResultForPrompt packages/*/src` → 0 | Mark reverted / remove. |
| **D5** | 🔴 | North Star §6.5 claims "every output through `commitDeliverable` → errors-leaked-as-output constructively impossible" — **literally false**: `commitDeliverable` was never implemented (JSDoc-only) and `state.output` has ~6 mixed writers | `05-DESIGN-NORTH-STAR.md` §6.5 | `grep -rn commitDeliverable packages/*/src` → `@example` only | Annotate as aspirational until [[2026-06-03-full-potential-realization-plan]] P1 lands. |

## S-series: scaffold / dead / parallel surfaces (§4.4 violations)

| ID | Sev | Surface | State | Anchor | Verify | Disposition |
|----|-----|---------|-------|--------|--------|-------------|
| **S5** | 🔴 | `commitDeliverable` (intended sole `state.output` writer) | **never implemented** — JSDoc `@example` only, no `export function` | `core/contracts/deliverable.ts:20,27` | `grep -rn commitDeliverable packages/*/src` → only `@example` lines | → Plan **P1** (implement single writer; route all ~6 `state.output` writers through it). |
| **S6** | 🔴 | Two `Deliverable` types coexist (4-source core contract + 2-source `assembleDeliverable`) | **migration in progress** — `runner.ts` imports BOTH (`:65` legacy, `:529` canonical) | `core/contracts/deliverable.ts` + `kernel/loop/runner-helpers/deliverable.ts` | `grep -rln "Deliverable" packages/reasoning/src/kernel/loop/runner.ts` | → Plan **P1** (fold 2-source into 4-source; delete `assembleDeliverable`). |
| **S7** | 🟡 | `TaskContract` | **bench-only** (not in runtime) | `core/contracts/task-contract.ts` | `grep -rln TaskContract packages/*/src` → benchmarks + core only | → Plan **P2** (thread into build). |
| **S8** | 🟡 | `projectResultForPrompt` | **dead** (reverted) | — | `grep -rn projectResultForPrompt packages/*/src` → 0 | Delete symbol if any stub remains; remove spec ref (D4). |
| **S9** | 🟡 | Dormant calibration fields (`parallelCallCapability`, `interventionResponseRate`, `tokenEfficiency`, `reasoningDepth`, `knownToolAliases`) | **defined, no consumer** | calibration profiles | `grep -rn parallelCallCapability packages/*/src \| grep -v calibrations/` | → Plan **P3** (activate w/ lift evidence, else remove). |
| **S10** | 🔴 | Compose chokepoint coverage | **~4/24 emit** — infra landed (HarnessPipeline, `.compose()`, 6 killswitches) but `emitToCompose` called in 1 file (`act.ts`); only `lifecycle.failure`, `nudge.healing-failure`, `observation.tool-result`, `prompt.system` emit | `capabilities/act/act.ts` | `grep -rln "emitToCompose(" packages/reasoning/src packages/runtime/src` (→1); `grep -rhoE '"(prompt\|message\|nudge\|tool\|observation\|lifecycle\|control)\.[a-z-]+"' packages/reasoning/src packages/runtime/src \| sort -u` | → Plan **P4** (expand coverage; `control.strategy-evaluated` is M14 prereq, not yet emitted). |
| **D6** | 🟡 | Compose chokepoints: some emit-only ("callers don't substitute payload back") | **read-vs-mutate coverage unclear** | `core/services/compose-bridge.ts:21` | manual: audit emitting sites for mutate capability | Audit; document which tags mutate vs observe. |

## Verified-healthy (recorded so they aren't re-litigated)

- ✅ 10-capability spine: all 10 owner dirs/files present `[verified]`; reason/guard/act + recall/learn traced in-loop (`iterate-pass.ts:401,939`) `[verified]`; sense/attend/comprehend/decide/verify/reflect per-iter call sites `[from-spec]`, not re-traced.
- ✅ `kernel/loop/terminate.ts` is the single-owner termination helper (`[verified]` exists; "sole verdict path" is `[from-spec]` — termination tokens referenced in ~8 files, not re-traced here).
- ✅ Capability source-tagging + `effectiveWindowChars` wired via `canonical-resolver.ts:43` `[verified]`.
- ✅ `PreFlight` type lives at `core/contracts/preflight.ts`; `runtime/src/build-validation.ts` exists `[verified]` — that it *runs* at `agent.build()` is `[from-spec]`, not re-traced.
- ✅ Compose API *infrastructure* live (HarnessPipeline, `.compose()`, `.withX` desugar, 6 killswitches) — but chokepoint coverage is ~4/24 (see S10), NOT the spec's 24.
- ✅ Decomposition continued past docs: runner 771 / engine 1,418 / builder 2,087 LOC.
- ✅ overhaul branch fully merged (`main...origin/overhaul/agentic-core-2026-05-31` = `38 0`).

## Open question (escalate)

- **Q1:** For P1, is `core/contracts/deliverable.ts` the intended source of truth (runner consumes it) or should the wired `runner-helpers/deliverable.ts` model be promoted into core? The spec wanted core as sole writer; the runner shipped its own. Decide before P1 collapse.

---
*Re-run verify commands each sprint. Move closed rows to a struck-through "Resolved" block; do not delete (so they don't resurface as false blockers).*
