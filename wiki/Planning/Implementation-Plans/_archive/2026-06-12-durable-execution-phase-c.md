# Durable Execution Phase C — `resume(runId)` + crash-resume e2e

> **✅ COMPLETE (2026-06-12).** Shipped on `feat/durable-execution`. C1 kernel seam (`8a07f544`); Hop A forwarding (`ResumeStateRef` FiberRef → reasoning-think → executeRequest → ReactiveInput → kernelInput); Hop B agent durable-config (`durableConfigHash` identity = systemPrompt+provider, threaded onto agent at instantiation); `agent.resumeRun(runId)` (renamed to avoid the pause/resume control verb) + `listRuns()`; `durable-resume.ts` load+guard helpers; C2 test 3/3; C3 cross-process hard-kill e2e 1/1; C4 guide + honesty fix + public error exports. Full monorepo build 38/38, reasoning 1665/0, runtime 934/1 (the 1 = pre-existing `as-unknown-as-ceiling`, red on `main` too — not a Phase C regression).
>
> **Scope note vs original plan:** resume API named `resumeRun` not `resume` (collision with the in-process pause/resume verb). Config-hash guard hashes systemPrompt+provider (NOT model — the resolved default model isn't reproducible from a freshly-built agent). Resume runs via `engine.execute` (no re-checkpoint write on the run() path); re-crash-during-resume coverage deferred (documented).

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox (`- [ ]`) steps.

**Goal:** Reconstruct a crashed/paused run from its last checkpoint and continue it to completion — the marketable "kill the process → resume → finish" story that gates evaluations.

**Architecture:** Phase B persists codec-serialized `KernelState` snapshots per iteration. Phase C adds (1) a kernel **resume seam** — `KernelInput.resumeState?: KernelState`, which the runner uses as the base state (preserving iteration/steps/scratchpad/toolsUsed/meta/tokens) instead of building fresh; (2) `agent.resume(runId)` / `agent.listRuns()` on the runtime, loading the latest checkpoint, validating the config hash (typed error on mismatch), seeding `resumeState`, and running to completion with durable checkpointing re-installed; (3) a subprocess SIGKILL e2e proving output parity with an uninterrupted run on the deterministic test provider. Resume does NOT re-execute completed tools (their results are in the restored steps/messages).

**Tech Stack:** TypeScript, Effect-TS, SQLite, Bun test (incl. `Bun.spawn` for the subprocess crash test).

**Source spec:** `wiki/Architecture/Design-Specs/2026-06-10-durable-execution.md` §2.3. Branch: `feat/durable-execution` (Phase B write-side committed; perf-QA'd +0.9%).

**Ownership:** C1 (kernel seam + codec re-export) → **kernel-warden**. C2 (resume/listRuns API) + C3 (e2e) → **runtime-warden** + main-thread. C4 (docs) → main-thread.

**Phase B carry-over prerequisites (fold into C):**
- `deserializeKernelState` is NOT exported from `@reactive-agents/reasoning` (no codec re-export) — C1 adds it.
- Durable checkpointing currently fires only on `runStream()` (the `run()` path threads no `RunController`). `resume()` runs to completion via the execute path with `resumeState` seeded; it re-installs durable checkpointing so a re-crash is also covered.

**Verified anchors:**
- `runner.ts:219-221` — seeds `state` from `effectiveInput.initialMessages` only; this is where `resumeState` plugs in.
- `KernelInput` at `kernel-state.ts` (`initialMessages?` at `:538`, `priorContext?` at `:441`). `KernelState` type at `kernel-state.ts:310`. `transitionState` is the only sanctioned mutation.
- Codec: `serializeKernelState`/`deserializeKernelState` (`kernel/state/kernel-codec.ts:186,199`).
- `RunStoreService` (`runtime/src/services/run-store.ts`): `latestCheckpoint(runId)`, `getRun(runId)`, `setStatus`. **Add `listRuns(status?)`** in C2.
- `reactive-agent.ts:585` `async run(...)`, `:~800` `runStream(...)`. `RunController` created in reactive-agent.ts (runStream path). Durable wiring in `engine/execute-stream.ts`.
- Config hash: Phase B B4 computes `configHash = hash(JSON.stringify(toConfig()))` via runtime-shim `hash` at run start (in `execute-stream.ts`).

---

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `packages/reasoning/src/kernel/state/kernel-state.ts` | MODIFY. Add `KernelInput.resumeState?: KernelState`. | C1 |
| `packages/reasoning/src/kernel/loop/runner.ts` | MODIFY. When `resumeState` present, use it as baseState (skip fresh seed). | C1 |
| `packages/reasoning/src/index.ts` (+ kernel barrel) | MODIFY. Re-export `serializeKernelState`/`deserializeKernelState`/`KERNEL_CODEC_VERSION`. | C1 |
| `packages/reasoning/tests/kernel/loop/resume-state-seam.test.ts` | **NEW.** runKernel with `resumeState` continues from the seeded iteration/steps. | C1 |
| `packages/runtime/src/services/run-store.ts` | MODIFY. Add `listRuns(status?)`. | C2 |
| `packages/runtime/src/reactive-agent.ts` | MODIFY. `async resume(runId)` + `async listRuns(filter?)`. | C2 |
| `packages/runtime/src/engine/durable-resume.ts` | **NEW.** Load checkpoint → deserialize → config-hash guard → build resume `KernelInput` → execute → re-install checkpointing. | C2 |
| `packages/runtime/src/errors.ts` (or durable errors) | MODIFY. `DurableConfigMismatchError`, `DurableRunNotFoundError` (typed). | C2 |
| `packages/runtime/tests/durable-resume.test.ts` | **NEW.** In-process resume: checkpoint a partial run, resume → completes; config-hash mismatch → typed error. | C2 |
| `packages/runtime/tests/durable-crash-e2e.test.ts` | **NEW.** Subprocess SIGKILL mid-run → new process `resume()` → output equals uninterrupted run. | C3 |
| `packages/runtime/tests/fixtures/durable-crash-child.ts` | **NEW.** Child script: builds the agent, runs, exits hard mid-run (or is SIGKILLed). | C3 |
| `packages/runtime/src/builder.ts` | MODIFY. `withProgressCheckpoint` docstring: drop "pending V1.1" (now wired via durable runs). | C4 |
| `apps/docs/src/content/docs/guides/durable-execution.md` | **NEW.** "Kill it, resume it" guide. | C4 |

**Out of scope (Phase D):** durable HITL (`approve`/`deny`, `run_pending`, `awaiting-approval`), Cortex resume UI.

---

## Task C1: Kernel resume seam + codec re-export

**Files:** `kernel-state.ts`, `runner.ts`, `reasoning/src/index.ts` (+ kernel barrel), `tests/kernel/loop/resume-state-seam.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
// drive runKernel (or executeReActKernel) with a resumeState that already has
// iteration=2 and 2 steps; assert the run continues from iteration 2 (not 0)
// and the restored steps are present in the result. Model on an existing
// runner/kernel test harness (rg -l "runKernel\|executeReActKernel" packages/reasoning/tests).
it("resumeState seeds the kernel from a restored state (iteration + steps preserved)", async () => {
  // build a KernelState via serialize→deserialize round-trip with iteration=2;
  // run with input.resumeState = restored; assert result reflects continuation, not a fresh start.
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd packages/reasoning && bun test tests/kernel/loop/resume-state-seam.test.ts --timeout 20000`
Expected: FAIL — `resumeState` not a field / not honored (run starts at iteration 0).

- [ ] **Step 3: Add the field + honor it in the runner**

`kernel-state.ts` `KernelInput` — add:
```ts
  /**
   * Durable resume (v0.12.0 track 1, Phase C): a fully-restored KernelState from
   * a checkpoint. When present, the runner uses it as the base state instead of
   * building a fresh one — preserving iteration/steps/scratchpad/toolsUsed/meta/
   * tokens so the run continues mid-stream. Completed tools are NOT re-executed
   * (their results are in the restored steps/messages).
   */
  readonly resumeState?: KernelState;
```
`runner.ts:~219` — before the `initialMessages` seed, branch on `resumeState`:
```ts
    let state = effectiveInput.resumeState
      ? effectiveInput.resumeState
      : effectiveInput.initialMessages?.length
        ? transitionState(baseState, { messages: effectiveInput.initialMessages })
        : baseState;
```
(Confirm `baseState`/`effectiveInput` names at that site; resumeState wins over the fresh build. Do NOT `transitionState` the resumeState — it's already a complete state.)

- [ ] **Step 4: Re-export the codec**

In `packages/reasoning/src/index.ts` (and the kernel barrel if one gates it), add:
```ts
export { serializeKernelState, deserializeKernelState, KERNEL_CODEC_VERSION } from "./kernel/state/kernel-codec.js";
export type { KernelState } from "./kernel/state/kernel-state.js"; // if not already exported
```

- [ ] **Step 5: Run — verify it passes + full suite + build**

Run: `cd packages/reasoning && bun test tests/kernel/loop/resume-state-seam.test.ts --timeout 20000` → PASS
Run: `cd packages/reasoning && bun test --timeout 60000` → baseline green
Run: `bunx turbo run build --filter=@reactive-agents/reasoning` → green

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/kernel/state/kernel-state.ts packages/reasoning/src/kernel/loop/runner.ts packages/reasoning/src/index.ts packages/reasoning/tests/kernel/loop/resume-state-seam.test.ts
git commit -m "feat(kernel): KernelInput.resumeState seam + codec re-export for durable resume"
```

---

## ⚠️ C2 SCOPE CORRECTION (2026-06-12 — runtime-warden finding)

C1 added `KernelInput.resumeState` + the runner consumption + codec re-export, but **NOT the forwarding tail** — `resumeState` is dropped before it reaches the kernel (same FM-I field-drop class). C2 is therefore blocked until two cross-package hops land (both OUTSIDE runtime-warden authority, hence main-thread / kernel-warden):

**Hop A — forward `resumeState` to `KernelInput` (reasoning package):**
- `reactive.ts` — add `resumeState?: KernelState` to `ReactiveInput` (~:90) AND `resumeState: input.resumeState` to the `kernelInput` literal (~:202, it's a field-by-field map, no spread). (+ reflexion/plan-execute/tree-of-thought literals for parity if resume must support heavy strategies; reactive-only suffices for the default-path e2e gate.)
- `reasoning-service.ts:27` — add `resumeState?: KernelState` to the `execute` params interface; `:152` impl — forward it into the strategy input.
- `reasoning-think.ts:189` — add `resumeState` to `executeRequest` (sourced from a new run-option).
- **DONE (C2 slice, committed):** `RunStore.listRuns` + `DurableRunNotFoundError`/`DurableConfigMismatchError`.

**Hop B — agent carries durable config (builder):** `ReactiveAgent` (`reactive-agent.ts:103` ctor) receives no durable dir/configHash/`withDurableRuns`-flag; it lives only in the builder + `execute-stream.ts`. Thread it onto the agent at `builder/build-effect/agent-instantiation.ts:99` so `resume()`/`listRuns()` can resolve dbPath + current hash.

**Untraced:** the run-option source — how `resume()` injects `resumeState` into the execute path so `reasoning-think.ts` can put it on `executeRequest`. Trace `agent.run` options → `reasoning-think` and add a `resumeState` pass-through.

After A+B+the run-option thread land, `durable-resume.ts` + `agent.resume/listRuns` + the test (below) are fully runtime-warden-completable.

---

## Task C2: `resume(runId)` + `listRuns()` + config-hash guard

**Files:** `run-store.ts`, `reactive-agent.ts`, `engine/durable-resume.ts` (new), `errors.ts`, `tests/durable-resume.test.ts`

- [ ] **Step 1: Add `listRuns` to RunStore**

In `run-store.ts`, add to the `RunStore` interface + impl:
```ts
  readonly listRuns: (status?: RunStatus) => Effect.Effect<readonly RunRecord[], never>;
```
Impl: `SELECT … FROM runs` (optionally `WHERE status = ?`) `ORDER BY updated_at DESC`, map rows to `RunRecord[]`.

- [ ] **Step 2: Typed errors**

Add (mirror existing runtime error classes):
```ts
export class DurableRunNotFoundError extends Data.TaggedError("DurableRunNotFoundError")<{ runId: string }> {}
export class DurableConfigMismatchError extends Data.TaggedError("DurableConfigMismatchError")<{ runId: string; storedHash: string; currentHash: string }> {}
```

- [ ] **Step 3: Write the failing resume test**

```ts
// 1. Build agent A with .withDurableRuns({dir}). Run a 2-iteration task PARTIALLY:
//    simulate a crash by checkpointing then NOT completing (or kill after N).
//    Simplest in-process: run to completion once to populate a checkpoint, grab runId,
//    then call agent.resume(runId) and assert it completes with the expected output.
// 2. Build agent B with a DIFFERENT config (different system prompt). B.resume(sameRunId)
//    → fails with DurableConfigMismatchError.
it("resumes a run from its latest checkpoint to completion", async () => { /* ... */ });
it("rejects resume when config hash mismatches", async () => { /* ... */ });
it("listRuns returns persisted runs filtered by status", async () => { /* ... */ });
```
Model the agent build/run harness on `durable-runs-write.test.ts`.

- [ ] **Step 4: Run — verify it fails**

Run: `cd packages/runtime && bun test tests/durable-resume.test.ts --timeout 30000`
Expected: FAIL — `agent.resume` is not a function.

- [ ] **Step 5: Implement `durable-resume.ts` + the agent methods**

`engine/durable-resume.ts` exports `resumeRun({ runId, agentId, currentConfigHash, dbPath, deserialize, execute })`:
1. Open `RunStoreLive(dbPath)`; `getRun(runId)` → if undefined, fail `DurableRunNotFoundError`.
2. `latestCheckpoint(runId)` → if undefined, fail `DurableRunNotFoundError` (nothing to resume).
3. Compare `run.configHash` vs `currentConfigHash` → mismatch fails `DurableConfigMismatchError`.
4. `deserialize(checkpoint.stateJson)` → `KernelState` (via the re-exported `deserializeKernelState`).
5. Build a `KernelInput` with `resumeState` = the restored state (+ the agent's normal input: tools, systemPrompt, etc. — reuse the same input assembly the live run uses; only `resumeState` is added).
6. Execute to completion (the agent's execute path with `resumeState` threaded); re-install durable checkpointing so a re-crash persists; `setStatus(runId, "completed"|"failed")` at end.

In `reactive-agent.ts`, add:
```ts
async resume(runId: string): Promise<AgentResult> { /* resolve dbPath + configHash from this built agent, call resumeRun, return result */ }
async listRuns(filter?: { status?: RunStatus }): Promise<readonly RunRecord[]> { /* open RunStore at this agent's durable dir, listRuns(filter?.status) */ }
```
Both require the agent to have been built with `.withDurableRuns()` — otherwise throw a clear Error ("resume requires .withDurableRuns()").

> **resumeState threading:** the agent's internal execute path must accept an optional `resumeState` and place it on `KernelInput.resumeState`. Thread it the same way `run()` threads task/options into the execution engine → KernelInput. Grep how `initialMessages` reaches `KernelInput` and follow that path.

- [ ] **Step 6: Run — verify it passes**

Run: `cd packages/runtime && bun test tests/durable-resume.test.ts --timeout 30000` → PASS

- [ ] **Step 7: Full runtime suite + build + commit**

Run: `cd packages/runtime && bun test --timeout 60000` (ignore the pre-existing `as-unknown-as-ceiling` fail)
Run: `bunx turbo run build --filter=@reactive-agents/runtime` → green
```bash
git add packages/runtime/src/services/run-store.ts packages/runtime/src/reactive-agent.ts packages/runtime/src/engine/durable-resume.ts packages/runtime/src/errors.ts packages/runtime/tests/durable-resume.test.ts
git commit -m "feat(runtime): agent.resume(runId) + listRuns() + config-hash guard"
```

---

## Task C3: Subprocess crash-resume e2e

**Files:** `tests/durable-crash-e2e.test.ts`, `tests/fixtures/durable-crash-child.ts`

- [ ] **Step 1: Write the child fixture**

`durable-crash-child.ts`: reads `DURABLE_DIR` + a `MODE` env (`crash` | `full`). Builds a deterministic test-provider agent with `.withDurableRuns({ dir: DURABLE_DIR, checkpointEvery: 1 })` and a multi-iteration tool scenario. In `full` mode runs to completion and prints `OUTPUT:<text>` + `RUNID:<id>`. In `crash` mode runs and calls `process.exit(137)` (or relies on parent SIGKILL) after the first checkpoint is written (poll the db for ≥1 checkpoint, then exit hard), printing `RUNID:<id>` first.

- [ ] **Step 2: Write the failing e2e test**

```ts
// 1. full run in a child → capture OUTPUT_full + RUNID is irrelevant (fresh).
// 2. crash run in a child (MODE=crash) → child writes >=1 checkpoint then hard-exits; capture RUNID.
// 3. parent process: build the SAME agent config, agent.resume(RUNID) → OUTPUT_resumed.
// 4. assert OUTPUT_resumed === OUTPUT_full (deterministic test provider) and the run completed.
it("hard-killed run resumes in a new process and matches the uninterrupted output", async () => {
  // use Bun.spawn for the child; parse RUNID/OUTPUT from stdout; resume in-parent.
}, 60000);
```

- [ ] **Step 3: Run — verify it fails, then passes once C1+C2 land**

Run: `cd packages/runtime && bun test tests/durable-crash-e2e.test.ts --timeout 60000`
Expected: PASS after C1+C2 (resume reconstructs + completes; deterministic output matches).

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/tests/durable-crash-e2e.test.ts packages/runtime/tests/fixtures/durable-crash-child.ts
git commit -m "test(runtime): subprocess crash-resume e2e — output parity with uninterrupted run"
```

---

## Task C4: Honesty + docs

**Files:** `builder.ts` (`withProgressCheckpoint` docstring), `apps/docs/src/content/docs/guides/durable-execution.md`, `CHANGELOG.md`

- [ ] **Step 1: Fix the `withProgressCheckpoint` honesty gap**

In `builder.ts`, update the `withProgressCheckpoint` docstring: remove "PlanStore write execution is pending V1.1"; note it now persists via `.withDurableRuns()` (or delegate `withProgressCheckpoint(every)` → `withDurableRuns({ checkpointEvery: every })` with a deprecation note).

- [ ] **Step 2: Write the docs guide**

`guides/durable-execution.md` — "Kill it, resume it": `.withDurableRuns()`, `agent.resume(runId)`, `agent.listRuns()`, the crash-resume guarantee, the side-effect note (resume does not replay completed tools), config-hash guard. Use absolute `/guides/...` links.

- [ ] **Step 3: CHANGELOG + commit**

```markdown
### Added
- **Durable execution** — `.withDurableRuns({ dir?, checkpointEvery? })` persists run state to SQLite; `agent.resume(runId)` continues a crashed/paused run from its last checkpoint (config-hash guarded); `agent.listRuns()`. Crash-resume verified by a subprocess SIGKILL e2e.
```
```bash
git add packages/runtime/src/builder.ts apps/docs/src/content/docs/guides/durable-execution.md CHANGELOG.md
git commit -m "docs: durable execution guide + withProgressCheckpoint honesty fix"
```

---

## Self-Review

**Spec coverage (§2.3 Resume API):** `resume(runId)` load+validate+seed+continue (C2); `listRuns` (C2); config-hash mismatch typed error (C2 DurableConfigMismatchError); tokens/iteration restored (C1 resumeState = full state); completed tools not re-executed (C1 — restored steps/messages, no re-dispatch). E2E crash gate §3.1 (C3). Honesty §3.3 (C4). ✓

**Deferred (correctly):** durable HITL (§2.4) + Cortex UI (§2.5) = Phase D, explicitly out of scope.

**Placeholder scan:** C1/C2/C3 test bodies are described with concrete assertions + a grep recipe for the harness, not invented APIs. The one real design call — `resumeState` wins over `initialMessages`/fresh build at runner.ts:219 — is spelled out with the exact branch. `resumeState` threading through the execute path (C2 step 5) names the pattern to follow (`initialMessages`→KernelInput). No "TBD".

**Type consistency:** `KernelInput.resumeState?: KernelState` (C1) consumed by `durable-resume.ts` (C2). `deserializeKernelState` re-exported (C1) used in C2/C3. `RunStore.listRuns(status?)` (C2 step 1) used by `agent.listRuns` (C2 step 5). `DurableRunNotFoundError`/`DurableConfigMismatchError` consistent C2. `resume(runId): Promise<AgentResult>` consistent C2↔C3.

**Key risk:** the resumed run must re-materialize services (memory, tools) fresh from builder config (spec §4 risk 3 — acceptable, documented). The restored KernelState carries data only (no closures); services come from the rebuilt agent. C2 step 5 reuses the agent's normal input assembly, so services are wired by construction.
