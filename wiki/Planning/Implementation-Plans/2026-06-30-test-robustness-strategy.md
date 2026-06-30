# Test Robustness Strategy — catching combinations, not just cases (2026-06-30)

How to evolve the suite from "does this function return the right shape for inputs I imagined" to "does the framework survive adversarial LLM output across providers, tiers, and feature combinations." Grounded in a 3-axis vetting (capability-enforcement · composition · test-architecture) of 660 test files / ~6,600 cases.

## What the vetting found (the structural blind spots)

**Suite is large, fast, deterministic — but src-coupled, happy-path-scripted, example-based.**

1. **Property/fuzz tests: 0.** The untrusted-input surfaces (tool-arg parsing, healing, JSON extraction) had only hand-picked example tests. `fast-check@3.23.2` was already resolved in the lockfile (via effect), unused.
2. **Src-only imports: 610/660 (92%).** Only one test loads a built `dist`. An export/build drop is invisible to the suite.
3. **Deterministic provider emits CLEAN function-calls** → it *structurally cannot* exercise the parse/heal surfaces that break in production (stringified args, snake_case names, double-wrapped JSON). Every "coercion works" test injected its own coercer.
4. **No strategy runs against a real provider in `bun test`** — all 8 strategies test only against the mock; tier is a config-dimension for just 2 of 8 (adaptive, ToT). Provider quirks (Gemini thinking-starvation class) break strategies with zero failing unit test.
5. **2 MOCKED / 1 WEAK capability** out of 20 behavioral `.with*`: `withRetryPolicy` (test reimplements the retry wrapper and asserts the copy — production `Schedule.recurs` at `runtime.ts:503` never runs), `withMemory` recall→prompt (fake RecallService; real seam `iterate-pass.ts:436` `void`s recalled context), `withHook` (fire site bypassed). 60 files assert only `success===true`.
6. **5 feature-combinations entirely unguarded** (`config-serialization-drift.test.ts` gives false comfort — it proves co-*serialization*, not co-*behavior*): outputSchema×grounding, memory×reasoning×strategy-switch, minIterations×customTermination×verification (precedence undefined), fabricationGuard×outputSchema, metaTools×reasoning. Security-critical guardrails×reasoning×tools tested only with benign input.
7. **Cross-cutting:** REAL enforcement tests exercise the service directly, bypassing the builder→config→runtime **wiring seam** — a plumbing regression (the missing-built-method class) wouldn't be caught.

## Proven this session (the pattern works)

- **Property tests on the resolver** (`tools/tests/tool-calling/native-fc-property.test.ts`) immediately found a **real bug**: stringified-JSON tool args were silently dropped to `{}` at `normalizeArgumentsForResolvedTool` (every cloud adapter JSON.parses args; the local/Ollama adapter passes them through). Fixed at the resolver chokepoint. The 500-file mock suite structurally could not catch this; one property did.
- **Healing property tests** (`tools/tests/healing/healing-property.test.ts`) confirmed the pipeline never throws on adversarial unicode/garbage input (a strength, now guarded).
- **Built-surface guard** (`runtime/tests/built-surface.test.ts`) — loads built dist, asserts all 83 documented `.with*` survive compilation.
- **Gut-check on the checker script** — `m9` now runs the real `check-termination-paths.sh` (fixed to ignore comments/test files; falsified both ways).

## Prioritized plan

### P0 — surfaces production keeps breaking (highest bug-yield/hour)
- [x] **Property tests for parser/healing/coercion** — DONE (found + fixed the arg-drop bug). EXTEND to: JSON-extraction in `native-fc-strategy` text path; `parseToolCalls` per-adapter (feed raw provider payloads, assert object args).
- [ ] **Tier-quirk contract runner.** Extend `TestTurn`/`testing.ts` with a quirk mode (stringified-args, snake_case/kebab tool names, double-wrapped JSON, `<think>` leakage), then replay ONE behavioral contract (toolCall→observe→answer) across simulated tiers via `describe.each`. Catches the cross-provider class (Gemini thinking-starvation, qwen3 string args) in CI, not a live run. Effort L.

### P1 — close the drift + wiring blind spots
- [ ] **Generalize the built-surface guard** to every published package: a shared helper that imports each `dist/index.js` and diffs exported names vs the documented src barrel. 92% of tests are blind to build drift; 1 guards it. Effort M.
- [ ] **Builder→enforcement wiring tests** for the seam the REAL tests bypass: drive `.withX()` through `agent.run()` (not the hand-composed layer) and assert the observable effect. Start with the cross-cutting offenders. Effort M.
- [ ] **Fix the 2 MOCKED capabilities** (likely 2 more hidden bugs like minIterations): verify `withRetryPolicy` production `Schedule.recurs` actually retries (real failing LLM Layer, count attempts); decide `withMemory` recall→prompt (is `iterate-pass.ts:436` `void` intended Phase-1, or a severed wire?). Effort M.
- [ ] **Capability×enforcement matrix** — convert the 60 `success===true`-only tests to assert observable effects (terminatedBy, abstention payload, step/callCount). Use the minIterations test as the template. Effort M.

### P2 — cheap force-multipliers
- [ ] **Composition smoke matrix** — N risky feature-combos through the deterministic provider, asserting build()+run() and the key effect of EACH feature fires (not just `success`). Target the 5 unguarded combos; precedence (minIterations×customTermination×verification) first since it's undefined-by-test. Effort S–M.
- [ ] **Gut-check / negative-control helper** baked into the contract matrix: a meta-test that stubs the enforcement and asserts the contract goes RED — proves non-vacuity at near-zero cost. Effort S.

### Rejected (with reason)
- **Stryker / full mutation harness** — too slow for a ~6,600-test bun suite; the targeted gut-check pattern gives non-vacuity at near-zero cost.
- **More LLM-judge coverage in unit tests** — determinism is a current strength; keep judges in `eval`/benchmarks only.

## Sequencing
P0 attacks the two surfaces production keeps breaking and the mock structurally can't reach. P1 closes the drift/wiring seam (and likely surfaces the next 1–2 hidden bugs). P2 makes the new contracts trustworthy. Each item is independently shippable with a real before/after.

## Load-bearing references
- Deterministic provider (extend for quirks): `packages/llm-provider/src/testing.ts` (`TestTurn`, `ToolCallSpec`).
- Resolver chokepoint (fixed): `packages/tools/src/tool-calling/native-fc-strategy.ts:531` `normalizeArgumentsForResolvedTool`.
- Untested adversarial surfaces: `local.ts` `parseToolCalls`, `native-fc-strategy` text/pseudo-code paths.
- Exemplar REAL enforcement test: `runtime/tests/harness-improvements.test.ts:144` (minIterations).
- `fast-check@3.23.2` now a direct devDep of `@reactive-agents/tools`.
</content>
</invoke>
