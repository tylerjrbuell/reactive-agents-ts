---
aliases: [Step 3 — One Execution Boundary]
tags: [plan, architecture, kernel, tools, step-3]
status: proposed
created: 2026-08-18
program: 09-UNIFIED-PROGRAM §7 Step 3
---

# Step 3 — One Execution Boundary

**Program position:** `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` §7, Step 3.
**WIP = 1.** This is the single active architectural item. Nothing in Steps 4–6 or Arc 2
starts until this closes.

---

## 0. Why this step, and not another

09 §7 orders the path Step 0 → Step 1 → Step 2 → Step 3. Before proposing Step 3 as next,
each earlier step was re-verified against source on 2026-08-18, because §6/§7 were written
on 2026-08-12 and substantial work has landed since. **The spec text is now materially
stale** and this plan should be read as the correction.

| 09 item | Spec claim (2026-08-12) | Verified state (2026-08-18) |
|---|---|---|
| 6.11 API-key prefix leak | prints first 8 chars of key on every build | **FIXED** — no such site remains in `packages/runtime/src` |
| 6.9 unvalidated trace load | `replay.ts:15-28` casts arbitrary JSONL to `TraceEvent` | **FIXED** — `replay.ts` now guards each line with `isTraceEvent`; residual gap (no per-`kind` payload schema) is documented in its own JSDoc |
| 6.11 `cost-track` stub | hardcodes `tier:"sonnet"`, `inputTokens: 0` | **FIXED** — `cost-track.ts:46-55` reads real `inputTokens` and classifies tier via `classifyTier(model)` |
| 6.1 two agent loops | `_enableReasoning` defaults false; default user gets the inline arm | **FIXED** — no `_enableReasoning` in `execution-engine.ts`; the inline arm is gone |
| Step 1 P2 (meta-tool wire tax) | named as Step 1's abort gate, unlanded | **LANDED** — `think.ts` applies the native-FC domain-only wire filter; `tool-capabilities.ts:88-130` shows meta-tools were already opt-in per `input.metaTools?.*`, never unconditional |
| 6.2 terminal truth reconstructed 3× | `run()`, `runStream()` and the kernel each re-derive | **MOSTLY FIXED** — `deriveTaskOutcome` (`engine/finalize/derive-outcome.ts`) is now the single shared computation for deliverables / goalAchieved / receipt across both paths (labelled FM-4 part 1). Residual: `reactive-agent.ts:1545-1568` still re-derives `toolCalls` by filtering `metadata.reasoningSteps` for `type === 'action'` — a projection of the steps record rather than of the outcome. Low-severity, folded into 3c's ledger work |
| 6.3 detached stream execution | cancelling a stream does not stop the run | **SYMPTOM FIXED, STRUCTURE REMAINS** — `execute-stream.ts:783-793` captures the daemon fiber and `Fiber.interrupt`s it on controller abort. The `Effect.forkDaemon` at `:763` is still structurally detached; the in-code comment explains that a scope-attached `Effect.fork` needs `Scope` threaded through `ManagedRuntime.runPromise` |

**Genuinely open, in program order:**

- **Step 0 leftover:** `discover-tools` removal (§5.2) — not done, still default-on.
- **Step 0 leftover:** F8 no-progress termination for repeated no-evidence discovery /
  meta-tool loops — not done. `.withStallPolicy` and the watchdog bound *time and
  iterations*; neither detects a meta-tool loop that keeps producing no evidence.
- **Step 3 (this plan):** 6.4, 6.5, 6.6 — all three confirmed live below.

Step 3 is therefore the correct next architectural step, and 6.6 inside it is the highest
user-visible defect on the board.

---

## 1. Scope

Three sub-items, sequenced by user-visible impact and independence. **Each ships as its own
branch with its own abort gate** — one gate per item is the §7 discipline, and bundling
them would make a single red gate ambiguous.

| Item | 09 ref | Symptom | Branch |
|---|---|---|---|
| 3a | 6.6 | F9 — agent writes and reads the file successfully, then the run is reported FAILED | `fix/one-path-authority` |
| 3b | 6.4 | Parallel tool batches bypass policy / observation / ledger / events | `fix/one-execution-boundary` |
| 3c | 6.5 | A required tool counts as covered when *attempted* in one path and only when *completed* in another | `fix/one-requirement-evidence` |

Out of scope, explicitly, so it is not re-litigated mid-execution:

- **F10** (request prefix churns, prompt cache never hits). Real and expensive, but it is
  Step 5 (context and cost economy). WIP = 1.
- **The remaining `forkDaemon` sites.** `execution-engine.ts:1373`,
  `finalize/debrief-synthesis.ts` and `phases/memory-flush-dispatch.ts:47` are
  *deliberately* fire-and-forget — their comments state they must never block `run()`'s
  return. Only `execute-stream.ts:763` was ever correctness-critical, and its symptom is
  already fixed. Do not sweep for `forkDaemon`.
- **6.10 config representations / 6.8 two memory consolidators.** Step 6, deliberately last.

---

## 2. Item 3a — One path authority (09 §6.6)

### The defect, verified 2026-08-18

Two independent authorities decide what an out-of-root absolute path means, against two
independently-sourced roots, and they do **opposite** things.

**Authority A — the healer.** `packages/tools/src/healing/path-resolver.ts:50-55`, reached
via `healing-pipeline.ts:68` with a `workingDir` passed in by the caller:

```ts
// Hallucinated absolute path (not within working dir) → remap filename to working dir
if (!resolved.startsWith(workingDir)) {
  const remapped = resolve(workingDir, basename(resolved))
  healed[key] = remapped
  actions.push({ stage: "path", from: value, to: remapped })
  continue
}
```

It **silently rewrites** `/etc/report.md` to `<workingDir>/report.md`.

**Authority B — the tool.** `packages/tools/src/skills/file-operations.ts:375-381`, against
`getFileRoot()` — an `AsyncLocalStorage` root defaulting to `process.cwd()`:

```ts
const allowedBase = getFileRoot();
const resolved = path.isAbsolute(filePath)
  ? path.resolve(filePath)
  : path.resolve(allowedBase, filePath);
if (!path.normalize(resolved).startsWith(path.normalize(allowedBase))) {
  throw new Error(`Path traversal detected: ${filePath}`);
}
```

It **throws**.

**Correction (2026-08-18, pre-probe re-verify):** the plan originally listed root
divergence (healer's `workingDir` vs. the tool's `getFileRoot()`) as a live consequence.
Re-checked against the actual callers: `act.ts:207` and
`plan-execute/step-executor.ts:309` both pass `getFileRoot()` as the healer's root — the
same fix comment appears at both sites, dated before this plan's first draft. **Roots are
already unified.** Strike that item. The remaining two consequences hold regardless of root
matching, because they come from the remap-vs-throw contradiction itself, not from a root
mismatch:

1. **F9 directly.** Healing runs *before* the tool executes and rewrites the argument in
   place, so `file-write`/`file-read` never see the out-of-root path at all — they only ever
   see the remapped in-root path, and succeed there. Terminal verification checks the path
   the model *originally asked for* (or the model's own claim about what it wrote), finds
   nothing at that path, and fails a run whose work actually completed. The user sees "task
   failed" next to a correctly written file. Because healing runs first, `file-operations.ts`'s
   throw branch is **effectively dead** for absolute paths reached through the kernel's
   normal call path — it only fires for a caller that bypasses healing entirely, which is its
   own instance of 6.4's boundary-bypass problem.
2. **A policy contradiction, not just a symptom.** Confinement is a single invariant with two
   implementations that resolve the same input two different ways. Silent remapping is not a
   weaker form of throwing — it is a different policy, and only one of the two can be the
   intended one. The fact that one of them (the throw) never actually fires in the normal
   path makes this an easy structural fix: deleting the healer's remap branch does not
   change roots or add a new confinement mechanism, it just lets the confinement mechanism
   that already exists start running.

### Fix

Pick one authority; delete the other. **Authority B (the tool) is the keeper** — confinement
belongs at the effect site, not in an argument-rewriting heuristic that runs earlier and can
be bypassed by any caller that skips the healing pipeline.

1. Introduce a single exported root accessor used by both sites. `getFileRoot()` already has
   the right shape (ALS, fiber-safe, per-agent, no global race — see its JSDoc). Thread it
   into the healing pipeline so `resolvePaths` stops taking an independently-sourced
   `workingDir` for the confinement decision.
2. In `path-resolver.ts`, **keep** tilde expansion and relative→root resolution (genuine,
   useful healing that does not change the meaning of an in-root path). **Delete** the
   out-of-root remap branch. An out-of-root absolute path is no longer silently rewritten;
   it reaches `file-write` / `file-read`, which throws with the existing
   `Path traversal detected:` message.
3. Verify terminal verification reads the *final executed* path. Since the healer no longer
   rewrites out-of-root paths, the argument the model issued and the path executed are the
   same value, which is what closes F9.

### Abort gate (red-on-cut)

Write these first and confirm they fail against current `main`:

- `withFileRoot(tmp, ...)`, agent issues `file-write` to an absolute path outside `tmp`.
  Assert: the tool throws, the run reports failure, and **no file is created inside `tmp`
  under the basename**. Currently the healer creates one.
- `withFileRoot(tmp, ...)`, agent issues `file-write` to a relative path, then `file-read`
  on that same relative path, then terminates. Assert: run succeeds, and the *verified*
  path equals the *executed* path. This is the F9 regression pin.
- A path-traversal test (`../../etc/passwd`) still throws under both a default root and a
  `withFileRoot` root.

### Risk

Behavior change for any user relying on hallucinated-path rescue. The remap was a
success-rate crutch: it converted a model error into a silent surprise. Removing it converts
it into a legible error the model can recover from via the existing error-observation path.
Note it in `CHANGELOG.md` as a behavior change, not a bugfix.

---

## 3. Item 3b — One execution boundary (09 §6.4)

### The defect, verified 2026-08-18 — narrower than originally scoped

`executeToolAndObserve()` (`tool-observe.ts`) owns policy, approval, observation, ledger and
event emission. The kernel's parallel tool batch does not call it — it calls
`executeNativeToolCall()` directly at `act.ts:704`. `act.ts:953`'s comment lists what the
canonical primitive owns that the bypass would otherwise lose: *"executeNativeToolCall,
errorRecovery guidance, LLM fact-extraction, …"*.

**Correction (2026-08-18):** on re-reading the full batch loop (not just the comment), three
of the four listed concerns are already hand-duplicated onto the batch path, not lost:

- **Approval** — `resolveBlockApproval` at `act.ts:625-640`.
- **Healing** — the shared `healCall` closure (`act.ts:193-215`) runs for both the
  single-call and batch members; this was *already* fixed for root divergence (see §2's
  correction above).
- **Error-recovery guidance** — `act.ts:770-778` calls the same `adapter.errorRecovery?.()`
  the single path calls, and stitches the same `[Recovery guidance: ...]` text into
  `obsContent`.
- **LLM fact-extraction** — `act.ts:783-796` calls `extractObservationFacts` directly.

So the comment at `:953` describes the *primitive's* contract, not a current *gap* — every
concern it lists has an independent, hand-written twin already living in the batch loop.
This is 09's "boundary multiplicity" disease in its purest form: **not missing behavior, but
the same four concerns implemented twice**, four maintenance sites instead of one, already
caught drifting once (the root-divergence bug just fixed) and one step from drifting again
on the next unrelated change to either side.

**One divergence that book-code claims is live and current but did not reproduce live
(2026-08-18, see §"Probe results" below):** `tool-observe.ts:503-517` attaches a
`VerificationResult` to the single-call path only under `RA_TOOL_OBSERVE_SYMMETRY=1`
(default off), while `act.ts:806-812`'s comment says the batch path attaches it
*unconditionally*. A cross-model probe comparing single-call vs. 3-parallel-call runs found
**no** `verification` field on either path's observation steps, for either model. Either the
public `AgentResult.metadata.reasoningSteps` projection strips it before it's visible (its
own instance of 6.2 — terminal truth re-derived/pruned on the way out), or the unconditional
attachment claim in the `:806-812` comment is itself stale. **Unresolved — needs a
kernel-internal assertion (not an external probe) before 3b's abort gate can rely on it.**

### Fix

Make the batch a **scheduler over the canonical primitive**, not a parallel reimplementation
of it — this is a consolidation now, not a bug-closing fix, since nothing observable is
currently broken by the duplication (modulo the unresolved verification question above).

1. Give `executeToolAndObserve()` a batch-capable entry point that accepts N calls and a
   concurrency setting, and internally runs the same per-call pipeline it already runs.
2. Replace the `act.ts` batch loop body with calls to that entry point.
3. Delete the four hand-duplicated blocks (`resolveBlockApproval`, the batch's own
   `adapter.errorRecovery?.()` call, its own `extractObservationFacts` call, and its own
   `defaultVerifier.verify()` call) — each becomes dead once the canonical primitive owns
   the concern again. **Requires a sole-caller grep per block before deletion**, and each
   deletion should land as its own commit so a regression is bisectable to one concern.

### Interaction with 3a — the reason 3a ships first

`executeToolAndObserve` runs the healing pipeline itself (`tool-observe.ts:262-285`,
`config.heal.cwd` feeding `runHealingPipeline`). So the canonical primitive is *also* a
`resolvePaths` caller, and the parallel-batch bypass means batched file-tool calls currently
skip healing entirely — a third concern lost on that path, alongside the two the comments
already name.

Two consequences:

- 3a must land first. Routing the batch back through the primitive (3b) would newly subject
  batched calls to the healer's out-of-root remap — i.e. 3b would *widen* F9's blast radius
  if 3a has not already removed that branch.
- After 3a, `config.heal.cwd` should resolve from the same single root authority as
  `getFileRoot()`, not from an independently-passed `cwd`. Fold this into 3a's step 1 rather
  than leaving a second root source behind.

### Abort gate

- A parallel batch of two tools under an approval policy that denies one: assert the denial
  is recorded, the denied tool never executes, and the ledger + emitted events are identical
  in shape to the same scenario run through the single-call path.
- A parallel batch where one member fails: assert error-recovery guidance is produced (it is
  currently listed as lost on this path).
- A parallel batch of file tools with healable arguments: assert healing now applies, and
  that it applies *identically* to the single-call path.
- `scripts/check-cross-cutting.sh` stays green — particularly the ledger-absorption check.

---

## 4. Item 3c — One requirement evidence (09 §6.5)

### The defect, verified 2026-08-18

`terminal-gate.ts:26-35` documents the divergence in its own header rather than resolving it:

> *"b) Coverage semantics: the kernel counts a required tool as covered when it was
> ATTEMPTED (`state.toolsUsed` is written before execution, act.ts:808) while plan-execute
> counts only COMPLETED steps. Callers pass `coveredTools` computed with their own
> semantics."*

**Confirmed live 2026-08-18, with corrected line numbers** (the header's `act.ts:808` is
stale). `newToolsUsed.add(...)` fires at eight sites in `act.ts`; on both the single-call
path (`:921`) and the parallel-batch path (`:695`) the add happens immediately after the
action step is pushed and **before** the tool executes. `arbitrator.ts:399` and `:481` then
pass `coveredTools: ctx.toolsUsed` straight into `evaluateTerminalGate`. So a required tool
that was attempted and **failed** satisfies the kernel's coverage check. The run reports
requirement coverage it does not have.

There are in fact **three** live semantics, not two:

| Caller | `coveredTools` | `coverageExhaustionPolicy` |
|---|---|---|
| `arbitrator.ts:399,481` (kernel) | `ctx.toolsUsed` — attempted | `"accept"` |
| `plan-execute.ts:1553` | `args.completedToolNames` — completed | `"abstain"` |
| `reflexion.ts:565` | `requiredTools` minus `missingRequired` — a third derivation | `"abstain"` |

And a fourth site, `arbitrator.ts:1245`, passes `coveredTools: new Set(ctx.requiredTools)` —
coverage deliberately **vacuous** (everything counts as covered) because that seam only
consults the grounding arm. That one is intentional and documented at `:1239-1241`; it must
be preserved as an explicit "coverage not evaluated here" mode rather than accidentally
unified into the real check.

### Fix

One ledger-backed `RequirementEvidence` type, computed centrally from the `RunLedger`
(which already records both attempt and outcome), replacing caller-computed `coveredTools`.
Coverage means **completed successfully**. The kernel's attempted-counts-as-covered
behavior is the bug, not the baseline.

Concretely:

1. Add a `RequirementEvidence` computed from the ledger, exposing covered-as-completed.
2. Replace `coveredTools` at `arbitrator.ts:399`, `:481`, `plan-execute.ts:1553` and
   `reflexion.ts:565` with it. Four call sites, one derivation.
3. Keep `arbitrator.ts:1245`'s vacuous mode, but express it as an explicit
   `coverage: "not-evaluated"` rather than the current
   `coveredTools: new Set(ctx.requiredTools)` trick, which is indistinguishable from a
   genuine full-coverage result.
4. `state.toolsUsed` keeps its attempted semantics — it is legitimately "what the model
   tried", used by prune/surface logic (`tool-surface.ts:119`). The fix is that the
   *terminal gate* stops treating it as evidence of completion. Do not repurpose the field.
5. Resolve `coverageExhaustionPolicy` to one behavior. Two strategies say abstain, the
   kernel says accept; the split is a caller-choice paper over an unmade decision. Abstain
   is the honest default (per the honest-claims law in 08 §), but this is an owner call —
   see §8 question 2, since it moves the same gate as the coverage fix.

### Abort gate

- Required tool attempted and failing: assert the terminal gate does **not** accept.
  Currently it does. This is the RED test.
- Required tool completed: accepts, unchanged.
- Both strategies (kernel and plan-execute) produce the same verdict for the same ledger.

### Note on ordering

3c is last because it is the one item whose fix can *reduce* measured success rate — it
closes a hole that was inflating coverage. Expect the t0 gate to move. That is a correction,
not a regression, but it must not be conflated with 3a/3b's results, which is the second
reason these ship as separate branches.

---

## 5. Step 0 leftovers — handle before 3a

Both are small, both are genuinely open, and both are cheaper than any Step 3 item.

### 5.1 Remove `discover-tools` (09 §5.2)

`tool-capabilities.ts:140-157` registers it whenever `toolDiscoveryEnabled()`, which is
**default-on since 2026-04-26** (justified then by
`wiki/Research/Harness-Reports/bare-vs-harness-curation-2026-04-26.md`). §5.2 (2026-08-12)
supersedes that report and rules the tool pure cost.

**Coupling risk 09 §5.2 does not address — read before opening the branch.**
`discover-tools` is the *escape hatch for lazy pruning*, and the two are separately flagged
but jointly defaulted in `harness-flags.ts:44-56`:

- `lazyDisclosureEnabled()` — `!isOff(RA_LAZY_TOOLS)`, default ON. Prunes the visible tool
  surface to required + relevant + used + **discovered** + meta (`tool-surface.ts:111-125`).
- `toolDiscoveryEnabled()` — `RA_TOOL_DISCOVERY` if set, else falls through to
  `RA_LAZY_TOOLS`. Default ON.

So removing `discover-tools` while lazy pruning stays default-on leaves **pruning with no
recovery path**: a tool the classifier failed to mark required-or-relevant becomes
permanently unreachable for that run. `tool-surface.ts:139-147` only guards the
prune-to-meta-only extreme, not the prune-dropped-the-one-tool-you-needed case, and
`discovered` (`:120`) is an input the store can no longer be populated.

This makes the removal a **two-part decision, not one deletion**:

1. Does lazy pruning stay default-on without its escape hatch? If yes, the branch needs
   evidence that classifier misses are rare enough to eat — which is a lift measurement, not
   an assertion.
2. Or does `RA_LAZY_TOOLS` flip default-off in the same branch, making both the pruning and
   the hatch opt-in together? This is the cleaner story and matches §5.1's *"pruning becomes
   a profile knob, not a hidden default"* — but that is Step 4 (profiles), so doing it here
   pulls Step 4 work forward.

**Recommendation:** take option 2's *intent* but the minimal form — remove `discover-tools`
and flip `RA_LAZY_TOOLS` default-off in one branch, so no configuration is left in the
unreachable-tool state. Defer the full profile knob to Step 4.

Process requirements, since this is a default-on behavior removal reaching every user:

- Sole-caller grep across `discoverToolsTool`, `makeDiscoverToolsHandler`,
  `discoveredToolsStoreRef`, `toolDiscoveryEnabled`, `RA_TOOL_DISCOVERY`, `RA_LAZY_TOOLS`,
  and the `packages/tools/src/index.ts` + `skills/builtin.ts` re-exports.
- `ablation-warden` holds veto over default-on changes — route through it. Both the removal
  *and* the `RA_LAZY_TOOLS` default flip are in its scope.
- The `discovered` parameter threading through `tool-surface.ts` (`:79`, `:104`, `:120`,
  `:228-239`, `:262-270`) becomes dead — remove it with the same sole-caller discipline
  rather than leaving an always-empty input.
- `CHANGELOG.md` entry plus migration lines for anyone setting either flag.
- `META_TOOLS` (`kernel-constants.ts:14`) lists `discover-tools` as a true protocol-only
  tool; `META_TOOL_SET` is consulted at `tool-surface.ts:124/134/143-144`. Removing the name
  from that set changes prune arithmetic — verify the never-prune-to-meta-only guard still
  behaves.

### 5.2 F8 — no-progress termination (09 §7 Step 0)

Still open. `.withStallPolicy` and the `watchdog:no-progress-for:Nms` reason bound elapsed
time and iteration count; neither detects the specific shape 09 names — *repeated
no-evidence discovery / meta-tool loops*. Needs a counter over consecutive meta-tool
observations that produce no new evidence, terminating the loop rather than waiting for the
iteration ceiling.

Sequence it after `discover-tools` removal — deleting the tool removes one of the two loop
sources and may shrink the fix.

---

## 6. Sequencing

```
1. discover-tools removal        (Step 0 leftover, ablation-warden gated)
2. F8 no-progress termination    (Step 0 leftover)
3. 3a  one path authority        (F9 — highest user-visible impact)
4. 3b  one execution boundary
5. 3c  one requirement evidence  (expect t0 movement; ships alone)
```

Each is a separate branch, each merges to local `main` under the existing
hold-until-tag convention (no PR against `origin/main` — it would show 350+ unrelated
commits).

## 7. Global exit criteria

- Build 37/37 clean.
- Full suite green, with the delta explained per branch — in particular any t0 movement
  from 3c.
- `scripts/check-cross-cutting.sh` 9/9.
- `bunx madge --circular packages/reasoning/src/kernel` stays at 0 (it was brought to 0 on
  2026-08-18 by #200; Step 3 touches kernel `act` and must not reintroduce a cycle).
- One retro per branch in `wiki/Research/Debriefs/`.
- **09 §6 and §7 amended in place** with the 2026-08-18 verification table from §0 above.
  Per §8, do not write a new north-star document.

## 8. Open questions for the owner

1. **3a behavior change.** Removing hallucinated-path rescue will lower raw success rate on
   tasks where models invent absolute paths, while removing a class of false failures. Is
   that trade accepted, or should the remap survive behind an explicit opt-in?
2. **3c and the t0 gate.** If closing the attempted-vs-completed hole moves t0, is the new
   number the baseline, or does 3c wait for a re-baseline first?
3. **`discover-tools`.** §5.2 rules it pure cost against an April report that ruled it
   valuable. Confirm §5.2 is the standing ruling before the removal branch opens.

## 9. Live cross-model probe results (2026-08-18)

Anthropic unreachable this session (API key present but account has no credit balance —
`invalid_request_error: Your credit balance is too low`). Substituted `gpt-4o-mini`
(OpenAI) as the frontier/cloud tier; `qwen3:14b` (local Ollama) as the small-tool-caller
tier — same two-tier shape the project's measurement ladder calls for (rung 2 + rung 3).
Probe scripts live in `scripts/probes/step3-*.ts`, runnable standalone via
`MODELS="model:provider,model:provider" bun scripts/probes/step3-<name>-probe.ts`.

| Item | Probe | gpt-4o-mini | qwen3:14b | Verdict |
|---|---|---|---|---|
| 3a (F9) | `step3-path-authority-probe.ts` | REMAPPED, `run.success=false` | REMAPPED, `run.success=false` | **CONFIRMED, 2/2.** File written to `ROOT/report.md`, run reported failure, model's requested path never reached the write. |
| 3c (coverage) | `step3-requirement-evidence-probe.ts` | ledger: `tool:record_finding` → `status:"satisfied"` despite 2/2 calls erroring | ledger: same, 2/2 calls erroring | **CONFIRMED, 2/2.** The requirement ledger records "satisfied" for a tool that never once succeeded. (Overall `run.success` was still `false` in both cells, but for unrelated reasons — token-delta-guard / abstention — not because the coverage claim was caught. The ledger entry itself is the wrong claim.) |
| 3b (boundary) | `step3-execution-boundary-probe.ts` | no `verification` field on single OR parallel path | same | **REFUTED AS SCOPED / UNRESOLVED.** Forced both models into a genuine 3-parallel-call turn (confirmed via tool-call count). Neither path showed the `verification` field the code comments describe as unconditionally attached on batch. Either it's stripped before reaching public `AgentResult.metadata`, or the `:806-812` comment is stale. 3b's *actual* live finding is architectural (four hand-duplicated implementations, see §3), not the coverage/approval/health bypass originally suspected — that part was already patched. |

**Net effect on the plan:** 3a and 3c are empirically confirmed defects with reproducible
red-tests now sitting in `scripts/probes/`, ready to be adapted into the abort-gate tests in
§2 and §4. 3b is downgraded from "live bypass bug" to "confirmed duplication, unconfirmed
behavioral divergence" — still worth consolidating per 09's boundary-multiplicity framing,
but its abort gate should assert **duplication removed with no behavior change**, not
**a currently-broken behavior fixed**. The verification-attachment question should be
settled with an in-process test (mock the kernel state, call the batch path directly, assert
on the raw `KernelState.steps` before any public projection) rather than another live-model
probe, since the gap — if real — is downstream of both paths.
