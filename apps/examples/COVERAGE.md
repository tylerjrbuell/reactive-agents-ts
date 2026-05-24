# Example Suite Coverage Matrix

Living checklist: every public framework API and shipped mechanism MUST have ≥1
offline-runnable example witness registered in `index.ts`. This file is the
release criterion for the "canonical smoke suite" goal.

Legend:
- ✅ — covered by ≥1 registered example, witness asserts behaviour
- 🟡 — xfail / aspirational failing-spec witness (gap documented in code)
- ❌ — no witness, no xfail; gap not yet captured
- 🔵 — covered indirectly (mentioned in a multi-feature example, not the focus)

Updated: 2026-05-23. Smoke run: 40 examples, 6 xfail, 0 fail.

---

## Tier 1 — Core builder API (must-cover; agent ergonomics)

| API | Status | Example | Notes |
|---|---|---|---|
| `withProvider(name)` | ✅ | every example | |
| `withModel(string\|params)` | ✅ | 01, 04 | |
| `withName(name)` | ✅ | every example | |
| `withAgentId(id)` | ✅ | F7 | stable id required for cross-session recall |
| `withTestScenario(turns)` | ✅ | most offline examples | |
| `withReasoning(options)` | ✅ | 01, 05, every reasoning ex | |
| `withTools(options)` | ✅ | 05, T7, T8 | |
| `withMemory(tier\|options)` | ✅ | 03, F7 | |
| `withSkillPersistence(enabled)` | ✅ | F7 | HS-122 |
| `withSessionPersistence()` | 🟡 | FX1 (xfail) | builder hook missing — SessionStoreServiceLive wired in runtime.ts:1354 |
| `withMaxIterations(n)` | ✅ | 04, 15, A22-archived | |
| `withMinIterations(n)` | ✅ | F8 | builder-state fingerprint |
| `withBudget(limits)` | ✅ | F8 | builder-state fingerprint |
| `withTimeout(ms)` | ✅ | F8 | builder-state fingerprint |
| `withRetryPolicy(policy)` | ❌ | — | needs failure-then-success scenario |
| `withErrorHandler(fn)` | ❌ | — | needs error scenario |
| `withHook(hook)` | ✅ | 02 | lifecycle hooks |
| `withHarness(fn)` | ✅ | A20 | compose API |
| `withLeanHarness()` | ❌ | (archived A22) | witness needs verifier prompts test provider doesn't generate |
| `withSystemPrompt(s)` | ✅ | F5 | exercised inline |
| `withPersona(p)` | ✅ | F5 | exercised inline |
| `withTaskContext(ctx)` | ✅ | F8 | builder-state fingerprint |
| `withEnvironment(env)` | ✅ | F8 | builder-state fingerprint |
| `withDocuments(docs)` | ✅ | F8 | builder-state fingerprint |
| `withStreaming(opts)` | ✅ | 23, 24, S25 | |

## Tier 2 — Mechanism witnesses (M1–M13)

| Mechanism | Status | Example | Notes |
|---|---|---|---|
| M1 RI dispatcher | 🔵 | every reactive run | entropy metric emitted; no focused witness |
| M2 Strategy switching | ✅ | R21 | wiring path witness; `control.strategy-evaluated` tag doesn't fire under test provider — cassette gap |
| M3 Verifier+retry | ❌ | — | needs failure-then-success scenario |
| M4 Healing pipeline | ✅ | T8 | direct healer-API exercise; in-loop healing under reactive strategy is a cassette gap |
| M5 Context curation | ✅ | R22 | direct curator-API exercise; in-loop budget crossing is a cassette gap |
| M6 Skill system | ✅ | F7 | cross-session recall via shared dbPath |
| M7 Calibration | ❌ | — | model-tier calibration witness missing |
| M8 Sub-agent delegation | ✅ | 04, 09, 10 | 04 + 09 + 10 now offline (flipped requiresKey) |
| M9 Termination oracle | 🔵 | every run | no focused witness; observe termination reason codes |
| M10 Memory system | ✅ | 03, F7 | |
| M11 Diagnostic system (rax-diagnose) | ✅ | A23 | programmatic API exports witnessed |
| M12 Provider adapters | 🔵 | 01 (ollama+test) | only 2 of 6 providers exercised offline |
| M13 Guards + meta-tools | ✅ | 12 | guardrails offline now witnessed |

## Tier 3 — Controller decision variants (13 total, see types.ts:181)

| Variant | State | Example | Notes |
|---|---|---|---|
| `early-stop` | ✅ ACTIVE | implicit in R21 | no focused witness |
| `compress` | 🟡 UNFIRED | ❌ | needs corpus expansion |
| `switch-strategy` | ✅ ACTIVE | R21 (wiring only) | full firing under cassette only |
| `temp-adjust` | 🟡 UNFIRED | ❌ | |
| `skill-activate` | 🟡 UNFIRED | partial F7 | needs persisted-skill match scenario |
| `prompt-switch` | ⚠ UNWIRED | 🟡 IX2 (xfail) | handler missing |
| `tool-inject` | ✅ ACTIVE | HS-115 nominator | no example yet |
| `tool-failure-redirect` | 🟡 UNFIRED | ❌ | |
| `memory-boost` | ⚠ UNWIRED | 🟡 IX2 (xfail) | handler missing |
| `skill-reinject` | ⚠ UNWIRED | 🟡 IX2 (xfail) | handler missing |
| `human-escalate` | ⚠ UNWIRED | 🟡 IX1 (xfail) | bridge to interaction-manager.approvalGate missing |
| `stall-detect` | ✅ ACTIVE | ❌ | no focused witness |
| `harness-harm` | 🟡 UNFIRED | ❌ | needs failure-corpus signal |

## Tier 4 — Trust / safety (M13-adjacent)

| API | Status | Example | Notes |
|---|---|---|---|
| `withGuardrails(opts)` | ✅ | 12 | offline witness via test branch |
| `withVerification(opts)` | ✅ | 13 | offline witness via test branch |
| `withIdentity()` | ❌ | 11 requires key | offline branch missing in example |
| `withKillSwitch()` | ✅ | 12 | exercised inline in guardrails example |
| `withBehavioralContracts(...)` | ✅ | 12 | exercised inline in guardrails example |
| `withStrictValidation()` | ❌ | — | |

## Tier 5 — Composition & multi-agent

| API | Status | Example | Notes |
|---|---|---|---|
| `withAgentTool(...)` | ✅ | 04 | researcher-as-tool |
| `withDynamicSubAgents(opts)` | ✅ | 10 | offline witness via test branch |
| `withRemoteAgent(name,url)` | ❌ | — | |
| A2A protocol | ✅ | 08 + MX1 xfail | 08 offline witness; offline cassette gap (MX1) |
| `withOrchestration()` | ✅ | 09 | offline witness via test branch |
| `withChannels(cfg)` | ❌ | — | |

## Tier 6 — Tools

| API | Status | Example | Notes |
|---|---|---|---|
| `withTools()` builtin | ✅ | 05 | |
| `withTerminalTools(cfg)` | ❌ | — | shell-execution surface |
| `withMCP(cfg)` | ❌ | 06, 07 require key | offline MCP combined witness missing |
| Dynamic register/unregister | ✅ | T7 | |
| `withRequiredTools(cfg)` | ❌ | — | HS-115 nominator wires through this surface |

## Tier 7 — Observability / cost / lifecycle

| API | Status | Example | Notes |
|---|---|---|---|
| `withObservability(opts)` | ✅ | 17 | offline witness via test branch |
| `withTelemetry(cfg)` | ❌ | — | RI telemetry export |
| `withLogging(cfg)` | ❌ | — | |
| `withCostTracking(opts)` | ✅ | 14 | offline witness via test branch |
| `withModelPricing(...)` | ❌ | — | |
| `withDynamicPricing(...)` | ❌ | — | |
| `withTracing(...)` | ❌ | — | |
| `withTraceRecorder({path})` | 🟡 | AX1 (xfail) | builder hook missing |
| Snapshot/Replay | ✅ | A21 | identity-replay + diff witness |
| RunHandle / terminate | ✅ | S25 | |
| `withEvents()` | ❌ | — | |
| `withHealthCheck()` | ❌ | — | |
| `withCircuitBreaker(...)` | ❌ | — | |
| `withRateLimiting(...)` | ❌ | — | |
| `withFallbacks(...)` | ❌ | — | |

## Tier 8 — Reasoning extensions

| API | Status | Example | Notes |
|---|---|---|---|
| `withReactiveIntelligence(cfg)` | ✅ | 05 (implicit), A22-archived | |
| `withCalibration(mode)` | ❌ | — | M7 witness |
| `withContextProfile(profile)` | ✅ | 20 | |
| `withMemoryConsolidation(cfg)` | ❌ | — | |
| `withExperienceLearning()` | ❌ | — | |
| `withSelfImprovement()` | ✅ | 18 | offline witness via test branch |
| `withSkills(...)` | ❌ | — | (distinct from withSkillPersistence) |
| `withMetaTools(...)` | ❌ | — | M13 meta-tool surface |
| `withProgressCheckpoint(...)` | ❌ | — | |
| `withVerificationStep(...)` | ❌ | — | |
| `withOutputValidator(...)` | ❌ | — | |
| `withCustomTermination(...)` | ❌ | — | |
| `withLayers(...)` | ❌ | — | Effect-TS layer composition |
| `withCacheTimeout(...)` | ❌ | — | |

## Tier 9 — Packages without builder hook

| Package | Status | Example | Notes |
|---|---|---|---|
| `@reactive-agents/replay` | ✅ | A21 | |
| `@reactive-agents/trace` | 🟡 | AX1 (xfail) | builder hook missing |
| `@reactive-agents/diagnose` | ✅ | A23 | programmatic API witness (DEFAULT_TRACE_DIR, listTraces, resolveTracePath, 6 cmd exports) |
| `@reactive-agents/observe` | ❌ | — | OTLP export |
| `@reactive-agents/eval` | 🟡 | 16 (xfail L1) | JudgeLLMService unbound w/ single provider |
| `@reactive-agents/compose` | ✅ | A20 | killswitch witness missing |
| `@reactive-agents/interaction` | ✅ | 21 + IX1 xfail | offline mode covered; approval-gate gap |

---

## Roll-up

- **Tier 1 (core builder):** 24 ✅, 1 🟡, 5 ❌ → ~80% covered
- **Tier 2 (M1–M13 mechanisms):** 8 ✅, 5 ❌ → ~62% covered (most remaining gaps are cassette-driven)
- **Tier 3 (controller variants):** 1 ✅, 4 🟡, 8 ❌ → ~38% covered
- **Tier 4 (trust/safety):** 4 ✅, 2 ❌
- **Tier 5 (multi-agent):** 4 ✅, 2 ❌
- **Tier 7 (obs/cost/lifecycle):** 5 ✅, 1 🟡, 11 ❌
- **Tier 9 (packages):** 5 ✅, 2 🟡, 0 ❌ → **100% covered**

**Suite:** 40 examples, 6 xfail, 0 fail offline. Up from 28/4/0 prior to W3.

## W3 priority list (close-out, by leverage)

Top-of-funnel: surfaces shipped without any witness that block the ship of release gates.

1. **`withKillSwitch()` + 6 compose killswitches** — 3 shipped dead per May 19 honesty sweep; one witness toggles each + asserts fired.
2. **`withGuardrails()` offline** — M13-adjacent; trust surface needs offline witness.
3. **`withVerification()` offline** — same.
4. **`withMCP()` offline combined harness** — filesystem + github + nominator orchestration in a single witness.
5. **`@reactive-agents/diagnose` programmatic API witness** — packages/diagnose/src/cli.ts exists; expose JS API and witness.
6. **`withCostTracking()` offline** — cost-tracking under test provider should work; witness it.
7. **`withObservability()` offline** — same.
8. **`withCalibration()` (M7 witness)** — model-tier calibration data flow witness.
9. **`withDynamicSubAgents()` offline** — multi-agent without API key.

Defer to W4+ (cassette infrastructure prerequisites):
- M2 full `control.strategy-evaluated` firing
- M4 in-loop healing under reactive strategy
- M5 in-loop budget crossing
- A2A offline cassette replay (xfail MX1)
- withLeanHarness step/token delta (archived A22)

## Live-run findings (smoke suite output)

These are real defects surfaced by running the suite against live providers,
not synthetic gaps. They belong in the ranked work queue.

| # | Example | Mode | Symptom | Hypothesis | Severity |
|---|---|---|---|---|---|
| L1 | 16 eval-framework | ollama live | `Service not found: JudgeLLMService` mid-eval | `@reactive-agents/eval` requires a judge LLM service that is not auto-resolved when the agent is built with a single provider; eval-framework example uses ollama for both the subject and the judge but JudgeLLMService is never bound. Needs explicit `.withEvalJudge(provider)` builder hook OR auto-bind from default provider. | high |
| L2 | tools/05 cogito | ollama live | `output-gate Synthesized output to match requested format: prose` — silent format coercion | Output-gate rewrites without emitting a decisionType telemetry event; observers cannot distinguish a real LLM answer from a coerced one. | medium |
| L3 | tools/05 termination divergence | ollama live | cogito terminates `final_answer`, qwen3 `final_answer_tool` — divergent reason codes for same task | Two paths into `terminate.ts`; reason-code surface uncalibrated. | low |
| L4 | reasoning/20 qwen3 vs cogito | ollama live | qwen3 emits 264% more tokens than cogito for identical 4-tier task | Context-curator does not normalize model verbosity; Pillar 6 efficiency gap. | high |
| L5 | reasoning/19 adaptive:select | ollama live | adaptive always picks `reactive` even for multi-turn-memory question on both models | Selector heuristic underutilizing plan-execute/ToT; needs task-intent gating. | medium |

## Goal-hook release criterion

The smoke-suite goal hook releases when:

- Every Tier 1 entry is ✅ or 🟡 (no ❌)
- Every Tier 2 mechanism (M1–M13) is ✅ or 🟡
- Every Tier 9 package surface is ✅ or 🟡
- `bun run smoke` exits 0 with all xfails accounted for
- `bun run smoke:strict` documents the remaining gaps as hard failures (release-gate target)

Tier 3 / 4–8 are nice-to-have; their absence is logged but does not block goal release.
