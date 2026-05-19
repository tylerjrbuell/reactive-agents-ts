---
type: audit-report
status: active
created: 2026-05-19
authored-by: Claude Code (Opus 4.7)
related:
  - "[[05-DESIGN-NORTH-STAR]]"
  - "[[2026-05-18-agentic-team-ownership-concepts]]"
  - "[[2026-05-19-tool-access-verifier-env-fixes]]"
---

# Framework State & Priorities — v0.11.1

**Scope:** ownership pass after the v0.11.1 misc-fix batch. Where the framework
stands, ranked improvement levers, evidence anchors, recommended next units.
All claims verified against source this session (file:line cited).

## 1. Current state

- **Version:** 0.11.1. **35 packages.** Branch `main`.
- **Test baseline:** 64/64 test packages green (`bun run test`, runtime alone
  793 tests). No failing suites.
- **Build was RED at HEAD.** The v0.11.1 batch left `runtime#build` DTS broken:
  `runtime.ts:807 TS2741 — softFail missing in VerificationResult`. Commit
  `a368a186` fixed the sibling `noopVerifier` but missed the second literal
  (`leanModeVerifier`). **Fixed this session → `e8dc8b20`; full build now
  38/38 green.** `main` could not publish until this commit (release:dry gate).
- **7 commits unpushed** to origin/main.
- **Phase status (North Star v5.0 §6):**
  - A (decomposition) ✅ · B (Compose API) ✅ · D (code-action) ✅ shipped
  - C (v0.11 launch) ~complete: playground, `@reactive-agents/observe`,
    `create-reactive-agent`, snapshot/replay, compose docs all shipped;
    **outstanding: GH Projects roadmap board, push backlog.**
  - **1.5 partial:** M3 ✅ (REWORK done). **M6/M7/M8/M10/M14 pending.**
  - E / F / G ahead.

**Headline:** the framework is feature-rich and test-green, but carries
**credibility debt** — two shipped+documented capabilities are inert, and a
declared security control does nothing. Bigger empirical lift sits in the
unfinished Phase 1.5 compounding-intelligence work.

## 2. Priority tiers (evidence-anchored)

### Tier 0 — vision-pillar honesty (credibility-blocking, low effort)

| Lever | Evidence | Problem |
|---|---|---|
| `confidenceFloor` killswitch doubly inert | `packages/compose/src/killswitches/confidence-floor.ts:13-22` | Registers `harness.before('verify', …)` — `verify` is **not** in the Wave D phase-hook fire-set (only `bootstrap`/`think`/`act`/`complete`, Hot.md). Also reads `state.verifierScore`, not a real state field. Shipped, documented in `killswitches`/`composition-recipes` docs, **never fires**. |
| `IdentityService.authorize()` never called | zero calls in `packages/reasoning/src` + `packages/runtime/src`; declared at `permission-manager.ts:84` | Security pillar (Vision §7) is **aspirational**. `identity.Delegation` is scoped/revocable/audited by design but the kernel act path never enforces it. |

**Why Tier 0:** "every decision controllable, observable, auditable" + "Security"
are public vision claims. A documented dead killswitch and an unenforced
security control are the cheapest things to fix and the most expensive to be
caught shipping. Fix-or-unship; do not leave dead.

### Tier 1 — compounding intelligence (highest empirical lift)

| Lever | Evidence | Target |
|---|---|---|
| `experienceSummary` wire severed | `packages/reasoning/src/context/context-manager.ts:272` hardcodes `experienceSummary: undefined`; consumer already wired `adapter.ts:214` | Unblocks measurable M6/M10 progress in one change |
| M6 Skill persistence | North Star §6 Phase 1.5 | >70% cross-session recall (5–7d) |
| M7 Calibration consumers | North Star §6 Phase 1.5 | ≥8 active fields w/ lift (4–6d) |
| M8 Sub-agent delegation | North Star §6 Phase 1.5 (elevated) | ≥20% acc lift, ≥3-step tasks (3–5d) |
| M10 Memory multi-session | North Star §6 Phase 1.5 | >80% recall (4–6d) |
| M14 Self-evolution | North Star §6 Phase 1.5 (new) | ≥3pp lift on looping scenarios (4–6d) |

### Tier 2 — debt with own merit

- `AgentContract` → `BehavioralContract` collapse — both exported from
  `@reactive-agents/guardrails` (`agent-contract.ts`, `behavioral-contracts.ts`);
  minor + deprecated alias, not a hard rename. ~1d.

### Tier 3 — strategic, large effort

- **Phase E** — local-model engineering (qwen3 FC parser, calibration
  activation, tool-result paging). Delivers the "any model, any tier" claim.
- **Phase F** — one reproducible third-party benchmark (τ²-bench retail).
  **Largest external-credibility multiplier**; ≥2-week effort; gated on E.

## 3. Constraints (honor in any execution)

1. **N=3 corpus rule** (NS §7.1) — every mechanism change validated over 3 runs.
2. **Pruning Principle** (NS §9) — each new harness mechanism must document the
   model-capability assumption it encodes; IMPROVE-list items risk net-negative
   on frontier models.
3. **No new contracts / no LLM verify-of-verify** — agentic-team Conflicts #1/#3.
   Own-failure recovery is a deterministic FSM, never a parent-side LLM gate
   (would recreate the just-killed M3 retry loop).

## 4. Recommended next 3 units

| # | Unit | Effort | Validation gate |
|---|---|---|---|
| 1 | **Tier 0 honesty sweep** — fix-or-unship `confidenceFloor`; wire one `authorize()` seam in `act/` gated by Delegation-present, deny → existing `approvalGate()` | 2–3d | confidenceFloor acceptance test fires on a real phase **or** removed from registry+docs; authorize() unit test: Delegation deny → approvalGate; no new authority type |
| 2 | **Close `experienceSummary` wire** — populate from existing `synthesizeDebrief()` AAR at `context-manager.ts:272`; consumer `adapter.ts:214` already expects it | ~1d | `experienceSummary` non-undefined end-to-end; regression test; no new AAR type |
| 3 | **Phase 1.5 M6 skill persistence** — SQLite-backed, per-agent scope | 5–7d | >70% cross-session recall (NS §8.2); evidence artifact in `wiki/Research/Harness-Reports/` |

Units 1 and 2 are independent of N=3 (no behavioral mechanism change); unit 3
requires the corpus discipline.

## 4b. Verified scope corrections (post-investigation, 2026-05-19)

Source-level investigation of the three approved sub-units changed the
estimates. Recorded so the plan stays honest:

- **Killswitch honesty sweep — DONE. 3 of 6 killswitches were broken in
  shipped v0.11.1** (the "shipped + documented + dead" pattern was systemic,
  not isolated). Build unbroken first (`e8dc8b20` — HEAD DTS was red on a
  missing `softFail`; `main` could not publish).
  - `confidenceFloor` — **unshipped** (`c7fa29c2`). Doubly dead: `verify`
    phase never fired (only bootstrap/think/act/complete); `state.verifierScore`
    does not exist. Fixing needs a new verify hook + state aggregate
    (mechanism change, N=3-gated) → unship was the in-scope honest call.
  - `watchdog` — **fixed** (`035f4765`). Reset rode `tap('observation.tool-result')`,
    a tag with no runtime emit site → `lastProgress` froze at construction →
    aborted healthy long-running agents. Re-targeted to `after('act')`.
  - `requireApprovalFor` — **fixed** (`0460aaad`). Read non-existent
    `state.pendingToolCalls` (real: `state.meta.pendingNativeToolCalls`) →
    approver never invoked → a human-in-the-loop **safety** control that
    silently approved every tool call. Highest-severity of the three.
  - `budgetLimit` / `timeoutAfter` / `maxIterations` — verified sound (fire on
    live phases AND read real state: `ctx.state.tokens`, wall-clock,
    `ctx.iteration`).
  - Every broken killswitch had isolation tests that fed the buggy shape and
    false-passed. **Lesson: killswitch tests must use the real runtime state
    shape and a real fire path, not `collectPhaseHooks` + synthetic state.**
- **experienceSummary — MIS-SCOPED (not ~1d).** `materializeExperienceSummary()`
  (`llm-provider/src/calibration.ts:244`) is **never called at runtime** (tests
  only). `experience-store.ts:59 query()` exists but **no `ToolCallObservation`
  records are ever written**. `KernelInput` carries no experience field. So
  "wiring" `:272` = build the write→store→read→materialize→thread loop = the
  M6/M10 mechanism itself. Multi-day, N=3-gated. **Not a cheap fold-in.**
- **authorize() — MIS-SCOPED (not "one seam").** identity / reasoning / runtime
  have **zero cross-references**. Wiring needs: identity field on `KernelInput`,
  `IdentityService` into the kernel Effect R-channel, the `authorize()` call +
  `AuthorizationError` handling, and an architectural decision (does
  `packages/reasoning` take an identity dependency?). ~2–3d, crosses a package
  boundary. Honest cheap alternative: **unship the claim** (stop asserting
  delegation enforcement in docs/README until wired) — same fix-or-unship logic
  as confidenceFloor.

## 5. Open question (drives the execution unit)

**Tier 0 honesty first, or Tier 1 compounding-intelligence first?**
Both defensible: Tier 0 is small and protects public claims before any larger
work; Tier 1 has the bigger empirical lift but longer runway. The
`experienceSummary` wire (unit 2) is cheap enough to fold into either path.
