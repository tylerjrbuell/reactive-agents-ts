# Phase 0 Execution Playbook — Foundations + Evidence Gates

**Shop-floor instructions for Week 1.** Companion to `2026-04-23-north-star-sprint-plan-01-phase-0.md` (the blueprint). This is the actionable playbook: full file contents, exact commands, day-by-day schedule, DoD checklists.

**Preconditions verified:**
- Tier 1-4 decisions locked (overview §12) — all sensible defaults accepted.
- North-star v2.3 at `docs/spec/docs/15-design-north-star.md`.
- Solo implementer mode. Scope cuts applied per heavy sprint if over capacity.

---

## Week 1 at a glance (7 stories, 21 pts)

| Day | Story | Title | Points | Critical? |
|---|---|---|---|---|
| Mon AM | Day-0 | Preflight | — | — |
| Mon PM | S0.1 | Typed error taxonomy — start RED | 5 | ✅ |
| Tue | S0.1 | Complete RED → GREEN | — | ✅ |
| Tue PM | S0.6 | MEMORY.md reconciliation (parallel) | 1 | ❌ |
| Wed | S0.2 + S0.3 | ErrorSwallowed event + Log redactor | 3+3 | ✅ (S0.2) |
| Thu | S0.4 + S0.5 | CI probe suite + Microbench baseline | 5+2 | ✅ (S0.4) |
| Fri AM | S0.7 | Debrief-quality spike (time-boxed 1 day) | 2 | ❌ |
| Fri PM | Close | Demo + retro + Phase 1 kickoff prep | — | — |

**Gate:** every story green by Friday EOD. Fallback: if Tuesday shows S0.1 over budget, cut S0.6 to a buffer day in Week 2.

---

## Day 0 (Monday AM) — Preflight

Execute in order. Do NOT skip any step.

### Step 1 — Pin Effect-TS (Tier-1 decision #4)

```bash
# From repo root
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
```

Open root `package.json` and change every `"effect": "^3.19.x"` to `"effect": "3.19.x"` (drop the caret). Same for all sub-package `package.json` files.

Find every occurrence:

```bash
rtk proxy "rg '\"effect\":\\s*\"\\^' packages/ apps/ package.json"
```

After edit, reinstall to re-pin lockfile:

```bash
bun install
```

Verify:

```bash
rtk proxy "rg '\"effect\":' package.json"
# Expect: exact versions like "effect": "3.19.5", NO carets
```

### Step 2 — Snapshot probe baseline (Tester)

```bash
bun run probes > harness-reports/pre-sprint-baseline-2026-04-23.jsonl 2>&1 || true
# The || true is because some probes may fail today; we're capturing current state
```

Commit:

```bash
git add harness-reports/pre-sprint-baseline-2026-04-23.jsonl
git commit -m "chore: snapshot pre-sprint-0 probe baseline"
```

### Step 3 — Create sprint log

```bash
touch docs/superpowers/plans/sprint-log-p0-sprint-1.md
```

Paste into the file:

```markdown
# Phase 0 Sprint 1 — Daily Log

**Week of:** 2026-04-23
**Capacity:** solo implementer, ~15 pts sprint. Stretch target: 21 pts (all 7 stories). Scope-cut fallback: S0.6 deferable to buffer.

## Story status

| ID | Title | Pts | Status | Started | Closed | Notes |
|---|---|---|---|---|---|---|
| S0.1 | Typed error taxonomy | 5 | planned | | | critical path |
| S0.2 | ErrorSwallowed event | 3 | planned | | | |
| S0.3 | Log redactor | 3 | planned | | | parallel |
| S0.4 | CI probe suite | 5 | planned | | | critical path |
| S0.5 | Microbench baseline | 2 | planned | | | parallel |
| S0.6 | MEMORY.md reconcile | 1 | planned | | | parallel, deferable |
| S0.7 | Debrief-quality spike | 2 | planned | | | parallel, time-boxed |

Status values: planned → red → green → refactor → integration → done | blocked | deferred

## Daily notes

### Day 0 (Mon AM)

- [ ] Effect-TS pinned exact
- [ ] Probe baseline committed
- [ ] This sprint log created
- [ ] 4 skills mentally loaded (effect-ts-patterns, agent-tdd, review-patterns, architecture-reference)

### Day 1 (Mon PM)

### Day 2 (Tue)

### Day 3 (Wed)

### Day 4 (Thu)

### Day 5 (Fri) — demo + retro

## Blockers

(none yet)

## Carry-forward to Phase 1

(populated Friday)
```

### Step 4 — Load skills (mental preload)

Before writing code, read these (5 minutes each):

- `.claude/skills/effect-ts-patterns/SKILL.md` — `Context.Tag`, `Layer`, `Schema.Struct`, `Ref`, no `throw`, no raw `await`, no `any`
- `.agents/skills/agent-tdd/SKILL.md` — `--timeout 15000`, `Effect.flip` for error paths, `.stop(true)` on servers, `mock.module()` caveats
- `.agents/skills/review-patterns/SKILL.md` — 9-category compliance checklist
- `.agents/skills/architecture-reference/SKILL.md` — dependency graph for the monorepo

### Step 5 — Branch

```bash
git checkout -b feat/phase-0-foundations
```

All Phase 0 work lands in this branch. Each story is a commit; PR opens at sprint close.

**Day 0 done when:**
- [ ] Effect-TS exact-pinned
- [ ] Probe baseline artifact committed
- [ ] Sprint log created
- [ ] Skills pre-loaded
- [ ] Branch `feat/phase-0-foundations` checked out

---

## Story S0.1 — Typed Error Taxonomy (Day 1-2, 5 pts, CRITICAL PATH)

### Context

First critical-path story. Every subsequent `Effect.catchTag(...)` depends on these types. Must land before S0.2 (which wires `errorTag()` from this module).

### File-by-file implementation

#### File 1 — `packages/core/src/errors/framework-error.ts` (NEW)

```ts
import { Data } from "effect"

/**
 * Top-level framework error. All framework-emitted errors extend one of the six
 * kind-specific subclasses (TransientError, CapacityError, CapabilityError,
 * ContractError, TaskError, SecurityError).
 *
 * Use `isRetryable(err)` from `@reactive-agents/core/errors` to classify for
 * retry rules. The six kinds are orthogonal: an error is exactly one kind.
 *
 * This class is NOT instantiated directly; use a specific subclass.
 *
 * @see isRetryable
 * @see TransientError
 * @see CapacityError
 * @see CapabilityError
 * @see ContractError
 * @see TaskError
 * @see SecurityError
 */
export class FrameworkError extends Data.TaggedError("FrameworkError")<{
  readonly message: string
}> {}
```

#### File 2 — `packages/core/src/errors/transient.ts` (NEW)

```ts
import { Data } from "effect"

/**
 * Transient failure — the fault is environmental (network blip, flaky endpoint,
 * transient DNS resolution). Retryable with exponential backoff.
 *
 * Subtypes: LLMTimeoutError, ConnectionResetError, DNSResolutionError.
 *
 * Retry rule default: 2-3 attempts, linear or exponential backoff.
 */
export class TransientError extends Data.TaggedError("TransientError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * LLM request exceeded the client-side timeout. The LLM may have been working
 * when the timeout fired — safe to retry ONLY if the calling tool is idempotent.
 */
export class LLMTimeoutError extends Data.TaggedError("LLMTimeoutError")<{
  readonly elapsedMs: number
  readonly message: string
}> {}
```

#### File 3 — `packages/core/src/errors/capacity.ts` (NEW)

```ts
import { Data } from "effect"

/**
 * Capacity failure — the provider/endpoint is overloaded, rate-limited, or
 * returning quota-related errors. Retryable with exponential backoff + jitter,
 * typically honoring server-supplied retry-after hints.
 *
 * Subtypes: LLMRateLimitError, ServerOverloadedError, QuotaExceededError.
 */
export class CapacityError extends Data.TaggedError("CapacityError")<{
  readonly message: string
  readonly retryAfterMs?: number
}> {}

/**
 * LLM provider rate limited the request (e.g. 429 response). If `retryAfterMs`
 * is present, retry rules should honor it as the minimum delay.
 */
export class LLMRateLimitError extends Data.TaggedError("LLMRateLimitError")<{
  readonly retryAfterMs?: number
  readonly provider?: string
  readonly message: string
}> {}
```

#### File 4 — `packages/core/src/errors/capability.ts` (NEW)

```ts
import { Data } from "effect"

/**
 * Capability failure — the model or tool cannot perform the requested
 * operation. NOT retryable; retry is pointless because the capability gap is
 * structural.
 *
 * Subtypes: ModelCapabilityError (e.g. asking a no-vision model to process
 * images), ToolUnsupportedInputError, ToolVersionMismatch.
 */
export class CapabilityError extends Data.TaggedError("CapabilityError")<{
  readonly message: string
  readonly capability?: string
}> {}

/**
 * The model lacks a required capability for the requested operation.
 */
export class ModelCapabilityError extends Data.TaggedError("ModelCapabilityError")<{
  readonly provider: string
  readonly model: string
  readonly required: string
  readonly message: string
}> {}
```

#### File 5 — `packages/core/src/errors/contract.ts` (NEW)

```ts
import { Data } from "effect"

/**
 * Contract failure — OUR code is wrong (type mismatch, schema violation,
 * misuse of an API). NOT retryable. Indicates a bug that should be fixed, not
 * handled.
 *
 * Subtypes: SchemaValidationError, ToolIdempotencyViolation, MissingConfigField.
 */
export class ContractError extends Data.TaggedError("ContractError")<{
  readonly message: string
  readonly expected?: unknown
  readonly actual?: unknown
}> {}

/**
 * A tool declared `idempotent: false` was attempted for retry. This is a
 * framework bug — retry rules should filter on idempotency before emitting.
 */
export class ToolIdempotencyViolation extends Data.TaggedError("ToolIdempotencyViolation")<{
  readonly toolName: string
  readonly message: string
}> {}
```

#### File 6 — `packages/core/src/errors/task.ts` (NEW)

```ts
import { Data } from "effect"

/**
 * Task failure — the task itself is ill-formed, unsolvable as stated, or the
 * agent's output cannot satisfy it. NOT retryable without changing the task.
 *
 * Subtypes: VerificationFailed, IllFormedTaskError, MaxIterationsReachedError.
 */
export class TaskError extends Data.TaggedError("TaskError")<{
  readonly message: string
  readonly taskId?: string
}> {}

/**
 * Task verification did not pass. Carries the list of specific gaps and a
 * suggested recovery action (nudge, retry-with-guidance, or abandon).
 */
export class VerificationFailed extends Data.TaggedError("VerificationFailed")<{
  readonly gaps: readonly string[]
  readonly suggestedAction: "nudge" | "retry-with-guidance" | "abandon"
  readonly message: string
}> {}
```

#### File 7 — `packages/core/src/errors/security.ts` (NEW)

```ts
import { Data } from "effect"

/**
 * Security failure — a tool or subsystem attempted an operation outside its
 * declared capabilities. NOT retryable. Should be escalated to
 * `SecurityEvent` telemetry and optionally trigger a kill switch.
 *
 * Subtypes: ToolCapabilityViolation, PromptInjectionDetected,
 * UnauthorizedMCPServer.
 */
export class SecurityError extends Data.TaggedError("SecurityError")<{
  readonly message: string
}> {}

/**
 * A tool attempted an operation outside its declared `capabilities` scope
 * (env var, network host, filesystem path).
 */
export class ToolCapabilityViolation extends Data.TaggedError("ToolCapabilityViolation")<{
  readonly toolName: string
  readonly attempted: readonly string[]
  readonly granted: readonly string[]
  readonly message: string
}> {}
```

#### File 8 — `packages/core/src/errors/index.ts` (NEW)

```ts
/**
 * Framework error taxonomy — all errors emitted by `@reactive-agents/*` packages
 * extend one of the six top-level kinds. Retry rules pattern-match on `_tag`
 * for type-driven retry decisions.
 *
 * @example Catch a specific error tag:
 * ```ts
 * pipe(
 *   someEffect,
 *   Effect.catchTag("LLMRateLimitError", (e) =>
 *     Effect.succeed({ retryAfterMs: e.retryAfterMs ?? 1000 }),
 *   ),
 * )
 * ```
 *
 * @example Classify retry eligibility:
 * ```ts
 * if (isRetryable(err)) {
 *   // apply retry rule pipeline
 * }
 * ```
 */

export * from "./framework-error"
export * from "./transient"
export * from "./capacity"
export * from "./capability"
export * from "./contract"
export * from "./task"
export * from "./security"

type TaggedError = { readonly _tag: string }

const RETRYABLE_TAGS: ReadonlySet<string> = new Set([
  "TransientError",
  "CapacityError",
  "LLMTimeoutError",
  "LLMRateLimitError",
])

/**
 * Classify a framework error for retry eligibility.
 * Transient and Capacity errors (and their subtypes) are retryable;
 * Capability, Contract, Task, and Security errors are NOT retryable.
 *
 * @param err Any value. Returns false for non-FrameworkError inputs.
 */
export function isRetryable(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("_tag" in err)) {
    return false
  }
  return RETRYABLE_TAGS.has((err as TaggedError)._tag)
}
```

#### File 9 — `packages/core/src/index.ts` (UPDATE)

Append to the existing file's exports:

```ts
export * as Errors from "./errors"
```

#### File 10 — `packages/core/tests/errors.test.ts` (NEW)

```ts
import { describe, it, expect } from "bun:test"
import { Effect, pipe } from "effect"
import {
  FrameworkError,
  TransientError,
  CapacityError,
  CapabilityError,
  ContractError,
  TaskError,
  SecurityError,
  LLMRateLimitError,
  LLMTimeoutError,
  ToolCapabilityViolation,
  VerificationFailed,
  ToolIdempotencyViolation,
  isRetryable,
} from "../src/errors"

describe("FrameworkError taxonomy", () => {
  it("every top-level kind has a unique _tag", () => {
    const tags = [
      new TransientError({ message: "x" })._tag,
      new CapacityError({ message: "x" })._tag,
      new CapabilityError({ message: "x" })._tag,
      new ContractError({ message: "x" })._tag,
      new TaskError({ message: "x" })._tag,
      new SecurityError({ message: "x" })._tag,
    ]
    expect(new Set(tags).size).toBe(tags.length)
  })

  it("each subtype carries a unique _tag", () => {
    expect(new LLMRateLimitError({ retryAfterMs: 1000, provider: "anthropic", message: "rate limit" })._tag).toBe("LLMRateLimitError")
    expect(new LLMTimeoutError({ elapsedMs: 5000, message: "timeout" })._tag).toBe("LLMTimeoutError")
    expect(new ToolCapabilityViolation({ toolName: "web-search", attempted: ["net:*"], granted: ["net:google.com"], message: "violation" })._tag).toBe("ToolCapabilityViolation")
    expect(new VerificationFailed({ gaps: ["missing claim"], suggestedAction: "nudge", message: "failed" })._tag).toBe("VerificationFailed")
    expect(new ToolIdempotencyViolation({ toolName: "write-file", message: "retry on non-idempotent" })._tag).toBe("ToolIdempotencyViolation")
  })

  it("Effect.catchTag pattern-matches on _tag", async () => {
    const program = pipe(
      Effect.fail(new LLMRateLimitError({ retryAfterMs: 500, provider: "openai", message: "rate limited" })),
      Effect.catchTag("LLMRateLimitError", (e) =>
        Effect.succeed({ retryAfterMs: e.retryAfterMs, provider: e.provider }),
      ),
    )
    const result = await Effect.runPromise(program)
    expect(result).toEqual({ retryAfterMs: 500, provider: "openai" })
  }, 15000)

  it("retryable classification", () => {
    expect(isRetryable(new TransientError({ message: "x" }))).toBe(true)
    expect(isRetryable(new CapacityError({ message: "x" }))).toBe(true)
    expect(isRetryable(new LLMRateLimitError({ message: "x" }))).toBe(true)
    expect(isRetryable(new LLMTimeoutError({ elapsedMs: 1000, message: "x" }))).toBe(true)
    expect(isRetryable(new CapabilityError({ message: "x" }))).toBe(false)
    expect(isRetryable(new ContractError({ message: "x" }))).toBe(false)
    expect(isRetryable(new TaskError({ message: "x" }))).toBe(false)
    expect(isRetryable(new SecurityError({ message: "x" }))).toBe(false)
  })

  it("isRetryable returns false for non-framework inputs", () => {
    expect(isRetryable(null)).toBe(false)
    expect(isRetryable(undefined)).toBe(false)
    expect(isRetryable("error string")).toBe(false)
    expect(isRetryable(new Error("native error"))).toBe(false)
  })

  it("LLMRateLimitError carries retryAfterMs metadata", () => {
    const err = new LLMRateLimitError({ retryAfterMs: 2000, provider: "anthropic", message: "rate limited" })
    expect(err.retryAfterMs).toBe(2000)
    expect(err.provider).toBe("anthropic")
  })

  it("VerificationFailed carries suggestedAction", () => {
    const err = new VerificationFailed({ gaps: ["gap1", "gap2"], suggestedAction: "retry-with-guidance", message: "verify failed" })
    expect(err.gaps).toEqual(["gap1", "gap2"])
    expect(err.suggestedAction).toBe("retry-with-guidance")
  })
})
```

### Execution commands

```bash
# After all 10 files in place:

# 1. Typecheck
bun run typecheck -F @reactive-agents/core

# 2. Build
bun run build -F @reactive-agents/core

# 3. Test
bun test packages/core/tests/errors.test.ts --timeout 15000

# 4. Pattern review (manual — run mental checklist or invoke skill)
# /review-patterns packages/core/src/errors

# 5. Changeset
bun run changeset
# When prompted:
#   - Packages: select all (fixed group)
#   - Bump: minor
#   - Summary: "core: new typed error taxonomy (FrameworkError + 6 kinds with subtypes)"

# 6. Commit
git add packages/core/src/errors/ packages/core/src/index.ts packages/core/tests/errors.test.ts .changeset/
git commit -m "feat(core): typed error taxonomy (S0.1)"
```

### Definition of Done

- [ ] All 10 files created/updated
- [ ] 7+ tests pass (`bun test packages/core/tests/errors.test.ts --timeout 15000`)
- [ ] `bun run build -F @reactive-agents/core` clean
- [ ] `bun run typecheck` 54/54 clean
- [ ] `/review-patterns packages/core/src/errors` 9/9 pass
- [ ] Changeset added (`bun run changeset`)
- [ ] Committed on `feat/phase-0-foundations` branch
- [ ] Sprint log updated: status=done, closed timestamp

### Rollback

If tests fail and root cause isn't obvious after 30 min:
```bash
git reset --hard HEAD~1
```
Re-plan RED phase. Do not proceed without green.

---

## Story S0.2 — ErrorSwallowed Event + 10-Site Instrumentation (Day 3, 3 pts)

### Context

Builds on S0.1 (needs `errorTag()` helper reading `_tag`). Instruments every `catchAll(() => Effect.void)` site to emit `ErrorSwallowed` — wiring verification, not traffic.

### File-by-file

#### File 1 — `packages/core/src/services/error-swallowed.ts` (NEW)

```ts
import { Effect } from "effect"
import { EventBus } from "./event-bus"

/**
 * Payload emitted when a framework site catches and swallows an error.
 * Use `emitErrorSwallowed({ site, tag })` instead of `catchAll(() => Effect.void)`
 * to keep swallows observable.
 */
export interface ErrorSwallowedPayload {
  readonly site: string
  readonly tag: string
  readonly taskId?: string
  readonly message?: string
}

/**
 * Emit an ErrorSwallowed event to the EventBus.
 * Returns an Effect that always succeeds with undefined.
 */
export const emitErrorSwallowed = (
  payload: ErrorSwallowedPayload,
): Effect.Effect<void, never, EventBus> =>
  Effect.gen(function* () {
    const bus = yield* EventBus
    yield* bus.emit({
      type: "ErrorSwallowed",
      site: payload.site,
      tag: payload.tag,
      taskId: payload.taskId,
      message: payload.message,
      timestamp: Date.now(),
    })
  })

/**
 * Extract a stable tag name from any error value. Reads `_tag` if present,
 * falls back to the Error constructor name, or "UnknownError".
 */
export function errorTag(err: unknown): string {
  if (err && typeof err === "object" && "_tag" in err) {
    return String((err as { _tag: unknown })._tag)
  }
  if (err instanceof Error) return err.name
  return "UnknownError"
}
```

#### File 2 — `packages/core/src/services/event-bus.ts` (UPDATE)

Locate the `AgentEvent` union and add:

```ts
  | {
      readonly type: "ErrorSwallowed"
      readonly site: string
      readonly tag: string
      readonly taskId?: string
      readonly message?: string
      readonly timestamp: number
    }
```

#### File 3 — `packages/core/src/index.ts` (UPDATE)

Add:

```ts
export { emitErrorSwallowed, errorTag, type ErrorSwallowedPayload } from "./services/error-swallowed"
```

#### Files 4-13 — Migrate the 10 known swallow sites

**Site #1 — `packages/reasoning/src/context/context-ingestion.ts:82`**

Find `Effect.catchAll(() => Effect.void)`. Replace with:

```ts
Effect.catchAll((err) =>
  emitErrorSwallowed({ site: "reasoning/context-ingestion.ts:82", tag: errorTag(err) }),
)
```

Imports at top:

```ts
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core"
```

**Sites #2-8 — `packages/runtime/src/builder.ts` lines 4182, 4184, 4916, 5023, 5057, 5105, 5129, 5152**

Same pattern. Site name format: `"runtime/builder.ts:<line>"`.

**Sites #9-11+ — `apps/cortex/src/cortex-reporter.ts` lines 76, 81, 86, 104, 107, 110, 150-151, 169, 174, 178**

Same pattern. Site name format: `"cortex/cortex-reporter.ts:<line>"`. Note: cortex has 11 sites; the 10 north-star sites include the most impactful; document remaining cortex sites in sprint log but migrate all.

#### File 14 — `packages/runtime/src/test-hooks.ts` (NEW)

Exports helpers used by tests:

```ts
import { Effect, Ref } from "effect"
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core"

export const KNOWN_SWALLOW_SITES: readonly string[] = [
  "reasoning/context-ingestion.ts:82",
  "runtime/builder.ts:4182",
  "runtime/builder.ts:4184",
  "runtime/builder.ts:4916",
  "runtime/builder.ts:5023",
  "runtime/builder.ts:5057",
  "runtime/builder.ts:5105",
  "runtime/builder.ts:5129",
  "runtime/builder.ts:5152",
  "cortex/cortex-reporter.ts:76",
  // ...add all migrated sites
] as const

/**
 * Force a site to throw by injecting a failing Effect; capture all AgentBus
 * events emitted during the forced failure. Used in wiring tests only.
 */
export const forceThrowSite = (site: string): Effect.Effect<AgentEvent[]> => {
  /* ... site-specific injection; implementation detail per site */
  return Effect.succeed([])  // placeholder shape; real implementation per migrated site
}
```

#### File 15 — `packages/core/tests/error-swallowed.test.ts` (NEW)

```ts
import { describe, it, expect } from "bun:test"
import { Effect, Ref } from "effect"
import { EventBus, EventBusLive, emitErrorSwallowed, errorTag, type AgentEvent } from "../src"

describe("ErrorSwallowed event", () => {
  it("emits when a catchAll swallow fires", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const captured = yield* Ref.make<AgentEvent[]>([])
        const bus = yield* EventBus
        yield* bus.subscribe((e) => Ref.update(captured, (xs) => [...xs, e]))
        yield* emitErrorSwallowed({
          site: "test-site",
          tag: "TestError",
          taskId: "t1",
        })
        return yield* Ref.get(captured)
      }).pipe(Effect.provide(EventBusLive)),
    )
    const swallow = events.find((e) => e.type === "ErrorSwallowed")
    expect(swallow).toBeDefined()
    expect(swallow?.type === "ErrorSwallowed" && swallow.site).toBe("test-site")
    expect(swallow?.type === "ErrorSwallowed" && swallow.tag).toBe("TestError")
  }, 15000)

  it("errorTag reads _tag from tagged error", () => {
    const err = { _tag: "CustomError", message: "test" }
    expect(errorTag(err)).toBe("CustomError")
  })

  it("errorTag falls back to Error name", () => {
    const err = new TypeError("bad input")
    expect(errorTag(err)).toBe("TypeError")
  })

  it("errorTag returns UnknownError for inputs without _tag or Error", () => {
    expect(errorTag("just a string")).toBe("UnknownError")
    expect(errorTag(null)).toBe("UnknownError")
    expect(errorTag(42)).toBe("UnknownError")
  })
})
```

#### File 16 — `packages/runtime/tests/error-swallowed-wiring.test.ts` (NEW)

```ts
import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { forceThrowSite, KNOWN_SWALLOW_SITES } from "../src/test-hooks"

describe("10-site swallow instrumentation", () => {
  for (const site of KNOWN_SWALLOW_SITES) {
    it(`site ${site} emits ErrorSwallowed when forced`, async () => {
      const events = await Effect.runPromise(forceThrowSite(site))
      const match = events.find(
        (e) => e.type === "ErrorSwallowed" && e.site === site,
      )
      expect(match).toBeDefined()
      expect(match?.type === "ErrorSwallowed" && match.tag).toMatch(/^[A-Z]\w+(?:Error)?$/)
    }, 15000)
  }
})
```

### Execution commands

```bash
bun test packages/core/tests/error-swallowed.test.ts --timeout 15000
bun test packages/runtime/tests/error-swallowed-wiring.test.ts --timeout 15000
bun run typecheck
bun run build

bun run changeset
# Summary: "core+runtime: ErrorSwallowed event + 10-site instrumentation (S0.2)"

git add -A
git commit -m "feat(core,runtime): ErrorSwallowed event + 10-site wiring (S0.2)"
```

### Definition of Done

- [ ] `ErrorSwallowed` in `AgentEvent` union
- [ ] `emitErrorSwallowed` + `errorTag` helpers exported
- [ ] All 10+ swallow sites migrated
- [ ] `KNOWN_SWALLOW_SITES` constant lists every migration
- [ ] Per-site wiring test green
- [ ] Core tests green
- [ ] Build + typecheck clean
- [ ] Changeset added
- [ ] Sprint log updated

### Rollback

Per-site migration is additive — if one site breaks, revert that site only, keep others. `git diff <file>` before committing to verify no unrelated changes.

---

## Story S0.3 — Default Log Redactor (Day 3, 3 pts, parallel to S0.2)

### Context

Ships the default redactor with OWASP patterns. Zero-leakage fixture corpus is the gate.

### File-by-file

#### File 1 — `packages/observability/src/redaction/default-patterns.ts` (NEW)

```ts
import type { Redactor } from "./redactor"

/**
 * Default secret patterns covering common API keys, JWTs, and cloud tokens.
 * Matches OWASP secret detection fixture corpus.
 *
 * Order matters: longer/more-specific patterns first so partial matches of
 * shorter patterns don't claim substrings.
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
    pattern: /eyJ[A-Za-z0-9+/=_-]+\.eyJ[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+/g,
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
]
```

#### File 2 — `packages/observability/src/redaction/redactor.ts` (NEW)

```ts
import { Effect } from "effect"
import { EventBus } from "@reactive-agents/core"

export interface Redactor {
  readonly name: string
  readonly pattern: RegExp
  readonly replacement: string
}

/**
 * Apply a sequence of redactors to a string, emitting RedactionApplied events
 * for each pattern that fires. Order preserved from input array; first-match
 * semantics for each redactor.
 */
export const applyRedactors = (
  input: string,
  redactors: readonly Redactor[],
): Effect.Effect<string, never, EventBus> =>
  Effect.gen(function* () {
    const bus = yield* EventBus
    let output = input
    for (const r of redactors) {
      const matches = output.match(r.pattern)
      if (matches && matches.length > 0) {
        output = output.replace(r.pattern, r.replacement)
        yield* bus.emit({
          type: "RedactionApplied",
          redactorName: r.name,
          matchCount: matches.length,
          timestamp: Date.now(),
        })
      }
    }
    return output
  })
```

#### File 3 — `packages/observability/src/redaction/index.ts` (NEW)

```ts
export { applyRedactors, type Redactor } from "./redactor"
export { defaultRedactors } from "./default-patterns"
```

#### File 4 — `packages/core/src/services/event-bus.ts` (UPDATE)

Add to `AgentEvent` union:

```ts
  | {
      readonly type: "RedactionApplied"
      readonly redactorName: string
      readonly matchCount: number
      readonly timestamp: number
    }
```

#### File 5 — `packages/observability/tests/fixtures/known-secrets.json` (NEW)

Paste the fixture JSON from sprint plan §P1.S0.3 (8 secret types).

#### File 6 — `packages/observability/tests/redaction.test.ts` (NEW)

Use the test file content from sprint plan §P1.S0.3, adjusted for actual imports.

#### File 7 — `packages/observability/src/services/observability-service.ts` (UPDATE)

Wire the redactor into emit paths so every log record is redacted before sinks see it.

### Execution commands

```bash
bun test packages/observability/tests/redaction.test.ts --timeout 15000
bun run typecheck
bun run build

bun run changeset
# Summary: "observability: default log redactor with OWASP patterns (S0.3)"

git add -A
git commit -m "feat(observability): default log redactor (S0.3)"
```

### Definition of Done

- [ ] All 8 default patterns match their fixtures
- [ ] Zero-leakage corpus test green
- [ ] `RedactionApplied` event fires per match
- [ ] Custom redactor composition test green
- [ ] Build + typecheck clean
- [ ] Docs page `apps/docs/src/content/docs/features/observability.md` updated
- [ ] Changeset added

---

## Story S0.4 — CI Probe Suite (Day 4, 5 pts, CRITICAL PATH)

### Context

CI-gate the probe suite. Wire the 4 new probes (scaffolded now, enabled across P1-P2). Enforce probe-suite runtime + cost budgets.

### Key files

- `.agents/skills/harness-improvement-loop/scripts/run-probes.ts` — runner
- `.agents/skills/harness-improvement-loop/scripts/probes/{num-ctx-sanity,semantic-memory-population,capability-probe-on-boot,error-swallowed-wiring}.ts` — 4 new probe scaffolds
- `.github/workflows/ci.yml` — add `probes` job required for merge
- `package.json` root — `"probes": "bun .agents/skills/harness-improvement-loop/scripts/run-probes.ts"`
- `harness-reports/ci-probes-baseline-2026-04-23.jsonl` — committed baseline

See sprint plan `2026-04-23-north-star-sprint-plan-01-phase-0.md` §Story S0.4 for full RED/GREEN code.

### Key commands

```bash
# Install probe CLI
bun add -D tsx  # if not already present

# Local dry run
bun run probes

# Enable PROBE_MODEL + budget ceilings
echo "PROBE_MODEL=claude-haiku-4-5" >> .github/workflows/ci.yml  # via editor, not echo
echo "PROBE_SUITE_MAX_MINUTES=10" >> .github/workflows/ci.yml
echo "PROBE_SUITE_MAX_USD=0.50" >> .github/workflows/ci.yml

# Commit
bun run changeset
# Summary: "ci: probe suite gate + 4 new scaffolded probes (S0.4)"

git add -A
git commit -m "ci: probe suite gate on every PR (S0.4)"
```

### Definition of Done

- [ ] `bun run probes` exits 0 on main
- [ ] CI workflow has `probes` job marked required
- [ ] 3 real + 4 scaffolded probes registered in `REGISTERED_PROBES`
- [ ] `harness-reports/ci-probes-baseline-2026-04-23.jsonl` committed
- [ ] SKILL.md documents the 4 new probes + scaffold→real transition plan
- [ ] Probe-suite runtime budget enforced via workflow timeout
- [ ] Per-run cost ceiling documented in README

---

## Story S0.5 — Microbench Baseline (Day 4, 2 pts, parallel)

Script: `.agents/skills/harness-improvement-loop/scripts/microbench.ts`.

Run:
```bash
bun .agents/skills/harness-improvement-loop/scripts/microbench.ts
# Commits harness-reports/benchmarks/baseline-2026-04-23.json
```

### Definition of Done

- [ ] Script runnable, stable (<10% variance over 3 runs)
- [ ] Baseline artifact committed
- [ ] Referenced in SKILL.md

---

## Story S0.6 — MEMORY.md Reconciliation (Tue PM or Fri, 1 pt, deferable)

Update `.agents/MEMORY.md` + Claude memory MEMORY.md to either (a) rename `StallDetector` / `HarnessHarmDetector` references to use handler-module path syntax OR (b) promote them to named classes. Delete `ModelTierProfile` references.

Add parity test in `packages/reactive-intelligence/tests/doc-code-parity.test.ts`.

### Definition of Done

- [ ] Parity test green
- [ ] Both MEMORY.md files updated
- [ ] No grep hits for claimed-but-absent symbols

---

## Story S0.7 — Debrief-Quality Spike (Fri AM, 2 pts, 1-day time-box)

Run `debrief.ts` across 10 recent probe traces. Grade rubric A/B/C/D. If ≥6 are A or B → P4 proceeds as scheduled. Else re-scope.

Commit to `harness-reports/debrief-quality-spike-2026-04-23.md` with:
- Grade per trace (table)
- Aggregate verdict
- P4 scope decision

### Definition of Done

- [ ] Artifact committed
- [ ] P4 scope decision recorded in MEMORY.md
- [ ] North-star Iteration Log updated if scope changed

---

## Friday EOD — Sprint close

### Demo artifacts to commit

- `harness-reports/ci-probes-baseline-2026-04-23.jsonl`
- `harness-reports/benchmarks/baseline-2026-04-23.json`
- `harness-reports/debrief-quality-spike-2026-04-23.md`
- `docs/superpowers/plans/sprint-log-p0-sprint-1.md` (filled in)

### Retro — 5 minutes

Append to `.agents/MEMORY.md` under "Running Issues Log":

```markdown
### Phase 0 Sprint 1 Retro — 2026-04-XX

**Shipped (points):** 21/21 (or X/21 with deferrals noted)
**Issues encountered:**
- (list)
**Carry-forward:**
- (list — e.g., S0.6 deferred to Phase 1 Sprint 1 Day 5)
**Pattern wins:**
- (e.g., per-site swallow instrumentation cleaner than expected)
```

### PR open

```bash
git push -u origin feat/phase-0-foundations

gh pr create --title "Phase 0: Foundations + Evidence Gates" --body "$(cat <<'EOF'
## Summary
- Typed error taxonomy (S0.1) — `FrameworkError` + 6 kinds in `@reactive-agents/core/errors`
- ErrorSwallowed event + 10-site instrumentation (S0.2)
- Default log redactor with OWASP fixtures (S0.3)
- CI probe suite gate + 4 new probes scaffolded (S0.4)
- Microbench baseline (S0.5)
- MEMORY.md reconciliation (S0.6)
- Debrief-quality spike (S0.7) — P4 decision: [scheduled | re-scoped]

## Test plan
- [x] `bun test` 100% green (21 pts of stories)
- [x] `bun run build` clean across 27 packages
- [x] `bun run typecheck` 54/54 clean
- [x] `/review-patterns` 9/9 per story
- [x] Probe suite green on main; CI `probes` job required
- [x] Redaction zero-leakage corpus green
- [x] Per-site `ErrorSwallowed` wiring tests green

## North-star gate
Phase 0 success gate (§14) verified:
- ✅ Per-site swallow test green
- ✅ Redaction zero-leakage corpus green
- ✅ Error taxonomy importable
- ✅ CI probe suite gates merges

Ready for Phase 1 Sprint 1 (Invariant — builder → config routing).
EOF
)"
```

---

## Phase 1 kickoff prep (Friday 4 PM)

Write `docs/superpowers/plans/2026-04-30-phase-1-execution-playbook.md` — the next phase's playbook using this file as template. Pre-plan Monday-of-next-week on Friday so Phase 1 starts hot.

Agenda for Phase 1 Sprint 1 Day 0:
1. Verify Phase 0 PR merged
2. New branch `feat/phase-1-invariant`
3. Pre-load `AgentConfig` schema audit (S1.1 red drafts)
4. Skills to re-load: same four + peek `kernel-extension` + `implement-service`
5. Start P1.S1.1 red-phase Monday PM

---

## Execution principles across Phase 0

1. **RED first, always.** Test drafts on Day 0; Builders finish red on Day 1 before any impl.
2. **One story at a time.** No parallel implementations per builder. Parallel stories only across multiple builders.
3. **Commit per story.** Use the exact commit message format shown above for traceability.
4. **Don't batch DoD.** Check boxes as you go, not at end of week.
5. **Block on DoD, not on "feels done."** Every box literal — if lint fails, story isn't done.
6. **Scope cuts visible.** If a story slips, update sprint log same day, don't bury.
7. **No `any` casts.** If Effect-TS types resist, stop and ask — don't cast.
8. **`/review-patterns` before every commit.** Faster than post-merge rework.

This playbook gets Phase 0 shipped. Phase 1 playbook lands Friday; all subsequent phases same format.
