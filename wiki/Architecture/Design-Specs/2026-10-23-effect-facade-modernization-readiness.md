---
type: design-spec
status: active
created: 2026-10-23
tags: [phase-2, effect, error-algebra, semver, readiness, quality-program]
---

# Effect-Facade Modernization — Phase-2 Readiness Checkpoint

**Program deliverable:** Task 15 of the Quality & Scalability Program
(`wiki/Planning/Implementation-Plans/2026-10-22-quality-scalability-program.md`).
This is a **decision document, not a design**: it records that Phase 2's stated
preconditions are met, inventories the remaining blast radius, lists the
service-tag candidates, and makes the semver call. It changes no code.

## 1. Preconditions — MET

| Precondition | Evidence |
|---|---|
| All four D1 facade families Effect-native at the module boundary | skills (#274), judgment (#276), durable (#278), run-task (#279). One Promise boundary per family, in the class shell, through the shared `agent/run-facade-effect.ts` bridge (`runFacadeEffect`) |
| Structural debt cleared | Every >=1,500-LOC file in runtime+reasoning decomposed or pinned shells: reactive-agent 3,303→2,344 ceiling, builder 3,348→2,222, think 2,445→676, execution-engine 1,976→991, arbitrator 1,970→850, runner+iterate-pass 1,903/1,896→953/1,266 |
| Mechanical locks enforce direction, not memory | CI lane of 24 `check-*.sh` invariant scripts incl. file-size ceiling ledger (24 entries, shrink-only) + twin error pools: `new Error(` = **287** (post-D3 tranche 1) and `instanceof *Error` = **129** (shrink-only, deliberate-edit law) |
| Seam coverage | Direct-import behavioral pins for all 21 original decomposition modules + shell-path rejection-VALUE identity pins for every facade family; RED-on-cut proven per file |
| Error-algebra template proven | trace tranche 1 (#284): `Data.TaggedError` classes riding a package `errors.ts`, byte-identical messages, `_tag`-dispatch consumers, ratchet ridden down 300→287 with an attributed ledger edit |

## 2. Per-family Effect-seam inventory (the swap surface Phase 2 builds on)

| Family | Module boundary | R channel | E channel | Promise boundary | Identity notes |
|---|---|---|---|---|---|
| skills (`agent/skills-facade.ts`) | Effect-typed | `<never,never>` (T13) | never + 2 deliberate arms | shell `runFacadeEffect` | raw arms proven by seam |
| judgment (`agent/judgment-facade.ts`) | Effect-typed | `<never,never>` | 6 guard arms raw | shell + per-method preserved inner boundaries | BACKEND failures reach callers as the inner `runPromise`'s wrapper shape — preserved by design, consumer-test-proven (#276), pinned tripwire |
| durable (`agent/durable-facade.ts`) | Effect-typed | `<never,never>` | 8 deliberate arms raw | shell | 17/17 inner boundaries preserved (all caller-observable); `getDurableInfo` stays sync (accepted deviation) |
| run-task (`agent/run-task-effect.ts`) | seam already Effect since #217 | `<unknown,never>` (forwards to bridge) | AgentResult/Error | shell | 2 sections folded via shared bridge with per-arm discard proofs; 3 sites KEPT under STOP rule |
| execute-event / gateway-driver / gateway-tick / gateway-runner | deps runtime fields | `<never,never>` (3), `<unknown,never>` (runner, forwarding targets) | per-module | n/a (not facade) | runner casts removed (#283); `BootstrapDeps`/`ChatManagerFactoryDeps` params still `<unknown,unknown>` — tighten those next, then runner field reaches `<never,never>` |
| class shell (`reactive-agent.ts:178`) | PUBLIC `runtime: ManagedRuntime<any, never>` | — | — | all delegates | the last declared `any` in the family; Phase-2 prewiring replaces it |

Empirical findings locked in for the phase (from #274/#276 audits): on
effect@3.19, `ManagedRuntime.runPromise` FiberFailure-wraps **typed failures
as well as defects** — the bridge's `catchAllDefect -> Either -> Promise.reject(Left)`
fold is the only identity-safe shape; `Effect.sync`/`Effect.promise` carry
incidental throws/rejects as defects holding the ORIGINAL value; the wrapper's
cause identity lives in `.name` (`String(err)` carries it).

## 3. Remaining blast radius

**Producers (`new Error(` pool = 287):** site-by-site dispositions at
`wiki/Research/Audit-Reports-2026-10-22/d3-error-site-classification.md`.
Tranche 2 is audit-verified ready: **diagnose 10** (message-regex consumers +
`.message`-only renderer, both checked) and **replay 9** — except replay's 7
`Effect.die` DEFECT values, which need a Phase-2 decision on tagging the
defect channel (flagged, not silently converted). The public-identity pools
(tools 64, runtime 54, llm-provider 16, testing 18, reasoning 15) are NOT
touchable without the semver decision in §5.

**Consumers (`instanceof *Error` = 129 occurrences / 128 lines):** full site
list at `wiki/Research/Audit-Reports-2026-10-22/instanceof-error-inventory.md`;
distribution by package (parsed from the full list, total = 129): tools 38,
reasoning 22, runtime 22, benchmarks 15, judgment 12, vue 5, ui-core 3, then
core / observability / react / svelte / create-reactive-agent at 2 each. These are the public rejection-identity
dependencies: each must be individually audited (framework-internal catches
may flip to `_tag` dispatch freely; sites on public rejection paths are the
conversion cost).

**Type-surface holds remaining:** (a) the `runFacadeEffect` bridge param
(`<any,never>`, family-generic by design); (b) the class's public `runtime`
field; (c) the two forwarding-target deps types (§2 row 5); (d) `runtime.ts`'s
34-LOC `parseJsonLoose` copy — unified only with a message-text proof
(deferred in #283, low priority).

**Docs/examples surface: zero.** No page in `apps/docs/src/content` or
`apps/examples/src` references `makeSkillsFacade` / `makeJudgmentFacade` /
`makeDurableFacade` / `buildRunTaskEffect` / `runFacadeEffect` (grep-verified
2026-10-23). The facade factory functions are NOT re-exported from
`packages/runtime/src/index.ts` — the public API surface consumed by docs is
the builder + `ReactiveAgent` class, whose delegate signatures every D1
conversion kept byte-identical.

## 4. Service-tag candidates (D4 prewiring shortlist)

1. **Replace inline structural tags with the real service Context.Tags.**
   `skills-facade`/`durable-facade` resolve `SkillStoreService` etc. through
   loose inline `Context.GenericTag<{ listAll: ... any[] }>("SkillStoreService")`
   shapes (key-interned against the real tag — deliberate carried debt from
   #217). Phase 2: depend on the owning package's Tag with its precise shape.
2. **Declare the runtime layer per agent.** `ReactiveAgent` holds
   `ManagedRuntime<any, never>`; with (1) landed, the class can carry a
   declared `R` union and the bridge's `<any, never>` collapses to `<R, never>`
   generic — this is the change that finally closes the D1 leak list.
3. **Tighten `BootstrapDeps`/`ChatManagerFactoryDeps` runtime params** to the
   honest R; `gateway-runner`'s `<unknown, never>` field then narrows to
   `<never, never>` (last module-level holdout, #283 note).
4. **Tranche-continue the error algebra** per §3: diagnose/replay next
   (template = trace #284), public-identity packages only after §5.
5. **`withers` BuilderState** now drift-guarded (#283) — the class-field/
   view-union restructure is unblocked but should ride its own ablation.

## 5. Semver decision

**Call: the shipped program requires only a MINOR (lockstep 0.x bump).**
Justification, per surface class:

- **Module-boundary signatures** (facade factories now return `Effect`): NOT
  part of the package public API — `index.ts` exports unchanged; grep-verified
  zero docs/examples references (§3). Internal refactor.
- **Class delegates** (`agent.skills()/judge()/run()/...`): Promise signatures
  byte-identical; resolved values identical.
- **Rejection VALUE shape** (deliberate arms): D1 raw-vs-wrapped delta
  documented per family. A user who branched on `e instanceof FiberFailureImpl`
  at a facade rejection would see a behavior change — but that surface was
  never documented, and `Error`-truth still holds (the wrapper IS an Error
  instance; raw arms are now plain Errors). Risk assessed: low; CHANGELOG
  note required in the release cut.
- **New `throw` classes** (trace `RationaleValidationError`,
  `TraceStorageError`): the ONLY user-visible text delta is
  `ErrorSwallowed.tag` `"Error" -> "TraceStorageError"` (telemetry discriminator,
  no consumer asserted it).
- **If Phase 2 later flips PUBLIC delegate return types** (Promise -> Effect,
  `ReactiveAgent.runtime` typed union): that is a MAJOR (or a codemod'd
  deprecation window) — explicitly deferred; nothing shipped here forces it.

## 6. Gates for Phase 2 (carried forward, non-negotiable)

- **Ablation lift rule + >=2-tier probe before ANY default-on mechanism**
  (north-star §7; already killed `.withAdaptiveHarness()` default-on).
- Every conversion tranche: existing test + `_tag` assertion per site;
  attributed ratchet baseline edit; suites at exact baselines; RED-on-cut on
  new pins; `as any`/`as unknown as` net-zero against the flat ceiling.
- Anchor-audit before any decomposition brief (`grep -l <file> scripts/check-*.sh`
  FIRST; v26b) — five bundles ran this protocol without a single regression.

## 7. Continuation roadmap (what happens when, and who decides)

| Work | Trigger | Decider |
|---|---|---|
| D3 tranche 2: diagnose (10) + replay (2 value sites) | anytime; template proven | parent-direct / general dispatch (no warden table entry) |
| Replay's 7 defect-value tagging | Phase-2 design session | TEAM decision (§3) |
| D4 service-tag prewiring (§4 items 1-3) | after §5 public-rejection policy settled | architecture session |
| Public-identity error conversion (tools/runtime/llm-provider/reasoning/testing) | Phase 2 proper | owner (semver-gated) |
| Seam breadth #281; giants #265-#268 | backlog cadence | execute-backlog loop |

**Status: READY.** All preconditions for the effect-facade modernization
phase are met, the blast radius is inventoried site-by-site, the template
conversions have landed under mechanical locks, and the semver call is
recorded above.
