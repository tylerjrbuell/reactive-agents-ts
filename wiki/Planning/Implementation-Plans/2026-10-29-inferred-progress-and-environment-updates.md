---
type: implementation-plan
status: active
created: 2026-10-29
updated: 2026-10-29
tags: [implementation-plan, checklist, ledger, meta-loop, environment, harness, chat]
spec: "[[2026-10-28-plan-and-goal-primitives]]"
---

# Plan 6 — Inferred to-do progress and environment-update events

**Goal:** (A) the to-do list keeps up with what the agent actually did, even when the agent forgets to update it; (B) the model is told, once and compactly, when the harness changed what it can see or do between turns (model, tools, skills, docs, user-edited to-do, goal state).

Both extend the meta-loop spine (Ledger → Assessment → Projector → `pendingGuidance`); no second channel.

## Part A — inferred checklist progress (deterministic, display-side)

1. **Evidence, not LLM judgment.** Pure `inferChecklistProgress(items, ledgerFacts)` in `packages/core/src/types/checklist.ts`. An advisory item becomes `inferred-done` only on a **strong anchor** in ledger facts recorded after the item was added: a successful tool call whose name or a distinctive argument value (path, url, query, id) is named in the item text; a written/read artifact path in the item text; a satisfied contract requirement the item text restates. No anchor → no inference. Ambiguity → no inference.
2. **Explicit beats inferred.** Agent or user marking an item always wins and can reverse an inference. Inferred state carries `source: "inferred"` and an `evidence` ref (ledger entry id).
3. **Honest display.** Inferred rows render distinctly ("inferred from evidence", dashed check) in TUI, ui-core and Cortex. Advisory rows still never count toward done (Phase 1 rule unchanged); inferred rows are advisory too.
4. **Reconcile at run end.** On finalize, run inference once more over the full ledger so a finished run does not leave plainly-completed items pending. Items with no evidence stay pending and are labelled "not marked done". Never force-complete.
5. **Observable:** `ChecklistUpdated` snapshots carry `source` per item; a trace event `checklist-inferred` records the evidence ref. No model-visible change in Part A (request-identity test with inference on vs off).

## Part B — environment-update events

1. **Deterministic diff, no model call.** The chat engine snapshots `{provider, model, thinking, toolNames[], skills[], docSources[], todoUserEdits, goal status, agentControl}` at the end of each turn. At the next turn start it diffs; a non-empty diff becomes an `EnvironmentChanged` fact (core event + trace event `environment-updated`, one entry per change with a one-line summary).
2. **Delivery through the existing spine:** rendered once in the `Guidance:` section of the next think via `pendingGuidance.environmentUpdate` (never a stray USER message, AGENTS pitfall #9), wording model-neutral and capped (e.g. 6 lines): `Environment update since your last turn: - Tools: +github-search, -http-get. - Model switched to qwen3:14b. - The user edited your to-do list (+2, -1). - Goal accepted: <objective>`.
3. **Zero cost when nothing changed:** no change → nothing added; request bytes identical to feature off. First turn of a session: no notice. Pinned by a request-identity test; token overhead only on change turns, capped.
4. **Signal accounting:** each notice is a signal in the signal ledger (rendered/effect) so the existing consumption instrumentation measures whether the model reacted.
5. **Scope:** chat engine / between-turn changes first. Mid-run changes (MCP tool list changes during a run) reuse the same fact and renderer later; hook, not built now.
6. **Rollout:** default-on for the chat engine only if ablation-warden confirms request identity on no-change turns and no regression on tool-call correctness across 2 tiers; kill switch `environmentUpdates: false`. Honest claims: no improvement claim until measured.

## Tasks

- **A1 · runtime-warden (core edits parent-approved):** `inferChecklistProgress` + types in core with exhaustive table tests (anchor positives/negatives, explicit-overrides-inferred, ambiguity → none, ordering: evidence must follow the item); wire into the runtime checklist projection (`checklist-stream.ts`) incl. finalize reconcile; trace event; request-identity test.
- **A2 · ui-core + Cortex + TUI (general agent):** `source`/evidence in the wire type; "inferred" row rendering (Tooltip component, both themes); docs.
- **B1 · runtime-warden:** environment snapshot + diff in the chat engine, `EnvironmentChanged` event, envelope field `environmentUpdate`; tests per change kind, no-change request identity.
- **B2 · kernel-warden:** render `pendingGuidance.environmentUpdate` once in think.ts, trace event, signal-ledger entry; scripted-model test that the notice appears exactly once and is gone next turn.
- **B3 · cortex (general agent):** user to-do edits / config patches / goal transitions feed the diff; setting + docs; changeset.
- **B4 · ablation-warden:** no-change request identity + tool-call correctness check on 2 local tiers; verdict decides default-on.

Order: A1 → A2 in parallel with B1 → B2 → B3 → B4. Sequence after the text-tool-call fixes (F1–F5) that touch `native-fc-strategy`, `dispatch-think-response`, chat `engine.ts` history to avoid file collisions.

## Exit gates
Scoped tests per task, typecheck, `check-*.sh` gates; browser pass of inferred row + environment notice after a model switch; docs + changeset truthful.
