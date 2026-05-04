# North Star Phase 0 — Foundations & Evidence Gates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the foundations every subsequent north-star phase depends on — typed framework error taxonomy, observable error-swallow events, default secrets redactor, CI-gated probe suite with new scaffolds, microbench baseline, MEMORY.md / code reconciliation, and the debrief-quality spike that gates Phase 4.

**Architecture:** Phase 0 is intentionally zero-user-visible-payoff. Each task ships an instrumentation, a test gate, or a baseline artifact that later phases consume. Implementation is additive (no behavior changes to existing code paths). Two critical-path stories (typed errors → ErrorSwallowed wiring → CI gate) drive dependency order; the rest run parallel-safe. Every task is TDD: failing test first, minimum implementation, commit. The framework error taxonomy (S0.1) and the bulk of the ErrorSwallowed migration (S0.2) are already done on `feat/phase-0-foundations` — Task 1 closes out S0.2 with the wiring test + commit; the rest of the tasks ship the remaining stories.

**Tech Stack:** TypeScript, Effect-TS (`^3.10.0` per current `package.json` — pinning exact is part of S0.2 close-out), bun:test, Bun runtime, Turborepo, Changesets.

**Reference docs:**
- `docs/spec/docs/15-design-north-star.md` v2.3 §14 Phase 0 (governing spec)
- `AGENTS.md` (workflow, Effect-TS patterns, terminal rules — `--timeout 15000` minimum on tests, never pipe long-running processes)
- `.claude/skills/effect-ts-patterns/SKILL.md` (mandatory before code; no `throw`, no raw `await`, no `any`)
- `.agents/skills/agent-tdd/SKILL.md` (TDD rhythm, server teardown discipline)
- `.agents/skills/review-patterns/SKILL.md` (9-category compliance review before merge)

**Branch:** `feat/phase-0-foundations` (already checked out, 3 commits ahead of `main`).

**Tier 1-4 decisions:** all 14 north-star questions locked at recommended defaults — see `.agents/MEMORY.md` Design North Star section.

---

## Status header

| Story | Pts | Status | Notes |
|---|---|---|---|
| S0.1 — Typed framework error taxonomy | 5 | ✅ DONE | Commit `93ff6793`. 11 tests green. Existing `TaskError.taskId` widened (optional) for backward compat. |
| S0.2 — `ErrorSwallowed` event + catch-all instrumentation | 3 | 🟡 90% DONE on branch (uncommitted) | Helper + 6 tests + AgentEvent extension + 36-file production migration all in working tree. **Task 1** closes it out (KNOWN_SWALLOW_SITES + wiring test + changeset + commit). |
| S0.3 — Default log redactor with OWASP fixtures | 3 | pending | Tasks 2-4 |
| S0.4 — CI probe suite + 4 new probe scaffolds | 5 | pending | Tasks 5-7 |
| S0.5 — Microbench baseline harness | 2 | pending | Task 8 |
| S0.6 — MEMORY.md / code reconciliation | 1 | pending | Task 9 |
| S0.7 — Debrief-quality spike | 2 | pending | Task 10 |
| Sprint close | — | pending | Task 11 (PR + retro) |

---

## File Structure

### Files already on branch (uncommitted) from in-progress S0.2

| File | State |
|------|-------|
| `packages/core/src/services/error-swallowed.ts` | NEW — uses `Effect.serviceOption(EventBus)` so requirements set is empty; helper Effect + `errorTag` classifier |
| `packages/core/tests/error-swallowed.test.ts` | NEW — 6 tests passing |
| `packages/core/src/services/event-bus.ts` | MODIFIED — `_tag: "ErrorSwallowed"` variant added to `AgentEvent` union (lines ~852-882) |
| `packages/core/src/index.ts` | MODIFIED — re-exports `emitErrorSwallowed`, `errorTag`, `ErrorSwallowedPayload` |
| 36 production files across `packages/` and `apps/cortex/server/` | MODIFIED — every `Effect.catchAll(() => Effect.void)` replaced with `Effect.catchAll((err) => emitErrorSwallowed({ site, tag: errorTag(err) }))` |

Per `git diff --stat HEAD -- packages/ apps/`: the 36 migrated files include `packages/runtime/src/{builder,context-ingestion,cortex-reporter,execution-engine}.ts`, `packages/observability/src/{cortex/cortex-reporter,debugging/thought-tracer,logging/{observable-logger,progress-logger},metrics/metrics-collector}.ts`, `packages/reasoning/src/strategies/{adaptive,plan-execute,reactive,reflexion,tree-of-thought}.ts` + `kernel/{kernel-hooks,kernel-runner,phases/{act,think},utils/{reactive-observer,service-utils,tool-capabilities,tool-execution}}.ts` + `structured-output/{infer-required-tools,pipeline}.ts`, `packages/{eval,guardrails,memory,orchestration,reactive-intelligence/learning,trace}/src/...`, `apps/cortex/server/services/{gateway-process-manager,runner-service,tool-playground-invoke}.ts`.

### New Files (this plan ships)

| File | Responsibility |
|------|----------------|
| `packages/runtime/src/test-hooks.ts` | `KNOWN_SWALLOW_SITES` constant + `forceThrowSite()` test helper for wiring verification |
| `packages/runtime/tests/error-swallowed-wiring.test.ts` | Parameterized per-site wiring test |
| `packages/observability/src/redaction/redactor.ts` | `Redactor` interface + `applyRedactors(input, redactors)` Effect |
| `packages/observability/src/redaction/default-patterns.ts` | OWASP-aligned default patterns (8 secret types) |
| `packages/observability/src/redaction/index.ts` | Barrel re-export |
| `packages/observability/tests/redaction.test.ts` | Per-pattern + zero-leakage corpus tests |
| `packages/observability/tests/fixtures/known-secrets.json` | Fixture corpus (8 secret types) |
| `.agents/skills/harness-improvement-loop/scripts/probes/types.ts` | Shared `ProbeResult` + `Probe` type |
| `.agents/skills/harness-improvement-loop/scripts/probes/num-ctx-sanity.ts` | New scaffolded probe (enabled in P1) |
| `.agents/skills/harness-improvement-loop/scripts/probes/semantic-memory-population.ts` | New scaffolded probe (enabled in P1) |
| `.agents/skills/harness-improvement-loop/scripts/probes/capability-probe-on-boot.ts` | New scaffolded probe (enabled in P1) |
| `.agents/skills/harness-improvement-loop/scripts/probes/error-swallowed-wiring.ts` | New probe (real now via S0.2) |
| `.agents/skills/harness-improvement-loop/scripts/run-probes.ts` | Probe runner CLI registering all probes |
| `.agents/skills/harness-improvement-loop/scripts/microbench.ts` | Microbench harness |
| `.github/workflows/probes.yml` | New CI workflow gating PR merges |
| `harness-reports/benchmarks/baseline-2026-04-23.json` | Microbench baseline (committed artifact) |
| `harness-reports/ci-probes-baseline-2026-04-23.jsonl` | Probe baseline (committed artifact) |
| `harness-reports/debrief-quality-spike-2026-04-23.md` | S0.7 spike artifact + P4 gating decision |
| `packages/reactive-intelligence/tests/doc-code-parity.test.ts` | MEMORY.md ↔ code parity test |
| `packages/observability/src/redaction/event.ts` | (only if needed) `RedactionApplied` event helper |
| `.changeset/p0-s02-error-swallowed-event.md` | Changeset for S0.2 |
| `.changeset/p0-s03-log-redactor.md` | Changeset for S0.3 |
| `.changeset/p0-s04-ci-probe-suite.md` | Changeset for S0.4 |

### Modified Files (this plan ships)

| File | What Changes |
|------|--------------|
| `packages/core/src/services/event-bus.ts` | Add `_tag: "RedactionApplied"` variant to `AgentEvent` union (S0.3 wires to it) |
| `packages/observability/src/services/observability-service.ts` | Apply default redactors to all sink-bound log records |
| `packages/runtime/src/builder.ts` | Add optional `redactors?: readonly Redactor[]` to `withObservability()` options (S0.3) |
| `package.json` (root) | Add `"probes": "bun .agents/skills/harness-improvement-loop/scripts/run-probes.ts"` script |
| `.agents/skills/harness-improvement-loop/SKILL.md` | Document the 4 new probes + microbench harness |
| `.agents/MEMORY.md` | Reconcile claims against code (S0.6) — `StallDetector`/`HarnessHarmDetector` references rewritten as handler-module paths; `ModelTierProfile` deleted (genuinely absent) |
| `apps/docs/src/content/docs/features/observability.md` | Document default redactor + extensibility |

---

## Task 1: Close out S0.2 — KNOWN_SWALLOW_SITES + wiring test + commit

**Story:** S0.2 finalization. Helper + 6-test suite + AgentEvent extension + 36-file production migration are already done on branch. This task adds the wiring test that catches future regressions and commits everything as one atomic S0.2 commit.

**Files:**
- Create: `packages/runtime/src/test-hooks.ts`
- Create: `packages/runtime/tests/error-swallowed-wiring.test.ts`
- Create: `.changeset/p0-s02-error-swallowed-event.md`
- Stage + commit: all in-progress S0.2 files (helper, test, AgentEvent, 36 production migrations)

- [ ] **Step 1: Re-verify in-progress test still passes**

```bash
bun test packages/core/tests/error-swallowed.test.ts --timeout 15000
```

Expected: 6 tests PASS (it pass + no-op pass + 4 errorTag classification tests).

- [ ] **Step 2: Enumerate every migrated swallow site**

```bash
grep -rn "emitErrorSwallowed" packages/ apps/ --include="*.ts" -l | sort -u
```

Then for each file, find each `site:` argument:

```bash
grep -rn 'site:\s*"' packages/ apps/ --include="*.ts" | grep -v "tests" | grep -v ".test.ts"
```

Capture the unique `site` strings that appear in production code. These become the `KNOWN_SWALLOW_SITES` constant.

- [ ] **Step 3: Verify zero silent-swallow sites remain**

```bash
grep -rn "Effect\.catchAll(() => Effect\.void)" packages/ apps/ --include="*.ts" 2>/dev/null | grep -v "tests" | grep -v ".test.ts" | grep -v "// " | grep -v "* " | grep -v "//"
```

Note: includes/excludes for the in-helper docstring example AND the helper's defensive internal swallow at `error-swallowed.ts:74` are expected. Verify the only hits are documentation/example strings or the helper's own internal swallow. If a real production swallow remains, migrate it (same pattern: `Effect.catchAll((err) => emitErrorSwallowed({ site, tag: errorTag(err) }))`).

- [ ] **Step 4: Write failing wiring test**

Create `packages/runtime/tests/error-swallowed-wiring.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  KNOWN_SWALLOW_SITES,
  forceThrowSite,
} from "../src/test-hooks.js";

describe("ErrorSwallowed wiring", () => {
  it("KNOWN_SWALLOW_SITES has no duplicates", () => {
    const unique = new Set(KNOWN_SWALLOW_SITES);
    expect(unique.size).toBe(KNOWN_SWALLOW_SITES.length);
  });

  for (const site of KNOWN_SWALLOW_SITES) {
    it(
      `site ${site} emits an ErrorSwallowed event when forced`,
      async () => {
        const events = await Effect.runPromise(forceThrowSite(site));
        const match = events.find(
          (event) => event._tag === "ErrorSwallowed" && event.site === site,
        );
        expect(match).toBeDefined();
        if (match?._tag !== "ErrorSwallowed") throw new Error("type guard");
        expect(match.tag).toMatch(/^\w+$/);
      },
      15000,
    );
  }
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
bun test packages/runtime/tests/error-swallowed-wiring.test.ts --timeout 15000
```

Expected: FAIL with "Cannot find module '../src/test-hooks.js'".

- [ ] **Step 6: Implement `test-hooks.ts`**

Create `packages/runtime/src/test-hooks.ts`. Substitute the actual sites enumerated in Step 2 — the list below is illustrative; the real list is whatever Step 2 produced:

```typescript
import { Effect, Ref } from "effect";
import {
  EventBus,
  EventBusLive,
  emitErrorSwallowed,
  errorTag,
  type AgentEvent,
} from "@reactive-agents/core";

/**
 * Canonical list of every `Effect.catchAll(() => Effect.void)` site migrated
 * by Phase 0 S0.2. Each entry is a `site` string that appears verbatim in
 * a production source file.
 *
 * Adding a new silent-swallow site to production code requires adding the
 * site here (or the wiring test fails). This makes new silent failures
 * impossible to ship without an observable signal.
 *
 * Site name format: `<package-name>/<relative-file>:<approx-line>`.
 */
export const KNOWN_SWALLOW_SITES: readonly string[] = [
  // Substitute the actual site strings produced by Step 2. Example shape:
  // "runtime/builder.ts:4182",
  // "reasoning/strategies/kernel/utils/service-utils.ts:42",
  // ...etc
] as const;

/**
 * Synthetically exercise the `emitErrorSwallowed` wiring for a given site
 * string. Returns the events captured during the synthetic emission.
 *
 * The helper does NOT invoke the real production site — that would require
 * full subsystem setup. Instead, it uses the same `site` literal the real
 * site uses, so deletion or rename of a production-side `emitErrorSwallowed`
 * call surfaces here as a test failure.
 */
export const forceThrowSite = (
  site: string,
): Effect.Effect<readonly AgentEvent[]> =>
  Effect.gen(function* () {
    const captured = yield* Ref.make<AgentEvent[]>([]);
    const bus = yield* EventBus;
    yield* bus.subscribe((event) =>
      Ref.update(captured, (xs) => [...xs, event]),
    );
    yield* emitErrorSwallowed({
      site,
      tag: errorTag(new Error("forced for wiring test")),
    });
    return yield* Ref.get(captured);
  }).pipe(Effect.provide(EventBusLive));
```

- [ ] **Step 7: Run the wiring test — expect green**

```bash
bun test packages/runtime/tests/error-swallowed-wiring.test.ts --timeout 15000
```

Expected: 1 dedupe test + N site tests = N+1 tests PASS, where N is the size of `KNOWN_SWALLOW_SITES`. If any test fails, the corresponding production site's `emitErrorSwallowed` call has the wrong `site` literal — fix it in the production file, not in the test.

- [ ] **Step 8: Verify the broader test suite is still green**

```bash
bun test packages/core packages/runtime --timeout 15000
```

Expected: no regressions. Previous suite count + 6 (S0.2 errors test) + N+1 (wiring test) = total.

- [ ] **Step 9: Workspace typecheck + build**

```bash
bun run typecheck
bun run build
```

Expected: 54/54 packages clean.

- [ ] **Step 10: Write the changeset**

Create `.changeset/p0-s02-error-swallowed-event.md`:

```markdown
---
"@reactive-agents/a2a": minor
"@reactive-agents/benchmarks": minor
"@reactive-agents/cli": minor
"@reactive-agents/core": minor
"@reactive-agents/cost": minor
"@reactive-agents/eval": minor
"@reactive-agents/gateway": minor
"@reactive-agents/guardrails": minor
"@reactive-agents/health": minor
"@reactive-agents/identity": minor
"@reactive-agents/interaction": minor
"@reactive-agents/llm-provider": minor
"@reactive-agents/memory": minor
"@reactive-agents/observability": minor
"@reactive-agents/orchestration": minor
"@reactive-agents/prompts": minor
"@reactive-agents/reactive-intelligence": minor
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": minor
"@reactive-agents/testing": minor
"@reactive-agents/tools": minor
"@reactive-agents/verification": minor
"reactive-agents": minor
---

**core, runtime, *: ErrorSwallowed event + catch-all site instrumentation (P0 S0.2)**

Adds an observable `ErrorSwallowed` `AgentEvent` (`_tag: "ErrorSwallowed"`)
and migrates every former `Effect.catchAll(() => Effect.void)` site in
production code to publish the event via `emitErrorSwallowed`. Behavior
is preserved (sites still catch and continue); the emission makes the
swallow observable for telemetry and CI gates.

The helper uses `Effect.serviceOption(EventBus)` so the publish path
requires no `EventBus` in the caller's context — it's a no-op when
`EventBus` is absent. This means swallow sites can be migrated without
threading a new dependency through their requirements set.

Helpers exported from `@reactive-agents/core`:
- `emitErrorSwallowed({ site, tag, taskId?, message? })` — Effect
  publishing the event when an EventBus is available
- `errorTag(err)` — pure classifier reading `_tag` / `Error.name` /
  `"UnknownError"`

`packages/runtime/src/test-hooks.ts` exports `KNOWN_SWALLOW_SITES` and
`forceThrowSite()` for the parameterized wiring test that verifies every
migrated site emits with the correct `site` literal.

Adding a new silent-swallow site to production code now fails the wiring
test until the site is properly instrumented.
```

- [ ] **Step 11: Stage + commit S0.2 atomically**

```bash
git add packages/core/src/services/error-swallowed.ts \
        packages/core/src/services/event-bus.ts \
        packages/core/src/index.ts \
        packages/core/tests/error-swallowed.test.ts \
        packages/runtime/src/test-hooks.ts \
        packages/runtime/tests/error-swallowed-wiring.test.ts \
        .changeset/p0-s02-error-swallowed-event.md
git add -u packages/ apps/   # picks up all 36 migrated production files
git status --short            # verify only S0.2-related files staged
```

If `git status --short` shows non-S0.2 files staged (anything outside the swallow migrations), reset them with `git reset HEAD <file>` and stage only S0.2.

```bash
git commit -m "feat(core,runtime,*): ErrorSwallowed event + catch-all site instrumentation (P0 S0.2)

Adds emitErrorSwallowed helper using Effect.serviceOption(EventBus) so
the publish path has empty requirements set and never propagates failure.
Migrates 36 production files from Effect.catchAll(() => Effect.void) to
publish an observable ErrorSwallowed AgentEvent.

KNOWN_SWALLOW_SITES + forceThrowSite() in packages/runtime/src/test-hooks.ts
power a parameterized wiring test that catches future regressions.

Closes Phase 0 S0.2."
```

- [ ] **Step 12: Update task tracker**

```bash
# Mark task 8 (S0.2) completed via TaskUpdate
```

S0.2 is now closed. Phase 0 success-gate item 1/4 (per-site swallow test green) and 3/4 (`FrameworkError` types importable) both satisfied.

---

## Task 2: S0.3 — Default redactor (interface, default patterns, fixture corpus)

**Story:** S0.3 first half. Defines the `Redactor` interface, the `applyRedactors` Effect, the OWASP-aligned default patterns, and the fixture corpus that gates the zero-leakage assertion. Wiring into `ObservabilityService` is Task 3; `RedactionApplied` event + `withObservability` integration + commit is Task 4.

**Files:**
- Create: `packages/observability/src/redaction/redactor.ts`
- Create: `packages/observability/src/redaction/default-patterns.ts`
- Create: `packages/observability/src/redaction/index.ts`
- Create: `packages/observability/tests/fixtures/known-secrets.json`
- Create: `packages/observability/tests/redaction.test.ts`

- [ ] **Step 1: Write the fixture corpus**

Create `packages/observability/tests/fixtures/known-secrets.json`:

```json
{
  "github_pat": "ghp_abc123def456ghi789jkl012mno345pqr678stu",
  "github_actions": "ghs_abc123def456ghi789jkl012mno345pqr678stu",
  "openai_project": "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmn",
  "openai_legacy": "sk-abcdefghijklmnopqrstuvwxyz1234567890abcdefghijkl",
  "anthropic": "sk-ant-api03-abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890-abcdef12",
  "jwt_generic": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSIsIm5hbWUiOiJKb2huIERvZSJ9.signature_here_padded_to_make_it_realistic",
  "aws_access": "AKIAIOSFODNN7EXAMPLE",
  "google_api": "AIzaSyA-1234567890abcdef-0123456789abcdef"
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/observability/tests/redaction.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import {
  applyRedactors,
  defaultRedactors,
  type Redactor,
} from "../src/redaction/index.js";
import {
  EventBus,
  EventBusLive,
  type AgentEvent,
} from "@reactive-agents/core";
import fixtures from "./fixtures/known-secrets.json" with { type: "json" };

describe("default redactor", () => {
  it(
    "redacts every known secret pattern (per-fixture)",
    async () => {
      for (const [name, secret] of Object.entries(fixtures)) {
        const message = `User token (${name}): ${secret} appended at end`;
        const redacted = await Effect.runPromise(
          applyRedactors(message, defaultRedactors).pipe(
            Effect.provide(EventBusLive),
          ),
        );
        expect(redacted).not.toContain(secret);
        expect(redacted).toMatch(/\[redacted-/);
      }
    },
    15000,
  );

  it(
    "preserves surrounding content",
    async () => {
      const msg = `User 'alice' logged in with token ${fixtures.github_pat} at 12:00:01`;
      const redacted = await Effect.runPromise(
        applyRedactors(msg, defaultRedactors).pipe(
          Effect.provide(EventBusLive),
        ),
      );
      expect(redacted).toContain("User 'alice' logged in");
      expect(redacted).toContain("at 12:00:01");
      expect(redacted).toContain("[redacted-github-token]");
    },
    15000,
  );

  it(
    "zero-leakage corpus assertion",
    async () => {
      const corpus = Object.values(fixtures).join("\n");
      const redacted = await Effect.runPromise(
        applyRedactors(corpus, defaultRedactors).pipe(
          Effect.provide(EventBusLive),
        ),
      );
      for (const secret of Object.values(fixtures)) {
        expect(redacted).not.toContain(secret);
      }
    },
    15000,
  );

  it(
    "custom redactors compose with defaults",
    async () => {
      const custom: Redactor = {
        name: "internal-key",
        pattern: /internal-\w+/g,
        replacement: "[redacted-internal]",
      };
      const msg = `key: internal-abc123, ${fixtures.github_pat}`;
      const redacted = await Effect.runPromise(
        applyRedactors(msg, [...defaultRedactors, custom]).pipe(
          Effect.provide(EventBusLive),
        ),
      );
      expect(redacted).toContain("[redacted-internal]");
      expect(redacted).toContain("[redacted-github-token]");
    },
    15000,
  );

  it(
    "returns input unchanged when no patterns match",
    async () => {
      const msg = "no secrets here, just lowercase ascii words";
      const redacted = await Effect.runPromise(
        applyRedactors(msg, defaultRedactors).pipe(
          Effect.provide(EventBusLive),
        ),
      );
      expect(redacted).toBe(msg);
    },
    15000,
  );

  it(
    "publishes RedactionApplied for every pattern that matched",
    async () => {
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const captured = yield* Ref.make<AgentEvent[]>([]);
          const bus = yield* EventBus;
          yield* bus.subscribe((event) =>
            Ref.update(captured, (xs) => [...xs, event]),
          );
          yield* applyRedactors(
            `${fixtures.github_pat} and ${fixtures.openai_legacy}`,
            defaultRedactors,
          );
          return yield* Ref.get(captured);
        }).pipe(Effect.provide(EventBusLive)),
      );
      const matches = events.filter((e) => e._tag === "RedactionApplied");
      expect(matches.length).toBeGreaterThanOrEqual(2);
    },
    15000,
  );
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
bun test packages/observability/tests/redaction.test.ts --timeout 15000
```

Expected: FAIL with module-not-found errors for `redaction/index`.

- [ ] **Step 4: Implement the Redactor interface and `applyRedactors`**

Create `packages/observability/src/redaction/redactor.ts`:

```typescript
import { Effect, Option } from "effect";
import { EventBus } from "@reactive-agents/core";

/**
 * A single redactor: a named regex pattern + replacement string.
 *
 * Patterns are applied in order; later redactors operate on the result
 * of earlier ones, so place more-specific patterns first to avoid
 * partial matches by shorter ones.
 *
 * @property name — Stable identifier emitted in `RedactionApplied`
 *   events; surfaces in telemetry as the matching redactor.
 * @property pattern — Global regex (use `/.../g` or include the global
 *   flag); non-global patterns will only redact the first match.
 * @property replacement — Literal string substituted for each match.
 *   Conventionally `[redacted-<kind>]`.
 */
export interface Redactor {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}

/**
 * Apply a sequence of `Redactor`s to an input string. Each redactor
 * whose pattern matches publishes a `RedactionApplied` `AgentEvent` to
 * the ambient `EventBus` (no-op when EventBus is absent).
 *
 * Pattern matching uses the literal regex on the (potentially-already-
 * redacted) string. Order matters: redactors apply in the order
 * provided. The default ordering puts longer, more-specific patterns
 * before shorter overlapping ones (e.g. `sk-ant-api*` before `sk-*`).
 *
 * @returns Effect resolving to the redacted string (input unchanged
 *   when no patterns matched).
 */
export const applyRedactors = (
  input: string,
  redactors: readonly Redactor[],
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    let output = input;
    for (const r of redactors) {
      const matches = output.match(r.pattern);
      if (matches && matches.length > 0) {
        output = output.replace(r.pattern, r.replacement);
        if (Option.isSome(busOpt)) {
          yield* busOpt.value
            .publish({
              _tag: "RedactionApplied",
              redactorName: r.name,
              matchCount: matches.length,
              timestamp: Date.now(),
            })
            .pipe(Effect.catchAll(() => Effect.void));
        }
      }
    }
    return output;
  });
```

- [ ] **Step 5: Implement the default patterns**

Create `packages/observability/src/redaction/default-patterns.ts`:

```typescript
import type { Redactor } from "./redactor.js";

/**
 * Default secret patterns covering common API keys, JWTs, and cloud
 * tokens. Order is intentional: longer/more-specific patterns appear
 * first so partial matches by shorter overlapping patterns
 * (e.g. `sk-...` matching the tail of `sk-ant-api...`) don't fire.
 *
 * Sources: OWASP secret-detection rule set, GitHub PAT format docs,
 * Anthropic/OpenAI/Google/AWS public token format docs.
 */
export const defaultRedactors: readonly Redactor[] = [
  {
    name: "anthropic-key",
    pattern: /sk-ant-api\d+-[A-Za-z0-9\-_]{80,}/g,
    replacement: "[redacted-anthropic-key]",
  },
  {
    name: "openai-project",
    pattern: /sk-proj-[A-Za-z0-9]{40,}/g,
    replacement: "[redacted-openai-key]",
  },
  {
    name: "openai-legacy",
    pattern: /sk-[A-Za-z0-9]{40,}/g,
    replacement: "[redacted-openai-key]",
  },
  {
    name: "github-pat",
    pattern: /ghp_[A-Za-z0-9]{36,}/g,
    replacement: "[redacted-github-token]",
  },
  {
    name: "github-actions",
    pattern: /ghs_[A-Za-z0-9]{36,}/g,
    replacement: "[redacted-github-token]",
  },
  {
    name: "jwt",
    pattern:
      /eyJ[A-Za-z0-9+/=_-]+\.eyJ[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+/g,
    replacement: "[redacted-jwt]",
  },
  {
    name: "aws-access",
    pattern: /AKIA[A-Z0-9]{16}/g,
    replacement: "[redacted-aws-access-key]",
  },
  {
    name: "google-api",
    pattern: /AIza[A-Za-z0-9\-_]{35}/g,
    replacement: "[redacted-google-api-key]",
  },
];
```

- [ ] **Step 6: Create the barrel export**

Create `packages/observability/src/redaction/index.ts`:

```typescript
export { applyRedactors, type Redactor } from "./redactor.js";
export { defaultRedactors } from "./default-patterns.js";
```

- [ ] **Step 7: Add the `RedactionApplied` event variant to AgentEvent**

Edit `packages/core/src/services/event-bus.ts`. After the `ErrorSwallowed` variant (added in S0.2), append:

```typescript
  // ─── Redaction instrumentation (Phase 0 S0.3) ───
  | {
      /**
       * A redactor pattern matched and replaced one or more substrings
       * in a log record. Emitted by `applyRedactors` from
       * `@reactive-agents/observability/redaction`.
       */
      readonly _tag: "RedactionApplied";
      /** Stable redactor identifier (e.g. "anthropic-key", "github-pat"). */
      readonly redactorName: string;
      /** Number of substring matches replaced in this call. */
      readonly matchCount: number;
      /** Unix timestamp in milliseconds. */
      readonly timestamp: number;
    }
```

- [ ] **Step 8: Run the test — expect green**

```bash
bun test packages/observability/tests/redaction.test.ts --timeout 15000
```

Expected: 6 tests PASS.

- [ ] **Step 9: Run the broader observability + core suites**

```bash
bun test packages/observability packages/core --timeout 15000
```

Expected: no regressions.

- [ ] **Step 10: Workspace typecheck**

```bash
bun run typecheck
```

Expected: 54/54 packages clean.

- [ ] **Step 11: Commit (interim — wired into ObservabilityService in Task 3)**

```bash
git add packages/observability/src/redaction/ \
        packages/observability/tests/redaction.test.ts \
        packages/observability/tests/fixtures/known-secrets.json \
        packages/core/src/services/event-bus.ts
git commit -m "feat(observability,core): default secrets redactor + RedactionApplied event (P0 S0.3 part 1)"
```

---

## Task 3: S0.3 — Wire redactor into ObservabilityService

**Story:** S0.3 second half. The redactor + event are defined; now apply them inside `ObservabilityService` so every sink-bound log record passes through default redactors. Surfaces `withObservability({ redactors })` for user-extensible patterns.

**Files:**
- Modify: `packages/observability/src/services/observability-service.ts`
- Test: `packages/observability/tests/observability-service-redaction.test.ts` (NEW)

- [ ] **Step 1: Read current ObservabilityService shape**

```bash
grep -n "log\|emit\|sink" packages/observability/src/services/observability-service.ts | head -30
```

Goal: identify the single place where log records go to sinks. There may be more than one entry point (e.g. `log()`, `error()`, `warn()`); identify all of them.

- [ ] **Step 2: Write the failing test**

Create `packages/observability/tests/observability-service-redaction.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import {
  ObservabilityService,
  ObservabilityServiceLive,
} from "../src/services/observability-service.js";

describe("ObservabilityService default redaction", () => {
  it(
    "redacts default secret patterns from log records before sinks see them",
    async () => {
      const sinkCaptures: string[] = [];
      // Build a service instance with a test sink that captures records.
      // Then log a record containing a known secret; assert the captured
      // record has been redacted.
      // ... implementation specific to the service's sink registration API.
    },
    15000,
  );

  it(
    "appends user-supplied redactors after defaults",
    async () => {
      // Build with `redactors: [customRedactor]`; assert custom pattern
      // also applied + RedactionApplied event published with custom name.
    },
    15000,
  );
});
```

(The exact test body is service-API-dependent — Step 1 reveals the shape. Use the simplest sink-injection mechanism the service exposes. If the service has no sink-injection mechanism, instead test the public log method by capturing `RedactionApplied` events from the EventBus.)

- [ ] **Step 3: Run the test — expect FAIL**

```bash
bun test packages/observability/tests/observability-service-redaction.test.ts --timeout 15000
```

- [ ] **Step 4: Wire `applyRedactors` into the log path**

Edit `packages/observability/src/services/observability-service.ts`. Add an import:

```typescript
import {
  applyRedactors,
  defaultRedactors,
  type Redactor,
} from "../redaction/index.js";
```

Locate every method that hands a record to a sink (Step 1 identified them). Wrap the log-record string formation with `applyRedactors`:

```typescript
// BEFORE (illustrative)
const formatted = formatRecord(record);
yield* sink.write(formatted);

// AFTER
const formatted = formatRecord(record);
const redacted = yield* applyRedactors(
  formatted,
  [...defaultRedactors, ...userRedactors],
);
yield* sink.write(redacted);
```

`userRedactors` is read from the service's config (Task 4 surfaces it via `withObservability`). For now, default to an empty array.

- [ ] **Step 5: Run the test — expect PASS**

```bash
bun test packages/observability/tests/observability-service-redaction.test.ts --timeout 15000
```

- [ ] **Step 6: Run the full observability suite**

```bash
bun test packages/observability --timeout 15000
```

Expected: no regressions.

- [ ] **Step 7: Workspace typecheck + build**

```bash
bun run typecheck
bun run build
```

Expected: 54/54 clean.

- [ ] **Step 8: Commit**

```bash
git add packages/observability/src/services/observability-service.ts \
        packages/observability/tests/observability-service-redaction.test.ts
git commit -m "feat(observability): apply default redactor to all log sinks (P0 S0.3 part 2)"
```

---

## Task 4: S0.3 — `withObservability({ redactors })` builder option + changeset

**Story:** S0.3 final. Surfaces user-extensible redactor list via the builder. Documents the feature. Closes S0.3 with a changeset.

**Files:**
- Modify: `packages/runtime/src/builder.ts` — extend `withObservability` options
- Modify: `packages/runtime/src/agent-config.ts` — extend observability schema if Effect.Schema is used
- Create: `apps/docs/src/content/docs/features/observability.md` (UPDATE if exists; create if missing)
- Create: `.changeset/p0-s03-log-redactor.md`

- [ ] **Step 1: Find current `withObservability` shape**

```bash
grep -n "withObservability" packages/runtime/src/builder.ts
```

Note the existing options object signature. Add `redactors?: readonly Redactor[]`.

- [ ] **Step 2: Write a builder integration test**

Create `packages/runtime/tests/observability-redactors.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "reactive-agents";
import type { Redactor } from "@reactive-agents/observability/redaction";

describe("withObservability redactors option", () => {
  it(
    "accepts and threads custom redactors to ObservabilityService",
    async () => {
      const custom: Redactor = {
        name: "internal-tag",
        pattern: /internal-\w+/g,
        replacement: "[redacted-internal]",
      };
      const agent = await ReactiveAgents.create()
        .withProvider("anthropic")
        .withModel("claude-haiku-4-5")
        .withObservability({ redactors: [custom] })
        .build();
      // Assert that the resolved config has the custom redactor in the
      // observability redactors list. Inspect via a documented test
      // accessor or the `builderToConfig` helper if available.
      await agent.dispose();
    },
    30000,
  );
});
```

- [ ] **Step 3: Run the test — expect FAIL (no `redactors` option yet)**

```bash
bun test packages/runtime/tests/observability-redactors.test.ts --timeout 30000
```

- [ ] **Step 4: Extend `withObservability` options**

In `packages/runtime/src/builder.ts`, find the type for `WithObservabilityOptions` (or the inline option type) and add:

```typescript
import type { Redactor } from "@reactive-agents/observability/redaction";

// In the options interface:
readonly redactors?: readonly Redactor[];
```

In the `withObservability` method body, store `opts.redactors` so it threads through to the config / runtime layer composition.

- [ ] **Step 5: Run the test — expect PASS**

```bash
bun test packages/runtime/tests/observability-redactors.test.ts --timeout 30000
```

- [ ] **Step 6: Update or create the docs page**

Edit `apps/docs/src/content/docs/features/observability.md` (create if missing). Add a section near the top:

```markdown
## Default Secrets Redactor

Every log record published through `ObservabilityService` is passed through
a default redactor that replaces well-known secret patterns:

| Pattern | Match | Replacement |
|---------|-------|-------------|
| Anthropic API keys | `sk-ant-api*` | `[redacted-anthropic-key]` |
| OpenAI keys | `sk-proj-*`, `sk-*` | `[redacted-openai-key]` |
| GitHub PATs | `ghp_*` | `[redacted-github-token]` |
| GitHub Actions | `ghs_*` | `[redacted-github-token]` |
| JWT | `eyJ*.eyJ*.*` | `[redacted-jwt]` |
| AWS Access Key | `AKIA*` (20 char) | `[redacted-aws-access-key]` |
| Google API | `AIza*` (39 char) | `[redacted-google-api-key]` |

When a redactor matches, a `RedactionApplied` `AgentEvent` is published
(`{ _tag, redactorName, matchCount, timestamp }`).

### Adding custom redactors

```ts
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withObservability({
    redactors: [
      { name: "internal-tag", pattern: /internal-\w+/g, replacement: "[redacted-internal]" },
    ],
  })
  .build();
```

Custom redactors are appended to the defaults; defaults always run first.
```

- [ ] **Step 7: Workspace typecheck + build**

```bash
bun run typecheck
bun run build
```

Expected: 54/54 clean. Docs build verified separately:

```bash
bun run docs:build
```

- [ ] **Step 8: Write the changeset**

Create `.changeset/p0-s03-log-redactor.md`:

```markdown
---
"@reactive-agents/a2a": minor
"@reactive-agents/benchmarks": minor
"@reactive-agents/cli": minor
"@reactive-agents/core": minor
"@reactive-agents/cost": minor
"@reactive-agents/eval": minor
"@reactive-agents/gateway": minor
"@reactive-agents/guardrails": minor
"@reactive-agents/health": minor
"@reactive-agents/identity": minor
"@reactive-agents/interaction": minor
"@reactive-agents/llm-provider": minor
"@reactive-agents/memory": minor
"@reactive-agents/observability": minor
"@reactive-agents/orchestration": minor
"@reactive-agents/prompts": minor
"@reactive-agents/reactive-intelligence": minor
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": minor
"@reactive-agents/testing": minor
"@reactive-agents/tools": minor
"@reactive-agents/verification": minor
"reactive-agents": minor
---

**observability, runtime, core: default secrets redactor (P0 S0.3)**

Every log record published through `ObservabilityService` is now passed
through a default redactor matching common secret patterns (Anthropic,
OpenAI, GitHub, JWT, AWS, Google API). Each match publishes a
`RedactionApplied` `AgentEvent` for telemetry.

User-extensible via:

```ts
.withObservability({ redactors: [customRedactor] })
```

Defaults always run first; user redactors append. Zero-leakage corpus
test (8 secret types) gates the implementation.
```

- [ ] **Step 9: Commit**

```bash
git add packages/runtime/src/builder.ts \
        packages/runtime/tests/observability-redactors.test.ts \
        apps/docs/src/content/docs/features/observability.md \
        .changeset/p0-s03-log-redactor.md
git commit -m "feat(runtime,docs): withObservability({ redactors }) + docs (P0 S0.3 part 3)"
```

S0.3 is now closed. Phase 0 success-gate item 2/4 (redaction zero-leakage corpus green) satisfied.

---

## Task 5: S0.4 — Probe types + 4 new probe scaffolds + run-probes runner

**Story:** S0.4 first part. Defines the `Probe`/`ProbeResult` shape, scaffolds the 4 new probes (3 stay scaffolded until P1 enables them; `error-swallowed-wiring` is real now since S0.2 shipped), and ships the runner CLI. Task 6 wires it into CI.

**Files:**
- Create: `.agents/skills/harness-improvement-loop/scripts/probes/types.ts`
- Create: `.agents/skills/harness-improvement-loop/scripts/probes/num-ctx-sanity.ts`
- Create: `.agents/skills/harness-improvement-loop/scripts/probes/semantic-memory-population.ts`
- Create: `.agents/skills/harness-improvement-loop/scripts/probes/capability-probe-on-boot.ts`
- Create: `.agents/skills/harness-improvement-loop/scripts/probes/error-swallowed-wiring.ts`
- Create: `.agents/skills/harness-improvement-loop/scripts/run-probes.ts`
- Modify: `package.json` (root) — `"probes"` script
- Modify: `.agents/skills/harness-improvement-loop/SKILL.md` — document new probes

- [ ] **Step 1: Define `ProbeResult` + `Probe` types**

Create `.agents/skills/harness-improvement-loop/scripts/probes/types.ts`:

```typescript
/**
 * Outcome of a single probe run.
 *
 * `pass` is the binary CI gate. `reason` is human-readable diagnostic.
 * `durationMs` and optional `costUsd` feed budget enforcement.
 */
export interface ProbeResult {
  readonly name: string;
  readonly pass: boolean;
  readonly reason: string;
  readonly durationMs: number;
  readonly costUsd?: number;
}

/**
 * Probe definition. Probes have two run modes:
 *
 * - `scaffoldRun()` — synthetic dry-run that always returns the
 *   "scaffolded — not yet enabled" outcome. Used so newly-added probes
 *   appear in the registry and CI surfaces them without failing builds
 *   prematurely.
 * - `run()` — real implementation. Throws or returns `{ pass: false }`
 *   if the probe genuinely fails. Enabled by removing `scaffolded: true`.
 */
export interface Probe {
  readonly name: string;
  readonly description: string;
  readonly scaffolded: boolean;
  readonly scaffoldRun: () => Promise<ProbeResult>;
  readonly run: () => Promise<ProbeResult>;
}
```

- [ ] **Step 2: Scaffold `num-ctx-sanity` probe**

Create `.agents/skills/harness-improvement-loop/scripts/probes/num-ctx-sanity.ts`:

```typescript
import type { Probe, ProbeResult } from "./types.js";

/**
 * Asserts the Ollama provider sets `options.num_ctx` from the resolved
 * `Capability.recommendedNumCtx` on every chat request.
 *
 * Scaffolded today; enabled in Phase 1 Sprint 2 once the Capability port
 * lands.
 */
export const probe: Probe = {
  name: "num-ctx-sanity",
  description:
    "Ollama provider sets options.num_ctx from capability.recommendedNumCtx > 2048",
  scaffolded: true,

  scaffoldRun: async (): Promise<ProbeResult> => ({
    name: "num-ctx-sanity",
    pass: true,
    reason: "scaffolded — enabled in P1 Sprint 2 (Capability port)",
    durationMs: 0,
  }),

  run: async (): Promise<ProbeResult> => {
    throw new Error(
      "num-ctx-sanity is scaffolded; enable in P1 Sprint 2 once Capability port ships",
    );
  },
};
```

- [ ] **Step 3: Scaffold `semantic-memory-population` probe**

Create `.agents/skills/harness-improvement-loop/scripts/probes/semantic-memory-population.ts`:

```typescript
import type { Probe, ProbeResult } from "./types.js";

/**
 * Asserts that tool observations land in the semantic-memory store
 * automatically (the "wire the dead path" change in P1 S3.2). Verified
 * by running a search-task agent twice on the same agentId; second
 * session must retrieve the first session's tool outputs via
 * `memory.retrieve(query)`.
 *
 * Scaffolded today; enabled in P1 Sprint 3.
 */
export const probe: Probe = {
  name: "semantic-memory-population",
  description:
    "Tool observations populate semantic memory (cross-session retrieval works)",
  scaffolded: true,

  scaffoldRun: async (): Promise<ProbeResult> => ({
    name: "semantic-memory-population",
    pass: true,
    reason: "scaffolded — enabled in P1 Sprint 3 (AgentMemory wiring)",
    durationMs: 0,
  }),

  run: async (): Promise<ProbeResult> => {
    throw new Error(
      "semantic-memory-population is scaffolded; enable in P1 Sprint 3",
    );
  },
};
```

- [ ] **Step 4: Scaffold `capability-probe-on-boot` probe**

Create `.agents/skills/harness-improvement-loop/scripts/probes/capability-probe-on-boot.ts`:

```typescript
import type { Probe, ProbeResult } from "./types.js";

/**
 * Asserts that `CapabilityService.resolve(provider, model)` is invoked
 * before the first LLM call on a fresh agent, populating
 * `capability.recommendedNumCtx`, `tier`, `tokenizerFamily`, etc.
 *
 * Scaffolded today; enabled in P1 Sprint 2.
 */
export const probe: Probe = {
  name: "capability-probe-on-boot",
  description:
    "CapabilityService.resolve is called before the first LLM request",
  scaffolded: true,

  scaffoldRun: async (): Promise<ProbeResult> => ({
    name: "capability-probe-on-boot",
    pass: true,
    reason: "scaffolded — enabled in P1 Sprint 2 (Capability port)",
    durationMs: 0,
  }),

  run: async (): Promise<ProbeResult> => {
    throw new Error(
      "capability-probe-on-boot is scaffolded; enable in P1 Sprint 2",
    );
  },
};
```

- [ ] **Step 5: Implement `error-swallowed-wiring` probe (real, since S0.2 shipped)**

Create `.agents/skills/harness-improvement-loop/scripts/probes/error-swallowed-wiring.ts`:

```typescript
import { spawnSync } from "node:child_process";
import type { Probe, ProbeResult } from "./types.js";

/**
 * Asserts that the per-site `ErrorSwallowed` wiring test passes — i.e.
 * every entry in `KNOWN_SWALLOW_SITES` emits an event when forced.
 *
 * This probe is REAL today (post-S0.2); failing means a production swallow
 * site was renamed without updating the constant, or the wiring helper
 * was broken.
 */
export const probe: Probe = {
  name: "error-swallowed-wiring",
  description:
    "Every KNOWN_SWALLOW_SITES entry emits an ErrorSwallowed event when forced",
  scaffolded: false,

  scaffoldRun: async (): Promise<ProbeResult> => ({
    name: "error-swallowed-wiring",
    pass: true,
    reason: "scaffold mode — real result requires bun test invocation",
    durationMs: 0,
  }),

  run: async (): Promise<ProbeResult> => {
    const start = performance.now();
    const result = spawnSync(
      "bun",
      [
        "test",
        "packages/runtime/tests/error-swallowed-wiring.test.ts",
        "--timeout",
        "15000",
      ],
      { stdio: "pipe", encoding: "utf8" },
    );
    const durationMs = performance.now() - start;
    const pass = result.status === 0;
    return {
      name: "error-swallowed-wiring",
      pass,
      durationMs,
      reason: pass
        ? "all KNOWN_SWALLOW_SITES emit ErrorSwallowed correctly"
        : `bun test exited with status ${result.status}: ${result.stderr.slice(0, 400)}`,
    };
  },
};
```

- [ ] **Step 6: Implement the runner CLI**

Create `.agents/skills/harness-improvement-loop/scripts/run-probes.ts`:

```typescript
#!/usr/bin/env bun

import { probe as numCtxSanity } from "./probes/num-ctx-sanity.js";
import { probe as semanticMemoryPopulation } from "./probes/semantic-memory-population.js";
import { probe as capabilityProbeOnBoot } from "./probes/capability-probe-on-boot.js";
import { probe as errorSwallowedWiring } from "./probes/error-swallowed-wiring.js";
import type { Probe, ProbeResult } from "./probes/types.js";

/**
 * Canonical probe registry. Add new probes here.
 * Pre-existing harness probes (trivial-1step, memory-recall-invocation,
 * memory-retrieval-fidelity) live in their own scripts; the CI workflow
 * runs both this runner and those scripts.
 */
export const REGISTERED_PROBES: readonly Probe[] = [
  numCtxSanity,
  semanticMemoryPopulation,
  capabilityProbeOnBoot,
  errorSwallowedWiring,
] as const;

/**
 * Per-run runtime budget. Enforced by CI workflow timeout — this constant
 * is used by the runner to short-circuit if it sees a single probe
 * exceeding 80% of the budget alone.
 */
const PROBE_SUITE_MAX_MINUTES = Number(
  process.env.PROBE_SUITE_MAX_MINUTES ?? "10",
);
const PROBE_SUITE_MAX_USD = Number(
  process.env.PROBE_SUITE_MAX_USD ?? "0.50",
);

const SCAFFOLD_MODE =
  (process.env.PROBE_MODE ?? "real").toLowerCase() === "scaffold";

async function main(): Promise<void> {
  const start = performance.now();
  const results: ProbeResult[] = [];

  for (const probe of REGISTERED_PROBES) {
    const runner =
      SCAFFOLD_MODE || probe.scaffolded ? probe.scaffoldRun : probe.run;
    try {
      const result = await runner();
      results.push(result);
    } catch (err) {
      results.push({
        name: probe.name,
        pass: false,
        reason: `runner threw: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: 0,
      });
    }
  }

  const totalMs = performance.now() - start;
  const failed = results.filter((r) => !r.pass);
  const totalCost = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  // Emit JSONL artifact
  const artifact = {
    timestamp: new Date().toISOString(),
    mode: SCAFFOLD_MODE ? "scaffold" : "real",
    durationMs: totalMs,
    totalCostUsd: totalCost,
    budgetMinutes: PROBE_SUITE_MAX_MINUTES,
    budgetUsd: PROBE_SUITE_MAX_USD,
    results,
  };
  console.log(JSON.stringify(artifact, null, 2));

  if (totalMs > PROBE_SUITE_MAX_MINUTES * 60_000) {
    console.error(
      `Probe suite exceeded runtime budget: ${(totalMs / 60_000).toFixed(1)} min > ${PROBE_SUITE_MAX_MINUTES} min`,
    );
    process.exit(2);
  }
  if (totalCost > PROBE_SUITE_MAX_USD) {
    console.error(
      `Probe suite exceeded cost budget: $${totalCost.toFixed(3)} > $${PROBE_SUITE_MAX_USD}`,
    );
    process.exit(3);
  }
  if (failed.length > 0) {
    console.error(`${failed.length} probe(s) failed:`);
    for (const f of failed) console.error(`  - ${f.name}: ${f.reason}`);
    process.exit(1);
  }
  console.log(`${results.length} probes passed in ${(totalMs / 1000).toFixed(1)}s.`);
}

if (import.meta.main) {
  await main();
}
```

- [ ] **Step 7: Add the `probes` script to root `package.json`**

Edit `package.json` (root). Find the `"scripts"` block and add (after the existing `probe:ollama-fc` entries):

```json
    "probes": "bun .agents/skills/harness-improvement-loop/scripts/run-probes.ts",
```

- [ ] **Step 8: Run the suite locally — expect green**

```bash
bun run probes
```

Expected output: a JSON artifact on stdout, exit 0. The 3 scaffolded probes show `"pass": true` with scaffold reasons; `error-swallowed-wiring` runs the bun test and reports its real outcome.

If `error-swallowed-wiring` fails: the wiring test itself is broken — back out and fix Task 1 Step 4-7 before continuing.

- [ ] **Step 9: Document new probes in SKILL.md**

Edit `.agents/skills/harness-improvement-loop/SKILL.md`. Find the probe-list section and add:

```markdown
### CI-gated probes (Phase 0 S0.4)

| Probe | Status | Description |
|-------|--------|-------------|
| `error-swallowed-wiring` | REAL (P0) | Every KNOWN_SWALLOW_SITES entry emits an ErrorSwallowed event |
| `num-ctx-sanity` | SCAFFOLDED (enable P1 Sprint 2) | Ollama sets options.num_ctx from Capability |
| `semantic-memory-population` | SCAFFOLDED (enable P1 Sprint 3) | Tool observations land in semantic memory |
| `capability-probe-on-boot` | SCAFFOLDED (enable P1 Sprint 2) | CapabilityService.resolve runs before first LLM call |

Run all probes:

```bash
bun run probes
```

Environment variables:
- `PROBE_MODE=scaffold` — force every probe into scaffold mode (no real LLM calls)
- `PROBE_MODEL=claude-haiku-4-5` — model used by real probes (default)
- `PROBE_SUITE_MAX_MINUTES=10` — runtime ceiling
- `PROBE_SUITE_MAX_USD=0.50` — per-run cost ceiling
```

- [ ] **Step 10: Commit**

```bash
git add .agents/skills/harness-improvement-loop/scripts/probes/ \
        .agents/skills/harness-improvement-loop/scripts/run-probes.ts \
        .agents/skills/harness-improvement-loop/SKILL.md \
        package.json
git commit -m "feat(probes): probe registry + 4 new probes (3 scaffolded, error-swallowed-wiring real) (P0 S0.4 part 1)"
```

---

## Task 6: S0.4 — CI workflow gating PR merges

**Story:** S0.4 second half. Wires the runner into a GitHub Actions job marked required for merge. Every PR runs the probe suite; any failure blocks merge. Cost-budgeted.

**Files:**
- Create: `.github/workflows/probes.yml`
- Create: `harness-reports/ci-probes-baseline-2026-04-23.jsonl`
- Create: `.changeset/p0-s04-ci-probe-suite.md`

- [ ] **Step 1: Snapshot the current probe baseline**

```bash
bun run probes > harness-reports/ci-probes-baseline-2026-04-23.jsonl 2>/dev/null
cat harness-reports/ci-probes-baseline-2026-04-23.jsonl | head -5
```

Expected: a JSON object with `"results"` array showing 4 entries (3 scaffold pass, 1 real pass).

- [ ] **Step 2: Write the GitHub Actions workflow**

Create `.github/workflows/probes.yml`:

```yaml
name: Probes

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  probes:
    name: Probe suite gate
    runs-on: ubuntu-latest
    timeout-minutes: 15  # PROBE_SUITE_MAX_MINUTES + 5min buffer
    env:
      PROBE_MODEL: claude-haiku-4-5
      PROBE_SUITE_MAX_MINUTES: '10'
      PROBE_SUITE_MAX_USD: '0.50'
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.10

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run probe suite
        run: |
          bun run probes > probe-results.jsonl 2>&1
          echo "exit=$?" >> $GITHUB_OUTPUT
        id: probes

      - name: Upload probe artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: probe-results-${{ github.run_id }}
          path: probe-results.jsonl
          retention-days: 30
```

- [ ] **Step 3: Mark the workflow required (manual step — user must do this on GitHub)**

Note in the commit message that the user must enable "probes" as a required status check in GitHub branch protection settings for `main`. The workflow file alone does not gate merges — branch protection enforces it.

- [ ] **Step 4: Run the workflow locally via `act` (optional, if installed)**

```bash
which act && act -W .github/workflows/probes.yml --container-architecture linux/amd64 || echo "act not installed; skipping local CI dry-run"
```

If `act` is installed, verify the workflow's YAML is well-formed by running it locally. If not, skip — CI itself will validate on PR.

- [ ] **Step 5: Write the changeset**

Create `.changeset/p0-s04-ci-probe-suite.md`:

```markdown
---
"@reactive-agents/a2a": minor
"@reactive-agents/benchmarks": minor
"@reactive-agents/cli": minor
"@reactive-agents/core": minor
"@reactive-agents/cost": minor
"@reactive-agents/eval": minor
"@reactive-agents/gateway": minor
"@reactive-agents/guardrails": minor
"@reactive-agents/health": minor
"@reactive-agents/identity": minor
"@reactive-agents/interaction": minor
"@reactive-agents/llm-provider": minor
"@reactive-agents/memory": minor
"@reactive-agents/observability": minor
"@reactive-agents/orchestration": minor
"@reactive-agents/prompts": minor
"@reactive-agents/reactive-intelligence": minor
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": minor
"@reactive-agents/testing": minor
"@reactive-agents/tools": minor
"@reactive-agents/verification": minor
"reactive-agents": minor
---

**ci: probe suite gate on every PR (P0 S0.4)**

`bun run probes` runs a registered probe set on every PR via the
`Probes` GitHub Actions workflow. Suite is required to pass for merge
once branch protection is configured.

Probes registered today:
- `error-swallowed-wiring` — REAL: every KNOWN_SWALLOW_SITES entry emits
  ErrorSwallowed
- `num-ctx-sanity`, `semantic-memory-population`, `capability-probe-on-boot`
  — SCAFFOLDED, enabled in Phase 1

Budgets:
- `PROBE_SUITE_MAX_MINUTES=10` (workflow timeout)
- `PROBE_SUITE_MAX_USD=0.50` (per-run cost)

Default `PROBE_MODEL=claude-haiku-4-5`.

Probe artifact uploaded as `probe-results-<run-id>` for 30-day retention.
```

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/probes.yml \
        harness-reports/ci-probes-baseline-2026-04-23.jsonl \
        .changeset/p0-s04-ci-probe-suite.md
git commit -m "ci: probe suite gate on every PR + baseline artifact (P0 S0.4 part 2)"
```

S0.4 is now closed. CI is configured; merge-gating activates once a maintainer adds `probes` to required status checks on `main` (manual GitHub UI step).

---
