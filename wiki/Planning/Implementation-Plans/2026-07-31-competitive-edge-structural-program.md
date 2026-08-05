# The Competitive-Edge Structural Program (2026-07-31)

**Status:** PROPOSED — strategic plan, owner ratification required before it re-orders the [[../../Architecture/Specs/09-UNIFIED-PROGRAM|09 Unified Program]] sequence.
**Author basis:** [[../../Research/Audit-Reports-2026-07-31/fresh-eyes-framework-audit|Fresh-eyes audit (2026-07-31)]] (3 grep-verified code agents + live first-user QA) cross-analyzed against [[../../Research/Audit-Reports-2026-07-29/systems-audit/00-overview|Systems Audit 2026-07-29]] (8/8 confirmed root causes), the [[../../Architecture/DEBT-REGISTER|Debt Register]] "7-boundary spine," and [[../../Planning/Implementation-Plans/2026-07-27-simplification-and-feedback-loop|the simplification program]].
**Governing law it answers to:** 09 §6 program invariants (one owner + one grep-able enforcement script; default-on only via the per-task-class lift rule + ablation-warden veto) and the ratified measurement ladder (Rung 1 replay → Rung 2 haiku → Rung 3 local, sign-agreement for cross-tier promotion).

---

## 0. TL;DR

Three independent audits (2026-07-27, -29, -31) plus the 200-item debt register are **not describing different problems**. They describe **one disease with two faces**, and the framework already named the cure ("fix the boundary, not the site") but has been applying it reactively, one boundary at a time, under measurement pressure. This program (a) states the disease precisely, (b) proves it recurs with cross-audit evidence, (c) prescribes six structural moves that each install a single-owner boundary + a grep enforcement script + a ladder-rung verification, and (d) sequences them so the framework's own instrument can show **verified lift** on the one number that is the competitive edge: **reliability-per-token**.

**The competitive north metric.** Corrected, measured overhead of the shipped default (`full`) over a bare loop is **+141% tokens / +156% cost** (haiku, n=3), ~9.4× over the framework's own 15% ceiling — and the `bare` baseline in that measurement *is RA's inline loop*, so the number is a floor. Vercel AI SDK and Mastra run at a fraction of that. **The edge is not a 9th strategy; it is driving that overhead toward the ceiling while clearing ≥1 accuracy lift on the ladder.** Everything below serves that sentence.

---

## 1. The disease, stated once

> **The harness maintains multiple code paths for one concern, and decides outcomes from a reconstruction of its own behavior rather than from ground truth. So every fix lands on the path currently under measurement, the sibling paths drift, and the judge that would catch the drift is itself reasoning over belief, not the world.**

Two faces:

- **Face A — path multiplicity.** N places implement one concern (two agent loops, four provider stream-suppression state machines, four success authorities, four delegation sites, two "memory" systems). A fix to one is invisible to the others.
- **Face B — reconstruction over ground truth.** Success/progress/coverage are computed from the ledger, recorded args, authorship heuristics, LLM-inferred required-tool sets — never from disk/world. The 2026-07-29 audit measured an **88% false-failure rate on real correct deliverables** from exactly this.

The two faces compound: because there are many paths (A), the reconstruction (B) that each path feeds is partial, so the judge is wrong in a path-dependent way — and the "fix" for the wrong judgment gets applied to the one path being watched, which is Face A again.

---

## 2. Cross-audit evidence that it recurs (not a one-off)

| Instance | Face | Source | Fix pattern that worked (or is needed) |
|---|---|---|---|
| Tool policy enforced in `act.ts` only; plan-execute/blueprint/code-action/inline bypass | A | Debt P0-4 / spine **B1** | Move gate INTO shared `executeToolAndObserve` chokepoint ✅ |
| Strategy `extraMetadata` — only `reactive` forwarded `terminatedBy` | A | spine **B2** | One shared `deriveTerminatedBy` ✅ |
| RunLedger overwritten per pass; 4 ledger factories, 3 silent | A | Wave C.2 | One announced seam `growRunLedger` + grep gate ✅ |
| Wave C.2 wired 3 of 4 delegation sites; code-action's 4th leaked raw child ledger | A | Sys-audit RC#7 | Give the 4th path the same extract/strip pattern ✅ |
| Token-accounting sweep covered 3 of 4 providers; LiteLLM missed | A | Sys-audit OB-2 | (open) — because LiteLLM is a 766-LOC *dup*, below |
| Classifier "opt-in" fix at the resolver, not the config layer that gates it | A+B | Sys-audit RC#2 | Fix the gating layer, not the surface ✅ |
| **Two agent loops (inline vs kernel), ~1,580 LOC** — bare builder runs the second | A | **Audit 2026-07-31 P1-1** | **One loop (Move 1)** |
| **4× copy-pasted stream suppression + LiteLLM dup + `toEffectError` ×4** | A | **Audit 2026-07-31 P2** | **One compat path + one normalizer (Move 3)** |
| Four independent success authorities; none read disk → 88% false-fail | B | Sys-audit **RC#1** (still open) | **Single ground-truth authority (Move 2)** |
| **Memory: write-only; `recall` a second disconnected system** | A+B | **Audit 2026-07-31 P1-2** | **One retrieval owner or delete the write (Move 4)** |
| Loop detector byte-identical only; `maxIterations` per-pass not per-run | B | Sys-audit §2c + **Audit 2026-07-31 P1-3** | **Ground-truth progress signal + per-run cap (Move 5)** |
| Instrument faults: 555–640% retracted; "cost near-deterministic at n=3" falsified | B (of ourselves) | 09 §7 / Sys-audit §2b | **Trustworthy measurement (Move 0)** |

Eleven+ instances, four audits, two months. The framework's own doctrine already says the remedy — spine §3: *"The ~200 findings are not 200 bugs. They are 7 boundaries where a value fails to cross. Fix the boundary, not the site."* This program's only new claim is **strategic**: stop discovering the boundaries reactively under measurement pressure; install the remaining single-owner boundaries deliberately, each with its enforcement script, in lift-verified order.

---

## 3. The moves

Each move states: **Boundary** (where the value fails to cross) · **Single owner** (the one module that will own it) · **Enforcement** (the grep-able script — no script, not done, per 09 §6) · **Verification** (which ladder rung proves it, and the expected lift) · **Risk**.

### Move 0 — Trustworthy measurement first (the meta-enabler)
Nothing below can claim "verified lift" until the instrument is honest. Two concrete, already-named gaps:
- **Composite bench runs ONE task (`disclosure-ablation.ts:40`, `T=1`)**, so the gate's between-task clustering term is structurally unavailable and *"the billed tier can currently measure cost but not accuracy"* (09 §7 open item, explicitly the highest-value follow-up). **Owner:** the composite bench harness. **Do:** raise to `T≥5` diverse tasks so `evaluateLiftGate` runs for real at the billed tier. **Enforcement:** a gate asserting `T>1` before any lift verdict is recorded. **Verify:** Rung 2. **Risk:** Low.
- **Numbers drift across docs** (README/QUICK_START/skills disagree; the `architecture-audit` skill falsely claims `context-engine.ts` deleted). **Owner:** the doc-derivation script AGENTS.md already uses. **Do:** extend build-time number derivation to QUICK_START + README badges; add a CI grep that fails on stale kernel paths (`src/strategies/kernel/`) and on skill/memory claims contradicting the tree. **Enforcement:** the CI grep. **Verify:** CI. **Risk:** Low.

### Move 1 — One agent loop (collapse inline into the kernel)
- **Boundary:** `execution-engine.ts:741` `reasoningOpt` fork; the `None` arm's ~1,580 LOC (`engine/phases/agent-loop/inline-{think,act,observe,harness-hooks}.ts`, `verification-*.ts`). The bare builder (`_enableReasoning=false`, `builder.ts:360`) — the default first-user path — takes it.
- **Single owner:** the kernel. Route the bare/default builder through the kernel `direct` strategy (already a thin `runKernel(reactKernel)` wrapper, `direct.ts:176`). Capability tiers become **phase composition on one loop**, not a second loop: `direct` = minimal phases (no contract/assessment/projection unless lift-justified); `.withReasoning()` adds the meta-loop phases. This respects 09's ruling that making the meta-loop *default-on* is a lift-rule question — Move 1 unifies the *machinery*, not the *default capability set*.
- **Enforcement:** `scripts/check-single-loop.sh` — greps that no `inline-think/act/observe` think-act-observe reimplementation exists outside `kernel/loop/`; the meta-loop-reachability test proves the default path now emits the kernel's tool/act/observe/terminate events.
- **Verify:** Rung 1 replay (control-flow parity: default path over the golden corpus must match) **and** Rung 2 (token/accuracy must not regress; likely *improves* the +141% floor because the default becomes a tunable single path). **Expected lift:** velocity (every future fix lands once) + removes the entire inline-vs-kernel confound class (4 findings retracted to it historically) + a real shot at the overhead floor.
- **Risk:** Med/High (behavior-visible for no-reasoning users). Gate behind ablation-warden. Biggest single unlock; do it deliberately, not opportunistically.

### Move 2 — Single ground-truth success authority (closes Sys-audit RC#1)
> **STRUCTURALLY COMPLETE (2026-07-31 / 2026-08).** Two commits:
> - **Slice 1 (`49a1c94f`)** — disk ground-truth override for `ArtifactProduced`: `VerifyOptions.fileExists` (injected, positive-only — flips false→MET, never opens false-met) consulted by `isArtifactProduced`; `nodeFileExists` (`verify/file-truth.ts`) wired into both post-condition authorities plus the run-scoped ledger the terminal gate was missing (`TerminationContext.ledger` ← `state.ledger` via think.ts). Real-temp-file integration test through `terminate()` proves the cogito `./commits.md`-on-disk false-fail fixed; mutation-verified red-on-cut.
> - **Slice 2 (`7dbb270d`)** — the two authorities are unified behind **one owner**: `verify/delivery-authority.ts` `verifyDelivery()` defaults `fileExists` to real fs (ground truth ON by construction) + threads the ledger; `terminate.ts` and `terminal-gate.ts` both route through it (redundant per-site injection dropped from `arbitrator.ts`). Enforcement: **`scripts/check-success-authority.sh`** fails CI if the owner stops defaulting `?? nodeFileExists` or if either delivery path reverts to the raw `verify()` — both mutation-verified red-on-cut. 609 kernel/loop tests pass; reasoning builds green. Satisfies the 09 §6 "one owner + one grep script" law.
> - **Slice 3 (`55a2292d`)** — E2E-driven completion. A live probe (gemma4:12b) writing a deliverable via a tool with a non-standard path-arg key (reconstruction can't link it) was STILL demoted `success=false` with the file on disk — the reactive strategy decides success at a THIRD site the first slices missed (`arbitrator.ts applyPostConditionGate`), plus `deliverable.ts`, `deliverable-report.ts`, `reflexion.ts`. Textbook Face A. Routed ALL SIX delivery sites through `verifyDelivery`; enforcement script now guards all six (grep lookbehind excludes the LLM `verifier.verify(`). **Controlled A/B on the live probe (toggling only the owner's `?? nodeFileExists`): disk-truth OFF → success=FALSE, ON → success=TRUE, verifier pass.** 1422 tests pass. **Lesson: unit tests missed the third authority; the E2E probe found it — the "one owner" claim is only as good as the enforcement script's coverage of EVERY decision site.**
> **Remaining (owner-gated measurement, not code):** disk-graded golden-corpus replay to quantify the aggregate RC#1 false-negative drop (Rung 1); optional disk-truth for `OutputContains`-style checks.
- **Boundary:** four independent authorities decide "did this succeed" from ledger/heuristics; none checks disk. 88% false-failure measured.
- **Single owner:** a `SuccessAuthority` module — the *only* place a run's success is decided — that reads the run-scoped ledger (substrate already unified in Wave C.2) **plus ground truth** (filesystem for `produces:"file"` deliverables; the world for other post-conditions). This is the missing half: Wave C.2 gave the authority one *substrate*; it still lacks one *owner with ground-truth access*.
- **Enforcement:** `scripts/check-success-authority.sh` — greps that no strategy/engine site computes terminal success independently of the owner; a red-on-cut mutation test.
- **Verify:** Rung 1 replay over the golden corpus with **disk-graded** assertions (the bench already had to write `// Grade on DISK, not on the model's claim`); the false-negative rate should collapse. **Expected lift:** pure **accuracy** — fixing false-negatives is the cheapest path to the *first* lift-rule pass in project history (7 attempts, 0 passes), because it adds accuracy at ~0 token cost.
- **Risk:** Med. Careful not to trade false-negatives for false-positives (Sys-audit warns fixing either direction alone trades one error for the other — the single owner with ground truth is what fixes both at once).

### Move 3 — One provider compat path + one stream normalizer
- **Boundary:** `openai.ts:398` / `gemini.ts:456` / `litellm.ts:335` / `anthropic.ts:334` each reimplement the suppress-then-synthesize tool-call state machine; `litellm.ts` is a 766-LOC re-implementation of `makeOpenAICompatProvider`; `toEffectError` duplicated ×4.
- **Single owner:** `streamWithAdapterNormalization(chunks, streamAdapter, emit)` in `streaming-helpers.ts`; route LiteLLM through `makeOpenAICompatProvider` (a `resolveBaseUrl` returning the gateway URL is the only real delta); one `toEffectError(err, provider)`.
- **Enforcement:** `scripts/check-provider-dedup.sh` — greps that LiteLLM has no bespoke SSE loop and that no provider hand-rolls the suppression machine; a provider-identity-count invariant.
- **Verify:** existing per-provider stream tests (unit / Rung 0). **Expected lift:** velocity — every streaming/tool-call fix lands once. This is the direct antidote to "LiteLLM missed the token sweep" (it missed *because* it is a dup). ~1,000+ LOC deleted.
- **Risk:** Med (streaming is timing-sensitive; the per-provider tests are the guard).

### Move 4 — Memory: make retrieval real, or delete the write-cost
> **DELETE HALF SHIPPED (`223fa340`).** The kernel forked a daemon embedding + SQLite-writing every successful tool result into semantic memory ("8-12s on local models" per its own comment); `search*` had ZERO loop callers — write-only dead. Removed the whole thread (`storeToolObservationSemantic` daemon + both call sites + the `memoryService` plumbing through `tool-execution.ts`/`tool-observe.ts`/`act.ts`). `packages/memory` untouched, so a real recall phase (the other half of Move 4) starts clean. 54 tests pass; reasoning+runtime build green.
- **Boundary:** `tool-execution.ts:133` embeds + persists a semantic entry every successful tool result; `search*` has **zero external callers** (verified); `recall` (`skills/recall.ts:64`) is a second, ephemeral `Map`.
- **Single owner:** `MemorySearchService` — wire it into a kernel recall phase and back `recall`'s search with it (converges the two systems). **Decision fork:** if recall does not clear the lift rule, **delete the embed+store** until a reader exists — an immediate token win that attacks the +141% directly.
- **Enforcement:** `scripts/check-memory-readers.sh` — greps that every `storeSemantic` write path has a corresponding read path OR the store is gated off; fails on write-only.
- **Verify:** Rung 2 behind the lift rule (does recall improve accuracy at ≤15% token cost?). **Expected lift:** either **accuracy** (recall earns its place) or **token** (delete dead write). Both move the competitive number.
- **Risk:** Low (deleting dead write is safe; wiring recall is gated).

### Move 5 — Loop control reads progress from ground truth
> **PARTS 1–2 SHIPPED.**
> - **Part 1 (`d58a6343`)** — `detectLoop` pattern (d): N calls to the same tool (by NAME, args may vary) with NO successful observation → loop. Gated on `observationResult.success`, floor of 3, actions link-able. Single loop-pattern owner. 5 unit tests.
> - **Part 2 (`b024a345`)** — per-RUN iteration cap: a strategy switch called `initialKernelState` which zeroed `iteration`, giving each pass its own `maxIterations` budget (audit: 16–28 vs declared 12). Now carries `priorState.iteration` across the switch so the cap bounds the whole run. Only loop-detect+switch runs are affected (pathological minority) → strict tail-trim, can't regress healthy runs. Test + live E2E (always-failing tool, cap 8 → terminated at iter 5, honest answer). 1427 tests pass.
> **Part 3 DEFERRED (lift-gated):** defaulting `fallbackStrategy` to a deterministic escalation would skip the `evaluateStrategySwitch` LLM call BUT changes *which* strategy you switch to — a behavior change the project's own §6 lift rule + ablation-warden gate. Not a blind default; file as a measured promotion, not shipped here.
- **Boundary:** `loop-detector.ts:56` fires only on byte-identical repeated calls, so varied-arg thrash burns to `maxIterations`; and the iteration cap is per-kernel-pass, silently multiplied by strategy-switch pass count (recorded 16–28 iters against a declared cap of 12).
- **Single owner:** the loop detector gains a **"no new successful observation"** signal (the `observationResult.success` field already exists, used at `strategy-switch.ts:161`) independent of arg equality; the iteration cap becomes **per-run**. Also: default `fallbackStrategy` to a deterministic escalation so the common loop-detection case skips the extra `evaluateStrategySwitch` LLM round-trip.
- **Enforcement:** `scripts/check-iteration-cap.sh` + extend `meta-loop-reachability.test.ts`; the Rung-1 guard-misfire detector (`dispensed < tableSize`) pins it.
- **Verify:** Rung 1 replay (zero-token control-flow) + Rung 2 for the cost tail. **Expected lift:** **token** — stuck runs finish cheaper across every tier; directly trims the bad-run tail that inflates overhead. Also removes the local-vs-frontier asymmetry (`maxSameTool` local=2/frontier=5 currently polices the weakest models hardest).
- **Risk:** Med (false positives — gate strictly on "no new *successful* observation").

### Move 6 — Decompose `iterate-pass.ts` (reliability of the hot path)
- **Boundary:** `kernel/loop/iterate-pass.ts` — 1,644-LOC single function, mutable `carrier` + hand-written `sync()` that ~10 early-returns must each remember to call; a missed `sync()` silently corrupts loop state next pass.
- **Single owner:** each branch returns an explicit typed delta; the pass is composed of named steps (pause-checkpoint, act, loop-detect+switch, required-tool nudge, stall). No mutable carrier.
- **Enforcement:** the existing `equivalence.test.ts` (ledger ≡ projection(steps)) pins behavior; add a size/complexity lint gate on the file.
- **Verify:** Rung 1 replay parity. **Expected lift:** not a measured lift — a **defect-rate** reduction on the single hottest control-flow file; pays out on every kernel change (velocity).
- **Risk:** Med — do it after Move 1 (which may relocate parts of this path anyway).

---

## 4. Sequence (WIP = 1, per 09 discipline)

The order maximizes *verified lift per unit risk* and respects that measurement must be trustworthy before anything claims lift.

```
DONE   P0 timeout fixes (tool-service + sandbox + local timeout) — shipped, verified live 2026-07-31
─────────────────────────────────────────────────────────────────────────
1      Move 0  Trustworthy measurement (bench T≥5 + doc/number CI grep)   [enables every "lift" claim below]
2      Move 2  Single ground-truth success authority                     [cheapest ACCURACY lift; 1st lift-rule pass candidate]
3      Move 5  Loop-control ground-truth progress signal + per-run cap    [cheap TOKEN win on the bad-run tail]
4      Move 4  Memory: delete dead write NOW; wire recall behind lift     [TOKEN win now, ACCURACY later — gated]
─────────────────────────────────────────────────────────────────────────
5      Move 1  Collapse the two loops into one kernel path               [biggest velocity + floor unlock; ablation-gated]
6      Move 3  Provider compat + stream normalizer dedup                 [velocity; ~1,000 LOC deleted]
7      Move 6  Decompose iterate-pass.ts                                 [reliability of the hot path; after Move 1]
```

Rationale: Moves 2/5/4 are cheap, mostly-accuracy-or-token wins that the ladder can verify quickly and that move the competitive number without the risk of Move 1. Move 1 is the structural keystone but behavior-visible and ablation-gated, so it goes once the cheap wins have de-risked the measurement path. Moves 3/6 are velocity/reliability debt paid opportunistically after the keystone.

---

## 5. Definition of done (per move) and the program exit gate

**Per move (09 §6 law):** one owner module + one grep-able enforcement script that is **red-on-cut** (proven to fail if the boundary is re-opened) + the named ladder-rung verification recorded in the improvement ledger + a debrief in `wiki/Research/Debriefs/`.

**Program exit gate — the competitive edge, made testable:**
1. **Overhead:** the shipped default's measured token overhead over a bare loop is **≤ 2×** the current +141% floor's *complement* — i.e. a real, ladder-verified reduction toward the 15% ceiling, reported at Rung 2 with `T≥5` (Move 0 makes this measurable). Target the first halving; the ceiling is the horizon, not the gate.
2. **Accuracy:** **≥ 1 mechanism clears the lift rule** (≥3pp accuracy AND ≤15% token, rungs 2+3 sign-agree) — the A-tier gate that has stood open at 7 attempts / 0 passes. Move 2 is the most likely first pass.
3. **Coherence:** every subsystem touched has its single-owner boundary + red-on-cut enforcement script; a fresh fan-out audit finds **zero** new instances of Face A / Face B in the touched surfaces.
4. **Truth:** no doc/number/skill in the repo contradicts the tree (Move 0's CI grep is green).

When 1–4 hold, RA's public claim changes from "reliable on every tier" (true but unquantified) to **"the most reliable typed agent harness per token across model tiers, proven by its own public instrument"** — the one sentence Vercel/Mastra/LangGraph cannot each say all of.

---

## 6. What this plan explicitly does NOT do

- It does not add a 9th strategy, a new provider, or a new product arc. Feature count is not the axis.
- It does not make the meta-loop default-on — that stays a lift-rule + ablation-warden decision (09 §6). Move 1 unifies machinery, not defaults.
- It does not resurrect falsified levers (no LATS/GoT) or re-cite the retracted 555–640%.
- It does not touch the genuinely healthy parts the audits confirmed: layer separation, single-owner termination, adapter-hook wiring (all 5 read), MCP docker lifecycle, `ToolRegistry`/`ToolService` split, `context-engine.ts` (a live helper — the skill's "deleted" claim is the stale one, corrected in Move 0), the ledger substrate, compaction's protected-classes design.

---

## 7. Immediate next actions (if ratified)

1. Land Move 0's bench `T≥5` change + the doc/number CI grep (small, unblocks measurement).
2. Retract two stale memory/skill claims now (they actively mislead sessions): "two context builders" and "conversation-assembly superseded by ResultStore" are one live pipeline; the `architecture-audit` skill's `context-engine.ts`-deleted line is false.
3. Open a `SuccessAuthority` design stub (Move 2) — the highest-leverage accuracy lift — and dispatch it through the harness-improvement-loop with a live-data re-investigation of real failing rung-2/rung-3 cells (Sys-audit RC#1 says this needs live data, not more source reading, before the fix).
