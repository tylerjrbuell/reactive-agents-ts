---
aliases: [Health Sweep 2026-08-07]
tags: [debrief, health-sweep, type-safety]
---

# Health Sweep 2026-08-07 — Error Observability + Cast Cleanup

Continuation of [[2026-08-06-health-sweep-debrief|2026-08-06 sweep]]. Focused on two P1 bug clusters: silent error swallowing and gratuitous `as any` casts.

## Baseline → Final

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Build | 37/37 GREEN | 37/37 GREEN | — |
| Tests (full suite) | 8765 pass / 1 fail | 8765 pass / 1 fail | — |
| WS-5b ceiling (`as unknown as`) | 84 vs 75 (fail, pre-existing) | 84 vs 75 (fail) | net 0 (validation.ts −2, local.ts +1; no change from same-counter baseline) |
| `as any` code casts | 24 | 11 | −13 (all 11 remaining justified) |
| Silent error swallows | 8 | 0 | −8 |
| Unhandled health endpoint failures | 2 | 0 | −2 |

**Count correction:** Prior sweep HS-215 reported "6 remaining `as any`" — glob artifact (`**/*.ts` without `shopt -s globstar` misses deep nesting). Correct pre-session count: 24 (= 11 remaining + 13 removed). Verified via `grep -rn 'as any' packages/*/src --include='*.ts'` filtering comments.

## What shipped (3 commits)

**1. Error swallowing migration (HS-217)** — 8 sites across 4 packages migrated from `Effect.catchAll(() => Effect.void)` to `emitErrorSwallowed`. Errors now route through EventBus for observability without propagating failure. Special handling for the non-void fallback at `channel-service.ts:runChatTurn` using `Effect.as()`.

**2. Health 503 hardening (HS-218)** — `/health` and `/ready` endpoints wrapped bare `Effect.runPromise` in try/catch, returning explicit 503 on failure. `buildResponse` returns "healthy" for empty arrays, so the catch uses direct error response instead.

**3. Gratuitous cast removal (HS-219)** — 13 `as any` casts removed across 10 files using:
- Plain annotation (validation.ts — `LLMMessage` assignable to `Record<string, unknown>`)
- Structural identity (entropy-sensor — `TokenLogprobLike` ≡ `TokenLogprob`, `StepLike` ≡ steps element)
- Typed narrowing with `Record<string, unknown>` (find.ts, pulse.ts, local.ts, calibration-store.ts)
- Property already on type (learning-engine `provider`)
- Unreachable guard removal (telemetry-client `modelTier === "test"` — type is `"frontier"|"local"|"unknown"`, no construction site widens to `"test"`, other guards already cover test detection)
- Spread-copy to satisfy readonly→mutable variance (database.ts `[...params]`)

## Remaining 11 `as any` — all justified

1. `entropy-sensor-service.ts:149` — deliberate `Readonly` bypass for mutation
2. `chat-manager-factory.ts:88` — cross-package type unification (SessionStore message shape)
3. `builder.ts:2551` — dynamic-import widening (`PromptService as any`)
4. `calibration-runner.ts:70` — Ollama SDK type boundary (tools param)
5. `testing.ts:461` — test provider generic bypass (eslint-disable)
6. `benchmarks/runner.ts:191,1377` (2) — `process.stdout.write` suppression (overloaded signature mismatch)
7. `testing/mocks/{tools,event-bus,llm}.ts` (4) — test-double boundary casts (`Layer.succeed(Tag, partial as any)`)

## Key finding: validation.ts annotation trick

`LLMMessage` is a discriminated union of readonly object literal types. TypeScript allows assigning these directly to `Record<string, unknown>` without `as unknown as` because each property value satisfies `unknown`. This eliminated 2 `as unknown as` sites that the prior session had introduced.

## Filed for planning

- **HS-220** (P1): LLM retry/timeout combinator — 5 providers, repeated pattern
- **HS-221** (P2): Tagged error classes for pricing/structured-output
- **HS-222** (P2): 5 console.warn/error → Effect.log migration
- **HS-223** (P2): Testing mock typed partial helpers

## Links

- [[wiki/Issues/Running Issues Log#Health Sweep — 2026-08-07]]
- Commits: `9b79c460`, `bf2f5085`, `c5f00d46`
