# Test-Suite Health Audit — 2026-06-30

**Goal:** find tests that tell a green story while the feature fails / is unverified in live runs ("lying-green"); fix the highest-value ones + patch the regression nets that missed them.

**Baseline:** `bun test` → **6634 pass / 4 fail / 23 skip**, 16140 expect() calls, 820 files, 96s. (Bun 1.3.10 pin.)

**Method:** 4 parallel read-only audit agents (assertion-free · over-mock · error-path · skipped/drift) + main-thread live verification from INSIDE the repo. Cross-checked; false positives excluded.

---

## ⚠️ Methodology correction that reframes prior session

The earlier "harness-hardening" FINDING #1 (`withFabricationGuard`/`withStallPolicy` absent from the built package) was a **FALSE ALARM**. Its probes ran from `/tmp/scratchpad` — outside the repo — so `import "reactive-agents"` resolved to bun's **global npm install cache** (stale published v0.12.0 tarballs), not the workspace. From inside the repo both methods are present and callable; they're simply **unreleased** (runtime source 0.10.6; methods committed June 27, ship next release). **Durable rule: probe/verify ONLY from inside the repo.** A /tmp probe silently tests the last *published* package.

---

## The 4 baseline failures (all triaged)

| failure | root cause | disposition |
|---|---|---|
| `benchmarks/benchmark-v2.test.ts` — `Cannot find module ./sessions/docs-receipts.js` | `run.ts:15` import committed (`8141353b`) without the file (untracked, never committed to main). | **FIXED** — restored `docs-receipts.ts` from `5d54144b` (leaf session, compiles on main, conflict-free; `stash@{0}` lacks it). Unblocked 40 previously-unrunnable tests. |
| `benchmark-v2` ×4 + `m3-ablation` ×2 — `REAL_WORLD_TASKS` length 10 vs 11 | `rw-bp1` added (`b7556842`) without updating count-asserting tests (updates sit in `stash@{0}`). | **Correctly red** — tests caught a real incomplete merge. Resolution (10 vs 11) is the blueprint/docs-bench thread's design call; flagged, not force-fixed. |
| `reasoning/plan-prompts.test.ts:140` | Full-suite run executed a STALE transpile of the dirty WIP `plan-prompts.ts` (parallel-thread uncommitted file); green alone + green in-package. | Transient cache/edit race, not a defect. |

---

## Lying-green findings (shipped features) — ranked

### 🐛 HIDDEN BUG FOUND + FIXED (the headline) — `withMinIterations(N)` under-enforced
A strengthened test (forcing a real assertion on a green-lying test) surfaced it: `withMinIterations(3)` produced only **2** LLM calls, not ≥3. Root cause: both enforcement sites were a lone `if` (single retry), not a loop to N — while the sibling `withCustomTermination` right above each correctly uses a bounded `while`:
- `runtime/src/engine/phases/agent-loop/inline-harness-hooks.ts:91` (direct-LLM path)
- `runtime/src/engine/phases/agent-loop/reasoning-harness-hooks.ts:159` (reasoning path)
So a run finalizing at iteration 1 got exactly one extra pass regardless of whether `minIterations` was 3, 5, or 10 — contradicting the documented "block early exit before N iterations" contract. **Fixed both: `if`→`while (itersDone < minIterations)`** (strictly-increasing counter terminates; null/failed continuation breaks early). Verified: `harness-improvements.test.ts` 22/0; full `runtime` 1039 pass / 0 fail; DTS build clean. The strengthened test now guards it.

### FIXED this session (test honesty)
- **`runtime/smoke-guardrails.test.ts:5`** — the ONLY test for the security-relevant "injection blocked" guarantee; only `expect`s lived inside `catch`, green whether or not blocking happened (an inline comment even institutionalized it). **Verified the real feature live** (bare `.withGuardrails()` DOES throw prompt-injection), then fixed the test to assert `threw===true`. Now 3 pass / 5 expect.
- **`runtime/dynamic-tools.test.ts:6,33`** (register/unregister), **`tool-filtering.test.ts:16`** (allowedTools execution gate), **`error-handler.test.ts:6,36,68`** (handler fires on real error + throwing handler doesn't replace original), **`builder-terminal-tools.test.ts:8,22,32`** (shell-execute present/absent per config) — strengthened to real assertions; **all 4 features CONFIRMED working** (gutting any to a no-op now turns the test RED).
- **`reasoning/m9-termination-oracle.test.ts:427`** — tautology → shells out to `scripts/check-termination-paths.sh` + asserts exit 0. Also fixed that script (was matching COMMENTS + `.test.ts` → false exit-1; now skips them; falsified: real code violation → exit 1).
- **`reasoning/m2-strategy-switching.test.ts:678-707`** — 4 empty `it("…[SKIP]")` that ran green → `it.todo` (16 pass / 4 todo).
- **NEW `runtime/tests/built-surface.test.ts`** — builds dist, imports the BUILT `dist/index.js` by absolute path (not the src-aliased pkg name), asserts all 83 documented `.with*` survive compilation on the exported builder. The missing guard for build/export drift.

### HIGH — confirmed lying-green on a real guarantee (verify feature → fix test)
- **`runtime/tool-filtering.test.ts:16`** — only behavioral coverage of `allowedTools`; asserts `success===true` only, never observes the tool set handed to the model. Filtering vs no-filtering indistinguishable.
- **`runtime/error-handler.test.ts:6,36,68`** — `.withErrorHandler` never triggered (scenario never errors); captured `errors[]` dead; asserts only `toBeDefined()`. (Sibling `error-handler-fires.test.ts` does it right.)
- **`runtime/harness-improvements.test.ts:143`** — `withMinIterations` enforcement never measured; mock ends at iter 1; asserts only `toBeDefined()`.
- **`runtime/builder-terminal-tools.test.ts:8,22`** — `withTerminalTools`/`withTools({terminal})` — `expect(true).toBe(true)` / `toBeDefined()`; shell-execute presence never checked.
- **`runtime/dynamic-tools.test.ts:6,33`** — `registerTool`/`unregisterTool` public API exercised with ZERO assertions (the sibling :58 does assert).
- **`reasoning/strategies/model-context-verification.test.ts:250`** — `<think>`-strip assertion wrapped in `if (calls.length>1)`; single-turn → never runs.

### HIGH — invariant guards that don't guard (tautologies)
- **`reasoning/m9-termination-oracle.test.ts:33,407,427`** — "single-owner termination" / "routes through arbitrator" — build an array then assert it contains its own literal; `runKernel` never invoked; the FM-D1 bug they guard would stay green. `scripts/check-termination-paths.sh` is never called from the suite.
- **`reasoning/m2-strategy-switching.test.ts:336,658`** — headline "switching improves performance / accuracy lift" — real assertions commented out; remainder asserts constants against themselves or `tokensUsed>=0`; `run.switched` computed, never asserted.

### MEDIUM — research-scaffold tautologies (lower risk; arguably intentional)
- `reactive-intelligence/m7-calibration.test.ts:226,245,252,277,303,417,490` — 7× `expect(true).toBe(true)` spike-recommendation placeholders.
- `tools/m4-healing-measurement.test.ts:398,432` — `console.log`-only "tests".
- `memory/memory-service.test.ts:144`, `runtime/debrief-integration.test.ts:71` — cosmetic tautology after a real op.
- `reasoning/m2-strategy-switching.test.ts:678-701` — 4 `[SKIP] FUTURE` placeholders that are NOT `.skip` → run green claiming coverage. Mark `it.todo`.

---

## Latent gaps (NOT confirmed live bugs — honesty note)

- **Ollama default tool-arg parser** (`llm-provider/src/providers/local.ts:213-217`) passes `tc.function.arguments` through with no coercion. Over-mock agent called this a "confirmed live qwen3 bug" — **could NOT reproduce**: qwen3:14b on the live Ollama returns args as a proper object `{a:17,b:25}`. Real status: a latent robustness gap (rare string-args models), partly salvaged by downstream `native-fc-strategy` coercion. The TEST-level lie is real — `local-adapter-parser-hook.test.ts:221` and `m12-provider-adapter-hooks.test.ts:30,65` inject their OWN coercing `parseToolCalls` closure, so the DEFAULT parser is never exercised; and the `parseToolCalls` hook, consumed in all 5 providers, has NO shipped adapter implementing it.

## Coverage holes (capability with no honest test)
1. No real-adapter `parseToolCalls` test (all inject a fake).
2. `.withGrounding()` enforcement (warn/block/terminal/retry) — only builder-state tests, no runtime gate test.
3. Recall→prompt grounding — nothing verifies recalled content reaches the prompt + influences output.
4. Native streaming tool-call extraction for OpenAI/Anthropic/Gemini — only litellm has a raw-SSE test.
5. **No built-`dist` public-surface test** — ~85% of the suite imports deep `../src/...`; an export/build drop is invisible. No test asserts the documented `.with*` set on a built prototype. `builder-wither-discipline.test.ts` only regexes raw source text (blind to compilation). No test references `withStallPolicy` at all.

## Cleared (suspicious by name, verified genuinely real — do not touch)
`fabrication-guard-rail.test.ts` (real verifier rail produces success:false), batch/tool healing (`act-symmetry`, `plan-verify`, `plan-execute-tool-observe` feed real typo'd names through `runHealingPipeline`), strategy-switch event (`kernel-hooks-wiring:322` real loop-detector), `guardrails-enforcement`, `error-handler-fires`, `behavioral-contract-enforcement`, `parse-first-e2e`, `reflexion-required-completion-gate` (mock returns "SATISFIED" precisely to prove the deterministic gate overrides it). Only ONE genuinely disabled test exists repo-wide: env-gated Ollama E2E (`e2e-haiku-ablation.test.ts:15`). No `.only`/hidden `.skip` masking broken features.
</content>
</invoke>
