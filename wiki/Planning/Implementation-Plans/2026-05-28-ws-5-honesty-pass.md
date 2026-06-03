---
title: WS-5 — Honesty Pass (tagged-error algebra + warning routes + doc-drift CI)
date: 2026-05-28
status: 🟡 PARTIAL (code-verified 2026-06-02) — ceiling tests shipped; 34 Effect<X,unknown> remain; +capability-source honesty gates 2026-06-02 (bench preflight + runtime build gate)
master-plan: 2026-05-28-canonical-refactor.md (§4 RC-4 + §6.2 WS-5 summary)
architecture-model: 2026-05-28-canonical-architecture-model.md (§6.5 typed errors + §13 honest-fail invariant)
root-cause-closed: RC-4 (silent error swallow at type level; lying comments; console bypass; doc drift)
gh-issues-closed: [#161 (doc-drift bundle), #166 (MetricsCollectorTag missing in test Layers), #168 (105 Effect<X, unknown> sites — corrected to 34 first-hand), #171 (manifest/doc drift)]
authoritative-anchor: master-plan §4 RC-4 + architecture-model §6.5 + §13 + canonical anti-missions #4 + #5
owner: cross-cutting (multiple wardens; tagged-error algebra design needs cross-package coordination)
session-budget: ~3-5 days (4 phases)
risk: MEDIUM-HIGH (tagged-error algebra touches every error channel; coordinated migration)
prerequisite: WS-2 shipped (typed seams stabilize first; tagged errors land cleanly afterward)
---

# WS-5 — Honesty Pass

## Goal (one sentence)

Eliminate silent error swallow at type level (`Effect<X, unknown>` → `Effect<X, TaggedError>`), route all `console.warn`/`console.error` through ObservabilityService, fix lying comments, and add a CI doc-drift gate that prevents AGENTS.md tree + North Star §4.3 from drifting silently from `packages/*/package.json` reality.

## Anchor

- **Architecture model §6.5** — effectful capabilities declare typed errors via Effect's error channel; never `Effect.runPromise` internally; never throw; never `catchAll(() => {})` without `emitErrorSwallowed`
- **Architecture model §13** — honest-fail invariant: `status === "failed" ⇒ output === null`
- **Anti-mission #4** — NOT a system that hides failure
- **Anti-mission #5** — NOT an instrumentation-late framework
- **Master plan §3.6 F4** — first-hand counts (corrected from prior audit overcount): 34 `Effect<X, unknown>`, 27 `console.warn`, 24 `console.error`, 28 `Effect.runPromise`, 113 `as any`

## Phase Inventory

### Phase 1 — Define tagged-error algebra under `core/errors/`

**Goal:** Establish the canonical error types every package's effectful code declares.

**Files touched:** NEW `packages/core/src/errors/` directory with one file per error class.

**Scope:**

```typescript
// packages/core/src/errors/index.ts (barrel export)
export * from "./llm-errors.js";
export * from "./tool-errors.js";
export * from "./memory-errors.js";
export * from "./validation-errors.js";
export * from "./runtime-errors.js";
// ... per concern

// packages/core/src/errors/llm-errors.ts
import { Data } from "effect";

export class LLMTimeoutError extends Data.TaggedError("LLMTimeoutError")<{
  readonly model: string;
  readonly timeoutMs: number;
  readonly partialResponse?: string;
}> {}

export class LLMParseError extends Data.TaggedError("LLMParseError")<{
  readonly model: string;
  readonly attempts: ReadonlyArray<{
    readonly raw: string;
    readonly parseFailure: string;
  }>;
}> {}

// Similar Data.TaggedError classes per concern
```

**Pre-condition for design:** `LLMParseError.attempts[]` shape already exists per memory (PR #138 / HS-16). Build on that pattern.

**Done:**
- [ ] `packages/core/src/errors/` directory exists with ≥1 error class per concern (llm, tool, memory, validation, runtime, etc.)
- [ ] All error classes use `Data.TaggedError` pattern (Effect canonical)
- [ ] Barrel export at `packages/core/src/errors/index.ts`
- [ ] `packages/core/src/index.ts` re-exports the errors barrel
- [ ] Build + typecheck clean

### Phase 2 — Migrate `Effect<X, unknown>` sites in priority order

**Goal:** Replace silent-swallow type signatures with explicit tagged-error declarations.

**Files touched:** All sites identified by `rtk grep -rE "Effect<[^,>]*,\s*unknown" packages/*/src` (34 sites total).

**Migration order (priority):**

1. `packages/runtime/src/` (highest concentration; mission-critical seam) — target: zero `Effect<X, unknown>` here
2. `packages/reasoning/src/` (kernel + strategies)
3. `packages/reactive-intelligence/src/`
4. `packages/memory/src/`
5. Remaining packages

For each site:
- Determine what errors the inner Effect can produce
- Declare them in the type: `Effect<X, LLMTimeoutError | LLMParseError | ToolError>`
- If a true `unknown` is needed (foreign data, dynamic schema), wrap with explicit error type that captures the reason

**Done:**
- [ ] `packages/*/src/` `Effect<X, unknown>` count ≤ 15 (from baseline 34)
- [ ] `packages/runtime/src/` `Effect<X, unknown>` count = 0
- [ ] No new `Effect<X, unknown>` introduced; CI lint enforces (Phase 4)
- [ ] All tests pass; build green; typecheck clean

### Phase 3 — Route console bypass through ObservabilityService

**Goal:** Eliminate 27 `console.warn` + 24 `console.error` sites that bypass the observability pipeline.

**Files touched:** Sites identified by `rtk grep -r "console\.(warn|error)" packages/*/src`.

**For each site:**
- If a structured `ObservabilityService.warn(...)` / `.error(...)` API exists, route through it
- If routing requires Effect context but the call site is outside Effect.gen, either:
  - Refactor the call site to be Effect-aware (preferred)
  - Use `emitErrorSwallowed` with explicit reason if truly fire-and-forget
- Remove the raw console call

**Coordinated cleanups:**
- Lying comment at `gateway-bootstrap.ts:236` (claims "propagate" but is `.catch(() => {})`) — fix to actually propagate OR route through `emitErrorSwallowed` with explicit "we deliberately swallow because Y" rationale
- Leftover `DEBUG_VERIFIER` console.error at `runner.ts:1740-1742` — delete (per Hot.md, should already be gone)
- 4× memory-service bootstrap swallows missing `emitErrorSwallowed` — add the emit

**Done:**
- [ ] `packages/*/src/` `console.warn` count = 0 (from baseline 27)
- [ ] `packages/*/src/` `console.error` count = 0 (from baseline 24)
- [ ] Lying comments at gateway-bootstrap.ts + similar are fixed (code matches comment)
- [ ] `DEBUG_VERIFIER` leftover removed
- [ ] memory-service swallows have `emitErrorSwallowed` calls

### Phase 4 — CI gates: anti-swallow + doc-drift

**Goal:** Prevent regression via CI lints.

**Files touched:** NEW `scripts/lint-anti-swallow.ts`, NEW `scripts/lint-doc-drift.ts`, `.github/workflows/`

**Anti-swallow lint:**
- Walk `packages/*/src/` for `Effect<X, unknown>` patterns; fail if count regresses past Phase 2 baseline
- Walk for new `console.warn` / `console.error`; fail
- Walk for `.catch(() => {})` without `emitErrorSwallowed` adjacent

**Doc-drift lint:**
- Parse AGENTS.md "Package Dependency Tree" section; extract list of declared packages
- Diff against `ls packages/` reality
- Fail on any package present in one but not the other
- Same for North Star §4.3 capability dirs vs `ls packages/reasoning/src/kernel/capabilities/`
- Same for canonical architecture model §17 mapping references

**Closes #161 + #166 + #171 via:**
- AGENTS.md tree auto-checked vs reality
- `04-PROJECT-STATE.md` staleness flagged when >30 days
- MetricsCollectorTag warning (#166): add MetricsCollectorLayer to test layer fixtures so the WARN noise stops; lint enforces test-layer completeness

**Done:**
- [ ] `scripts/lint-anti-swallow.ts` exists; CI invokes; exits 0 against current main post-Phase 2-3
- [ ] `scripts/lint-doc-drift.ts` exists; CI invokes; exits 0 against current main
- [ ] AGENTS.md tree synced to all 35 packages
- [ ] North Star §4.3 capability list synced to actual kernel/capabilities/
- [ ] `04-PROJECT-STATE.md` updated to reflect current shipped state
- [ ] Architecture model §17 mapping cross-references verified

---

## Scope OUT (non-goals)

- Touching `Effect.runPromise` patterns (28 sites; needs Effect.runFork audit + separate workstream)
- Refactoring strategies / kernel logic (WS-3 territory)
- New error classes for hypothetical future concerns (only what current code needs)
- Memory v2 (separate)

## Pre-Conditions

- WS-2 shipped (runtime composition + typed seams stable)
- Build green, tests green, typecheck clean at HEAD
- Cross-package coordination — tagged-error algebra design reviewed before Phase 2 begins

## Tests (RED → GREEN per phase)

### Phase 1 — RED

```typescript
test("tagged error algebra exists with required classes", () => {
  // Import and instantiate each canonical error
  expect(new LLMTimeoutError({...})).toBeInstanceOf(LLMTimeoutError);
  expect(new LLMParseError({...})).toBeInstanceOf(LLMParseError);
  // ... etc per error
});
```

### Phase 2 — RED

```typescript
test("zero Effect<X, unknown> in packages/runtime/src/", () => {
  const count = execSync(
    "grep -rE 'Effect<[^,>]*,\\s*unknown' packages/runtime/src/ | grep -v test | wc -l"
  );
  expect(parseInt(count.toString().trim())).toBe(0);
});
```

### Phase 3 — RED

```typescript
test("zero console.warn or console.error in packages/*/src/", () => {
  const warns = execSync(
    "grep -rE 'console\\.(warn|error)' packages/*/src --include='*.ts' | grep -v test | wc -l"
  );
  expect(parseInt(warns.toString().trim())).toBe(0);
});
```

### Phase 4 — RED

```bash
bun scripts/lint-anti-swallow.ts   # must exit 0
bun scripts/lint-doc-drift.ts      # must exit 0
```

### Existing tests that MUST still pass

- All workspace `bun test` (5750+ baseline)
- `bunx turbo run build` 38/38
- `bun run typecheck` clean across all packages

## Verification Protocol

```bash
# Pre-WS-5 baseline (first-hand 2026-05-28)
echo "Effect<X, unknown>: $(rtk grep -rE 'Effect<[^,>]*,\s*unknown' packages/*/src --include='*.ts' | grep -v test | wc -l)"  # 34
echo "console.warn: $(rtk grep -r 'console\.warn' packages/*/src --include='*.ts' | grep -v test | wc -l)"  # 27
echo "console.error: $(rtk grep -r 'console\.error' packages/*/src --include='*.ts' | grep -v test | wc -l)"  # 24
echo "lying comments (gateway-bootstrap.ts:236 sample):"
sed -n '230,240p' packages/runtime/src/gateway-bootstrap.ts

# Per-phase verification per Done criteria above

# Final gate
bunx turbo run build && bun test && bun run typecheck
bun scripts/lint-anti-swallow.ts
bun scripts/lint-doc-drift.ts
```

## Done Criteria (falsifiable)

### Phase 1 — Tagged-error algebra
- [ ] `packages/core/src/errors/` directory with ≥6 canonical error classes
- [ ] All use `Data.TaggedError` (Effect canonical pattern)
- [ ] Re-exported from `@reactive-agents/core`

### Phase 2 — Migration
- [ ] `packages/runtime/src/` `Effect<X, unknown>` = 0
- [ ] Workspace `Effect<X, unknown>` ≤ 15 (from 34)
- [ ] No new `Effect<X, unknown>` (CI enforces post-Phase 4)

### Phase 3 — Console route
- [ ] `console.warn` count in production = 0 (from 27)
- [ ] `console.error` count in production = 0 (from 24)
- [ ] All lying comments fixed (code matches narrative)

### Phase 4 — CI lints
- [ ] `scripts/lint-anti-swallow.ts` live in CI; green at HEAD
- [ ] `scripts/lint-doc-drift.ts` live in CI; green at HEAD
- [ ] AGENTS.md tree + North Star §4.3 + 04-PROJECT-STATE synced to reality

### Cross-cutting
- [ ] Workspace tests pass (5750+ baseline)
- [ ] Build green (38/38)
- [ ] Typecheck clean workspace-wide
- [ ] No regression in honest-fail invariant (status=failed → output=null still holds)

## Rollback Plan

Per-phase atomic. Phase 2 (migration) is the largest change exposure — sub-divide by package (runtime first, reasoning second, etc.) for granular rollback.

CI lints can ship as warning-only initially (Phase 4.1), then promote to error-mode after baseline confirmed clean (Phase 4.2).

## Evidence Artifact

`wiki/Research/Refactor-Reports/2026-05-28-ws-5-final.md` containing:

- Per-phase before/after counts
- Confirmation of closed issues (#161, #166, #168, #171)
- Tagged-error algebra design doc cross-reference
- Lint exit-status snapshots from CI

## Owner + Handoff

Cross-cutting. Each phase has its own ownership:

- Phase 1: cross-package — needs design review before commit (architecture-model §6.5 implicates every effectful capability)
- Phase 2: per-package wardens (runtime-warden first; then kernel-warden + memory-warden in sequence)
- Phase 3: cross-cutting; main thread + per-package wardens
- Phase 4: cross-cutting CI; release-warden or main thread

The tagged-error algebra design (Phase 1) is the long-pole architectural decision. Worth a dedicated ADR at `wiki/Decisions/2026-05-28-tagged-error-algebra.md` before any migration begins.

## Cross-Reference

- Master plan: §4 RC-4, §3.4, §3.6 F4, §6.2 WS-5 summary, §10 issue routing
- Architecture model: §6.5 effectful capability typed errors, §13 honest-fail invariant
- Closed issues: #161, #166, #168, #171
- Memory cross-ref: `feedback_clean_types`, `project_token_optimization_may3`
