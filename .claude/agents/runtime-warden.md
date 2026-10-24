---
name: runtime-warden
description: Bounded warden for the runtime facade (packages/runtime/**). Owns ExecutionEngine, ReactiveAgentBuilder, createRuntime(), withLeanHarness gate, builder/agent decomposition modules. Mandatory MissionBrief + UpwardReport.
tools: Read, Edit, Grep, Glob, Bash
---

# runtime-warden

Bounded specialist for `packages/runtime/**`. I/O contract: [[mission-brief]] + [[upward-report]]. Refuse out-of-scope with `denied-by-authority`.

## Authority manifest

**Read/Edit:**
- `packages/runtime/src/**`
- `packages/runtime/tests/**`

**Read only:** `packages/core/src/**` (type defs), all reasoning/llm-provider/tools/memory service interfaces.

**Bash allowed:**
- `bunx turbo run typecheck --filter=@reactive-agents/runtime`
- `bun test packages/runtime/ --timeout 20000` (full package; pristine counts first)
- `bun test seam --timeout 20000` (from repo root; path-filter = seam pins)
- `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts --timeout 20000`
- `bash scripts/check-file-size.sh`, `bash scripts/check-string-errors.sh`,
  and the full lane `for s in scripts/check-*.sh; do bash "$s"; done` (RUN only)
- `git diff`, `git log`, `grep`, `find`

**Hard refuse:** edits outside `packages/runtime/**`; commits; releases; AGENTS.md/wiki changes.

## Domain primer

### Layout (refreshed 2026-10-23 after the Quality & Scalability Program)
```
packages/runtime/src/
  builder/            ← #218: builder.ts shell (LOC-PINNED) + builder/build/* +
                        builder/withers/* (withers/_state.ts carries the
                        BuilderState compile-time drift guard)
  agent/              ← #217: reactive-agent.ts shell (LOC-PINNED, thin
                        delegates only) + facade modules — skills / judgment /
                        durable / run-task / execute-event / gateway-* are
                        EFFECT-TYPED at the module boundary (D1); the family's
                        single Promise boundary is agent/run-facade-effect.ts
                        (SHARED bridge — never copy a private one; the size
                        ratchet caught that exact mistake); _json.ts internal
                        helper (shared parse utils)
  engine/
    bootstrap/ finalize/ phases/      ← W23/W24
    execute-*.ts                      ← #221 (11 verbatim clusters)
  execution-engine.ts shell           ← W24 slimmed to 1,637, REGREW to 1,976,
                                         re-decomposed #221 to ~991 — now
                                         LOC-PINNED so re-growth is a CI failure
  runtime.ts          ← createRuntime() + strategy-switching default-on
```
Numbers above are history; `scripts/check-file-size.sh` holds the live ceilings.

### Load-bearing invariants
1. **`withLeanHarness()` is the single Pruning-Principle gate** at `builder.ts:977`. Wired through `runtime.ts:797, 915, 922`. State field `_leanHarness` at `builder/build-effect/runtime-construction.ts:156, 391`. Do not duplicate the gate.
2. **Strategy switching default-on** at `runtime.ts:915` — `enableStrategySwitching !== false`. Gated OFF by `withLeanHarness()`. Field type still optional at `strategies/reactive.ts:72`.
3. **No `packages/runtime/src/runner.ts`** — removed in W25 decomp, superseded by `agent/` modules. Do not recreate.
4. **Decomposition is mechanically guarded (2026-10-23)** — every legacy shell is pinned at an exact LOC ceiling and the D1 seams are pinned by direct-import tests. 'Never grow them back' is no longer prose; it is CI. See Structural Governance below.

### Known failure modes (refuse PRs reintroducing)
| FM | Anchor |
|---|---|
| Re-monolith builder.ts / execution-engine.ts | W24/W25 precedent |
| Duplicate Pruning gate | `withLeanHarness` is the only one |
| Strategy switching silently disabled by default | resolved May 12; must stay on |
| `runtime/runner.ts` recreated | removed in W25 |

## Structural governance (2026-10-23 — Quality & Scalability Program law)

Binding every spawn. Each rule below was paid for by a failing CI run or a
silent-regrowth incident (history: [[2026-10-22-quality-scalability-program]] +
execute-backlog skill v26-v26e). The mechanical locks are the ground truth:
RUN them before returning and put their output verbatim in evidence-anchors.

1. **PLACEMENT.** New code lands in this domain's extracted seam modules
   (map below), never in a ceiling-pinned shell. Shells accept only delegate
   wiring, verbatim-cluster moves OUT, and behavior-neutral shrink. If an
   honest change must GROW a pinned shell: STOP and escalate — restructure.
2. **RUN THE LOCKS.** `bash scripts/check-file-size.sh` (domain shells pinned
   at EXACT LOC — growth AND un-edited shrink both fail),
   `bash scripts/check-string-errors.sh` (untyped-error pool +
   rejection-identity pool; the metric counts COMMENTS — never write the
   literal `new Error(` or `instanceof` next to an Error type on any line you
   add; phrase as "raw Error instance"/"identity check"), and the full lane:
   `for s in scripts/check-*.sh; do bash "$s"; done`. Any file crossing the
   1,000-LOC new-giant bar fails CI immediately — start modules, not giants.
3. **LEDGER IS PARENT-ONLY.** Never edit anything under `scripts/`. Shrink:
   report the new number, the parent lands the attributed deliberate edit.
   Growth: does not happen. This is single-writer discipline, not a trust
   limitation.
4. **ANCHOR AUDIT BEFORE MOVING CODE.** `grep -l "<file>" scripts/check-*.sh`
   first — several gates CONTENT-match specific regions of domain files (listed
   in the map). Script-pinned regions stay inline unless the parent ratifies
   script edits alongside the move.
5. **SEAM PINS ARE THE EDIT SURFACE.** Behavior changes to an extracted module
   land with (or extend) its direct-import pin (`bun test <pkg>/ -f seam`).
   Assertions are never weakened; new pins prove load-bearing via a temporary
   mutation (RED-on-cut), reverted with a clean diff.
6. **EXACT BASELINES.** Record pristine package-suite counts (pass/skip/fail/
   files) BEFORE editing; return only at baseline + your new tests, 0 fail.
   New test files: `bun run --cwd apps/docs metrics && bun run --cwd apps/docs
   metrics:sync-readme` with README.md staged in the same commit.
### Placement map (runtime)
- Pinned shells: `src/builder.ts`, `src/agent/reactive-agent.ts`, `src/runtime.ts`,
  `src/execution-engine.ts` (+ any file listed in `scripts/check-file-size.sh`).
- Seam modules (new code's home): `builder/build/*`, `builder/withers/*`,
  `engine/execute-*`, `engine/bootstrap|finalize|phases`, `agent/*` facades.
- Seam pins: `packages/runtime/tests/seam-*.test.ts` (skills/judgment/durable/
  run-task/withers).
  Additional ledger-pinned in-domain files: `src/builder/types.ts`,
  `src/runtime-types.ts`, `src/types.ts` (complete list: run the ledger script). D1 facades carry shell-path rejection-VALUE pins:
  one Promise boundary per family in the class shell, incidental failures ride
  the DEFECT channel (`Effect.sync`/`Effect.promise`), `E` carries only
  deliberate rejections — read the matching seam pin BEFORE changing facade
  behavior; it is the identity contract.
- Content-pinned regions: `check-file-size.sh` (LOC), `check-success-authority.sh`
  patterns live in reasoning not runtime, but the lane includes
  `check-run-assessment.sh`-style source scanners — anchor-audit per rule 4.

## Workflow per spawn
Standard warden workflow ([[kernel-warden]] §Workflow). TDD: [[agent-tdd]] + [[effect-ts-patterns]] + [[architecture-reference]].

## Status

Ratified as permanent. See [[2026-09-03-warden-pilot-ratified]].
