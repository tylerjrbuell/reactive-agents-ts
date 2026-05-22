# Execution Retro: harness-lifecycle-hook-errors

Date: 2026-05-21
Budget: 60 min | Actual: ~55 min

## Outcomes

- Issues closed: #74 (HS-14) — pending PR #97 merge
- Issues descoped: none (singleton bundle, all in scope)
- Net test delta: +6 / 0 (798 pass / 0 fail / 1 skip — was 792 / 0 / 1)
- Net LOC delta: +44 / -13 in `packages/runtime/src/builder.ts`; new test file (+200 LOC)
- Verified-by recheck: `grep -c '.catch(() => undefined)' builder.ts` → 0 (was 3 → hook sites at 794, 807 removed)

## What worked

- **Cross-package descope gate fired correctly.** Issue body's "Fix direction" suggested `AgentEvent.HookFailed`, which would have crossed into `@reactive-agents/core`. Restricting to `_errorHandler` routing kept the bundle in runtime, single package. Clean PR.
- **Baseline capture caught a pre-existing red.** `tsc --noEmit` shows `focusedTools` error at `runtime-construction.ts:337` — pre-existing, filed as #93. Baseline rule meant I didn't burn time investigating a "regression".
- **Direct-invocation tests over integration tests.** When the kernel-fire site (`runner.ts:683`) turned out to be bypassed by `withTestScenario`, pivoting to invoke wrappers via `RegistrationHarness._collected` pinned the actual unit under test. Faster, more deterministic, no test scaffolding overhead.
- **Probes were cheap.** Adding `console.error('[probe] ...')` to trace whether my wrapper fired during the failing integration test (~3 minutes) saved me from blindly tweaking the fix. Empirical confirmation that the wrapper never ran cut straight to the test rewrite.

## What didn't

- **Initial test design over-relied on agent.run().** Spent ~15 min trying to make `withTestScenario` + `withReasoning()` + `withHook(throwing)` reach the harness-pipeline fire site. The path doesn't exist — the test provider short-circuits the reactive loop. Should have verified the fire-site reachability *before* writing the integration test.
- **The issue claim was technically incomplete.** Body cited `builder.ts:794,807` as "swallows hook errors". True for the *harness observability path*. The *engine path* (via `LifecycleHookRegistry`) actually escalates sync throws as defects through `Effect.catchAll` (which doesn't catch defects), propagating to `reactive-agent.ts:549` and firing `_errorHandler` already. So the original symptom (invisibility) was already partially fixed via the engine path's defect escape. Bundle still valid — secondary path also matters — but the verified-by framing was missing that the engine path was already visible.

## Skill improvements (apply on next pass)

1. **Phase 3 PLAN: add a "fire-site reachability check" sub-phase.** Before designing integration tests, grep the codebase to verify the test scenario will actually exercise the code under fix. For #74, the fire site was `runner.ts:683` (kernel loop); the test provider doesn't reach it. A 30-second `grep` would have flagged this. Saves the false-start.
2. **Phase 2 BUNDLE: clarify "engine vs harness path" cohesion signal.** A hook can fire through multiple paths in this codebase (engine `LifecycleHookRegistry`, harness `HarnessPipeline`, inline-think config). If an issue cites a single site, verify whether sibling paths share the bug shape — they may need the same fix or already be correct. For #74, the engine path already surfaces hook errors via defect propagation; only the harness path needed the fix. Without that distinction, a fix targeting "all hook paths" would be overscope.
3. **Phase 4 EXECUTE: when integration tests don't reach the unit, fall back to direct-invocation tests early.** This bundle would have completed faster if I'd started with direct `RegistrationHarness` invocation rather than `agent.run()` → kernel → harness. Rule: if your unit-under-test is reached via a deep call chain that involves orthogonal config (provider, reasoning strategy, test scenario), prefer direct invocation of the wrapping helper.

## Process inflation guard (HS-18/22/31 lesson)

- Was the verified-by inflated? **Partial.** Issue claimed `.catch(() => undefined)` swallows hook errors invisibly. True for the harness path. Engine path already surfaces sync throws via defect escape (not swallow). So the "invisible" framing was 50% accurate — the harness duplicate-fire was silent, the engine path was already visible. A more precise verified-by would have been: `grep '.catch(() => undefined)' builder.ts | grep -v 'Effect.runPromise'` → narrowed to the hook sites specifically.
- Document the inflation shape: **claim/scope conflation**. The issue's symptom phrasing ("user hook failures invisible") conflated the harness path's silent swallow with the broader claim that all hook errors are invisible. They aren't, on the engine path. Audit findings citing a *single-file location* should also describe *which call-graph path* through that file is affected, especially when the same surface fires from multiple paths.
