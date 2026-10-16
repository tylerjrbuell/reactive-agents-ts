# Bundle: reasoning-numctx-guard-override
Date: 2026-10-16
Budget: 90 min
Issues: #241 (singleton; cross-seam decision contained in one guard)

## Acceptance criteria
- #241: with `.withModel({numCtx: N})` explicit override below the capability recommendation, the head-truncation guard enforces against N (not the recommended ceiling). Explicit override reaches the window the guard reads; default (no-override) behavior byte-identical.

## GROUND (parent, pre-dispatch)
- Wire honors override: `local.ts resolveOllamaNumCtx` = `request.numCtx ?? config.explicitNumCtx ?? recommended ?? default`.
- Guard blind: `grep explicitNumCtx packages/reasoning/src packages/runtime/src` = zero hits. Guard ceiling binds to `profile.maxTokens` via capability (`runner.ts` S1.4 `applyCapabilityMaxTokens`).
- Guard lives at `packages/reasoning/src/kernel/capabilities/reason/head-truncation-guard.ts` (kernel scope → kernel-warden). Wire already surfaces `resolvedParams.contextWindow`; prefer reading an existing signal over new plumbing.

## Execution units (ordered)
1. **Unit 1 (warden):** TDD red (explicit-override scenario fails: guard ceiling = recommended, not explicit) → minimal fix at the guard/profile seam → green. Scope: `head-truncation-guard.ts` + profile plumbing it reads + tests. Read-only elsewhere; do NOT redesign provider config surfaces.
2. **Unit 2 (parent):** verifier (targeted tests + typecheck), ceil­ing-gate check (`as-unknown-as` 0 net), commit, close #241.

## Risk register
- Over-plumbing (new cross-package channel for one number) → mitigation: prefer existing `resolvedParams.contextWindow` / profile field; smallest seam that kills the blind spot.
- Demand-bucket path (`numCtxPolicy='demand'`) interaction → mitigation: cover with a test case or explicitly record as out-of-scope with reason.
- Default-path behavior drift → mitigation: byte-identical test on no-override config.

## Verification protocol
- New tests fail-before/pass-after (file-swap RED if behavior-additive).
- `bun test packages/reasoning --timeout 15000` — zero new failures vs baseline.
- `bun run typecheck` — green; `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts` — 0 net new sites.
- `bun run build` — green (only if dist consumers touched; else skip with reason).

## Out-of-scope
- #242 (cloud-provider numCtx semantics RFC) — needs owner decision, not code.
- Demand-policy redesign; non-Ollama providers.
- Bench/live-model re-capture (mechanism-level tests suffice).

## Baseline
- Post-#251 dev HEAD `8ba4f4295`; tree clean at branch time. Branch `bundle/numctx-guard-override` off `dev` (repo staging convention; skill default is origin/main).
- Baseline: `bun test packages/reasoning --timeout 15000` → 3154 pass / 0 fail across 364 files.
- Runtime baseline (runtime-warden): 1721 pass / 1 fail / 7 skip (fail = w2-wave-census missing-row ratchet tripped by the reasoning schema addition; fixed in-bundle).

## Close-out (parent verifier, 2026-10-16)
- Consumer (kernel-warden): `ContextProfile.explicitNumCtx` + `resolveEffectiveNumCtx()` = explicit ?? maxTokens; think.ts guard preflight ceiling, guard log/metadata, demand-bucket cap all read it. 8 new tests, RED-proven.
- Producer (runtime-warden): both seed sites (`createRuntime` ~348, `buildLightRuntimeConfig` ~1249) seed from `options.numCtx` unless caller-explicit; 5 new tests RED-proven; census ratchet green.
- Chain (parent grep): `.withModel({numCtx})` → `_numCtx` → `createRuntime({numCtx})` → `explicitNumCtx` → profile spread (preserved by `applyCapabilityMaxTokens`) → think.ts:1087/:1165.
- Full: reasoning 3162/0, runtime 1727/0, targeted 13/13, typecheck green, ceiling gate green, 0 new casts.
- Residuals: `maxTokens ?? numCtx` precedence for other consumers untouched (out of scope); full createRuntime path pinned by code-identity+grep (no pure seam); reasoning dist rebuilt (gitignored) for DTS consumers.
