---
tags: [debt, burndown, planning, release-gate]
date: 2026-07-13
status: ACTIVE — the only active program (WIP limit = 1)
items: wiki/Architecture/DEBT-REGISTER.md
---

# Debt Burndown — sequence

**This plan holds NO item list.** The items live in [[../../Architecture/DEBT-REGISTER|DEBT-REGISTER]],
which is the single source of truth. This document holds only the ORDER and the RULES.
(13 plans rotted in July because each re-listed its own items and then drifted. Not again.)

## Rules (binding for every wave)

1. **WIP = 1.** One wave at a time. Nothing in wave N+1 starts until wave N is committed and its gate is green.
2. **Definition of done:** declaration + non-test writer + non-test reader + **a mutation that goes red**.
   Prose does not discharge debt. A wave is done when its register rows flip to PROVEN or are deleted.
3. **Delete is a first-class outcome.** "Wire it or delete it" — there is no third option, and no "defer"
   without an owner decision written into the register row.
4. **Boundary-first.** Fix the boundary, never the Nth site. If a fix is per-site, it is the wrong fix.
5. **Ratchet only decreases.** Every wave lowers a count in §1 of the register. A PR that raises one fails.
6. **v0.14 is already a breaking release** (3 withers removed). This is the free window to remove more.
   Removing a lying API is cheaper and more honest than implementing it under time pressure.

---

## Wave 0 — MAKE THE SIGNAL TRUSTWORTHY  ⟵ blocking, must be first

*Why first: every later wave's "done" depends on red/green. Today red means nothing (main is already red),
the doc gate can silence itself, and the bench scores "didn't crash" as a pass. Fix the instruments before
using them. This is the cheapest wave and it unblocks all the others.*

- Fix the 3 environment-independent failures (`.withBudget()` ×2 stale assertion; **WS-5 silent-swallow
  ceiling — a breached ratchet**). Main goes green. Register §1 "failing tests" → 0.
- Wire the two gates that exist but aren't in CI: `docs:examples:check` and `metrics:check`.
- **Delete `--fix-fragments`** (it silences drift by marking failing blocks skipped) and ratchet the skip
  count (283/632 today; may only fall).
- Fix the doc gate's parse-error bug (one bad snippet suppresses semantic checking program-wide).

**Gate:** CI green on a bare `bun test`; the doc gate fails the build when an example drifts.

---

## Wave 1 — STOP THE LIES  (parallelizable; no architecture)

*Two piles. Everything in P0/P0b of the register is one or the other.*

**1a — Delete the claim** (fast, zero risk): every published benchmark number comes down (the instrument
that made them scored "didn't crash" as a pass; 86.7%/+80pp trace to a 15-case unit fixture). Fix the counts
(8,247/1,045; 34 published), the "27-signal" router (it's 4 factors), the 6-vs-8 provider contradiction,
`benchmark-report.json` (`runs: []`), and rewrite CHANGELOG `[Unreleased]` (~40 landed changes, incl.
meta-tools going opt-in).

**1b — Fix or remove the API** (safety first): `.withReactiveIntelligence` autonomy/constraints
(**SAFETY — a no-op safety switch**), the calibration regression (`adapter.ts:322` discards the tier adapter),
`.withFallbacks`, `.withCalibration("skip")`, the provide-and-forget layers, `.withMemoryConsolidation`,
`.withVerificationStep`, `.withProgressCheckpoint`, bare `.withSkills`, and `errors.ts` (it emits
syntactically invalid TypeScript as a suggestion).

**Gate:** every P0 row is PROVEN or gone. No shipped API promises what it doesn't do.

---

## Wave 2 — THE SPINE  (the real engineering)

The ~200 findings are **7 boundaries** (register §3). Fix them in dependency order:

1. **B1 `executeToolAndObserve`** — mint the ledger + enforce the tool-policy gate at the shared choke point.
   *Closes 2 columns × 4 strategies.* Also closes P0-4 (forbidden tools actually enforced).
2. **B2 `terminatedBy` forward** — one line per strategy. *Closes abstention + goalAchieved across 8 rows.*
3. **B7 `requirement` ledger writers** — mint at contract-compile and at the gates. Two live readers are
   waiting on `[]` today; the meta-loop's requirement lifecycle is fiction until this lands.
4. **B4 kernel→strategy projection** — widen the 2-field `ReActKernelResult.metadata` (or route through
   CompletionEnvelope). Rescues the verifier verdict; retires most of the 19 KernelMeta orphans.
5. **B5 EventBus→stream projection** — `PhaseStarted`/`PhaseCompleted` (same bug as `61f05489`).
6. **B3 builder-seam test lane** — one behavioral test per wither. *Converts 30 SILENT → PROVEN.*
   Largest single quality win in the repo; highly parallelizable.

**Gate:** each boundary ships with a mutation test — cut the boundary, something goes red.

---

## Wave 3 — DELETE

`packages/orchestration` (935 LOC, zero consumers, `.withOrchestration()` is a literal no-op), the dead
ledger kinds, the 7 dead `RA_*` flags **and the two ablation benches they corrupt** (both currently measure
pure noise), `packages/scenarios` (merge), the orphan builder fields, and whatever B4 didn't rescue.

**Gate:** register §4 empty. LOC goes down.

---

## Wave 4 — MAKE IT PERMANENT (the disease dies here)

- **Derive declarations FROM implementations** — `type LedgerKind = keyof typeof emitters`; the adapter-hook
  union from the dispatch table; receipt fields from the projector map. **An orphan becomes a compile error**,
  not an audit finding. This retires the class; it is the highest-leverage engineering on this page.
- **`scripts/check-orphans.sh`** for the residue that can't be typed (env flags, cross-package projections).
  Rides the existing auto-globbed CI script lane, so it cannot itself be orphaned. Ratcheted baseline.
- Its own mutation test (delete a known writer → detector goes red), or it's more theater.

---

## Wave 5 — RE-EARN THE NUMBERS

Only now, on a trustworthy instrument: run the real bench, publish receipts, restate any claim we can back.
Anything we can't back stays deleted. (Self-built benches are internal tooling, not public claims.)

## Wave 6 — CONSOLIDATE, THEN SHIP

Docs + memory collapse onto the true state (last, so we canonize truth instead of the current false signals).
Then cut v0.14.

---

## Why this order

Wave 0 makes the thermometer work. Wave 1 stops harming users and is 90% deletion (cheap). Wave 2 is the only
expensive wave and it's 7 fixes, not 200. Wave 3 shrinks the surface we must maintain. Wave 4 ensures we never
run this audit again. Waves 5–6 turn a truthful codebase into a truthful release.

**Do not reorder.** Every earlier attempt started at Wave 2 or 5 with a broken instrument, and that is the
whole story of July.
