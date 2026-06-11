---
type: pilot-log
status: active
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

## Summary (2026-06-15)

(written on evaluation day)
