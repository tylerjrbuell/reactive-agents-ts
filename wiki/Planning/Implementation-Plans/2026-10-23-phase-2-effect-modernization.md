---
type: plan
status: active
created: 2026-10-23
tags: [phase-2, effect, error-algebra, dependency-injection, quality-program]
---

# Phase 2 — Effect-Facade Modernization

**Predecessor:** Quality & Scalability Program (complete 2026-10-23, tasks 1-15).
**Authority:** `wiki/Architecture/Design-Specs/2026-10-23-effect-facade-modernization-readiness.md`
(the readiness doc - blast radius, seam inventory, service-tag shortlist, semver call).
This plan sequences that readiness into executing tranches. **Living tracker** -
update the Execution Log in place per task, same format as the predecessor.

## Impact honesty (read first)

Phase 2 is deliberately **near-invisible by default**: every pre-gated tranche
preserves resolved values, event sequences, and error message TEXT byte-for-byte
(the Phase-1 verification law carries forward). The perceivable payoff is
engineering-rate and reliability, not behavior - see section 6 of the readiness
doc before writing any claim about this program in user-facing material. The
ONE tranche that changes what users/agents see (P2-T5, public surface flips) is
major-version-gated and may be declined; Phases 2 proceeds fine without it.
**Do not sell T1-T4 as user-facing features.**

## Tranches (execution order)

### P2-T1: D3 error tagging, tranche 2 — diagnose + replay value sites

- Template: trace tranche 1 (PR #284) - audit CONSUMER flows first, byte-identical
  messages, `_tag` + message anchors in the covering test, attributed ratchet edit
  in the same commit, per-site disposition table appended to
  `wiki/Research/Audit-Reports-2026-10-22/d3-error-site-classification.md`.
- Scope: diagnose 10 sites (message-regex consumers + `.message`-only CLI renderer,
  audit-verified in the map); replay 2 PRODUCED-in-value sites.
- NOT in scope: replay's 7 `Effect.die` defect values -> blocked on P2-D1 below.
- Expected ledger: ratchet 287 -> ~275. No new test FILES preferred (extend
  in place; new files => `metrics:sync-readme` same PR, v26c).
- Parent-direct or general dispatch (no warden-table package). Warden routing
  table applies only if tools/runtime packages appear (they must not here).

### P2-T2: D4 step 1 — real service tags in facade deps

- Replace the five loose inline `Context.GenericTag<any-shape>("SkillStoreService")`
  etc. keys (skills/durable/judgment facades; carried #217 debt) with the OWNING
  package's real tag where one exists; where a service has no formal Tag (inline
  structural keys), first-class it in the owning package and export from index.
- Behavior-neutral: key resolution is identity-matched at runtime; tsc + exact
  baselines + seam suites prove it. Ratchets net-zero (no `as` additions -
  structural tags may need honest generic work in tests; Reflect/typeof first).
- Verify: tsc runtime + owning packages, downstream 29/29, runtime suite exact,
  seams green. Route: runtime-warden (+ owner-package warden if the tag moves).

### P2-T3: D4 step 2 — honest runtime typings up the chain

- `BootstrapDeps` + `ChatManagerFactoryDeps` `runtime:` params -> precise R from
  the effects they actually run (mirror of Task 13's method); gateway-runner's
  deps field then narrows `<unknown,never>` -> `<never,never>`.
- STOP condition: any effect whose consumer flow requires keeping a wide param -
  leave, document (Task 13 precedent).
- Same gates. Route: runtime-warden.

### P2-T4: seam breadth + giants (continuation of filed backlog, same protocol)

- #281 (direct-import pins for the 35 Task 4/7/9 modules - highest-value seams
  only) and #265-#268 (four giants, anchor-audit protocol). Cadence items, not
  blockers for anything; run via the execute-backlog loop between gates.

### P2-T5: GATED - public surface modernization (MAJOR decision)

Three sub-decisions, each requires an explicit owner call BEFORE any code:
1. **Public delegate Promise -> Effect returns** (agent.run/skills/judge/...):
   the biggest integrator win (typed cancellation, rejection unions, composable
   streams); also the biggest codemod. Deferred per readiness doc 5.
2. **`ReactiveAgent.runtime` public field** `ManagedRuntime<any, never>` -> declared
   R union (closes the last type-surface hold from inside the class).
3. **Error-type upgrades at public rejection surfaces** (e.g. the 6 deliberate
   judgment/durable guard arms): message-text-compatible but identity-changing
   for consumers who catch-and-branch on name/message patterns.

Gate for ALL THREE: major-version window + deprecation notes + codemod script +
consumer-test matrix at apps/examples + docs tier. Until then P2-T5 is a
decision memo, not code.

## Decision gates (owner input needed, blocking only their tranche)

- **P2-D1 (blocks part of T1):** Do `Data.TaggedError`s ride the DEFECT channel
  (`Effect.die`) at sites whose observable today is a Cause-wrapped raw Error?
  Options: (a) die-with-tagged-value (String(err)/.name changes; needs
  ErrorSwallowed.tag audit + possibly a new pin style), (b) fold to error
  channel at the boundary (changes the delivered value at catchAll sites - the
  D1 lesson: value identity is what callers see), (c) leave the 7 sites.
  Recommend (c) default, (a) with explicit audit if the pool target demands it.
- **P2-D2 (gates T5):** semver window for the public flips above. Recommendation
  already recorded: program ships minors; T5 waits for a major or a codemod'd
  deprecation cycle. Needs owner timing call, not necessarily yes.
- **P2-D3 (policy):** telemetry discriminator renames (the trace tranche's
  `ErrorSwallowed.tag "Error" -> "TraceStorageError"` delta): accepted per-site
  so far; codify "no consumer asserts old tag string" as the rule and have the
  cortex UI's dashboards checked before future renames.

## Verification protocol (inherited, non-negotiable)

Exact baselines per package suite (record pristine first); twin ratchets move
ONLY via attributed deliberate edits; file-size ledger; cast ceiling flat; tsc
rc=0 + downstream typecheck for touched surfaces; red-on-cut for every new pin;
sequential doc-flip batches with anchors re-read from disk (v26e); commit
messages with code literals via -F (v26e); PR -> CI 5/5 -> merge dev -> closeout
(tracker Execution Log + register + pilot log when warden-routed).

## Execution Log

- 2026-10-23: Plan created from the readiness checkpoint (Phase-1 program
  complete) Tranche + decision issues filed: #285 (P2-T1 diagnose/replay-value), #286
  (P2-T2/T3 prewiring), #287 (P2-D1 defect-channel rfc), #288 (P2-D2 semver-window rfc). T1-T3 pre-wired: all audits exist (classification map, Task 13
  variance findings). T5 and P2-D1 are owner decisions; everything else can run
  in warden/parent-direct cadence. Awaiting go.
