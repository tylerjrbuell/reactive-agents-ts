# North Star Sprint Plan — Part 1: Phase 0 (Foundations + Evidence Gates)

**Duration:** 1 sprint (1 week).
**Goal:** land the foundations every subsequent phase depends on. Zero user-visible payoff; maximum risk reduction.
**Success condition:** every P1+ story can be written against a stable error taxonomy, a CI-gated probe suite, and a measured microbench baseline.

**North-star reference:** §14 Phase 0, §5.3 (error taxonomy), §11.6 (fixture seed prep), §12.9 (primitive migration table).

---

## Sprint-0 Day 0 (Monday): planning + RED-side drafts

Before coding begins, the Lead + Tester must complete:

1. **Confirm Tier 1 answers** from user (team, capacity resolution, probe model + budget, Effect-TS pin). Tier 2-4 answers can arrive just-in-time.
2. **Pin Effect-TS version** (advisor gap fix). Lock the current pinned version in `package.json` root (e.g. `"effect": "3.19.5"` — exact, not caret). Document upgrade policy in `AGENTS.md` → "any Effect-TS bump requires a dedicated PR with full probe re-run, never a drive-by".
3. **Snapshot probe baseline** → `harness-reports/pre-sprint-baseline-2026-04-23.json` (Tester).
4. **Create sprint board** (`docs/superpowers/plans/sprint-log-p0-sprint-1.md`) with one row per story, status columns: `planned | red | green | refactor | integration | done`.
5. **Load skills** (each Builder/Tester):
   - `effect-ts-patterns` — mandatory for all code/test writing
   - `agent-tdd` — TDD rhythm, timeouts, teardowns
   - `review-patterns` — 9-category compliance checklist
   - `architecture-reference` — dependency graph navigation
6. **RED-side test drafts** — every story's test shape drafted in planning so Builders can pick up and finish red-phase on Day 1 without re-planning.

---

## Story backlog

Seven stories total; 3 on the critical path, 4 parallelizable.

| ID | Title | Critical path | Effort (pts) | Risk |
|---|---|---|---|---|
| S0.1 | Typed error taxonomy seed | ✅ (blocks P1+) | 5 | Low |
| S0.2 | `ErrorSwallowed` event + 10-site instrumentation | ✅ (blocks P2 migration) | 3 | Low |
| S0.3 | Default log redactor with OWASP fixtures | ❌ (parallel) | 3 | Low |
| S0.4 | CI-gate probe suite + 4 new probes | ✅ (all phases depend) | 5 | Medium |
| S0.5 | Microbench baseline harness | ❌ (parallel) | 2 | Low |
| S0.6 | MEMORY.md / code reconciliation | ❌ (parallel) | 1 | Low |
| S0.7 | Debrief-quality spike (decides P4) | ❌ (parallel, time-boxed) | 2 | Medium |

Total: 21 points. Sprint capacity for 2 Builders + 1 Tester + 1 Lead ≈ 25 points (generous — P0 is the easy sprint by design).

---

## Story S0.1 — Typed error taxonomy seed

**Intent:** define `FrameworkError` + 6 top-level subtypes + initial subclasses in `@reactive-agents/core/errors`. No migration yet; types are importable so P1 stories can use them.

**North-star reference:** §5.3, §14 Phase 0 bullet "Typed error taxonomy seeded".

**Success gate:** `FrameworkError` types importable from `@reactive-agents/core/errors`; round-trip test passes.

### Files affected

- **NEW:** `packages/core/src/errors/index.ts` — public taxonomy exports
- **NEW:** `packages/core/src/errors/framework-error.ts` — base class
- **NEW:** `packages/core/src/errors/transient.ts`
- **NEW:** `packages/core/src/errors/capacity.ts`
- **NEW:** `packages/core/src/errors/capability.ts`
- **NEW:** `packages/core/src/errors/contract.ts`
- **NEW:** `packages/core/src/errors/task.ts`
- **NEW:** `packages/core/src/errors/security.ts`
- **NEW:** `packages/core/tests/errors.test.ts`
- **UPDATE:** `packages/core/src/index.ts` — re-export errors namespace
- **UPDATE:** `AGENTS.md` package map note (minor)
- **CHANGESET:** required (new public exports)

### RED — tests first

Test file: `packages/core/tests/errors.test.ts`

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
} from "@reactive-agents/core/errors"

describe("FrameworkError taxonomy", () => {
  it("every top-level kind extends FrameworkError", () => {
    expect(new TransientError("msg")).toBeInstanceOf(FrameworkError)
    expect(new CapacityError("msg")).toBeInstanceOf(FrameworkError)
    expect(new CapabilityError("msg")).toBeInstanceOf(FrameworkError)
    expect(new ContractError("msg")).toBeInstanceOf(FrameworkError)
    expect(new TaskError("msg")).toBeInstanceOf(FrameworkError)
    expect(new SecurityError("msg")).toBeInstanceOf(FrameworkError)
  })

  it("each subtype carries a unique _tag", () => {
    expect(new LLMRateLimitError(1000, "anthropic")._tag).toBe("LLMRateLimitError")
    expect(new LLMTimeoutError(5000)._tag).toBe("LLMTimeoutError")
    expect(new ToolCapabilityViolation("web-search", ["net:*"], ["net:google.com"])._tag).toBe(
      "ToolCapabilityViolation",
    )
    expect(new VerificationFailed(["missing claim"], "nudge")._tag).toBe("VerificationFailed")
    expect(new ToolIdempotencyViolation("write-file")._tag).toBe("ToolIdempotencyViolation")
  })

  it("Effect.catchTag pattern-matches on _tag", async () => {
    const program = pipe(
      Effect.fail(new LLMRateLimitError(500, "openai")),
      Effect.catchTag("LLMRateLimitError", (e) =>
        Effect.succeed({ retryAfterMs: e.retryAfterMs, provider: e.provider }),
      ),
    )
    const result = await Effect.runPromise(program)
    expect(result).toEqual({ retryAfterMs: 500, provider: "openai" })
  }, { timeout: 15000 })

  it("retryable classification derivable from top-level kind", () => {
    expect(isRetryable(new TransientError("msg"))).toBe(true)
    expect(isRetryable(new CapacityError("msg"))).toBe(true)
    expect(isRetryable(new CapabilityError("msg"))).toBe(false)
    expect(isRetryable(new ContractError("msg"))).toBe(false)
    expect(isRetryable(new TaskError("msg"))).toBe(false)
    expect(isRetryable(new SecurityError("msg"))).toBe(false)
  })

  it("LLMRateLimitError carries retryAfterMs metadata", () => {
    const err = new LLMRateLimitError(2000, "anthropic")
    expect(err.retryAfterMs).toBe(2000)
    expect(err.provider).toBe("anthropic")
  })

  it("VerificationFailed carries suggestedAction", () => {
    const err = new VerificationFailed(["gap1", "gap2"], "retry-with-guidance")
    expect(err.gaps).toEqual(["gap1", "gap2"])
    expect(err.suggestedAction).toBe("retry-with-guidance")
  })

  it("ToolCapabilityViolation is always security-severity", () => {
    const err = new ToolCapabilityViolation("code-execute", ["fs:*"], ["fs:/tmp/*"])
    expect(err).toBeInstanceOf(SecurityError)
    expect(isRetryable(err)).toBe(false)
  })
})
```

**Test count target:** 7 tests minimum. All pass after GREEN phase.

### GREEN — minimal implementation

`packages/core/src/errors/framework-error.ts`:

```ts
import { Data } from "effect"

/**
 * Top-level framework error. All framework-emitted errors extend this.
 * Use `isRetryable(err)` to classify for retry rules (see `@reactive-agents/core/errors`).
 */
export class FrameworkError extends Data.TaggedError("FrameworkError")<{
  readonly message: string
}> {
  constructor(message: string) {
    super({ message })
  }
}
```

`packages/core/src/errors/transient.ts`:

```ts
import { Data } from "effect"

/**
 * Transient failure — fault is environmental (network blip, flaky endpoint).
 * Retryable with exponential backoff.
 */
export class TransientError extends Data.TaggedError("TransientError")<{
  readonly message: string
  readonly cause?: unknown
}> {
  constructor(message: string, cause?: unknown) {
    super({ message, cause })
  }
}

export class LLMTimeoutError extends Data.TaggedError("LLMTimeoutError")<{
  readonly elapsedMs: number
  readonly message: string
}> {
  constructor(elapsedMs: number) {
    super({ elapsedMs, message: `LLM timeout after ${elapsedMs}ms` })
  }
}
```

Similar for `capacity.ts`, `capability.ts`, `contract.ts`, `task.ts`, `security.ts`. Each file:

- Exports the top-level kind as a `Data.TaggedError`
- Exports concrete subtypes as tagged errors with metadata
- JSDoc per export stating retry-ability and when to throw

`packages/core/src/errors/index.ts`:

```ts
export * from "./framework-error"
export * from "./transient"
export * from "./capacity"
export * from "./capability"
export * from "./contract"
export * from "./task"
export * from "./security"

/**
 * Classify any FrameworkError subtype for retry eligibility.
 * Transient + Capacity are retryable; others are not.
 */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof Object) || !("_tag" in err)) return false
  const tag = (err as { _tag: string })._tag
  const topLevel = tag.includes("Transient") || tag.endsWith("TimeoutError") || tag.endsWith("RateLimitError")
  return topLevel
}
```

(The exact `isRetryable` implementation is refined in Refactor — the shape here is the contract.)

### REFACTOR

- Extract subtype-to-top-level mapping into a typed `Record<string, "Transient" | "Capacity" | "Capability" | "Contract" | "Task" | "Security">`.
- Add a `FrameworkError.kind: "transient" | "capacity" | ...` derived getter.
- Ensure every subtype's `_tag` is globally unique (test enforces).

### INTEGRATION

- **New probe (Story S0.4 dependency):** `error-taxonomy-import` — a contract test that imports every public error class and asserts no TS compile errors.
- **Update `packages/core/src/index.ts`:** add `export * as Errors from "./errors"` (namespace export so users write `import { Errors } from "@reactive-agents/core"`).

### Acceptance criteria

- 7+ tests pass (`bun test packages/core/tests/errors.test.ts --timeout 15000`)
- `bun run build -F @reactive-agents/core` clean
- `bun run typecheck` clean
- `/review-patterns packages/core/src/errors` — 9/9 pass
- Changeset added with entry: `"@reactive-agents/core": minor — new typed error taxonomy"`
- `AGENTS.md` unchanged (internal addition)

### Dependencies

None. This story starts Day 1.

### Risk: LOW

Pure type addition. Nothing to regress.

---

## Story S0.2 — `ErrorSwallowed` event + 10-site instrumentation

**Intent:** wire the 10 known `catchAll(() => Effect.void)` sites to emit `ErrorSwallowed { site, tag, taskId? }` events. Instrumentation only; no migration to typed errors yet.

**North-star reference:** §14 Phase 0 first bullet, §1.2 G-6.

**Success gate:** unit test suite forces each of the 10 sites to throw; asserts `ErrorSwallowed` event emitted with correct `site` tag.

### Files affected

- **UPDATE:** `packages/core/src/services/event-bus.ts` — add `ErrorSwallowed` to `AgentEvent` union
- **UPDATE:** `packages/reasoning/src/context/context-ingestion.ts:82`
- **UPDATE:** `apps/cortex/src/cortex-reporter.ts` lines 76, 81, 86, 104, 107, 110, 150-151, 169, 174, 178 (11 sites in cortex)
- **UPDATE:** `packages/runtime/src/builder.ts` lines 4182, 4184, 4916, 5023, 5057, 5105, 5129, 5152 (8 sites in builder)
- **NEW:** `packages/core/tests/error-swallowed-event.test.ts`
- **NEW:** `packages/runtime/tests/error-swallowed-wiring.test.ts`
- **CHANGESET:** required

Note: audit revealed more than 10 sites (~20 including cortex reporter cleanup paths). Story scope is ALL of them, not just the 10 first identified in north-star §1.2.

### RED — tests first

`packages/core/tests/error-swallowed-event.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core"

describe("ErrorSwallowed event", () => {
  it("emits when a catchAll swallow fires", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const captured = yield* Ref.make<AgentEvent[]>([])
        const bus = yield* EventBus
        yield* bus.subscribe((e) =>
          Ref.update(captured, (xs) => [...xs, e]),
        )
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
    expect((swallow as any).site).toBe("test-site")
    expect((swallow as any).tag).toBe("TestError")
  }, { timeout: 15000 })
})
```

`packages/runtime/tests/error-swallowed-wiring.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { Effect, Ref } from "effect"
// Import every site helper under test
import { forceThrowSite, KNOWN_SWALLOW_SITES } from "@reactive-agents/runtime/test-hooks"

describe("10-site swallow instrumentation", () => {
  it.each(KNOWN_SWALLOW_SITES)(
    "site %s emits ErrorSwallowed when forced to throw",
    async (site) => {
      const events = await Effect.runPromise(forceThrowSite(site))
      const match = events.find((e) => e.type === "ErrorSwallowed" && e.site === site)
      expect(match).toBeDefined()
      expect(match!.tag).toMatch(/^[A-Z]\w+Error$/)
    },
    { timeout: 15000 },
  )
})
```

The `test-hooks.ts` file exports a helper that temporarily injects a faulting Effect into each site, collects events from a test-scoped `EventBus`, returns the collected events. Exports `KNOWN_SWALLOW_SITES: readonly string[]` as the canonical list (same order as north-star §1.2 G-6).

### GREEN

Each site becomes:

```ts
// BEFORE
pipe(someEffect, Effect.catchAll(() => Effect.void))

// AFTER
pipe(
  someEffect,
  Effect.catchAll((err) =>
    emitErrorSwallowed({
      site: "context-ingestion.line-82",
      tag: errorTag(err),
      taskId: getContextTaskId(),
    }),
  ),
)
```

`emitErrorSwallowed` helper in `@reactive-agents/core/src/services/error-swallowed.ts`:

```ts
import { Effect } from "effect"
import { EventBus } from "./event-bus"

export interface ErrorSwallowedPayload {
  readonly site: string
  readonly tag: string
  readonly taskId?: string
  readonly message?: string
}

export const emitErrorSwallowed = (
  payload: ErrorSwallowedPayload,
): Effect.Effect<void, never, EventBus> =>
  Effect.gen(function* () {
    const bus = yield* EventBus
    yield* bus.emit({ type: "ErrorSwallowed", ...payload, timestamp: Date.now() })
  })

export function errorTag(err: unknown): string {
  if (err && typeof err === "object" && "_tag" in err) {
    return String((err as { _tag: unknown })._tag)
  }
  if (err instanceof Error) return err.name
  return "UnknownError"
}
```

### REFACTOR

- Group site constants in `KNOWN_SWALLOW_SITES` array, export for test and registry use.
- Ensure every swallow site uses the site name format: `<package>/<relative-file>:<line>` so grep is easy.

### INTEGRATION

- Telemetry dashboard shows `ErrorSwallowed` emission frequency per site during a sample run. Committed as a manual-check artifact.

### Acceptance criteria

- Per-site test emits expected `ErrorSwallowed` event
- `bun test packages/core packages/runtime --timeout 15000` green
- `/review-patterns <changed-files>` 9/9

### Dependencies

S0.1 (typed error taxonomy — `errorTag` reads `_tag`).

### Risk: LOW

Additive change only. Existing code paths preserved (catch + swallow still happens; event is added).

---

## Story S0.3 — Default log redactor with OWASP fixtures

**Intent:** ship a redactor service that matches OWASP / GitHub token / OpenAI token / JWT patterns; emits `RedactionApplied`. Extensible via `config.observability.redactors`.

**North-star reference:** §14 Phase 0 second bullet, §7.1 security.

**Success gate:** redaction test suite passes on a known-secrets corpus with zero leakage.

### Files affected

- **NEW:** `packages/observability/src/redaction/redactor.ts`
- **NEW:** `packages/observability/src/redaction/default-patterns.ts`
- **NEW:** `packages/observability/src/redaction/index.ts`
- **NEW:** `packages/observability/tests/redaction.test.ts`
- **NEW:** `packages/observability/tests/fixtures/known-secrets.json`
- **UPDATE:** `packages/observability/src/services/observability-service.ts` — apply redactor to all emitted log records
- **UPDATE:** `packages/runtime/src/builder.ts` — add `.withObservability({ redactors })` option
- **UPDATE:** `apps/docs/src/content/docs/features/observability.md` — document default redactor + extensibility
- **CHANGESET:** required

### RED — tests first

`packages/observability/tests/fixtures/known-secrets.json`:

```json
{
  "github_pat": "ghp_abc123def456ghi789jkl012mno345pqr678stu",
  "github_actions": "ghs_abc123def456ghi789jkl012mno345pqr678stu",
  "openai_project": "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmn",
  "openai_legacy": "sk-abcdefghijklmnopqrstuvwxyz1234567890abcdefghijkl",
  "anthropic": "sk-ant-api03-abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890-abcdef12",
  "jwt_generic": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSIsIm5hbWUiOiJKb2huIERvZSJ9.signature_here",
  "aws_access": "AKIAIOSFODNN7EXAMPLE",
  "google_api": "AIzaSyA-1234567890abcdef-0123456789abcdef"
}
```

`packages/observability/tests/redaction.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { applyRedactors, defaultRedactors, type Redactor } from "@reactive-agents/observability/redaction"
import fixtures from "./fixtures/known-secrets.json"

describe("default redactor", () => {
  it("redacts every known secret pattern", async () => {
    for (const [name, secret] of Object.entries(fixtures)) {
      const message = `Here is my ${name} token: ${secret}`
      const redacted = await Effect.runPromise(applyRedactors(message, defaultRedactors))
      expect(redacted).not.toContain(secret)
      expect(redacted).toMatch(/\[redacted-\w+\]/)
    }
  }, { timeout: 15000 })

  it("preserves surrounding content", async () => {
    const msg = "User 'alice' logged in with token ghp_abc123def456ghi789jkl012mno345pqr678stu at 12:00"
    const redacted = await Effect.runPromise(applyRedactors(msg, defaultRedactors))
    expect(redacted).toContain("User 'alice' logged in")
    expect(redacted).toContain("at 12:00")
    expect(redacted).toContain("[redacted-github-token]")
  }, { timeout: 15000 })

  it("emits RedactionApplied event for each match", async () => {
    // Using event-bus probe; test captures all RedactionApplied events
    // and asserts one per secret in a multi-secret string.
  }, { timeout: 15000 })

  it("custom redactors compose with defaults", async () => {
    const custom: Redactor = {
      pattern: /internal-\w+/g,
      replacement: "[redacted-internal]",
      name: "internal-key",
    }
    const msg = "key: internal-abc123, ghp_validtokenpattern123..."
    const redacted = await Effect.runPromise(
      applyRedactors(msg, [...defaultRedactors, custom]),
    )
    expect(redacted).toContain("[redacted-internal]")
    expect(redacted).toContain("[redacted-github-token]")
  }, { timeout: 15000 })

  it("zero-leakage gate: corpus-level assertion", async () => {
    // Load entire fixture corpus, redact, assert no raw secret appears.
    const corpus = Object.values(fixtures).join("\n")
    const redacted = await Effect.runPromise(applyRedactors(corpus, defaultRedactors))
    for (const secret of Object.values(fixtures)) {
      expect(redacted).not.toContain(secret)
    }
  }, { timeout: 15000 })
})
```

### GREEN

`packages/observability/src/redaction/default-patterns.ts`:

```ts
import type { Redactor } from "./redactor"

export const defaultRedactors: readonly Redactor[] = [
  { pattern: /ghp_[A-Za-z0-9]{36,}/g, replacement: "[redacted-github-token]", name: "github-pat" },
  { pattern: /ghs_[A-Za-z0-9]{36,}/g, replacement: "[redacted-github-token]", name: "github-actions" },
  { pattern: /sk-proj-[A-Za-z0-9]{40,}/g, replacement: "[redacted-openai-key]", name: "openai-project" },
  { pattern: /sk-[A-Za-z0-9]{40,}/g, replacement: "[redacted-openai-key]", name: "openai-legacy" },
  { pattern: /sk-ant-api\d+-[A-Za-z0-9\-_]{80,}/g, replacement: "[redacted-anthropic-key]", name: "anthropic" },
  { pattern: /eyJ[A-Za-z0-9+\/=_-]+\.eyJ[A-Za-z0-9+\/=_-]+\.[A-Za-z0-9+\/=_-]+/g, replacement: "[redacted-jwt]", name: "jwt" },
  { pattern: /AKIA[A-Z0-9]{16}/g, replacement: "[redacted-aws-access-key]", name: "aws-access" },
  { pattern: /AIza[A-Za-z0-9\-_]{35}/g, replacement: "[redacted-google-api-key]", name: "google-api" },
]
```

`packages/observability/src/redaction/redactor.ts`:

```ts
import { Effect } from "effect"
import { EventBus, type AgentEvent } from "@reactive-agents/core"

export interface Redactor {
  readonly pattern: RegExp
  readonly replacement: string
  readonly name: string
}

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

### REFACTOR

- Pull out `RedactionApplied` type into `AgentEvent` union in `@reactive-agents/core`.
- Document that redactors run in order; first match wins for a given substring.
- Add CI-gated probe `redaction-zero-leakage-corpus` — runs the fixture test on every PR.

### INTEGRATION

- Wire into `ObservabilityService.emit()` so every log sink gets redacted output.
- Add `config.observability.redactors` field to `AgentConfig` (just the schema; P1 Invariant fully wires it).
- Builder: `.withObservability({ redactors: [custom1, custom2] })` merges with defaults.

### Acceptance criteria

- 5+ tests pass including zero-leakage corpus assertion
- Fixture corpus (8 secret types minimum) all redacted
- `RedactionApplied` events emitted per match
- Docs page updated (`apps/docs/src/content/docs/features/observability.md`)
- Changeset added

### Dependencies

S0.1 (event types). Can start Day 1.

### Risk: LOW

Pure additive. Existing traces unaffected unless redaction triggers (and if it does, that's the desired outcome).

---

## Story S0.4 — CI-gate probe suite + 4 new probes

**Intent:** every PR runs the probe suite; failure blocks merge. Add 4 new probes for Phase 1 readiness.

**North-star reference:** §14 Phase 0 third bullet.

**Success gate:** `trivial-1step`, `memory-recall-invocation`, `memory-retrieval-fidelity` required green; new probes `num-ctx-sanity`, `semantic-memory-population`, `capability-probe-on-boot`, `error-swallowed-wiring` scaffolded (will be enabled as their source stories land).

### Files affected

- **UPDATE:** `.github/workflows/ci.yml` — add probe job running `bun run probes`
- **NEW:** `.agents/skills/harness-improvement-loop/scripts/probes/num-ctx-sanity.ts`
- **NEW:** `.agents/skills/harness-improvement-loop/scripts/probes/semantic-memory-population.ts`
- **NEW:** `.agents/skills/harness-improvement-loop/scripts/probes/capability-probe-on-boot.ts`
- **NEW:** `.agents/skills/harness-improvement-loop/scripts/probes/error-swallowed-wiring.ts`
- **UPDATE:** `package.json` root — `"probes": "bun .agents/skills/harness-improvement-loop/scripts/run-probes.ts"` script
- **UPDATE:** `.agents/skills/harness-improvement-loop/SKILL.md` — document the new probes
- **CHANGESET:** required (CI infrastructure change, minor)

### RED — tests first

Each probe is itself a test, but we also write a CI meta-test asserting the probe suite contract:

`.agents/skills/harness-improvement-loop/scripts/run-probes.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { runAllProbes, REGISTERED_PROBES } from "./run-probes"

describe("probe suite CI contract", () => {
  it("registers every required probe", () => {
    const required = [
      "trivial-1step",
      "memory-recall-invocation",
      "memory-retrieval-fidelity",
      "num-ctx-sanity",
      "semantic-memory-population",
      "capability-probe-on-boot",
      "error-swallowed-wiring",
    ]
    for (const name of required) {
      expect(REGISTERED_PROBES.find((p) => p.name === name)).toBeDefined()
    }
  })

  it("each probe returns a typed ProbeResult", async () => {
    for (const probe of REGISTERED_PROBES) {
      const r = await probe.scaffoldRun()
      expect(r.name).toBe(probe.name)
      expect(typeof r.pass).toBe("boolean")
      expect(typeof r.durationMs).toBe("number")
    }
  }, { timeout: 60000 })
})
```

Each new probe file (e.g. `num-ctx-sanity.ts`) exports a scaffold:

```ts
export const probe = {
  name: "num-ctx-sanity",
  description: "Asserts Ollama provider sets options.num_ctx > 2048",
  scaffoldRun: async () => ({
    name: "num-ctx-sanity",
    pass: false,  // scaffold returns fail; enabled when Capability port ships P1
    reason: "scaffolded — enabled by P1 Sprint 2 Capability port story",
    durationMs: 0,
  }),
  run: async () => {
    // Real implementation fills in when P1 ships; returns pass:true once Ollama provider sets num_ctx from capability
    throw new Error("not yet implemented — ships P1 Sprint 2")
  },
}
```

### GREEN

`run-probes.ts`:

```ts
#!/usr/bin/env bun
import { probe as trivial1step } from "./probes/trivial-1step"
import { probe as memoryRecall } from "./probes/memory-recall-invocation"
// ... etc
import type { ProbeResult } from "./types"

export const REGISTERED_PROBES = [
  trivial1step,
  memoryRecall,
  // ...
  numCtxSanity,
  semanticMemoryPopulation,
  capabilityProbeOnBoot,
  errorSwallowedWiring,
] as const

export async function runAllProbes(mode: "scaffold" | "real" = "real"): Promise<ProbeResult[]> {
  const runs = REGISTERED_PROBES.map((p) =>
    mode === "scaffold" ? p.scaffoldRun() : p.run(),
  )
  return Promise.all(runs)
}

if (import.meta.main) {
  const results = await runAllProbes("real")
  const failed = results.filter((r) => !r.pass)
  if (failed.length > 0) {
    console.error(`${failed.length} probe(s) failed:`, failed.map((r) => r.name))
    process.exit(1)
  }
  console.log(`${results.length} probes passed.`)
}
```

CI wiring in `.github/workflows/ci.yml`:

```yaml
  probes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run probes
        env:
          PROBE_MODEL: ${{ secrets.PROBE_MODEL || 'claude-haiku-4-5' }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### REFACTOR

- Extract a `ProbeResult` type + a minimal Probe protocol.
- Every probe logs to `harness-reports/ci-probes-<run-id>.jsonl` (GitHub Actions artifact).
- Document scaffolded vs. real state of each new probe in SKILL.md.

### INTEGRATION

- Baseline artifact: `harness-reports/ci-probes-baseline-2026-04-23.jsonl` committed.
- Any probe listed as required in CI but failing blocks merge.

### Acceptance criteria

- CI job `probes` exists and is required for merge.
- 7 probes registered and runnable (3 real, 4 scaffolded).
- `bun run probes` exits 0 on main, exits non-zero on a seeded failure.
- Baseline artifact committed.
- **Probe-suite runtime budget** (advisor gap fix): full suite completes in ≤ `PROBE_SUITE_MAX_MINUTES` per CI run. Default: 10 min. Enforced via timeout in workflow. As probes grow across phases, the budget enforcement prevents CI cost creep.
- **Per-run cost ceiling** (advisor gap fix): `PROBE_SUITE_MAX_USD` per run. Default: $0.50 with `PROBE_MODEL=claude-haiku-4-5`; adjust with team/billing approval. Artifact `harness-reports/probe-cost-<run-id>.json` committed per CI run.

### Dependencies

S0.1 (error taxonomy needed for typed probe failures). Can start Day 1 on scaffolds; full enablement of new probes lands with P1+.

### Risk: MEDIUM

CI config errors can block all PRs. Lead reviews CI change before merging. The probe-suite runtime + cost ceiling values require user answer in Tier 1 Question 3.

---

## Story S0.5 — Microbench baseline harness

**Intent:** capture baseline timings for trivial-1step, memory-retrieval-fidelity, tool-heavy probes. Required before any P2+ perf-oriented work (Principle #8).

**North-star reference:** §14 Phase 0 fourth bullet, Principle #8.

**Success gate:** `harness-reports/benchmarks/baseline-2026-04-23.json` committed; every subsequent perf story references it.

### Files affected

- **NEW:** `.agents/skills/harness-improvement-loop/scripts/microbench.ts`
- **NEW:** `harness-reports/benchmarks/baseline-2026-04-23.json` (generated artifact)
- **UPDATE:** `.agents/skills/harness-improvement-loop/SKILL.md` — reference the microbench harness
- **CHANGESET:** not required (tooling only)

### RED — tests first

`.agents/skills/harness-improvement-loop/scripts/microbench.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { runMicrobench, type MicrobenchResult } from "./microbench"

describe("microbench harness", () => {
  it("returns timings for every registered scenario", async () => {
    const r = await runMicrobench({ iterations: 3 })
    expect(r.length).toBeGreaterThan(0)
    for (const s of r) {
      expect(s.name).toBeDefined()
      expect(s.medianMs).toBeGreaterThan(0)
      expect(s.iterations).toBe(3)
    }
  }, { timeout: 120000 })
})
```

### GREEN

`microbench.ts`:

```ts
#!/usr/bin/env bun
import { Effect } from "effect"
import { ReactiveAgents } from "reactive-agents"

export interface MicrobenchResult {
  readonly name: string
  readonly iterations: number
  readonly medianMs: number
  readonly p95Ms: number
  readonly minMs: number
  readonly maxMs: number
}

const SCENARIOS = [
  { name: "trivial-1step", run: async () => { /* ... */ } },
  { name: "memory-retrieval-fidelity", run: async () => { /* ... */ } },
  { name: "tool-heavy-5-calls", run: async () => { /* ... */ } },
]

export async function runMicrobench(opts: { iterations: number }): Promise<MicrobenchResult[]> {
  const results: MicrobenchResult[] = []
  for (const scenario of SCENARIOS) {
    const timings: number[] = []
    for (let i = 0; i < opts.iterations; i++) {
      const start = performance.now()
      await scenario.run()
      timings.push(performance.now() - start)
    }
    timings.sort((a, b) => a - b)
    results.push({
      name: scenario.name,
      iterations: opts.iterations,
      medianMs: timings[Math.floor(timings.length / 2)]!,
      p95Ms: timings[Math.floor(timings.length * 0.95)]!,
      minMs: timings[0]!,
      maxMs: timings[timings.length - 1]!,
    })
  }
  return results
}

if (import.meta.main) {
  const results = await runMicrobench({ iterations: 5 })
  const artifact = {
    timestamp: new Date().toISOString(),
    results,
    commit: process.env.GITHUB_SHA ?? "local",
  }
  const path = `harness-reports/benchmarks/baseline-${new Date().toISOString().slice(0, 10)}.json`
  await Bun.write(path, JSON.stringify(artifact, null, 2))
  console.log(`Baseline written to ${path}`)
}
```

### REFACTOR

- Every scenario uses fixed seeds for determinism where possible.
- Iterations default to 5; increase via CLI flag.
- Output format stable so P1+ comparisons are easy.

### INTEGRATION

- Run `bun .agents/skills/harness-improvement-loop/scripts/microbench.ts` once at sprint close, commit artifact.

### Acceptance criteria

- Script executable, returns stable results on 3+ runs (variance < 10%).
- Baseline artifact committed.
- Documented in SKILL.md.

### Dependencies

None; parallel to all other stories.

### Risk: LOW

Tooling-only.

---

## Story S0.6 — MEMORY.md / code reconciliation

**Intent:** reconcile MEMORY.md claims (`StallDetector`, `HarnessHarmDetector`, `ModelTierProfile`) with code reality. Handler modules exist under kebab-case filenames but not as named types; `ModelTierProfile` is absent.

**North-star reference:** §14 Phase 0 fifth bullet, §1.3.

**Success gate:** no MEMORY.md claim is contradicted by code; docs/code match exactly.

### Files affected

- **UPDATE:** `.agents/MEMORY.md` — remove or update claims (rename handler references, delete ModelTierProfile mention or mark as deferred)
- **UPDATE:** `/home/tylerbuell/.claude/projects/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/memory/MEMORY.md` — sync
- **POSSIBLE:** `packages/reactive-intelligence/src/controller/handlers/stall-detector.ts` — add named export if claimed as a named type
- **CHANGESET:** not required (docs only)

### RED — tests first

`packages/reactive-intelligence/tests/doc-code-parity.test.ts`:

```ts
import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"

describe("MEMORY.md parity with code", () => {
  it("every named class claimed in MEMORY.md exists in code", () => {
    const memory = readFileSync(".agents/MEMORY.md", "utf8")
    const claimedClasses = ["StallDetector", "HarnessHarmDetector", "ModelTierProfile"]
    const grep = (name: string) =>
      Bun.$`rg "export (class|const|function|interface) ${name}" packages/`.text()

    for (const cls of claimedClasses) {
      if (memory.includes(cls)) {
        const found = grep(cls)
        // If memory mentions it as a deferred/absent, skip this assertion
        expect(found).not.toBe("")  // else code must back the claim
      }
    }
  }, { timeout: 30000 })
})
```

### GREEN

Two paths:
1. **Promote:** add `export class StallDetector { ... }` at top of `handlers/stall-detector.ts` (just a thin class wrapping the handler function) so the MEMORY.md claim becomes honest.
2. **Demote:** update MEMORY.md to reference `handlers/stall-detector.ts` (the file) rather than `StallDetector` (the class).

Recommend **demote** for StallDetector + HarnessHarmDetector (they are fundamentally handler modules, not classes). Recommend **delete** for ModelTierProfile (not used anywhere).

### REFACTOR

- Update the MEMORY.md "Current Status" section accordingly.
- Consider a CI lint rule that errors on MEMORY.md mentioning any `PascalCase` symbol that does not appear in `rg "export (class|interface|const|function) <name>"`.

### INTEGRATION

- Sync both MEMORY.md files (project + Claude auto-memory).

### Acceptance criteria

- Parity test green.
- Both MEMORY.md files updated.

### Dependencies

None; parallel.

### Risk: LOW

Docs-only.

---

## Story S0.7 — Debrief-quality spike

**Intent:** run `debrief.ts` across 10 recent probe traces; grade whether outputs are coherent enough to distill into reusable Skills. Binary answer decides whether P4 (closed learning loop) is 2 weeks or 2 months.

**North-star reference:** §14 Phase 0 sixth bullet, Phase 4 gate.

**Success condition:** grading artifact committed + P4 scope decision recorded.

### Files affected

- **NEW:** `harness-reports/debrief-quality-spike-2026-04-23.md`
- **UPDATE:** north-star §14 Phase 4 if scope changes
- **UPDATE:** `.agents/MEMORY.md` Running Issues Log — record decision
- **CHANGESET:** not required

### Activity (time-boxed, 1 day)

1. Select 10 recent probe traces from `harness-reports/`.
2. Run `debrief.ts` against each.
3. Grade each output on a rubric:
   - **A:** "clearly distillable into a reusable skill"
   - **B:** "partial — could be distilled with post-processing"
   - **C:** "noisy — would produce a bad skill"
   - **D:** "unusable — no skill content"
4. Aggregate: if ≥6/10 are A or B, P4 proceeds as scheduled (2 weeks). Else P4 is re-scoped as "build distillation pipeline first" (separate ~3-week project).
5. Record rationale in spike artifact.

### Acceptance criteria

- Artifact committed.
- P4 decision recorded in north-star iteration log + MEMORY.md.

### Dependencies

None; parallel, time-boxed.

### Risk: MEDIUM

If result is D-heavy, Phase 4 gets pushed. Not a sprint blocker but affects planning downstream.

---

## Sprint close (Day 5): demo + retro

### Demo artifact

- All 7 stories green on the sprint board.
- `harness-reports/ci-probes-baseline-2026-04-23.jsonl` and `harness-reports/benchmarks/baseline-2026-04-23.json` committed.
- `FrameworkError` types importable.
- CI probe suite running on every PR.
- MEMORY.md reconciled with code.

### Retro triggers (record in `.agents/MEMORY.md` Running Issues Log)

Questions to ask:
- Did any story take > 1.5x its estimate? Why?
- Did any test reveal a preexisting bug (add to Architecture Debt)?
- Did CI probes fail for reasons other than the intended scope? (flakes to fix)
- Did redaction fixture corpus miss a secret pattern we encountered in logs? (add to defaults)

### Success-gate recap for Phase 0

Per north-star §14 Phase 0 gate: "unit test suite forces each of the 10 sites to throw and asserts the `ErrorSwallowed` event is emitted with the correct `site` tag — this verifies wiring, not traffic. Redaction test suite passes on a known-secrets corpus with zero leakage. `FrameworkError` types importable from `@reactive-agents/core/errors`."

All four conditions must be true to close Phase 0:
1. ✅ Per-site swallow test green
2. ✅ Redaction zero-leakage corpus green
3. ✅ Error taxonomy importable
4. ✅ CI probe suite gates merges

If any condition fails, the Lead either extends Sprint 0 by 2-3 days OR descopes P1 Sprint 1 work to accommodate catch-up.

---

## Phase 0 outputs — what P1 consumes

- `@reactive-agents/core/errors` namespace importable
- `ErrorSwallowed` event type in `AgentEvent` union
- Default redactor applied to all traces
- CI probe suite gating merges (baseline + 4 new probes scaffolded)
- Microbench baseline (P2 perf comparisons root here)
- MEMORY.md + code in parity
- P4 scope confirmed (2 weeks or re-scoped)

All of this is a precondition for Sprint 1 of Phase 1 (the Invariant refactor).
