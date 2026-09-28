---
type: debrief
status: completed
created: 2026-09-28
tags: [execute-backlog, bundle, runtime-subscribe-silent-fallback, runtime, subscribe, dead-code, retro]
---

# Execution Retro: runtime-subscribe-silent-fallback

Date: 2026-09-28
Budget: 60 min | Actual: ~40 min
Branch: `bundle/runtime-subscribe-silent-fallback` → merged to local `dev`
Commit: `31fe0689` (code+test)

## Outcomes

- Issues closed: **#224** (resolved as a root-cause falsification + dead-code removal, not the suggested fix)
- Issues descoped: none (singleton bundle)
- Net test delta: runtime **+4 tests** (1635 → 1639 pass; same 2 pre-existing #214 ceiling fails)
- Net LOC delta: +106 / −6 (96-line test + the 16-line src cleanup)
- Follow-up (pre-existing, filed earlier): **#230**

## What worked

- **Probe before fix falsified the issue's premise.** #224 claimed `subscribe()` "silently falls back to a no-op on EventBus resolution failure." A 6-line bun probe of the exact pattern with no EventBus supplied printed `REJECTED: (FiberFailure) Error: Service not found: EventBus` — not a resolved no-op. Combined with the type facts (`EventBus.subscribe/on` are `Effect<() => void, never>`, missing `Context.Tag` service = defect) and the provisioning fact (`EventBus` is a mandatory layer in `createRuntime`/`createLightRuntime`), the `catchAll` no-ops are provably **dead code**. The root fix is deletion + an explicit invariant comment — *not* wiring `emitErrorSwallowed` into a branch that cannot execute.
- **Cheap, decisive reconnaissance.** Reading the service tag signature, the provisioning site, and one probe replaced what could have been an hour of speculative hardening. The `grep` for sibling occurrences confined the pattern to the two cited sites.
- **Existing `error-reporting.test.ts` was a real subscribe regression net** (7 tests). The new test extended rather than duplicated: catch-all delivery, post-unsubscribe silence, tag-filtered subscribe, and `agent.on` parity — all end-to-end through a built agent + real run.
- **Removing the dead branch made a nearby cast redundant**, and the warden removed it only after typecheck confirmed it was safe (cleaner diff, still 0 `as unknown as` sites).

## What didn't

- **The issue's stated fix direction was wrong, and executing it literally would have added unreachable code.** The team-ownership contract's SCAN "stale-premise check" covers *drifted* mechanisms; this was a step further — the claimed *behavior* ("silently falls back") never existed. The skill's dead-code sweep rule handled it, but the skill doesn't currently name "premise may be behaviorally false, not just stale — prove reachability before fixing a swallow report."
- **The runtime package's baseline is not clean** (2 pre-existing #214 cast-ceiling fails). Handled as known-baseline (documented, not blocking), per the skill's baseline protocol, but it means "runtime suite green" is never literally true until #214 lands.

## Skill improvements (apply on next pass)

1. **Prove reachability before fixing any "silent swallow/fallback" report (added to SCAN).** For an issue alleging a swallowed error or silent fallback, establish three facts first: (a) the effect's **error channel** (a `catchAll` over a `never`-error effect is dead); (b) whether the failure would be a **typed error or a defect** (`catchAll` catches the former only; missing `Context.Tag` = defect); (c) whether the **precondition is reachable at all** (is the service optional or mandatory?). If the branch is unreachable, the correct root fix is deletion + invariant documentation, and the issue should be closed as "premise falsified / dead code removed" — not by wiring observability into dead code. Include a one-line probe in the SCAN output.
2. **Re-scope phrasing for falsified-premise issues.** Extend the stale-premise rule: when the claimed *behavior* is disproven (not merely drifted), record the probe evidence on the issue and re-scope the bundle deliverable to the honest root fix, rather than dropping the issue or implementing against the false description.
3. **Dead-branch removal cast sweep** (extends the existing cast-removal follow-through): after deleting an unreachable branch, re-check nearby plain `as` casts for redundancy and remove them if typecheck passes — reduces review noise without touching the `as unknown as` ratchet.

## Process inflation guard (HS-18/22/31 lesson)

Inverted case: the issue **overstated** a defect that did not exist (a "silent no-op" that is provably unreachable). Executing its suggested fix (`emitErrorSwallowed` at the fallback) would have shipped dead code masquerading as a fix. The probe-before-fix rule added here is the generalized guard against executing on a confident-but-false mechanism claim.
