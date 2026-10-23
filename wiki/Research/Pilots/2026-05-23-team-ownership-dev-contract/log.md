---
type: pilot-log
status: superseded (2026-07-31 wiki-lint cleanup — untouched since creation, not in current active-program list per .agents/MEMORY.md)
created: 2026-05-23
---

# Pilot Log — Team-Ownership Dev Contract

> Append-only. One block per logical kernel/* task. Format below. Summary section appended on 2026-06-15.

## Entry format

```yaml
- task: <short slug>
  date: YYYY-MM-DD
  warden: kernel-warden | provider-warden | tools-warden | memory-warden | runtime-warden | compose-warden | harness-warden | ablation-warden | release-warden | debrief-scribe | <main if bypass>
  routed: warden | main | bypass
  bypass-reason: <if bypass>
  commits: <count>                       # first-attempt = 1
  agent-spawns: <count>                  # for re-spawn metric
  tokens-est: <number from rtk gain>
  regression-prevented: <description | none>
  notes: <one line>
```

## Baseline (computed 2026-05-23)

> Run on day 1 of Phase 1. Compute first-attempt-completion and token-cost over the last 10 commits across the pilot's combined scope (all warden authority manifests: kernel + llm-provider + tools + memory + runtime + compose + cross-cutting), so the baseline matches the aggregate metric used in Phase 2 evaluation.

| Metric | Value |
|---|---|
| First-attempt completion rate | TBD-day-1 |
| Avg tokens / task | TBD-day-1 |
| Sample tasks (10) | TBD-day-1 |

## Entries

```yaml
- task: hs-122-skill-persistence-wire
  date: 2026-05-23
  warden: runtime-warden
  routed: warden
  commits: 1  # 44e4fbcf
  agent-spawns: 1
  tokens-est: ~95K
  regression-prevented: mission-brief-pseudocode-contradiction (warden caught `?? options.enableMemory` contradicted "no force-enable without memory" policy; chose `enableMemory && sp !== false` instead via advisor consult)
  notes: >
    Single runtime-warden dispatch wired SkillStoreServiceLive into runtime
    layer composition. Layer existed at packages/memory/services/skill-store.ts:73
    + exported via memory/index.ts:157 but had ZERO runtime consumer — classic
    North Star §9 anti-scaffold. Activates M6 IMPROVE → KEEP graduation: skill
    stored in session A is recoverable in session B via shared dbPath
    (test g cross-session recall). Side effect: HS-116 skill-activate 🟡 UNFIRED
    variant becomes reachable for next corpus sweep. Warden's autonomous
    judgments: (a) advisor-driven correction of mission-brief gating condition,
    (b) mirror SessionStoreLive precedent exactly for wire pattern, (c) test
    suite covers all four (enableMemory × skillPersistence) gate cells.
    7 new tests, 817 → 824, 0 fail. Typecheck zero new errors (pre-existing
    focusedTools + ExecutionContext flagged via git-stash ablation).
  evidence-anchors:
    - packages/runtime/src/runtime.ts:16 (SkillStoreServiceLive import)
    - packages/runtime/src/runtime.ts:713-741 (RuntimeOptions.skillPersistence)
    - packages/runtime/src/runtime.ts:1372-1383 (wire block)
    - packages/runtime/src/builder.ts:817-839 (.withSkillPersistence chainable)
    - packages/runtime/src/builder/build-effect/runtime-construction.ts:113,354 (forward)
    - packages/runtime/src/__tests__/builder-with-skill-persistence.test.ts (7 tests)
    - bun test packages/runtime 824 pass / 1 skip (was 817; +7)

- task: hs-115-required-tool-nomination
  date: 2026-05-23
  warden: kernel-warden
  routed: warden
  commits: 1  # 9d7bb884
  agent-spawns: 1
  tokens-est: ~81K
  regression-prevented: phantom-tool-nominations (only availableTools names emitted); guard-test partial-state breakage caught via defensive optional-chain
  notes: >
    Single kernel-warden dispatch closed Audit G-E + anti-scaffolds F4+F5. Pure
    regex/keyword nominator (5 semantic categories: math, search, http, file-write,
    file-read) seeded into state.meta.nominatedTools at runner comprehend boundary.
    Same-commit consumer: act/guard.ts effectiveRequiredTools(state, input) fallback
    fires when input.requiredTools empty AND nomination confidence ≥0.7. North Star §9
    discipline preserved — emit+consumer in single commit, no scaffold-without-caller.
    Phantom-name guard verified by test ('does not emit a name absent from availableTools').
    17 new tests added (8 nominator + 3 guard-integration + 6 supporting). Suite
    1240 → 1257, 0 fail. LOC src 262 / 300 cap. Confidence 0.88. Authority bounds
    honored zero cross-package edits.
  evidence-anchors:
    - packages/reasoning/src/kernel/capabilities/comprehend/task-intent.ts:330 (nominateRequiredTools)
    - packages/reasoning/src/kernel/capabilities/comprehend/task-intent.ts:210 (NominatedTool type)
    - packages/reasoning/src/kernel/state/kernel-state.ts:123 (KernelMeta.nominatedTools)
    - packages/reasoning/src/kernel/loop/runner.ts:550-564 (runner seed)
    - packages/reasoning/src/kernel/capabilities/act/guard.ts:45 (effectiveRequiredTools helper)
    - packages/reasoning/src/kernel/capabilities/act/guard.ts:130,197 (guard fallback sites)
    - packages/reasoning/tests/kernel/capabilities/comprehend/task-intent.test.ts (17 tests)
    - bun test packages/reasoning 1257/1257 (was 1240; +17)

- task: hs-116-controller-decision-classification
  date: 2026-05-23
  warden: none
  routed: main
  bypass-reason: packages/reactive-intelligence/ not in warden authority table — main-thread is canonical owner per pilot doctrine.
  commits: 1  # 2f59bd50
  agent-spawns: 0
  tokens-est: ~28K (analysis greps + edits)
  regression-prevented: silent-public-api-promotion-of-unfired-variants
  notes: >
    Documentation + coverage-guard disposition. 13 ControllerDecision
    variants classified: 5 ACTIVE, 4 UNFIRED (handler registered, no
    corpus firing), 4 UNWIRED (evaluator exists, no handler). Each
    UNFIRED/UNWIRED variant @experimental-tagged in JSDoc + 5-case
    regression test pins current state to catch drift. No code deleted;
    audit Tier 1 mandate was "audit + prune/doc" not "delete now".
    Followups filed: corpus expansion (UNFIRED) + handler registration
    decisions (UNWIRED).
  evidence-anchors:
    - packages/reactive-intelligence/src/types.ts:167-243 (classified union)
    - packages/reactive-intelligence/tests/controller/decision-coverage.test.ts (5 tests)
    - bun test packages/reactive-intelligence 469/471 pass (was 464; +5)

- task: hs-129-recall-capability-seam-phase1
  date: 2026-05-23
  warden: kernel-warden
  routed: warden
  commits: 1  # 8cbb1ed9
  agent-spawns: 1
  tokens-est: ~67K
  regression-prevented: forkDaemon-misapplication (advisor-caught divergence)
  notes: >
    Single kernel-warden dispatch shipped Phase 1 SEAM mirroring HS-120
    learn/ pattern. Key divergence: recall uses plain `yield*` not
    Effect.forkDaemon — recall returns values consumed in-iter (forking
    would leave per-iter locals empty), learn fires fire-and-forget.
    Warden caught this via advisor consultation, applied correctly, +
    inline-documented rationale. Pilot-positive: warden autonomous
    judgment + correct deviation from precedent + traceable evidence.
    2 of 3 methods wired (recallMemoryContext + findSkills); loadProfile
    JSDoc'd as Phase 2 runtime-warden seam (no caller this commit by
    design — Phase 2 first consumer).
  evidence-anchors:
    - packages/reasoning/src/kernel/capabilities/recall/recall-service.ts:1-202 (3-method tag + Noop)
    - packages/reasoning/src/kernel/loop/runner.ts:694-738 (iter-start wire)
    - packages/reasoning/src/kernel/capabilities/recall/recall-service.test.ts (7 tests)
    - bun test packages/reasoning 1240/1240 (was 1233; +7 new)

- task: hs-120-learn-capability-seam-phase1
  date: 2026-05-23
  warden: kernel-warden
  routed: warden
  commits: 1  # a8dfc581
  agent-spawns: 1
  tokens-est: ~75K
  regression-prevented: forkDaemon-wraps-slow-writers (blocks-hot-path-risk)
  notes: >
    Single kernel-warden dispatch shipped Phase 1 SEAM only — directory
    + Context.Tag service + NoopLearningPipelineLayer + runner wire +
    4 co-located tests. Phase 2 (actual writes) deferred to follow-up
    dispatches per audit Tier 1 plan. Warden's autonomous decisions:
    (a) forkDaemon-wrap user writers (matches tool-execution.ts:526
    precedent for memory writes), (b) learn-specific delta cursors
    (avoid coupling with loop-detection's prevStepCount), (c) class-style
    Context.Tag (mirrors PromptServiceTag canonical pattern). All 5
    load-bearing invariants preserved.
  evidence-anchors:
    - packages/reasoning/src/kernel/capabilities/learn/learning-pipeline.ts:98-103 (Context.Tag)
    - packages/reasoning/src/kernel/capabilities/learn/learning-pipeline.ts:116-119 (NoopLayer)
    - packages/reasoning/src/kernel/loop/runner.ts:1494-1525 (forkDaemon write site)
    - packages/reasoning/src/kernel/capabilities/learn/learning-pipeline.test.ts (4 tests)
    - bun test packages/reasoning 1233/1233 (was 1229; +4 new)

- task: hs-128-budget-signal-arbitrator
  date: 2026-05-23
  warden: kernel-warden,runtime-warden
  routed: warden+main
  commits: 1  # 3db49f4a
  agent-spawns: 2  # kernel-warden + runtime-warden
  tokens-est: ~340K (provider runs combined)
  regression-prevented: side-channel-vs-canonical-termination
  notes: >
    Multi-warden coordinated landing. kernel-warden shipped arbitrator
    pre-guard + KernelInput type + runner seed + diagnostics emit
    + 17 co-located regression tests (confidence 0.85, +553 LOC, over
    ~200 LOC budget but justified by JSDoc heavy production helper).
    runtime-warden shipped .withBudget() builder + RuntimeOptions +
    config schema + 6 builder tests (status=partial-shipped, flagged
    strategy-bridge as out-of-authority FU). Main-thread completed:
    AgentEvent schema variant in core/event-bus.ts, StrategyFn input
    type, ReasoningService.execute params, ReactiveInput + DirectInput
    + kernelInput pass-through. End-to-end activation path now
    reaches Arbitrator pre-guard. Pilot data: 2 wardens both honored
    authority bounds, zero out-of-scope edits, zero retries; both
    flagged correct followups including kernel-warden's accurate
    pre-existing-runtime-error ablation note (FU-5).
  evidence-anchors:
    - packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts:501 (BudgetLimits type)
    - packages/reasoning/src/kernel/capabilities/decide/arbitrator.budget.test.ts (17 tests)
    - packages/runtime/src/builder.ts withBudget chainable method
    - packages/runtime/src/__tests__/builder-with-budget.test.ts (6 tests)
    - packages/core/src/services/event-bus.ts:1060+ BudgetSignalCollectedEmitted
    - bun test packages/reasoning 1229/1229 + packages/runtime 817 pass

- task: hs-117-llm-exchange-stream-wiring
  date: 2026-05-23
  warden: kernel-warden
  routed: warden
  commits: 1  # 60dac4b7
  agent-spawns: 1
  tokens-est: ~62K (provider runs)
  regression-prevented: stream-bound-never-run-spurious-emit
  notes: >
    Single kernel-warden dispatch shipped makeObservableLLM.stream wrap in
    observable-llm.ts (+102/-16). Confidence 0.85 because no test added
    (tests/ tree outside warden authority — explicit out-of-scope per
    brief). Main-thread added 1 stream-emit regression test in
    packages/reasoning/tests/kernel/observable-llm.test.ts immediately
    after, per warden's risk-and-followups note. Closed F8 anti-scaffold.
    Authority discipline: warden refused to edit tests/ correctly.
  evidence-anchors:
    - packages/reasoning/src/kernel/observable-llm.ts:115+ (stream wrap)
    - packages/reasoning/tests/kernel/observable-llm.test.ts:91+ (regression test)
    - bun test packages/reasoning 1212/1212 (was 1211, +1)

- task: hs-113-emit-helper-extension
  date: 2026-05-23
  warden: kernel-warden
  routed: warden
  commits: 1  # 6af922cb
  agent-spawns: 2
  tokens-est: ~100K
  regression-prevented: none-known
  notes: >
    Dispatch #1 added optional outerLoopName?/outerIter? params to
    emitKernelStateSnapshot in kernel/utils/diagnostics.ts (+7/-1 LOC,
    1211/1211 tests). Dispatch #2 narrowed args.state from KernelState to
    a local KernelStateLike interface (+46/-9 LOC, 576/576 kernel tests).
    Both dispatches: confidence ≥0.9, authority-bounds-honored=true,
    out-of-scope-touched=[]. Re-spawn driven by genuine scope progression
    (signature opens → shape opens for outer-loop callers), not retry.
  evidence-anchors:
    - packages/reasoning/src/kernel/utils/diagnostics.ts:23-46 (KernelStateLike)
    - packages/reasoning/src/kernel/utils/diagnostics.ts:80 (signature)
    - packages/core/src/services/event-bus.ts:980-991 (schema fields)

- task: terminate-reason-union-export
  date: 2026-05-23
  warden: kernel-warden
  routed: warden
  commits: 0  # warden does not commit; main-thread bundles
  agent-spawns: 1
  tokens-est: ~69K
  regression-prevented: open-string-reason-surface
  notes: >
    Single kernel-warden dispatch exported TerminateReason union from
    packages/reasoning/src/kernel/loop/terminate.ts (19 members
    empirically enumerated from runner.ts + arbitrator.ts call sites).
    Narrowed TerminateOptions.reason from `string` to TerminateReason.
    Confidence 0.85 — typecheck green + 98 termination tests green; full
    @reactive-agents/reasoning suite not re-run in warden scope.
    Surprises: 8 imperative callers (not 9 — line 882 is arbitrateAndApply
    not terminate), pre-existing runner.ts:696 termination-paths lint
    violation (out of authority), naming inconsistency between
    dispatcher_early_stop (underscore) vs dispatcher-early-stop (hyphen).
    Authority bounds respected (refused arbitrator Verdict.terminatedBy
    tightening + runner.ts edits + wiki log append — all flagged as
    followups). Closed M9 finding in R23 (apps/examples xfail).
  evidence-anchors:
    - packages/reasoning/src/kernel/loop/terminate.ts:23-50 (union + narrowed type)
    - apps/examples/src/reasoning/24-mechanisms-cassette-xfail.ts (M9 removed)
    - bun test packages/reasoning/tests/{terminate-rationale,m9-termination-oracle,shared/termination-oracle} 98/98

- task: react-kernel-raw-terminated-by
  date: 2026-05-24
  warden: kernel-warden
  routed: warden
  commits: 0  # warden does not commit; main-thread bundles
  agent-spawns: 1
  tokens-est: ~61K
  regression-prevented: killswitch-reason-narrowing-loss
  notes: >
    Single kernel-warden dispatch closed the last kernel-side blocker in
    the killswitch propagation chain. Extracted pure
    `deriveTerminatedBy(state)` helper in react-kernel.ts; added optional
    `rawTerminatedBy?: string` to `ReActKernelResult` interface in
    kernel-state.ts; refactored executeReActKernel to emit both fields.
    Two interpretive calls surfaced cleanly: (a) brief targeted
    result.metadata.* shape but ReActKernelResult is FLAT — patched the
    flat shape per out-of-scope-surface clause; (b) brief said no
    kernel-state.ts schema change but the flat-shape route required one
    optional field (in kernel-warden authority bounds). +7 tests
    (1221/1221 reasoning suite green). LOC +45 (5 over 40 soft budget,
    JSDoc-heavy). Confidence 0.82. Two propagation gaps surfaced for
    parent: (1) plan-execute.ts:1339 doesn't forward terminatedBy
    upward (parent's inline list only mentioned reactive.ts); (2)
    pre-existing llmCalls structural-typing waiver in
    ReActKernelResult — unrelated. Authority discipline: edits confined
    to kernel/loop/react-kernel.ts + kernel/state/kernel-state.ts +
    co-located tests; no edits to strategies/, runtime/, core/, wiki/.
  evidence-anchors:
    - packages/reasoning/src/kernel/loop/react-kernel.ts:87-130 (deriveTerminatedBy helper)
    - packages/reasoning/src/kernel/loop/react-kernel.ts:206 (conditional spread)
    - packages/reasoning/src/kernel/state/kernel-state.ts:888-902 (ReActKernelResult.rawTerminatedBy)
    - packages/reasoning/tests/kernel/loop/react-kernel-raw-terminated-by.test.ts (+7 tests)
    - bun test packages/reasoning 1221/1221
  followups:
    - "plan-execute.ts:1339 doesn't forward terminatedBy/rawTerminatedBy upward — parent declined to patch (multi-step aggregation complexity); reactive strategy works, plan-execute strategy doesn't surface killswitch reasons (filed as separate followup)."
    - "Pre-existing llmCalls structural-typing waiver on ReActKernelResult — unrelated."
  pilot-signal:
    re-dispatch-pattern: clean
    first-attempt-success: yes
    re-spawn-count: 0
    regression-catch: prevented-killswitch-reason-loss-at-kernel-narrowing

- task: killswitch-reason-preservation
  date: 2026-05-24
  warden: kernel-warden
  routed: warden
  commits: 0  # warden does not commit; main-thread bundles
  agent-spawns: 1
  tokens-est: ~66K
  regression-prevented: silent-killswitch-aborts
  notes: >
    Single kernel-warden dispatch fixed killswitch.reason preservation
    at 4 abort-transition sites (runner.ts bootstrap + before-think,
    act.ts before-act + after-act). All 4 sites now set
    state.meta.terminatedBy from hookAbort.reason with fallback sentinel
    `killswitch:${abort}` for safety. Extracted killswitchTerminatedBy()
    helper in phase-hooks.ts. +5 tests (helper + 4 transition paths +
    fallback sentinel). 1214/1214 reasoning suite green. LOC +48,
    well under 60 budget. Confidence 0.88 — kernel-level fix
    mechanically correct + tests pin the contract; downstream
    output-assembly normalization (react-kernel.ts:152 + reactive.ts:256
    narrow to closed TerminatedBy enum) still drops the raw reason,
    surfaced as followup. Pre-existing termination-paths lint
    violation at runner.ts:711 (RunController stop bypasses
    terminate()) verified NOT introduced by this dispatch (via stash
    + re-run). Authority discipline: 4 files in bounds; no edits
    to compose, core/event-bus, runtime, or wiki.
  evidence-anchors:
    - packages/reasoning/src/kernel/loop/phase-hooks.ts (killswitchTerminatedBy helper)
    - packages/reasoning/src/kernel/loop/runner.ts (2 abort sites)
    - packages/reasoning/src/kernel/capabilities/act/act.ts (2 abort sites)
    - packages/reasoning/tests/kernel/loop/killswitch-reason-preserved.test.ts (+5 tests)
    - bun test packages/reasoning 1214/1214
  followups:
    - "react-kernel.ts:152 + reactive.ts:256 narrow rawTerminatedBy to 5-value TerminatedBy enum. Need parallel `rawTerminatedBy?: string` channel through reasoning result → engine ctx → AgentCompleted.terminationReason (schema already extended)."
    - "Pre-existing lint violation runner.ts:711 (RunController stop) — separate ship."
    - "Verdict.terminatedBy in arbitrator.ts still typed `string` — already tracked."
    - "Output-assembly mapping ctx.metadata.terminatedBy → result.metadata.terminatedBy stays narrow per current TerminatedBy schema; ship the raw channel via separate field rather than widening the enum."
  pilot-signal:
    re-dispatch-pattern: clean
    first-attempt-success: yes
    re-spawn-count: 0
    regression-catch: prevented-silent-killswitch-aborts

- task: hs-128-followup-a-profile-max-tokens-plumb
  date: 2026-05-24
  warden: kernel-warden
  routed: warden
  commits: 0  # warden does not commit; main-thread bundles
  agent-spawns: 1
  tokens-est: ~61K
  regression-prevented: overly-aggressive-frontier-baseline
  notes: >
    Single kernel-warden dispatch plumbed ContextProfile.maxTokens into
    reactive-observer (HS-128 FOLLOWUP-A). Added KernelMeta.profileMaxTokens
    typed field seeded ONCE at kernel-start in runner.ts (mirrors HS-128
    budgetLimits seed pattern, immediately after that block at ~line 577).
    reactive-observer passes state.meta.profileMaxTokens to evaluateVerbosity;
    DEFAULT_PROFILE_MAX_TOKENS=32_768 retained as final fallback for
    synthetic-state callers only. Frontier-tier 128_000 now derives
    baseline=2000 / threshold=4000 (was hardcoded 512/1024). 1209/1209
    reasoning tests green (+3 new: frontier / local / legacy-fallback).
    Typecheck green. Effective src delta ~7 LOC + 47 test LOC; doc-comment
    + 3 tests pushed total to +85 vs ≤80 cap (surfaced transparently).
    Authority discipline: no edits outside packages/reasoning/src/kernel/**
    + co-located tests; runner-init integration test deferred as a flagged
    followup (typecheck enforces the seed compiles, behavioural test pins
    the legacy fallback, full suite covers runner code paths).
  evidence-anchors:
    - packages/reasoning/src/kernel/state/kernel-state.ts (KernelMeta.profileMaxTokens field)
    - packages/reasoning/src/kernel/loop/runner.ts (~line 577 seed point, mirrors #128 budgetLimits)
    - packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:510-515 (caller pass-through)
    - packages/reasoning/tests/kernel/capabilities/reflect/reactive-observer-verbosity.test.ts (+3 tests)
    - bun test packages/reasoning 1209/1209
  followups:
    - "Runner-init integration test asserting state.meta.profileMaxTokens IS seeded — not required (typecheck + suite cover it) but a defensive belt-and-suspenders option."
    - "Consider deprecating DEFAULT_PROFILE_MAX_TOKENS export once all callers thread profileMaxTokens — only if a future audit shows a concrete miss-wire."
  pilot-signal:
    re-dispatch-pattern: clean
    first-attempt-success: yes
    re-spawn-count: 0
    regression-catch: none

- task: gh-46-per-provider-tool-call-parser-hook-attempt2
  date: 2026-05-24
  warden: provider-warden
  routed: warden
  commits: 0  # warden does not commit; main-thread bundles
  agent-spawns: 1
  tokens-est: ~94K
  regression-prevented: false-green-via-recursive-mock-binding
  notes: >
    Provider-warden re-dispatch after parent's empirical spike (zero
    production callers across all 7 M12 Hooks 1-7) revealed the cleanest
    architecture: `selectAdapter()` at adapter.ts:345 is a pure stateless
    function — provider invokes it per-CompletionRequest internally with
    the request's modelId + resolved tier. Zero threading, zero schema
    changes, zero new tags. Both complete() and stream() paths in
    local.ts now consume `adapter.parseToolCalls` when supplied;
    default Ollama-shaped parser preserved as fallback. +3 tests;
    261/261 llm-provider tests green (was 254 baseline). LOC delta
    +79/-34 net = within ≤80 budget (tight). Authority discipline:
    zero edits to adapter.ts, calibration.ts, types.ts, or any other
    provider. Mocking lesson surfaced empirically: delegating mock
    `selectAdapter` back to real `selectAdapter` recurses through the
    mocked binding — must build the tier-based fallback inline in the
    mock factory. Used 1 of 2 retries.
  evidence-anchors:
    - packages/llm-provider/src/providers/local.ts:380-490 (complete() — capability lifted out of Effect.tryPromise; selectAdapter() + parseToolCalls)
    - packages/llm-provider/src/providers/local.ts:550-650 (stream() — same pattern)
    - packages/llm-provider/tests/local-adapter-parser-hook.test.ts (+3 tests pinning the consumption seam)
    - bun test packages/llm-provider 261/261 (was 254)
  followups:
    - "buildCalibratedAdapter (calibration.ts:168) emits only systemPromptPatch + toolGuidance today; extend to emit parseToolCalls from calibration data so the JSON-load path is end-to-end testable. New ModelCalibration field e.g. `toolCallNormalization: 'qwen3-stringified-args' | 'none'`."
    - "+1 streaming-path test for adapter parseToolCalls coverage parity with complete() — current tests cover wiring by inspection only on the stream side."
    - "complete() vs stream() capability-error symmetry — complete() now has explicit Effect.catchAll(resolveCapability('ollama', model)); stream() relies on resolveOllamaCapability's internal fallback. Worth normalizing."
    - "Other 5 M12 hooks (extractText, computeCost, validateResponse, optimizePrompt, handleError, streamSupport) remain unconsumed in production for all providers per parent-thread audit. Each is its own future dispatch."
    - "Same selectAdapter() consumption pattern should apply to anthropic.ts, gemini.ts, openai.ts, litellm.ts — out of #46 scope; future dispatches."
  pilot-signal:
    re-dispatch-pattern: clean
    first-attempt-success: yes
    re-spawn-count: 1  # 1 within-dispatch retry consumed on mock recursion discovery
    regression-catch: prevented-infinite-recursion-on-mock-binding

- task: gh-46-per-provider-tool-call-parser-hook-attempt1
  date: 2026-05-24
  warden: provider-warden
  routed: warden
  commits: 0  # blocker surfaced — no edits
  agent-spawns: 1
  tokens-est: ~49K
  regression-prevented: false-green-on-undefined-adapter-reference
  notes: >
    Provider-warden refused-and-surfaced. Mission scoped a 2-call-site
    patch at local.ts:425 (complete) + 581-602 (stream) to consume
    adapter.parseToolCalls when supplied. Empirical orientation found
    LocalProviderLive Layer.effect consumes ONLY LLMConfig — zero
    `adapter` references in local.ts, zero `Adapter` references in
    runtime.ts. The brief explicitly pre-declared this exact scenario
    as a hard blocker ("Threading the adapter into the runtime factory
    if it's not already wired — surface as hard blocker"). Warden
    honored that contract. Time-to-blocker: ~3 min (4 file reads + 2
    greps). No edits, no test churn. Parent-thread spike-grep
    confirmed adapter.parseToolCalls is invoked ONLY in
    m12-provider-adapter-hooks.test.ts — zero production callers. Hook
    surface is dead code today; the M12 ship verified the hook shape
    but never wired its consumer side.
    
    4-option decision matrix surfaced for parent:
      Option A (per-request injection): add adapter?: ProviderAdapter
        to CompletionRequest (types.ts) — high blast radius (6 providers
        + caller sites).
      Option B (LLMConfig field): add adapter to LLMConfig — Layer-time
        binding, lowest blast radius if LLMConfig provider sites are
        in scope.
      Option C (new Context.Tag): introduce ProviderAdapterTag — clean
        Effect-TS idiom, medium blast radius, cross-package wiring
        required.
      Option D (do nothing — redefine semantics): acknowledge that M12
        Hook 1/7 is consumed upstream of the provider boundary; clarify
        in adapter.ts JSDoc + update GH #46 framing.
    
    Catch quality: prevented a likely re-spawn cycle where the patch
    would have failed typecheck (`adapter is not defined`). This
    counts as a regression-catch per pilot lift signal.
  evidence-anchors:
    - packages/llm-provider/src/providers/local.ts:425 (consume site for complete())
    - packages/llm-provider/src/providers/local.ts:581-602 (sibling streaming extraction)
    - packages/llm-provider/src/adapter.ts:103-106 (declared hook signature)
    - packages/llm-provider/src/runtime.ts (zero adapter references — confirmed not wired)
    - packages/llm-provider/tests/m12-provider-adapter-hooks.test.ts (the ONLY current caller)
  followups:
    - "Parent picks A / B / C / D before re-dispatch. Warden recommends C if Layer wiring is in scope, A otherwise. D is materially different (no code ship; redefine semantics)."
    - "If A/B/C is picked: spawn kernel-side and provider-side wardens with explicit threading scope (cross-package, larger brief)."
    - "If D is picked: write a one-paragraph wiki note in wiki/Architecture/Design-Specs/ clarifying that M12 hooks fire upstream of the provider boundary; update GH #46 with the redefinition and close."
  pilot-signal:
    re-dispatch-pattern: refused-and-surfaced
    first-attempt-success: blocked-correctly
    re-spawn-count: 0
    regression-catch: prevented-false-green-on-undefined-adapter-reference

- task: hs-128-verbosity-detector
  date: 2026-05-24
  warden: kernel-warden
  routed: warden
  commits: 0  # warden does not commit; main-thread bundles
  agent-spawns: 2  # first refused on schema gap (correct discipline); re-dispatch with Option A schema shipped
  tokens-est: ~156K (combined two dispatches)
  regression-prevented: verbosity-induced-token-waste
  notes: >
    Two-dispatch sequence: first kernel-warden dispatch correctly refused
    on a pre-declared schema blocker (state.steps[].tokens does not exist
    — only cumulative state.tokens). Surfaced three adaptation options;
    recommended Option A (state.meta.lastIterationTokens snapshot at
    think.ts:711). Re-dispatch with Option A explicit shipped end-to-end:
    new KernelMeta.lastIterationTokens field (capped at 5 entries),
    snapshot append in think.ts:715-728 (truthy guard for test-provider
    zero-usage), new pure helper verbosity-detector.ts (88 LOC), new
    detector block in reactive-observer.ts placed outside RI gate so it
    fires on runs without reactive-controller wired. Mirrors #119
    advisor→single-mutator pattern: detector emits
    pendingCompressionRecommendation with `reason: "verbosity-detected"`
    and `targetTokens = profile.maxTokens / 4`; curator consumes via
    existing #119 freshness gate. Confidence 0.85 — math-pinned across 5
    new tests + 1206/1206 full reasoning suite green; production claim
    (qwen3 ratio drop) unverified against live trace at the time of
    dispatch (deferred to post-merge revalidation).
  evidence-anchors:
    - packages/reasoning/src/kernel/state/kernel-state.ts:226-244 (lastIterationTokens typed field)
    - packages/reasoning/src/kernel/capabilities/reason/think.ts:715-728 (snapshot append with truthy guard + slice(-5) cap)
    - packages/reasoning/src/kernel/capabilities/reflect/verbosity-detector.ts (new pure helper, freshness gate iter delta ≤1)
    - packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:492-523 (detector block placed before return, independent of RI)
    - packages/reasoning/tests/kernel/capabilities/reflect/reactive-observer-verbosity.test.ts (+5 tests)
    - bun test packages/reasoning 1206/1206 green (was 1201; +5 from new tests)
  followups:
    - "FOLLOWUP-A: Plumb ContextProfile.maxTokens into reactive-observer (either via KernelMeta.profileMaxTokens seeded at kernel-start in loop/runner.ts, or by threading profile through runReactiveObserver's signature). Currently detector uses a hardcoded 32_768 local default — frontier-tier providers will trip overly aggressively."
    - "FOLLOWUP-B: Wire typed CompressionRecommendation event onto event-bus.ts with `source: 'verbosity-detector'` vs `'dispatcher'` discriminant — observability followup unchanged from #119."
    - "FOLLOWUP-C: Cross-tier matrix re-run on context-profiles task post-merge to confirm trace shows reason='verbosity-detected' surfaces on qwen3 but not cogito."
  pilot-signal:
    re-dispatch-pattern: clean
    first-attempt-success: yes
    re-spawn-count: 1
    regression-catch: none

- task: hs-119-curator-sole-prompt-author
  date: 2026-05-24
  warden: kernel-warden
  routed: warden
  commits: 0  # warden does not commit; main-thread bundles
  agent-spawns: 1
  tokens-est: ~93K
  regression-prevented: rogue-state.messages-mutation
  notes: >
    Single kernel-warden dispatch closed GH #119 / North Star v5.0 §4.3
    (curator as sole prompt author). Demoted the reactive-observer
    `compress-messages` patch handler from a direct `state.messages`
    mutator (transitionState({ messages: compressed }) at observer.ts:371)
    to an advisory recommender that sets
    `state.meta.pendingCompressionRecommendation` + emits an
    ObservableLogger `compression-recommendation` metric. Curator pipeline
    (buildConversationMessages → applyMessageWindowWithCompact) now reads
    that field with a freshness gate (iteration delta <= 1), clamps the
    effective budget, and emits a `compression-applied` debug log when a
    recommendation is consumed. Static authority closure asserted by a
    co-located test: `rtk grep "transitionState.*messages:"` over
    reactive-observer.ts returns 0 (was 1). Confidence 0.78 — high on the
    static authority assertion + 256 targeted tests + 1201/1201 full
    reasoning suite green; tempered because the L4 production validation
    signal (qwen3 264% token verbosity regression) requires a
    harness-runner re-run outside this warden's scope. LOC delta +341
    overruns the 250 cap by +91, entirely in test documentation; the 4
    mandated invariants are named in the test bodies. Authority
    discipline: refused event-bus.ts edits (core domain), refused
    reactive-intelligence patch-type tightening (controller-decisions
    domain), refused wiki/** writes (scribe territory).
  evidence-anchors:
    - packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts (case "compress-messages" — no transitionState messages mutation)
    - packages/reasoning/src/kernel/capabilities/attend/context-utils.ts (effectiveBudget clamp + freshness gate)
    - packages/reasoning/src/kernel/state/kernel-state.ts (KernelMeta.pendingCompressionRecommendation typed field)
    - packages/reasoning/tests/context/curator-compression-recommendation.test.ts (+4 invariants)
    - packages/reasoning/tests/kernel/capabilities/reflect/reactive-observer-compression.test.ts (+2 checks incl. static regrep)
    - bun test packages/reasoning 1201/1201; targeted 256/256
  followups:
    - event-bus.ts CompressionRecommendation + CompressionApplied schema variants (core domain)
    - reactive-intelligence patch type — add reason: string to compress-messages canonical shape
    - harness-runner cross-strategy matrix re-run on context-profiles (L4 closure signal)
    - freshness-gate widening for future arbitrator pause/resume cycles

- task: test-provider-logprobs
  date: 2026-05-23
  warden: provider-warden
  routed: warden
  commits: 0  # warden does not commit; main-thread bundles
  agent-spawns: 1
  tokens-est: ~47K
  regression-prevented: open-entropy-pipeline-test-gap
  notes: >
    Single provider-warden dispatch extended TestTurn.text and
    TestTurn.json with optional `logprobs?: readonly TokenLogprob[]`.
    Wired pass-through in complete() and stream() (StreamEvent of type
    "logprobs" already declared at types.ts:879 — purely consumer-side).
    +29 LOC testing.ts + 4 new round-trip tests in
    test-provider-logprobs.test.ts (258/258 pass, was 254). Surprises:
    StreamEvent already had the variant; CompletionResponseSchema
    already declared logprobs as Schema.optional — zero types.ts edit.
    Conditional spread keeps undefined off response object, matching
    Ollama adapter precedent. Authority bounds respected (READ-only
    on types.ts, no real-adapter edits, no entropy-pipeline edits).
    Unblocks the surface needed to drive M2/M3/M5 in-loop firing
    under the test provider; consumer-side witness still pending
    because entropy events flow through EventBus not Compose harness
    (separate finding — needs RI-aware tap surface or direct
    EventBus subscription in examples).
  evidence-anchors:
    - packages/llm-provider/src/testing.ts (TestTurn extended; logprobs pass-through)
    - packages/llm-provider/tests/test-provider-logprobs.test.ts (+4 tests)
    - bun test packages/llm-provider 258/258 (was 254)
```


```yaml
- task: v0112-pre-tag-release-audit
  date: 2026-06-10
  warden: release-warden
  routed: warden
  commits: 0  # audit-only by design
  agent-spawns: 1
  tokens-est: ~53K
  regression-prevented: residual-retired-model-fallback-404 (runtime.ts:268,1079) + tag-on-unpushed-main + stale-changeset-release-notes
  notes: >
    Pre-tag audit for fast 0.11.2 (June-15 model retirement deadline). All
    quality gates PASS on ad059ec2 (release:dry 35-pkg lockstep clean; build
    38/38; typecheck 68/68; tests 6205/0/23-skip). NO-GO verdict solely on
    git-sync (local main 51 ahead of origin). Diagnosed 0.10.6-vs-0.11.1
    package.json "drift" as by-design (release.ts stamps at publish; VERSION
    file is truth). Caught P1: createRuntime/createLightRuntime still
    hard-coded claude-sonnet-4-20250514 — the exact 404 class the release
    exists to fix. Caught P2: 7 stale v0.11.0-era changesets would have
    produced wrong release notes.

- task: v0112-runtime-fallback-model-fix
  date: 2026-06-10
  warden: runtime-warden
  routed: warden
  commits: 1
  agent-spawns: 1
  tokens-est: ~38K
  regression-prevented: future-retired-id-drift-in-runtime (guard test pins every claude-* literal to static capability table)
  notes: >
    runtime.ts:268 + :1079 terminal fallbacks → claude-sonnet-4-6 (read-verified
    against provider-defaults.ts, not assumed). BONUS: warden's own new guard
    test caught a third retired id (claude-opus-4-20250514 in JSDoc :245) the
    audit missed. New tests/default-model-fallback.test.ts (40 LOC). Runtime
    934/0; typecheck forced-uncached 21/21.

- task: v0112-runtime-readme-retired-id
  date: 2026-06-10
  warden: runtime-warden
  routed: warden
  commits: 0  # folded into release commit
  agent-spawns: 1
  tokens-est: ~21K
  regression-prevented: none
  notes: >
    One-liner: packages/runtime/README.md:44 retired id → claude-sonnet-4-6.
    Micro-dispatch honored contract; observation for evaluation day — 21K
    tokens for a 1-line doc sed is the contract's worst-case overhead shape.

- task: v0112-repo-wide-readme-id-sweep
  date: 2026-06-10
  warden: main
  routed: main
  bypass-reason: >
    Cross-cutting mechanical sed (same literal, 13 packages + apps/docs);
    primary scope is repo-wide docs, not any single warden domain — per-warden
    routing would have required 5+ dispatches for identical one-line seds.
    Logged for transparency; not claiming pilot-data eligibility.
  commits: 0  # folded into release commit
  agent-spawns: 0
  tokens-est: ~3K
  regression-prevented: none
  notes: >
    20 retired-id refs in published package READMEs + docs site → current ids.
    Reverted sed collateral on apps/docs/src/data/benchmark-report.json
    (historical benchmark record — must not be rewritten).
```

```yaml
- task: fm-i-canonical-buildkernelinput
  date: 2026-06-11
  warden: kernel-warden
  routed: warden
  commits: 0  # main-thread committed the integrated change
  agent-spawns: 1
  tokens-est: ~59K
  regression-prevented: cross-cutting-field-drop-becomes-compile-error (Pick-partition builder)
  notes: >
    FM-I (#195) Phase 1: built kernel/state/build-kernel-input.ts —
    buildKernelInput(crossCutting, perPass), both bundles Pick<KernelInput,…>
    so a dropped cross-cutting field is a compile error not a silent gap.
    Equivalence test pins reactive's field set incl. the verifier env-branch.
    verifier kept PER-PASS (gate-safe — no new terminal gate on sub-passes).
    12/12 builder tests, reasoning typecheck 8/8. Strategy migration was
    main-thread (strategies/** unmapped).

- task: fm-i-reactkernel-inner-forwarding
  date: 2026-06-11
  warden: kernel-warden
  routed: warden
  commits: 0  # main-thread committed
  agent-spawns: 1
  tokens-est: ~65K
  regression-prevented: plan-execute-inner-literal-field-drop (executeReActKernel now uses buildKernelInput)
  notes: >
    FM-I (#195) Layer-3: executeReActKernel's inner runKernel literal
    (react-kernel.ts) re-built kernel input by hand and dropped the 4
    cross-cutting fields. Migrated it to buildKernelInput; all 21 original
    fields preserved, 4 now forwarded. Found ReActKernelInput = KernelInput
    alias so no type edit needed (fields already declared). before('think')
    forwarding test RED→GREEN. 606 scoped tests 0 fail. Handed off
    step-executor call-site migration to main-thread.

- task: fm-i-strategy-migration
  date: 2026-06-11
  warden: main
  routed: main
  bypass-reason: >
    packages/reasoning/src/strategies/** is unmapped in the pilot table —
    main-thread is canonical owner. Migrated reflexion, tree-of-thought,
    adaptive, plan-execute(+step-executor) call sites onto buildKernelInput
    and widened each strategy's narrowed input interface to carry the
    cross-cutting fields. Per-strategy before('think')-fires regression tests.
  commits: 4  # 90c7c089, 9030d5a1, plan-execute, docs
  agent-spawns: 0
  tokens-est: ~40K
  regression-prevented: compose/killswitch/calibration-dead-on-4-strategies
  notes: >
    Empirical RED→GREEN: reflexion live ollama hook 0→1. Full reasoning
    1617/0. Remaining sub-gap (#195 open): tool_call/analysis steps bypass
    kernel.
- task: durable-exec-phase-a-checkpoint-seam-codec
  date: 2026-06-10
  warden: kernel-warden
  routed: warden
  commits: 1
  agent-spawns: 1
  tokens-est: ~76K
  regression-prevented: pre-existing-lossy-serialize-pair-flagged (kernel-state.ts:856/886 drops 6 fields, zero callers — Phase B consolidation note)
  notes: >
    Durable execution Phase A (design spec 2026-06-10-durable-execution.md).
    TDD RED→GREEN: (1) onCheckpoint observer seam wired in iterate-pass.ts
    at iteration boundary via sanctioned asKernelStateLike() adapter, 14 LOC,
    throw-safe (triple-surface warn), zero cost when absent; (2) new
    kernel/state/kernel-codec.ts — versioned envelope, tagged Map/Set/Date
    encoding, meta WARN-skip for non-serializable values. 12/12 new tests;
    full reasoning suite 1620/0; typecheck 8/8. Core contract
    (RunControllerLike.onCheckpoint?) landed main-thread (core has no
    assigned warden).
```

## Summary (2026-06-15)

## Post-canonicalization entries (convention now standing, not pilot — log kept for continuity)

```yaml
- task: typesafe-judgment-task8-builder-wiring
  date: 2026-09-22
  warden: runtime-warden
  routed: warden
  commits: 0  # pending parent commit
  agent-spawns: 1
  tokens-est: ~216K
  regression-prevented: none (net-new plumbing, no existing behavior touched)
  notes: >
    Task 8 of wiki/Planning/Implementation-Plans/2026-09-20-typesafe-judgment-layer.md
    (Phase C, first of 6 remaining tasks). `.withJudgment()` builder method +
    public `agent.judge()` primitive, mirroring `.withGuardrails()`/
    `.withVerification()` exactly. JudgmentSites config threaded but unread
    (Tasks 9/9b/10/11/12 will consume it). 4 new tests green; full runtime
    (1616/0, 3 skip) + reactive-agents (20/0) suites re-verified by parent;
    2 fails are the pre-existing repo-wide `as unknown as` ceiling gate,
    confirmed unrelated via git stash on the unmodified tree. Parent ran
    `bun run docs:gen:api` post-dispatch (outside warden's authority-bounds)
    to clear builder-api.md drift the new method introduced.

- task: typesafe-judgment-task9-strategy-selection-shadow
  date: 2026-09-22
  warden: kernel-warden
  routed: main
  bypass-reason: >
    kernel-warden correctly returned denied-by-authority — its manifest is
    hard-limited to packages/reasoning/src/kernel/** (edit) with strategies/**
    as read-only context, and this task's entire scope (adaptive.ts,
    adaptive-jev-questions.ts, adaptive tests) is under strategies/**, which
    has no dedicated warden in the routing table. Refused rather than widen
    its own scope, per the standing anti-pattern list. Parent implemented
    directly.
  commits: 0  # pending parent commit
  agent-spawns: 1  # the denied kernel-warden dispatch
  tokens-est: ~44K
  regression-prevented: none (net-new shadow instrumentation, zero behavior change)
  notes: >
    Task 9 (Phase C) of the judgment-layer plan. jevClassifyShadow() fires a
    batched Jev Choice+Nouls speculatively at adaptive.ts's strategy-selection
    site via Effect.forkDaemon, never altering selectedStrategy. New
    JudgmentShadow AgentEvent (core). 4 new tests (agree/disagree/timeout/
    absent-service), full reasoning suite 2854/0 (4 pre-existing todo).
    Recommend: add a strategies-scoped warden or fold strategies/** into
    kernel-warden's manifest before the next dispatch targeting this path.

- task: typesafe-judgment-task9b-complexity-router-shadow
  date: 2026-09-22
  warden: main
  routed: main
  bypass-reason: >
    packages/cost/** has no dedicated warden in the routing table (per the
    plan's own "Warden: parent" assignment for this task).
  commits: 0  # pending parent commit
  agent-spawns: 0
  tokens-est: ~0K  # done inline, no sub-dispatch
  regression-prevented: none (net-new shadow instrumentation, zero behavior change)
  notes: >
    Task 9b (Phase C), same shape as Task 9. jevComplexityShadow() fires at
    complexity-router.ts's heuristicClassify site; current reflects the
    POST-escalation tier (FIX-32 tool-reliability walk), not the raw
    heuristic pick, so shadow agreement data isn't skewed by escalation.
    5 new tests (4 shared with Task 9's shape + 1 proving the escalation
    gate is unaffected in shadow mode). Full cost suite 103/0.

- task: typesafe-judgment-task10-comprehend-shadow
  date: 2026-09-22
  warden: kernel-warden
  routed: warden
  commits: 0  # pending parent commit
  agent-spawns: 1
  tokens-est: ~138K
  regression-prevented: pooled-events-test-isolation-gap (Task 9's adaptive-jev-shadow.test.ts had no `site` filter, over-counted once Task 10's shadow landed on the same bus — fixed)
  notes: >
    Task 10 (Phase C). jevComprehendShadow() fires a chunked (CHUNK_CAP=30)
    batched Choice+Score+Nouls at runKernel()'s unconditional
    nominateRequiredTools() call site — the true per-run comprehend entry
    inside kernel-warden's own manifest (rejected packages/runtime's
    reasoning-think.ts as the OTHER candidate site since it's out of
    manifest, and rejected runner.ts's OWN adaptiveHarness-gated classifyTask
    call since it's opt-in, not unconditional). 12 new tests across 2 files.
    Self-reported one collateral regression (3 pre-existing Task-9 tests
    broken by the new shared-bus event volume) and escalated rather than
    silently fixing outside its test-file authority; parent applied the
    1-line site-filter fix directly. `/code-review medium` then found 2 real
    issues (chunk-cap dual-source-of-truth constant; shadow input computed
    unconditionally before the JudgmentService presence check, breaking the
    documented zero-cost-when-absent guarantee) — both fixed with a new
    lazy-thunk regression test. Full reasoning suite 2866/0 (4 pre-existing
    todo), up from 2854 pre-Task-10.
```

(written on evaluation day)

- task: judgment-phase-d-task1-includecontext
  date: 2026-09-23
  warden: runtime-warden
  routed: warden
  commits: 4  # 6a988e5a, 40cfa680 (parent), 0d48d4f5; on worktree-judgment-phase-d, not yet merged to dev
  agent-spawns: 3  # implementer (resumed once after rate-limit interruption), task reviewer, scoped re-reviewer
  tokens-est: ~825K
  regression-prevented: >
    misleading compressToolResult reuse would have folded kernel-only
    "[STORED...] use recall(...)" instructions into one-shot judgment-backend
    prompts with nothing actually stored and no recall tool available to act
    on it — caught by task review, fixed by reverting to a plain honest
    truncation.
  notes: >
    Task 1 of the Phase D judgment-leverage follow-up plan (includeContext
    auto-merge on agent.judge()). Self-flagged 3 concerns outside
    packages/runtime/** authority; parent fixed 2 directly (export
    compressToolResult from @reactive-agents/reasoning's public surface,
    add docs subsection) rather than re-dispatching a warden for a
    sub-package-boundary crossing (Task 12 precedent). Task review found
    2 Important findings (untested contextMerged observability signal;
    the STORED/recall leak above); 1 fix round, scoped re-review clean.
    Also caught+fixed a worktree-isolation gap (fresh worktree had no
    node_modules, typecheck was resolving @reactive-agents/reasoning
    through the MAIN checkout via directory walk-up) and a stale-dist
    issue on packages/reactive-agents (cleared by an earlier cascading
    turbo run that died on the pre-existing observability OTel build
    failure). Full runtime suite: 1554 pass / 2 pre-existing ratchet fail,
    confirmed unrelated via stash-and-rerun baseline comparison.

- task: judgment-phase-d-task2-completion-shadow
  date: 2026-09-23
  warden: kernel-warden
  routed: warden
  commits: 1  # d90fe2c0; on worktree-judgment-phase-d, not yet merged to dev
  agent-spawns: 2  # implementer, task reviewer
  tokens-est: ~290K
  regression-prevented: none — clean first pass
  notes: >
    Task 2 of the Phase D judgment-leverage follow-up plan (completion/
    termination shadow judgment), Steps 1-3 only (live exit-gate data
    collection deferred to parent). Chose verifyAndEmit in verifier.ts as
    the funnel point over arbitrate()/terminate.ts to keep the sole-decider
    and single-termination-owner invariants provably untouched (reviewer
    independently confirmed zero diff to both files and that verdict is
    never mutated by the shadow path). New completion-judgment-shadow.ts
    mirrors the two existing Phase C shadow-site patterns
    (judgmentClassifyShadow, judgmentComprehendShadow). 6 new tests incl. a
    harder case than precedent (disagreement against a REJECTED verdict,
    not just an accepted one). Task review: Approved, 0 findings (1 cosmetic
    minor noted, not actioned). bun run build run separately by parent
    (outside warden's authorized command surface) — clean.

- task: judgment-phase-d-task3-grounding-shadow
  date: 2026-09-23
  warden: kernel-warden
  routed: warden
  commits: 1  # fc77bbbd; on worktree-judgment-phase-d, not yet merged to dev
  agent-spawns: 2  # implementer, task reviewer
  tokens-est: ~440K
  regression-prevented: none — clean first pass, 1 scope ruling (see below)
  notes: >
    Task 3 of the Phase D judgment-leverage follow-up plan (grounding/
    fabrication shadow judgment), Steps 1-3 only. Plan document originally
    assumed this had no dedicated warden owner ("parent, no warden exists");
    grepped first per the brief's own Step 1 and found the live check
    inside packages/reasoning/src/kernel/**, re-routed to kernel-warden —
    correcting a plan-authoring assumption, not a warden authority
    violation. Implementer found assembleDeliverable has 6 call sites with
    no shared choke point (unlike Task 2's single verifyAndEmit funnel);
    wired only 1 of 6 (runner.ts §8.8 general fallback) and flagged for
    sign-off. Controller ruled: accept narrow wiring, document the coverage
    limitation in the Step 4 Harness Report rather than widening scope
    mid-task. Extracted the inline containment IIFE into a pure,
    regression-pinned function (evaluateUnconsumedEvidenceGrounding).
    13 new tests incl. the required adversarial case (judge flags a
    fabrication the heuristic's substring match missed). Task review:
    Approved, 0 findings (2 cosmetic minors noted, not actioned). bun run
    build run separately by parent — clean.

```yaml
date: 2026-09-23
warden: harness-warden
task: "4 leverage-proof spikes (batched fan-out, memory rerank, hierarchical strategy-router, state-presentation bias) for judgment primitive Phase E scoping"
result: denied-by-authority
reason: "MissionBrief target wiki/Research/Prototypes/** and packages/judgment/** research domain outside harness-warden's Edit authority (scoped to wiki/Research/Harness-Reports/** + harness-improvement-loop skill) and domain primer (cross-strategy-matrix/ri-ablation/harness-probe, not judgment-backend spikes)."
action: "re-dispatched to general-purpose agent per harness-warden's own recommendation — no warden in AGENTS.md routing table owns wiki/Research/Prototypes/** spike work"
```

```yaml
date: 2026-09-23
warden: kernel-warden
task: "thread confidence field into 3 kernel JudgmentShadow sites (completion, grounding-fabrication, task-comprehension) + fix 5 kernel test fixtures for new required listModels + state-handling audit against docs.typesafe.ai/concepts/state.md"
result: completed, confidence 0.9
outcome: "accepted — targeted kernel tests 176/176 pass, kernel package typecheck contributes zero new errors, state audit found no gap in kernel sites' buildState shapes"
escalation: "flagged 1 pre-existing-style type error in adaptive.ts (packages/reasoning/src/strategies/**, outside kernel-warden authority) — parent fixed directly (kind-narrowing on JudgmentAnswer before reading .confidence), same root cause also existed in complexity-router.ts and preference-learner.ts (parent's own files), all fixed, all packages now typecheck green"
```

```yaml
date: 2026-09-23
warden: runtime-warden
task: "Phase E Task 4 — re-export JudgeInput<Q> from packages/runtime/src/index.ts"
result: completed, confidence high
outcome: "accepted — task review clean (spec ✅, quality excellent), commit 7dbc8144"
```

```yaml
date: 2026-09-23
warden: runtime-warden
task: "Phase E Task 5 — agent.listModels() facade method"
result: completed, confidence 0.95
outcome: "accepted — task review clean (spec pass, quality approved), 1 minor deferred (test assertion robustness), commit 9339c604"
```

```yaml
date: 2026-09-23
warden: runtime-warden
task: "Phase E Task 6 — agent.judgeRank() batched candidate re-ranking primitive"
result: completed, confidence 0.9
outcome: "accepted — 1 Important finding (undocumented silent answer-drop) fixed in round 1, scoped re-review ADDRESSED, 1 minor deferred, commits 4a27cad8..c37fcfb3"
```

```yaml
date: 2026-09-23
warden: runtime-warden
task: "Phase E final whole-branch review fix wave — 7 findings (CI-breaking network test, missing facade re-exports, chunkCap hang, missing changeset, listModels error-contract docs, duplicate/__proto__ candidate id safety, doc import fix) + 1 unrelated pilot-log fence fix"
result: completed
outcome: "accepted — scoped re-review verdict ALL findings ADDRESSED, no new Critical/Important breakage, 6 commits"
```

```yaml
date: 2026-10-05
warden: runtime-warden
task: "normalizeReasoningResult drops metadata.selectedStrategy (whitelist rebuild missing the declared key) -> adaptive runs report strategyUsed='adaptive' instead of the dispatched sub-strategy; add passthrough + red/green tests"
result: completed, confidence 0.92
outcome: "accepted - parent verified: targeted test 3 pass; full reasoning suite 2907/0; runtime tsc exit 0; live stackblitz 03 adaptive row now reports sub-strategy (plan-execute-reflect). Flagged pre-existing #214 cast-ceiling failures in runtime suite, not contributed by this change"
```

```yaml
date: 2026-10-05
warden: kernel-warden
task: "cumulative run-level budget enforcement for plan-execute-reflect (Arbitrator counts per-kernel-invocation spend; step kernels each got a fresh full tokenLimit and outer LLM calls unguarded -> live 25,675 past a 20,000 cap); shared remaining-budget helper + strategy-level stop + tests"
result: interrupted, parent-integrated
outcome: "warden session died mid-mission leaving substantive partial work (helper + tests + plan-execute gate). Parent verified root-cause trace (red via stash: pre-fix the cumulative test fails on [EXEC s3] launching), fixed one merge-order defect found on integration (budgetStopped branch clobbered the sub-kernel envelope's deliverable-naming verificationWarning - now appends), updated plan-execute-honest-partial test to the new strategy-level stop semantics with rationale, ran strategies 85/85 + kernel budget suites 26/26 + reasoning 2907/0 + tsc clean. Live demo: BUDGET_TOKENS=3500 caps the run with honest partial. Follow-on gaps reported: reflexion.ts + tree-of-thought.ts share the multi-kernel budget gap (helper ready); separate pre-existing O(n^3) PATH_TOKEN backtracking in kernel verify/derive-conditions.ts on huge prior-step blobs (documented in the new test's comments)"
```

```yaml
date: 2026-10-06
warden: runtime-warden
task: "System One decision backends Task 5: judgment-layer.ts BACKENDS registry + builder ollama namespace; replace both runtime.ts judgment IIFEs"
result: completed, confidence 0.95
outcome: "accepted: parent verifier green (turbo typecheck filter=@reactive-agents/runtime 21/21; builder-judgment/judgment-context/agent-list-judgment-models/judge-input-export/judgment-rank + judgment package 113/0; zero new as-unknown-as casts; scope = the 4 briefed paths only). Parent integrated commit 5f03ab6d per warden no-commit contract (R2); independent task review dispatched separately."
```

```yaml
date: 2026-10-06
warden: runtime-warden
task: "System One decision backends Task 6: optional images channel on agent.judge() (JudgeInput + verbatim forwarding to ask; service guard owns rejection per R5)"
result: completed, confidence 0.95
outcome: "accepted: parent verifier green (5 focused runtime judgment test files 39/0 incl. 4 new pins; turbo typecheck filter=@reactive-agents/runtime clean; zero new casts; scope = reactive-agent.ts + judge-images.test.ts only). Parent integrated commit e2f70240; independent task review dispatched separately."
```

```yaml
date: 2026-10-06
warden: kernel-warden
task: "System One decision backends Task 7 kernel half: chunkQuestions(toolNames, maxQuestions?) cap = min(CHUNK_CAP, maxQuestions ?? Infinity); shadow resolves capabilitiesOf inside forkDaemon"
result: completed, confidence 0.95
outcome: "accepted: working tree already contained the implementation (residue of an interrupted funds-killed attempt); warden verified rather than re-implemented (red via HEAD-src restore 2-vs-5 ask calls, green 31/0 comprehend, typecheck 9/9, zero new casts). Parent re-verified (comprehend + kernel loop 133/0, zero casts) and integrated per warden no-commit contract. Independent Task 7 review covers both halves."
```

```yaml
date: 2026-10-12
warden: runtime-warden
task: "Wave 0 W0.3: implicit-test-provider warning — builder tracks _providerExplicit; build/buildEffect emit actionable once-per-build warning when provider silently defaults to 'test' (fake-green front door); explicit arms (.withProvider('test'), .withTestScenario, .withReplayLLM override) silent"
result: completed, confidence 0.85 (round 2; round 1 was 0.7)
outcome: "accepted: parent verifier green (builder-test-provider-warning + durable-checkpoint 10/0 scoped; runtime suite 1670/0/6; turbo typecheck filter=@reactive-agents/runtime 21/21). Independent task review Approved with 1 Important (buildEffect terminal uncovered, violating the file's own public-entry-duplication precedent); fix round 1 (commits 29a06365..2379ef22) deviated from prescribed dual-call-site to single call in buildEffect because build() delegates via Effect.runPromise(this.buildEffect()) (:2704) — re-review verified deviation correct (warn-once preserved, no-double-warn regression pin added). Authority note: brief manifest under-listed packages/runtime/tests/**; contract table governs — durable-checkpoint test edit accepted as in-domain. Deviations + findings all disclosed by warden."
```

```yaml
date: 2026-10-12
warden: kernel-warden
task: "Wave 0 W0.4a: export composable-kernel extension surface from @reactive-agents/reasoning index (makeKernel value; Phase/Guard/KernelContext/MetaToolHandler/ThoughtKernel types; KernelState untouched) + public-entry pin test + minor changeset"
result: completed, confidence 0.95
outcome: "accepted: parent verifier green (focused pin test 4/4, turbo typecheck filter=@reactive-agents/reasoning; warden runs: RED 3-fail runtime + 10 TS2339/TS2694 compile, GREEN 4/4, reasoning suite 2968/0/4todo, typecheck --force 9/9). Independent task review Approved, 0 Critical/0 Important-for-task; diff surgically exports-only; collision + type-pin-elision named risks checked. Disclosed gap ledged as parent follow-up: tests/** excluded from package tsconfig, so type-pins do not compile-fail in CI (runtime pins compensate). Warden correctly escalated the pilot-log obligation instead of widening authority."
```

```yaml
date: 2026-10-12
warden: kernel-warden
task: "Wave 0 W0.4b: composable-kernel.md rewritten against published package imports; all skip markers cleared (12, not 11); SKIP_CEILING ratchet 235->223 with dated history; stale prose fixed honestly (onError event, KernelHooks arity, codec type, removed guard mechanism)"
result: completed, confidence 0.92
outcome: "pending task-review; parent verifier: full doc gate re-run at HEAD. Warden declined export-widening (runKernel/transitionState/KernelHooks/KernelStatus/KernelRunOptions stay internal) — correctly routed to parent. Ruling: out of W0.4 scope; revisit only if Wave 4 kernel work needs a public seam."

```yaml
date: 2026-10-13
warden: runtime-warden
task: "Wave 0 W0.5: result->trace linkage — runId + tracePath minted on AgentResultMetadata at single finalize seam (engine/finalize/trace-linkage.ts), settle-flush + existsSync honest-absence gate, traceDir threaded builder->RuntimeOptions->config single-sourced"
result: completed, confidence 0.9 (round 2)
outcome: "accepted: task review 'Needs fixes' on 1 Important (test hand-parse weaker than rax contract — loadTrace drops invalid lines silently, loadRecordedRun throws without run-started); fix round 1/5 (42175a34..4c99fb04, test-only) asserted via the CLI's own loadTrace barrel export + run-started/every-event pins; scoped re-review: ADDRESSED, no new breakage. Parent verifier green (focused 3/3, runtime typecheck). Production code clean on all 3 named risks at first review. Deferred minors ledged (Option.isSome idiom, absolute-path JSDoc wording, join duplication recorder<->mint). Cross-task ⚠️: streaming/light-sub-agent results lack linkage — follow-up if Wave-1 lift captures need them."
```

```yaml
date: 2026-10-13
warden: runtime-warden
task: "GH #236 cross-domain bundle: AgentStarted gains task/taskTruncated (core), execution-engine stamps real prompt with 64KB publisher cap (runtime), normalize run-started branch consumes raw.task ?? '' (trace), replay workaround removed + golden regenerated via real recorder + fresh-task/orchestrator/back-compat pins (replay)"
result: completed, confidence 0.9 (round 2)
outcome: "accepted: review Approved (single-emission-site verified by repo-wide grep; regeneration signature proves genuine fixture regen; authority discipline praised — resisted out-of-manifest events.ts edit, disclosed consequence -> GH #237 filed by parent). Fix round 1/5 (fa6b39dc): back-compat pin's fabricated run-completed line replaced byte-for-byte with real pre-fix golden (re-reviewer verified provenance against git show), events.length===2 strict pin added. Parent verifier: focused test green, replay 34/0. W0.5 TS2769 type-only ride-along accepted as bundle-gate hygiene (disclosed)."
```

```yaml
date: 2026-10-13
warden: harness-warden
task: "Task 0 baseline capture: scripts/lift/ bench + extractor + replay-gate, S1/S2/S3/S4 temp-0 N=5 live captures (34 traces + workspaces + MANIFEST + scoreboard + Hot.md freeze), zero framework edits"
result: completed, confidence 0.88
outcome: "accepted: parent verifier green (extractor 6/6, scoreboard columns all populated-or-named-gap, zero packages/ diff range-verified). First dispatch died mid-recon (budget, zero artifacts) -- status-check resume recovered cleanly. Task review Approved: S3-llama3.2 run-4 canonical false-success verified field-for-field from raw trace (146 discover-tools, empty-headings report.md artifact), S2 starve confirmed, redaction limited to disclosed dummy strings (structurally cannot false-pass the gate), replay gate asserts real string equality. Interface deviation ruled against plan text (amended). rung-2 haiku deferred on account credit (one-command rerun recorded)."
```

```yaml
date: 2026-10-13
warden: provider-warden
task: "Wave 1.1+1.2 thinking channel on streaming wire protocol: StreamEvent +thinking_delta/content_complete.thinking (additive), local.ts same-loop-pass forwarding gated by existing capability seam, anthropic routed, gemini/openai/litellm audited+recorded, ui-core drop-with-reason + react/svelte/vue parity tripwire"
result: completed, confidence 0.9
outcome: "pending task review; parent verifier: focused stream test + llm-provider typecheck at HEAD de369f77. NOTE for 1.3 dispatch (warden-disclosed semantics): on thinking-capable models thinking flows even with config.thinking:false (Ollama cannot opt out) — kernel must treat thinking as always-possible on capable models. First dispatch of this mission died with zero disk artifacts; retry directive (incremental report writes + commit-as-soon-green) delivered."
```

```yaml
date: 2026-10-13
warden: kernel-warden
task: "Wave 1.3+1.4: think.ts accumulator consumes thinking_delta/content_complete.thinking -> existing providerThinking/rescueFromThinking activate (zero new parse logic); llm-exchange forensics thinkingChars + PREVIEW_MAX-capped preview (additive-optional, REQUIRED_FIELDS_BY_KIND untouched)"
result: completed, confidence 0.92
outcome: "accepted: parent verifier pending task review; warden evidence: 3-arm consumption RED->GREEN + cut-arm + byte-identical no-thinking golden; reasoning 2977/0, trace 88/0, replay+diagnose 72/0, typechecks clean. Escalation (2-line core transit gap) APPROVED + integrated by parent at 91e8d6006 (precedent: #236 core stamp; typed subscribers now see the fields). Consent ruling honored: thinking presence never gated by config.thinking. Next: 1.5 harness lift capture unblocked."
```

```yaml
date: 2026-10-13
warden: harness-warden
task: "Wave 1.5: first program LIFT capture — post-w1 S2 N=5 + S1 drift guard, scoreboard PRE/POST section, Hot.md #38"
result: completed, confidence 085
outcome: "accepted (review folded with re-capture per controller ruling): verdict MIXED — channel lift CONFIRMED 5/5 (0 -> 6.0-9.5K thinkingChars/run), quality lift NOT — surfaced the terse-answer rescue-guard DEFECT (file-ready, in-authority declined, correctly escalated to kernel-warden). Lift Protocol doing its job: measurement caught W1's own activation-reachable regression before Wave 2 could lean on contaminated S2 numbers. Also disclosed dist-rebuild need (checked-out dist predated kernel commit)."
```

```yaml
date: 2026-10-13
warden: kernel-warden
task: "W1.5-defect fix: gate stream-parser branch-4 prose fallback on (empty content OR exchange truncated); terse correct answers survive end_turn, marker rescues (branches 1-3) and empty-content rescue untouched; TRUNCATING_STOP_REASONS + exchangeTruncated from existing accumulator"
result: completed, confidence 0.95
outcome: "accepted: review Approved 0C/0I. Deviation (branch-4-only, pre-authorized) verified SOUND — gate default-safe, single production caller, zero new plumbing (accumulatedStopReason pre-existing), W1.3 suite byte-unchanged. RED 2/6->GREEN 6/6 + cut-test + reasoning 2983/0. 4 latent-hardening minors ledged for final-review triage (stop_sequence reachability, marker-clobber inherited paths -> re-capture counts, changeset wording, set typing)."
```

```yaml
date: 2026-10-13
warden: harness-warden
task: "W1.5 re-capture: post-w1-fix S2 N=5 + S1 drift guard against fixed kernel (af7d1b45), marker-clobber count, FINAL Wave-1 verdict"
result: completed, confidence 0.9
outcome: "accepted (capture verification = its own review, per controller ruling): FINAL WAVE-1 VERDICT CONFIRMED — defect prose-tail 5/5->0/5 with per-run outputs quoted ('3052', end_turn), marker-clobber 0/5, thinkingChars 6.7-10.8K 5/5, S1 drift 2/2 shape-identical, zero packages/ edits range-verified. Honest residual recorded (S2 answer never changed at temp 0 => quality win = defect-free retention + rescue availability; accuracy lift provable only on thinking-only tasks, W1.3 unit arms). Methodology finding folded into Lift Protocol plan text: ~±17% token variance => N>5 for sub-15% deltas. Hot.md #38 amended per authorized contradiction clause."
```

```yaml
date: 2026-10-13
warden: provider-warden
task: "Wave 2a: capability probe ladder (size/thinking/tool-template capture + capability-store write-through), derived supportsToolCalling claim, D-2026-07-30-H budget-monotone fix + ratchet test"
result: completed, confidence 0.85
outcome: "3 commits (64a94a309, 57b06836a, d2c58d6a6). llm-provider 486/0, core+reasoning 3160/0, runtime 1673/0, typecheck 24/24. Cross-authority notes for parent: (1) CONTEXT_PROFILES lives in reasoning/core, not llm-provider — Area 3 executed per explicit dispatch instruction despite the 'packages/reasoning out of scope' line (interpreted as resolver-consumption exclusion), commit scoped fix(reasoning) honestly; (2) D-H fix had to move core TIER_TOOL_RESULT_PRESERVE mirror too or the live project() budget keeps the inversion; (3) as-unknown-as-ceiling TESTS_CEILING 237->240: pin was already red at 239 on arrival (pre-Wave-2a drift, verified at 64a94a309~1), +1 is sanctioned fetch-stub — guard option 3 used; (4) dispatch's 'monotone non-decreasing whole table' unsatisfiable literally for preserve budgets (designed shape descends) — ratchet encodes per-family direction + D-H guard, documented in test header + w2a-report."
```

```yaml
date: 2026-10-13
warden: provider-warden
task: "Wave 2a: probe ladder (parameter_size decimals + thinking + tool-template emission) + CapabilityStore write-through persistence replacing process-Maps + supportsToolCalling derived (fail-safe permissive-provisional / strict-false only measured-no-emission) + D-2026-07-30-H ladder inversion fixed with per-family ratchet test (cross-package hunks dispatch-driven, controller-adjudicated)"
result: completed, confidence 0.85
outcome: "accepted after review (first reviewer dispatch died empty; resume-extract delivered full verdict): Approved 0C/3I. Adversarial checks passed: store-first genuinely shadows nothing (cold-Map decoy test), no reachable stranding for unmeasured models, cross-package hunks minimal+load-bearing (core test UPDATE not weakening), cast-ceiling bump verified as sanctioned test-double (src adds zero casts), pre-existing 239>237 drift confirmed. Importants -> W2a-fixup dispatch (function_call/.functioncall markers, store-key baseUrl, test-disable seam). YAGNI-deflect on tier-from-size accepted (plan's own clause). First dispatch of this mission had died zero-output (third such); lean-retry-with-commit-per-area pattern again delivered."
```

```yaml
date: 2026-10-13
warden: provider-warden
task: "W2a review fix loop round 1: function_call template markers, endpoint-scoped store rows, CAPABILITY_STORE_DISABLE seam + key-sanitize/atomic-write minors"
result: completed, confidence 0.9
outcome: "accepted-pending-review: 1 commit (a298ba7e). RED 5 -> GREEN. llm-provider 492/0, typecheck llm-provider+core+reasoning+runtime 24/24, RI+testing 23/23 (duck-type back-compat), RI+testing tests 125/0, cast-ceiling guard 2/0 (239<240, one stub cast designed out). Deviation surfaced: fix 2 needed optional endpoint args on CapabilityCache (3 files, not 1) because the store cannot learn baseUrl from (provider,model) alone; legacy rows self-heal per controller preference."
```

```yaml
date: 2026-10-13
warden: kernel-warden
task: "Wave 2b (plan 2.1): registry-first tiering in resolveProfileWithWindow; ollama size-regex branch deleted; provisionalTier mark + 17-arm classification matrix; test-provider carve-out with data-bug escalation"
result: completed, confidence 0.93
outcome: "accepted: verifier green (matrix 17/17 re-run by parent). Review Approved 0C — carve-out judged acceptable (case-safe, exact-keyed registry, pinned arm) with the underlying stub-row data bug escalated correctly (-> GH #239, parent-filed); both modified existing test files verified UPDATE-TO-TRUTH (net coverage up); fail-safe registry-miss semantics confirmed (fallback source never poses as verdict, no throw path). Infra discovery: runtime suite tests reasoning SRC via tsconfig paths (dist irrelevant to bun test)."
```

```yaml
date: 2026-10-13
warden: provider-warden
task: "W2c (plan 2.3): tokenizer-aware dense-JSON correction in estimateTokenCount, measured per-family factors beside calibrations, registry tokenizerFamily gets first consumer"
result: completed, confidence 0.85
outcome: "1 work commit (f8fae1d67). Measurement path = committed traces (0.97-1.02 llama traffic; FC-residual 1.245) + sanctioned live /api/chat probe (dense 1.032-1.157, prose 0.767-0.892 over-count). Plan seed 1.35 DISPROVED (probe-3 folklore, circular provenance); shipped llama dense factor 1.25, prose/mixed untouched (unsafe-direction guard), unknown=>1.0 zero behavior change. RED-first weak point disclosed (first RED was parse/module failure, not assertion-level). llm-provider 502/0, reasoning/context 95/0, runtime 1673/0, typecheck 10/10. think.ts:1034 + rate-limiter + prompt-manager flagged-not-threaded (census in w2c-report.md); W2e inherits the corrected helper. Concern: real overflow driver is the OMITTED FC-schema input, not the char ratio — 2.5 preflight must add the schema term."
```

```yaml
date: 2026-10-13
warden: kernel-warden
task: "Wave 2d: FC wire-payload honesty (2.4, names-and-types applied to tools[] via existing stripper semantics, frontier byte-pinned) + classifier-skip enforcement (2.6 at the measured strategy-evaluator firing site, harness-signal observable, runtime correctly untouched)"
result: completed, confidence 0.95
outcome: "accepted: review Approved 0C/2I -> #1 fixed round 1 (d5ecf6b77 >=3x pin per spec, measured 7x headroom), #2 residual adaptive/decompose classify sites -> GH #240. Independent trace verification of the classify-source finding (2/8 post-w1 fixtures carry strategy-evaluator classify exchanges) praised. W4.0 note: structural pin greps iterate-pass.ts source — will need re-pinning through the 4.0 refactor. Full reasoning 3,013/0 + runtime parity + typecheck 9/9."
```

```yaml
date: 2026-10-13
warden: kernel-warden
task: "Wave 2e+fix: head-truncation guard (2.5) — ollama-scoped preflight (wire-truthful num_ctx), schemas->pair-safe-history ladder, system head never sacrificed, harness-signal + ledger fact, demand sizing schema-inclusive, conservative reserve; W2c reconciliation documented (option a)"
result: completed, confidence 0.96
outcome: "accepted: review Approved 0C + 4I; #1 rung-2 fork/#2 demand leak/#3 reserve fixed round 1 (05a944e28, RED->GREEN + discriminating cuts, re-review all ADDRESSED, pairing algorithm verified against live projection invariants); #4 explicitNumCtx cross-authority -> GH #241 filed by parent. Full reasoning 3,025/0, runtime parity, typechecks clean. Ollama-scoping judged honest decision with shipped precedent + indirect regression cover (reviewer: tests were correctly scoped, guard was mis-scoped)."
```

```yaml
date: 2026-10-13
warden: kernel-warden
task: "Wave 2f (plan 2.7): prove-or-delete census of every Wave-2-touched field - w2-wave-census.test.ts ratchet on ContextProfileSchema.fields, 31-row register, 12 mutation-cuts, CONTEXT_PROFILES unreachable sweep, DEBT rows W2F-1/2 (+ D-30-I kept)"
result: completed, confidence 0.9
outcome: "accepted pending census-design review: tally 29 PROVEN/1 dead-registered (recentObservationsLimit, public knob -> removal wave)/1 justified-keep (provisionalTier, W3 obligated consumer)/0 deleted. Ratchet self-corrected from instance-keys undercount to schema-fields after authoring - exactly the inert-green class it guards. Warden disclosed stale-tool-echo incident mid-dispatch, re-grounded shipped state from filesystem; reviewer spot-checking rows from ground truth. reasoning 3,025/0, provider 502/0, runtime 1,677/0 (+4 census), typecheck 23/23."
```

```yaml
date: 2026-10-13
warden: harness-warden
task: "Wave 2 close capture: 20 runs (S1/S2/S3 arms, three-point PRE->W1-fix->POST-W2), verdict per seam, payload + guard-signal counts, rax-visible signals"
result: completed, confidence 0.88
outcome: "accepted: WAVE-2 VERDICT MIXED recorded on scoreboard honestly. Guard 0/20 head-truncations (alive, 1 over-fire), classify delta explained (reliability=high arms), payload measured -51% llama tokensIn; caught Wave 2's OWN regression: stale dialect:none prior (runsAveraged 1) demotes capable qwen3:4b to text-mode with unparsable taught markup -> 5/5->0/5. GH #243 filed + provider fix dispatched. Wave-4 baseline-continuity finding (thrash phenotype no longer live-reproducible) ledged: W4 uses frozen fixture. Wave-3 gate set: post-fix S3 re-capture + 3.2 markup round-trip."
```

```yaml
date: 2026-10-13
warden: provider-warden
task: "GH #243 root fix: DIALECT_PRIOR_CONFIDENCE_FLOOR=2 + explicit-presence phantom-kill in deriveSupportsToolCalling; calibration-runner v2 genuine dialect probe (v1 stub deleted); 8/8 shipped-prior audit vs live /api/show + behavioral evidence, 3 refuted none-claims refreshed via probe seam with provenance; gemma4 stub-template guard found mid-audit; coder:14b flagged-not-fabricated"
result: completed, confidence 0.9
outcome: "accepted: review Approved 0C/1I(next-wave chore: full v2 suite re-commit for truthful metadata + coder:14b measurement). Precedence traced: no ra=1 demotion path survives; absent-vs-schema-default indistinguishable. Static entries re-reconciled to evidence w/ dated history comments. RED->GREEN + floor-before-refresh discrimination recorded. llm-provider 510/0, typecheck 4/4. Deeper-than-brief root cause (hardcoded dialect stub, never a measurement) self-discovered - the bricking class was folklore-circular by construction; program's first self-caused P1 fully closed pending S3 re-capture gate."
```

```yaml
date: 2026-10-13
warden: provider-warden
task: "#243-review Important #1 discharge: full-suite v2 calibration-runner --commit refresh of 4 priors (qwen3:4b/qwen3:14b/cogito:14b/coder:14b) via shipped probe seam - hand-merged metadata replaced by uniform v2 measurements; coder:14b dialect measured 3/3 none"
result: completed, confidence 0.9
outcome: "accepted (controller direct verification, ruling: data-only artifact of an already-reviewed seam - diff = 4 JSON + changeset exactly; field moves match claims incl. the disclosed 2000-censor cap). Wave-2 provenance sin-class fully closed. New true fact: coder:14b is genuinely text-dialect by measurement -> Wave 3 S4-grade target; two priors tightened optimalToolResultChars 4000->2000 (censored ladder cap, ledged as runner design note). S3 re-capture gate (R1) dispatched next."
```

```yaml
date: 2026-10-13
warden: harness-warden
task: "R1 WAVE-3 GATE: post-#243 S3-qwen34b re-capture N=5 (+bonus 2) three-point row, signature clearance (schemas-on-wire, tool-call-start, workspace deliverable, no-unparsed-markup), S2 sanity"
result: completed, confidence 0.92
outcome: "accepted: GATE PASS measured 0/5 -> 5/5 canonical (7/7), deliverable-correct 5/5, all four #243 signatures zero, thinking retention 6-12K intact, S2 2/2 stable. Wave-2's MIXED regression component CLOSED with live proof; floor+truthful-priors compose correctly end-to-end. Disclosed slips kept honest: global --n flag semantics (bonus rows kept), terminatedBy label churn flagged for docs truth-up, box-contention wall times annotated not hidden. #243 verification comment posted; close at merge with the branch."
```

```yaml
date: 2026-10-13
warden: kernel-warden
task: "Wave 3a: Stage-B think->acting transition behind default-off REACTIVE_AGENTS_TEXT_PARSE=off|shadow|act - orphaned act.ts extractCalls reached via same dispatch pipeline (guards/policy/healing/ledger, growRunLedger untouched); builder-derived teach/parse single grammar (#243 binding); parse-diff observability for promotion measurement"
result: completed, confidence 0.92 (round 2)
outcome: "accepted: review Approved 0C/3I -> fix round 1/5 all ADDRESSED, re-review clean. Warden's disclosed extra (gate-mirror alone bypassable via act re-extraction -> dispatch flipped to consume GATED set, RED arm proved 2-raw-1-gated=1-execution) verified true by re-reviewer - enforcement now argument-for-argument identical to native incl budget Layer-3/single-step/quota-conflict. failMsg now reads the live taught block structurally, fail-safe-unreadable (never teaches guessed grammar). Stale-thread: thread deleted as dispatch source, skip-and-record + both pins. reasoning 3,041/0, runtime parity 1,677/0 (default-off proven)."
```

```yaml
date: 2026-10-13
warden: tools-warden
task: "Wave 3b (plan 3.3 + triad): dialect-live routing per spec end-state (capability sole arbiter, claim=provenance never downgrades), phantom rule at runner caller via loadDialectPriorClaim, provisionalTier keep-obligation pinned, sentinel exemption verified, RF2 triad mutation-pin (sever any leg -> red), core nominal carriers survive toCanonical/adaptCache"
result: completed, confidence 0.9
outcome: "accepted: review Approved 0C/0I. Reviewer independently opened the spec - shipped mapping faithful to §4/§5 as written (the 'fuses' ambiguity resolved by the spec's own 'at the source' clause), danger cell (caps=false + native-fc claim) routes text-parse never native. Cross-domain ratifications: 2 additive llm-provider hunks + core carriers (mandate-bound, item 6 of brief). Triad arms verified as true mutation pins incl phantom-re-entry kill arm. reasoning 3053/0, runtime parity 1683/0, tools drivers 53/0 (15 pre-existing Docker arms noted)."
```

```yaml
date: 2026-10-13
warden: harness-warden
task: "W3c Stage-B promotion data: shadow-soak (coder:14b N=5, phi4-mini N=3) + act-mode (coder N=5, phi4 N=2) - would-have-executed rate, first-acting, deliverable outcome, safety watch"
result: completed, confidence 0.88 (resumed after a mid-close-out crash; incremental writes preserved all arms)
outcome: "rung-3 PARTIAL, plan-3.5 NOT declarable: shadow seam PROVEN (phi4 clean-run 3/3 tier-1 taught-grammar parses; placeholder-arg caveat) but coder:14b markup hits a parser-coverage gap (would-have-executed 0/5) and act end-to-end is unmeasured (coder parse-gap + phi4 2/2 hung on box stalls 6/8 attempts). Safety watch clean: no double-dispatch/budget-bypass/parse-loops in 12 completed runs; fail-safe legacy path byte-identical. File-ready follow-ups routed: wrapper-tolerant tier-1 (tools-warden, preserve #243 grammar pin), ParamNameHealer proof (kernel), quiet-box act-phi4 re-run (harness). Zero packages/** edits."
```

```yaml
date: 2026-10-13
warden: tools-warden
task: "W3c parser-coverage fix (Stage-B blocker): make TextParseDriver tier-1 wrapper-tolerant so the SHAPES real no-FC models emit parse. Diagnosed verbatim from committed traces (fixtures/post-w3) - coder:14b emits bare `tool: <name>` + param lines, drops both wrapper tags; blocks split by prose/---; file-write content as YAML block scalar `content: |`. Extended tier-1 with a bare-block scanner (same taught grammar minus wrapper; #243 pin preserved) + block-scalar handling; wrapped path unchanged and still wins."
result: completed, confidence 0.9
outcome: "accepted-pending-controller: measured 0/10 -> 10/10 coder:14b runs parse (all names in callable surface [file-read,file-write]; 8x3 calls, 2x2 calls faithful to emission). RED->GREEN: 6 new tests fail on the pre-change driver, pass after; wrapped-tier tests unchanged. GH #243 grammar pin preserved via builder-derived test (taught block with wrapper lines stripped parses). Authority: packages/tools/** only (parser + tests + changeset) - reasoning-side markerPresent stays wrapped-only but is now moot for coder (parsed>0 drives both shadow and act); noted as residual for kernel-warden, not edited. tools drivers 61/0, healing+tool-calling 125/0, reasoning kernel 736/0, reasoning strategies/kernel 549/0, text-parse-transition 16/0, tools typecheck+build clean."
```

```yaml
date: 2026-10-13
warden: tools-warden
task: "W3c review fix round 1/5: harden bare-block parse against three real corruption paths - (1) indent asymmetry (indented block opened with {} args), (2) mid-param prose truncation, (3) `>`/chomp block-scalar syntax accepted but not interpreted"
result: completed, confidence 0.9
outcome: "ADDRESSED: (1) tool+param indent now symmetric w/ per-param indent captured and used as the block-scalar base, so a following param at block indent is not swallowed; bare block now requires >=1 param, killing the empty-args dispatch class. (2) in-list prose tolerance REJECTED on measured FP evidence - coder runs embed `ProductA: 100` data lines between blocks; tolerance scoped BETWEEN blocks, mid-param prose ends the list loudly (required-param validation rejects), docstring corrected to match + pinning test. (3) `>` folding + `-`/`+`/clip chomping implemented to exact values, per-form value tests added. RED 8 fail -> GREEN 70/0 (tools/tests/drivers); empirical 0/10 -> 10/10 over committed coder traces, zero empty-args. reasoning kernel+strategies 1285/0, healing+tool-calling 125/0, tools typecheck+build+eslint clean. Authority packages/tools/** only."
```

```yaml
date: 2026-10-13
warden: tools-warden
task: "W3c round 2 (live user-facing bug): text-parse taught delimiter `<tool_call>` collided with Ollama's own qwen tool-call parser (stream poisoned -> EOF at iter 0). Move taught wrapper to `<tool_use>`; keep legacy + bare acceptance."
result: completed, confidence 0.9
outcome: "Trigger evidence: journal qwen35.go:115 + qwen3coder.go:87 'tool call parsing failed' error=EOF on the text-parse run; binary strings show <tool_call> x15 / </tool_call> x14, <tool_use> x0. Chose <tool_use>: absent from both parsers' vocabulary AND stays a lone <name> tag so reasoning readTaughtCallShape (GH #243 pin) is untouched - no reasoning source edit. Additive: regex accepts tool_use|tool_call; bare/JSON/scalar paths unchanged. RED 3 -> GREEN tools/tests/drivers 72/0; reasoning kernel+strategies 1285/0; coder fixtures 10/10; builder scan shows all Ollama trigger literals absent (only benign `<tool` substring remains, prefix-match ruled out). tools typecheck/build/eslint clean. File-ready: stale comment driver-instructions.test.ts:3 (kernel-warden)."
```

```yaml
date: 2026-10-13
warden: provider-warden + tools-warden
task: "Live user-bug fix chain: qwen3.5 scratch.ts EOF at iter 0 - (a) provider: NETWORK_FAULT += EOF (pre-first-emission retry engages) + capability-store CURRENT_PROBE_VERSION gate (stale probe rows self-heal); (b) tools: taught delimiter <tool_call> -> <tool_use> (Ollama parser trigger collision; binary-strings evidence 15/14 vs 0/0), legacy form still accepted"
result: completed, confidence 0.9
outcome: "accepted pending delimiter re-review; END-TO-END VERIFIED by controller live: scratch.ts success (4 steps, 6.4s, native route 12 schemas), ollama journal parser-failure count 0 (was universal), tool-sourced final answer. Provider pair reviewed APPROVED (minors ledged: Tier-0 cache seam ungated-latent, future-version demotion, EOF-vs-model-name edge, 400-arm comment). New root-cause law ledged for debrief: version-gate persisted measurement data."
```

```yaml
date: 2026-10-13
warden: kernel-warden
task: "W4.0 iterate-pass refactor-first: generator return-protocol single-writer (18 sync sites + closure -> 0 + one unconditional write-back); W2d source-grep pin replaced by a behavior test (real runKernel, discriminating classifier-skip presence/absence)"
result: completed, confidence 0.85 (warden self-rated; review upgraded)
outcome: "accepted: review APPROVED 0C/0I. Byte-identical claim independently verified: all 19 base exit paths had adjacent sync(); carrier referenced in exactly 2 places (entry destructure + write-back) so nothing observes mid-pass staleness; same 15 fields; error channel never. reasoning 3,050/0, runtime parity, typecheck 22/22. Out-of-authority census consumer-string edit (1 line) parent-accepted as the re-pin's consequence. Parent also bumped both guard ratchets with dated rationale (as-unknown-as 240->242, console-ceiling 11->12) - the W0.3 test-provider warning is the console site (sync build() context, ceiling's own exception)."
```

```yaml
date: 2026-10-13
warden: kernel-warden
task: "W4 control plane (4.1+4.6+4.7: ONE progress arbiter, pattern-(e) zero-evidence staleness, evidenceDelta crediting, band rule) then LIVE-GAP fix e0c6a456f (band keyed on deterministic outstanding short-circuited green; actuator horizon-gated -> default-on 2-stale-iteration stand-down + 4.3 gate routing)"
result: completed, confidence 0.8
outcome: "accepted pending review; END-TO-END LIVE VERIFIED by controller: impossible task 4-5 iters/23.4s/~1980tok -> 2 iters/9.1s/857tok with honest abstain reason + band green->economize; hard reasoning-only task unaffected (1 iter, success). Warden disclosed the trade-off (no-tool 3rd-pass tasks stand down) - review targets it. User-reported defect (inefficient termination) closed at root: detection now actuates by default."
```

```yaml
date: 2026-10-13
warden: kernel-warden
task: "W4-live fix round 1 (a77dd5c13): stand-down requires a flail signature (canonical give-up refusal OR near-duplicate thoughts >0.85 Levenshtein) so no-tool REASONING survives; long-horizon escape hatch; NO_OP marker hardening; #206 budget e2e restored"
result: completed, confidence 0.82
outcome: "accepted pending scoped re-review; LIVE VERIFIED by controller both directions: impossible task 2 iters/6.6s/835tok honest abstain (was 4-5/23.4s/~1980tok); qwen3:4b no-tool reasoning task NOT stood down (correct derivation produced). Review's Critical (bare staleness aborted deriving runs at pass 3, no escape hatch) closed with RED-first FP pin + two cut arms. reasoning 3086/0, runtime 1678/0, replay 37/0. Surfaced a PRE-EXISTING defect (GH filed): fabrication guard hard-fails correct reasoning answers on derived durations - routed to Wave 5 verdict honesty."
```

```yaml
date: 2026-10-13
warden: kernel-warden
task: "W4-live fix rounds 1+2: flail-signature precision (MIN_REPETITION_LENGTH=100 mirroring contentStabilityEvaluator; thoughtRefusal = canonical isGiveUpAnswer + task-level/no-capability gate + step-narration exclusion)"
result: completed, confidence 0.85
outcome: "accepted: scoped re-reviews rounds 1+2 -> round 2 All findings ADDRESSED, no new Critical/Important breakage; one narrow residual disclosed (deriving preamble 'don't have access' can still arm). Controller live-verified both directions: impossible 2 iters/10.3s/842tok honest abstain; qwen3:4b multi-step reasoning survives with correct answer. reasoning 3090/0, runtime 1678/0, replay 37/0. User-reported inefficient-termination defect CLOSED with measured lift."
```

```yaml
date: 2026-10-13
warden: kernel-warden
task: "W4 remainder: 4.4 outstanding recitation default-on (CONTRACT_PROFILE showOutstanding, F10 volatile tail, dedupe+satisfied-exclusion, cap 8 + (+K more), no-contract parity) + 4.5 deterministic escalation (strategy-ladder.ts, zero-LLM default path outcome-pinned, availableStrategies from KERNEL_STRATEGY_CANDIDATES, pattern-id handoff reason, keyObservations cap 12)"
result: completed, confidence 0.85
outcome: "accepted: review APPROVED 0C/1I/4M. Cache-safety verified STRUCTURAL (volatile-tail seam after compaction); parity pin genuine; zero-LLM claim outcome-proven (scripted evaluator ignored on default path); pattern-id reason real. Important #1: the plan's 4.4 tail-bloat guard (tokens/run) UNRUN -> parent measurement lane at wave close (always-outstanding floor makes the tail non-empty every contract run; bounded by cap). Minors: within-turn-only dedupe (intent clarification), 'requirement-relevant' wording vs evidence-bearing slice, candidate-naming comment, ladder-ignores-fit (bounded by maxSwitches=1 + carried iteration cap). GH #240 stays open (separate adaptive/decompose seam). reasoning 3101/0, runtime 1678/0, replay 37/0."
```

```yaml
date: 2026-10-13
warden: harness-warden
task: "Wave 4 close capture: detection (fixture-replay) + live termination + no-regression + tail-bloat guard + temperature-integrity check"
result: completed, confidence 0.9
outcome: "accepted as measurement; WAVE 4 NOT VERIFIED: detection PASS (146/146 arbiter non-progress, (c)/(d)/(e) trip, FP guard green), no-regression PASS, tail-bloat CLEAN (-7%/+4% noise), termination PARTIAL with a LIVE HONESTY REGRESSION (3/3 early-stop runs minted fabricated success claims, 0 tool calls, verdict success - the program's core false-success class via a new route) -> kernel fix dispatched + w4-terminate re-run required. Integrity finding: commanded temperature never reached the wire (provider default 0.5/0.3 recorded) - all temp-0 labels truth-upped with era note; threading fix routed to provider-warden. Warden discipline note: refused to mark the wave verified and escalated instead."
```

```yaml
date: 2026-10-13
warden: kernel-warden + provider-warden + runtime-warden
task: "Wave-4 close-capture escalations: (1) kernel honesty fix db7c5e985 (dispatcher-early-stop missing from HARNESS_FORCED_TERMINALS + gate fenced to completed while route yields partial -> false success 3/3); (2) provider temp diagnosis + adapter pins 5fb652362 (wire-broken: commanded temperature never reached the wire; trace faithful); (3) runtime root fix 129fc70b (command-first precedence; the escalated one-liner was incomplete - reactive.ts:228 second drop found and fixed, disclosed)"
result: completed (3 dispatches), confidence 0.9
outcome: "accepted pending review: honesty RED-first pin + over-blocking guard + cut all green (reasoning 3105/0); temp RED (Expected 0/Received 0.5) -> GREEN with command-first precedence (runtime 1686/0, reasoning 3109/0). Program-wide consequence: every historical temp-0 capture was wire-wrong (era-labelled); substrate restored, harness re-run dispatched. Provider warden correctly BLOCKED on the out-of-authority runtime seam rather than crossing it - contract working as designed."
```

```yaml
date: 2026-10-13
warden: harness-warden + runtime-warden
task: "Wave-4 verdict re-run at TRUE temp 0 (80bdc50dd) + temp fix round 1 (e8252af2: verification-retry third seam, changeset honesty, over-block intent pin)"
result: completed, confidence 0.93
outcome: "WAVE 4 VERIFIED: temp-0 substrate proven 9/9; honesty 0/5 fabricated (was 3/3); grounded S2 2/2 no over-block; detection/no-regression/tail-cost clean. Methodology: true-0 yields shape determinism (prior 'variance' was decoding temp). Temp threading now consistent at all THREE kernel seams (reasoning-think, reactive KernelInput, verification-retry); non-kernel strategies honestly scoped to GH #246. Residual filed for Wave 5: abstained output TEXT still ships success claims (verdict-level honest, content-level unscrubbed)."
```

```yaml
date: 2026-10-13
warden: runtime-warden
task: "temp fix round 1 (e8252af2): verification-retry third seam command-first + honest changeset scoping + over-block intent pin (controller ruling: abstain correct on zero grounding + harness-forced terminal)"
result: completed, confidence 0.9
outcome: "accepted: scoped re-review CLEAN - all 3 findings ADDRESSED (retry-route pin real, #246 claim verified by grep, intent pin revert-sensitive); no new breakage; unset-command path byte-identical. Temp threading consistent at all 3 kernel seams. WAVE 4 VERIFIED overall."
```

```yaml
date: 2026-10-13
warden: kernel-warden
task: "Wave 5 kernel lane: 5.1 contract coverage into verdict (outstanding>0 AND status!=abstention => cap at partial; S1/S3 as gate scenarios; cut RED) + 5.2 judgment citation plumbing; folds GH #245 (no-tool derived value => warn not hard-fail, benchmark fabrication still rejects) + close-capture content-scrub residual (abstained output no longer ships success claims)"
result: completed, confidence 0.85
outcome: "accepted pending review; S1-shape => abstained + scrubbed, S3-shape => partial + outstandingCriteria, grounded+satisfied unchanged, abstained unaffected. reasoning 3114/0, runtime 1682/0, replay 37/0. Concern routed to runtime lane: AgentResult.success coarse bit (execution-engine maps partial+substantive -> true) - runtime-warden 5.3/5.4 scope."
```

```yaml
date: 2026-10-14
warden: runtime-warden (stalled; controller-finished)
task: "Wave 5 runtime lane finish: 5.3 delegation composition (2ef324ec0) + 5.5 strategy-tier honesty (36739c89f)"
result: completed, confidence 0.8
outcome: "controller finished quota-blocked lane inline from warden drafts; fixed 3 draft defects (phantom metadata read, undefined function + invented shapes, decorative budget rire). Pins: delegation join RED->GREEN (severed), derivation 5/5, tools envelope 3/3. reasoning 3120/0, runtime 1693/0, replay 37/0. INDEPENDENT REVIEW OWED - subagent dispatch blocked on account usage limit. No live claim yet (harness capture still to run)."
```

```yaml
date: 2026-10-15
warden: controller-inline-review (subagents quota-blocked)
task: "Independent program review: code soundness + completed/remains accounting"
result: completed, confidence 0.8
outcome: "CRITICAL found+fixed in review: 5.3 join wired to dead executeToolCall (no production callers); live path is executeNativeToolCall->tool-observe. Fixed 7bba37606 with live-path pins (RED verified). 5.1/5.2 boxes corrected to [x]. Wave 5 code complete. Recommended: fresh-eyes reviewer pass + harness Wave-5 capture when quota returns."
```

```yaml
date: 2026-10-15
warden: controller-inline (subagents quota-blocked, recovered later)
task: "Review fix rounds: W5 crash envelopes + code-action route + mint-shape pin; W6 census reverse-arm + openInference order/idempotence + changeset + 6.3 remainder GH #248 + gateway refusal pin; W7 sink subscription wiring + autoshadow-loop live test + contention measured (+6s trivial-task) + cf-26 bound <=2; auto-shadow judge-contract preservation"
result: completed, confidence 0.85
outcome: "all review findings addressed with RED-verified pins; full suites green (runtime 1722/0, reasoning 3122/0, replay 37/0); W5/W6/W7 code complete pending independent re-review of fix rounds + harness verdict."
```

```yaml
date: 2026-10-15
warden: kernel-warden + reviewer + controller
task: "GH #244 preflight (93a1a27ee, review Approved) + #246 remainder (e07dbc848, review 1 Important) + blueprint patch-seam fix + #245 closure + #249/#250 follow-ups"
result: completed, confidence 0.85
outcome: "preflight live-verified 0 iters/0 tokens with capability reason (was 4-5/~1980). #245 CLOSED with live evidence (train problem now success:true). #246: all non-kernel strategies threaded + blueprint patch seam fixed per review; pipeline repair-retry filed as #250 (needs determinism sign-off). Open: #244 follow-ups #249, #246-follow-up #250, W3 promotion (owner), branch finish."
```

```yaml
date: 2026-10-15
warden: controller-inline + branch-reviewer
task: "Rung-2 on gemini (credit-block bypass) + rung-3 refix + branch-wide review response"
result: completed, confidence 0.85
outcome: "Rung-2: gemini FC-disabled shadow/act 3/3 each — taught grammar ignored (<tool_code> invented, deterministic); promotion NOT recommended (no end-to-end text-parse execution anywhere). Rung-3 refix: coder parses 9/9 (was 0/5), uses native FC, finals honestly failed; phi4 still hangs. Branch review must-fix all closed (3 changesets, plan hygiene, 4 issues closed, doc-truth one-liners); full suite 10369/20fail with 18 environmental-Docker + 2 fixed here (feature-matrix, ceiling 251 with rationale). Open trackers: #235,#237,#238,#240,#241,#242,#248,#249,#250 (+#234 backlog)."
```

```yaml
date: 2026-10-15
warden: kernel-warden (via general subagent; no warden agent types in this harness)
task: "GH #251 contract compiler mints task input files as deliverables (deriveDeliverablePaths listMode fallback)"
result: completed, confidence 0.9
outcome: "No-verb branch requires write-verb-before-token + no existential framing + no forward read veto (FORWARD_READ_WINDOW=80, WRITE_ADJACENT_WINDOW=30); S3 task now yields ['./report.md'] only, genuine multi-deliverable lists intact. TDD: 3 new tests failed-before/passed-after. Reasoning 3150/0 (baseline 3148+2 new-test fails), typecheck 69/69, 0 new as-any. Parent verifier: targeted 35/0, repro confirmed, multi-list intact."
bypass-reason: none
```

```yaml
date: 2026-10-16
warden: kernel-warden (via general subagent)
task: "GH #241 consumer half: guard-visible effective numCtx ceiling"
result: completed, confidence 0.9
outcome: "ContextProfile.explicitNumCtx + resolveEffectiveNumCtx (explicit ?? maxTokens); think.ts guard ceiling, log/metadata, demand cap read it. 8 tests RED-proven. Reasoning 3158/0 pre-producer. Residual: producer threading needed (parent dispatched runtime-warden)."
bypass-reason: none
```

```yaml
date: 2026-10-16
warden: runtime-warden (via general subagent)
task: "GH #241 producer half: seed explicitNumCtx at createRuntime + light config"
result: completed, confidence 0.9
outcome: "Both seed sites thread options.numCtx unless caller-explicit; 5 tests RED-proven; w2-wave-census ratchet green (was 1 pre-existing fail). Runtime 1727/0, typecheck green. Builder path traced read-only. Residual: reasoning dist rebuild needed for DTS (gitignored, done); createRuntime path pinned by code-identity+grep."
bypass-reason: none

```yaml
date: 2026-10-16
warden: none (parent-direct verification; zero domain edits, contract needs no warden)
task: "GH #234 verify-and-close: are per-strategy budget gates redundant post-#231?"
result: completed, confidence 0.9
outcome: "Premise FALSIFIED with current-code evidence: wave gate (plan-execute.ts:769-771) + reflect/self-correct gates + blueprint overBudget (:619-622) enforce direct-call spend the per-kernel Arbitrator never sees; both already read the shared meter via resolveRunSpend. Named tests 24/24, reasoning 3162/0. Closed with file:line evidence; no code change (correct per stale-premise rule)."
bypass-reason: none

```yaml
date: 2026-10-16
warden: none (main thread; release-warden.md authority manifest hard-refuses edits to scripts/release.ts, line 29)
task: "GH #235 release.ts stamps versions without bun.lock resync"
result: completed, confidence 0.9
outcome: "Added stamp -> bun install -> git add bun.lock after the version-stamp block (scripts/release.ts:280-286). Verified end-to-end with `bun scripts/release.ts 99.99.99 --no-publish` (exit 0, full build 38/38, lock resynced + staged). Then fully reverted test mutation, re-applied fix. Final: bun install --frozen-lockfile exit 0, build 38/38, typecheck 69/69, dry-run parses. No changeset (internal tooling, not a published package)."
bypass-reason: none

```yaml
date: 2026-10-15
warden: kernel-warden (via general subagent; no warden agent types in this harness)
task: "GH #251 contract compiler mints task input files as deliverables (deriveDeliverablePaths listMode fallback)"
result: completed, confidence 0.9
outcome: "No-verb branch requires write-verb-before-token + no existential framing + no forward read veto (FORWARD_READ_WINDOW=80, WRITE_ADJACENT_WINDOW=30); S3 task now yields ['./report.md'] only, genuine multi-deliverable lists intact. TDD: 3 new tests failed-before/passed-after. Reasoning 3150/0 (baseline 3148+2 new-test fails), typecheck 69/69, 0 new as-any. Parent verifier: targeted 35/0, repro confirmed, multi-list intact."
bypass-reason: none

```yaml
date: 2026-10-16
warden: none (parent-direct; packages/tools not in warden table)
task: "GH #226 bounded-parallel.test.ts real setTimeout flake risk"
result: completed, confidence 0.9
outcome: "Replaced 4 wall-clock setTimeout(r, N) calls (N∈{5,10-50}) with deterministic Promise.resolve() microtask yield (yieldOnce). boundedMap implementation already order-guaranteeing via index-based slots; active++ is synchronous so maxActive is deterministic. No implementation change needed. bounded-parallel.test.ts 4/4 green, typecheck 6/6 green, setTimeout count in test → 0, 0 new as unknown as."
bypass-reason: none

```yaml
date: 2026-10-16
warden: none (parent-direct; packages/trace not in warden table)
task: "GH #237 RunStartedEvent lacks taskTruncated marker"
result: completed, confidence 0.9
outcome: "Added readonly taskTruncated?: boolean to RunStartedEvent (events.ts:88-95), mirroring RunCompletedEvent.outputTruncated. normalize.ts AgentStarted case carries raw.taskTruncated via ...(raw.taskTruncated === true ? { taskTruncated: true } : {}). New tests: taskTruncated:true flows through; absent stays absent (historical traces byte-identical). trace suite 174/0 (baseline 172), typecheck green, 0 new as unknown as."
bypass-reason: none

```yaml
date: 2026-10-16
warden: none (parent-direct; packages/compose not in warden table)
task: "GH #248 part 2: watchdog resets no-progress timer on llm-exchange (after('think'))"
result: completed, confidence 0.9
outcome: "Added harness.after('think', () => { lastProgress = Date.now(); }) to watchdog.ts after the existing after('act') reset. A slow-but-progressing LLM exchange during think no longer triggers a false watchdog abort at the next before('think') boundary. New test proves reset on after('think'). compose test suite 30/0 (baseline 29 + 1 new), typecheck green, 0 new as unknown as. Part 1 (shared computeBudgetSignal) not addressed — separate design pass needed."
bypass-reason: none

```yaml
date: 2026-10-20
warden: runtime-warden (via general subagent; no warden agent types in this harness)
task: "GH #217 reactive-agent.ts decomposition (3,303 LOC, 4 top-level exports)"
result: completed, confidence 0.92
outcome: "4 cohesive clusters moved verbatim into packages/runtime/src/agent/{judgment-facade,skills-facade,durable-facade,run-task-effect}.ts (350/181/459/547 LOC); class methods became thin per-call deps-object delegates preserving live-read of mutable class state. Parent verifier: typecheck 24/24, runtime suite 1677/7/0 = exact baseline (re-run 3x), cast-ceiling green (39 flat), 0 new as-any, surface bit-identical. Review pass: JudgeInput canonicalized on judgment-facade (removed type-only back-import cycle). Known micro-debt: safeParseJson duplicated ~15 LOC in durable-facade + run-task-effect; pattern-modernization (async/Promise class facade) explicitly out of scope."
bypass-reason: none

```yaml
date: 2026-10-20
warden: runtime-warden (via general subagent; no warden agent types in this harness)
task: "GH #218 builder.ts decomposition (3,348 LOC at bundle time, largest exported-API file)"
result: completed, confidence 0.92
outcome: "builder.ts 3,348 -> 2,222 LOC via verbatim moves: build() -> builder/build/build-agent.ts, buildEffect()+warnIfImplicitTestProvider -> builder/build/build-effect.ts, 61 with* bodies -> 7 builder/withers/* modules; delegates are thin applyWithX over per-call asBuilderState(this) views. Overload sets verified identical; surface bit-identical. Verifier: typecheck rc=0 + downstream 29/29, suite 1677/7/0 exact baseline, ceiling flat, 0 new throw/as-any. Contract-coupled bodies stayed on class (withMCP dispatch, withOutputSchema inline-cast return, _assertRuntimeStateViewShape drift guard) - documented extraction-boundary rule."
bypass-reason: none

```yaml
date: 2026-10-20
warden: kernel-warden (via general subagent; no warden agent types in this harness)
task: "GH #219 think.ts decomposition (2,445 LOC at bundle time; one ~2,100-LOC handleThinking)"
result: completed, confidence 0.95
outcome: "think.ts 2,445 -> 676 LOC as a 6-stage orchestrator; 10 verbatim modules under capabilities/reason/ (dispatch-think-response 800 is the largest); canonical request core kept inline by design (check-projection/check-domain-only-fc/check-volatile-placement grandfathered lines). Verifier: tsc rc=0, suite 3163/4todo/0f exact baseline, ceiling 2/2 (0 casts in think.ts+10 modules), all 4 enforcement scripts PASS, kernel invariants untouched (signature byte-stable, runner/terminate/loop-detector untouched)."
bypass-reason: none

```yaml
date: 2026-10-22
warden: runtime-warden + kernel-warden (parallel general-subagent dispatch; MissionBrief-in / UpwardReport-out)
task: "GH #262 durable tool-effect records + crash-window resume reconciliation (raised externally by Raju Dandigam)"
result: completed, confidence 0.9/0.93
outcome: "Parent landed the core seam first (RunControllerLike awaited onToolEffectStart/onToolEffectEnd, ToolEffectSpec/Record types, RecoveredToolEffectsRef keyed by toolEffectIdentityKey=tool+canonical-args, TrustReceipt.effects[] + ui-core wire mirror). runtime-warden: run_effects RunStore table (PK run_id+effect_id, putToolEffect/updateToolEffectOutcome/listToolEffects), awaited never-throw observer impl, resumeRun reconciliation (succeeded row = recovered; terminal-less executing row = ambiguous-then-replayed), receipt threading, deterministic cross-process crash tests. kernel-warden: act routes ALL dispatch paths through tool-observe.ts recovery consult + awaited observers with fx-<taskId>-<iter>-<idx> ids and recovered-injection (tool NOT re-executed, metadata.recoveredEffect provenance). Verifier (parent): typecheck 69/69 green; core 178/0, runtime 1746/0, reasoning 3175/0, ui-core 37/0; built-surface green after package rebuild. One commit per land: core seam / kernel / runtime / docs+FM catalog+changeset. FM-A3 catalog entry added."
bypass-reason: none

```yaml
date: 2026-10-22
warden: none (parent-direct; scripts/ + gate fixtures are outside warden tables)
task: "Quality program Tasks 1+2: file-size ratchet + string-throw ceiling gates (GH #259)"
result: completed, confidence 0.9
outcome: "check-file-size.sh: 24 files pinned at wc -l ceilings, shrink-only deliberate-ledger law, new-giant block, SCAN-EMPTY, 9 red-on-cut fixtures (PR #263). check-string-errors.sh: new Error( pool pinned 300 (299 capture +1 attributed #262 site via PR #270 fix), 7 fixtures parsing the ledger (PR #269). Gate earned its keep same-day: forced attributed ledger edits for #262's real feature growth (+2/+32). Review finding fixed pre-merge: removed ledger-size floor (would go red on program success). TDD honored: fixtures RED before scripts both times. Verified (measured): reasoning 3,189 pass / 4 todo / 0 fail (369 files); runtime 1,679 / 7 skip / 0 fail (310 files); enforcement lane 24/24. NOTE both suites moved off the 217-219-era baselines because of peer durable-effect work #262; program recorded new numbers in plan Verification Protocol.."
bypass-reason: none

```yaml
date: 2026-10-22
warden: none (parent-direct; gate scripts + fixtures outside warden tables)
task: "Quality program Task 3: instanceof ceiling (129) + inventory artifact"
result: completed, confidence 0.9
outcome: "check-string-errors.sh twin ledger INSTANCEOF_BASELINE=129 occurrences (128 lines, one double-match), collect-FAIL dual verdict; inventory at wiki/Research/Audit-Reports-2026-10-22/instanceof-error-inventory.md (per-file distribution + all 129 sites - the Phase-2 rejection-identity blast radius D3 must carry deliberately); header's 43-site figure corrected to 129/43 split. Fixtures 7->11 cases, TDD RED-first honored (8/10 pre-script RED). Measured: real tree 300/129 green; 11/11; lane 24/24; reasoning 3,193/4todo/0/369; tsc rc=0; ceiling 2/2 flat; 0 casts in new/edited files; no new test FILES (README count stable)."
bypass-reason: none

```yaml
date: 2026-10-22
warden: runtime-warden (via general subagent; no warden agent types in this harness)
task: "GH #221 execution-engine.ts decomposition (program Task 4; 1,976 LOC regrown past W24)"
result: completed, confidence 0.92
outcome: "1,976 -> 991 LOC via 11 verbatim engine/execute-* modules (obs-wiring, event-collectors, killswitch-bridge, telemetry-notice, lifecycle-guard, agent-started, output-derivation, output-screens, success-invariants, result-assembly, completion-obs); Refs/accumulator identities passed in never re-created (Effect-native adaptation of the #217 deps-object idiom); tag/interface/Live export bit-identical; index.ts untouched. Stayed inline with reasons: isRootExecution+status-renderer cluster (source-scanning test pins it to the file), executeCore preamble/PhaseDeps/phase-dispatch/debrief-prep glue (fiber-scope). Parent verifier: tsc rc=0 + downstream 29/29; runtime suite 1679/7/0/310 EXACT; ceiling 2/2 (new modules 0 casts); verbatim line-set proof 0 divergences. Ratchet: check-file-size ceiling 1976->991 shrunk as a deliberate ledger commit AFTER the refactor commit (bisect-clean). Follow-up flagged: emitErrorSwallowed site-strings kept byte-identical; re-anchoring tranche rides Task 5."
bypass-reason: none

```yaml
date: 2026-10-22
warden: none (parent-direct; test authoring under seam protocol)
task: "Quality program Task 5: seam-level behavioral pins for all 3 decomposition families + site-string re-anchor"
result: completed, confidence 0.9
outcome: "3 direct-import pin files (withers applyWithBudget 4 pins incl #9 no-empty-spend invariant; agent makeSkillsFacade 3 pins with ARRAY-IDENTITY pass-through + agentId wiring spy + zero-cast ManagedRuntime stub via GenericTag key interning; resolveThinkToolSurface pressure-gate refuse vs narrow arms). RED-on-cut proven per file (forced spend-object, renamed store tag key, short-circuited pressureCritical - each reddened exactly the expected arms, restored clean). Re-anchored 17 stale emitErrorSwallowed site strings in engine/execute-* to true paths (13 numeric, 4 semantic anchors); grep-verified no test pinned the stale strings. Measured: runtime 1,693/7skip/0/312 (=1,686+7), reasoning 3,199/4todo/0/370 (=3,193+2), wiring 4/4, tsc rc=0 both, ceiling 2/2, 0 casts in new files, README metrics synced."
bypass-reason: none

```yaml
date: 2026-10-23
warden: runtime-warden (via general subagent; no warden agent types in this harness)
task: "Quality program Task 6: D1 bridge family 1 (skills facade Effect-ization)"
result: completed, confidence 0.9
outcome: "skills-facade methods now Effect.Effect<A,E,R> (E = never/Error/never + deliberate Errors); Promise boundary in the shell via SHARED agent/run-facade-effect.ts. Two self-gates fired during review and shaped the design: private bridge copy grew reactive-agent.ts +37 (check-file-size FAILED the PR -> shared module, shell delta +4, attributed ledger raise to 2344); preserveError identity helper added 4 new Error(/1 instanceof sites (check-string-errors FAILED -> defect-channel fold via Effect.sync/Effect.promise, ratchets back to exactly 300/129 net-zero). Empirical: runPromise FiberFailure-wraps typed failures on effect@3.19 -> bridge = catchAllDefect->either->Promise.reject(Left), scratch-proven instance-identity. loadSkill inner runPromise kept (FiberFailure-value identity). Seam pins 3->5 incl. two shell-path rejection-VALUE pins (raw Error + raw ErrnoException code). Parent: tsc rc=0; suite Ran 1,695/7skip/0 = exact baseline+2; lane 24 scripts green; ceiling 2/2; merged #274."
bypass-reason: none
```

```yaml
date: 2026-10-23
warden: kernel-warden (via general subagent; no warden agent types in this harness)
task: "GH #220 arbitrator.ts decomposition (program Task 7; 1,970 LOC, 31 exports, four content-scanning scripts anchor it)"
result: completed, confidence 0.9
outcome: "1,970 -> 850 LOC via 10 verbatim decide/* modules (bodies diff-proven) + re-export shim keeping ALL 31 export names resolvable from arbitrator.ts (compile-side scratch + runtime 18/18 values + 13 types). ANCHOR AUDIT first (v26b): every region pinned by check-run-assessment (grounding-redirect budget writes), check-run-contract (deriveConditions call), check-success-authority (verifyDelivery + no-bare-verify), check-termination-paths (exit-success literal) stayed INLINE; sole termination authority untouched. Parent verifier: tsc rc=0; six scripts green; reasoning 3,195/4todo/0/370 exact; ceiling 2/2 (0 casts touched set); scope 1+10 files under decide/; ledger shrink 1970->850 as its own commit (ratchet intermediate-red by design); merged #275, #220 closed."
bypass-reason: none
```

```yaml
date: 2026-10-23
warden: runtime-warden (via general subagent; no warden agent types in this harness)
task: "Quality program Task 8: D1 bridge family 2 (judgment facade Effect-typed)"
result: completed, confidence 0.92
outcome: "judge/listJudgmentModels/judgeRank -> Effect with precise E (6 deliberate arms raw via bridge, message-identical); backend sections keep preserved inner runPromise boundaries (Effect.promise wrap) because agent-list-judgment-models pin (c) — outside warden authority — proves callers observe the FiberFailure wrapper shape for catalog rejects. Shared runFacadeEffect reused (shell net-zero at ceiling, no private copy); twin ratchets exactly 300/129; new seam file 4 shell-path pins (deliberate-raw + branch order + wrapper tripwire), 0 casts; README metrics synced in-branch. Parent: tsc rc=0; 23/23 lane; suite Ran 1,699/7skip/0 = baseline+4 exact; ceiling 2/2; merged #276."
bypass-reason: none

```yaml
date: 2026-10-23
warden: kernel-warden (via general subagent; no warden agent types in this harness)
task: "GH #222 runner.ts + iterate-pass.ts decomposition (program Task 9; seven content-anchored scripts, heaviest anchoring in repo)"
result: completed, confidence 0.9
outcome: "runner.ts 1,903->953, iterate-pass.ts 1,896->1,266 via 14 verbatim kernel/loop/* seam modules (largest: terminal-verify-gate 460, assessment-seam 288, post-loop-deliverable 252, control-plane-seams 255, resume-reentry 225). Anchor audit governed placement: main-loop spine (Cat-9), all counter writes, policy-compile/contract-seed/control-plane seams, every terminal WRITE site stayed inline; single-termination-owner + loop-detector untouched. 10 documented control-flow adapters (inner break/continue -> driver-honored returned flags, existing precedent). Parent: six anchored scripts green unedited; tsc rc=0; suite 3,195/4todo/0/370 exact after deliberate ledger shrinks (own commit); ceiling 2/2; 0 casts; export census net-zero via shims. Merged #277, #222 closed."
bypass-reason: none

```yaml
date: 2026-10-23
warden: runtime-warden (via general subagent; no warden agent types in this harness)
task: "Quality program Task 10: D1 bridge family 3 (durable facade Effect-ization; mixed-boundary case)"
result: completed, confidence 0.9
outcome: "8 async methods -> sync Effect<A, Error> (R=never; generics preserved); shared runFacadeEffect wraps 8 delegates in-place (shell net-zero 2,344, no new imports). Identity audit: 17/17 inner runPromise/Promise sites caller-observable through pre-bridge async delegates -> ALL preserved inside Effect.promise wrapping, ZERO folded, ZERO fiber-parent changes; 7 guard arms + 1 unwrap arm ride E byte-verbatim and were raw pre-bridge (no wrapped->raw delta this family); resumeRun try/catch scoping mirrored (inner gen + catchAllDefect, status-mark boundaries keep routing semantics). ACCEPTED DEVIATION: getDurableInfo stays sync pure accessor (Effect-izing = observable API break). New seam file: 3 shell-path pins incl wrapper-identity tripwire + empirics refinement (FiberFailure cause identity in .name, String(err) carries it); README metrics synced in-branch. Parent re-verified: tsc rc=0; ratchets exact 300/129; 23/23 lane; suite Ran 1,702 = pristine 1,699 + 3 pins exact; ceiling 2/2; 0 casts."
bypass-reason: none
