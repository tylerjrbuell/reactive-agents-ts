# Wave F — Compose API Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write three MDX documentation files for the Compose API: full API reference, harness tag catalog, and cookbook with 9 composition recipes. Also update stability marking and navigation index.

**Architecture:** All docs land in `apps/docs/src/content/docs/`. The site uses Starlight (Astro-based). MDX with standard frontmatter. No codegen needed for Wave F — harness-tags.mdx is hand-authored from the known 7 tags (codegen is a v0.12 build step per spec §10.4).

**Tech Stack:** MDX (Markdown + JSX), Starlight frontmatter (`title`, `description`, `sidebar`), `apps/docs/` Astro project

---

## Critical Context

### Docs site structure

```bash
# Check actual structure before writing:
ls apps/docs/src/content/docs/
ls apps/docs/src/content/docs/reference/ 2>/dev/null
ls apps/docs/src/content/docs/cookbook/ 2>/dev/null
```

Standard Starlight frontmatter:
```mdx
---
title: Page Title
description: One-line description shown in meta tags
sidebar:
  order: N
---
```

### Compose API source (spec §1–§9)

- `wiki/Architecture/Design-Specs/2026-05-06-compose-harness-api.md` — full spec, read §1–§9 for compose-api.mdx content
- Wave A–D tag catalog: 7 tags in `packages/core/src/services/harness-types.ts:29–36`
- 9 cookbook recipes: spec §8.9 table (lines 554–565)

### Known 7 tags (Wave A-D)

```
prompt.system, nudge.loop-detected, nudge.healing-failure,
message.tool-result, observation.tool-result,
lifecycle.failure, control.strategy-evaluated
```

---

## File Map

### Created
```
apps/docs/src/content/docs/reference/compose-api.mdx
apps/docs/src/content/docs/reference/harness-tags.mdx
apps/docs/src/content/docs/cookbook/composition-recipes.mdx
```

### Modified
- `apps/docs/src/content/docs/reference/stability.md` (or `.mdx`) — mark `.compose()` as `@stable`
- `apps/docs/src/content/docs/index.mdx` — add harness/compose card or tagline mention

---

## Task 1: compose-api.mdx — Full API Reference

**Files:**
- Create: `apps/docs/src/content/docs/reference/compose-api.mdx`

- [ ] **Step 1.1: Check docs site structure**

```bash
ls apps/docs/src/content/docs/reference/
head -20 apps/docs/src/content/docs/reference/stability.md 2>/dev/null || head -20 apps/docs/src/content/docs/reference/stability.mdx 2>/dev/null
```

Check how existing reference pages start (frontmatter pattern).

- [ ] **Step 1.2: Read compose spec sections**

Read `wiki/Architecture/Design-Specs/2026-05-06-compose-harness-api.md` sections §1–§5 (conceptual) and §6–§8 (API surface). Key content to extract:
- `.compose()` method signature (§3 or §11.1)
- `harness.on()`, `harness.tap()`, `harness.emit()` signatures
- `harness.before()`, `harness.after()`, `harness.onError()` signatures
- `harness.use()` pattern
- Transform semantics (undefined → keep, null → suppress, value → replace)
- Wildcard patterns (`prompt.*`, `nudge.**`, `**`)

- [ ] **Step 1.3: Write compose-api.mdx**

```mdx
---
title: Compose API
description: Reference for .compose(), harness transforms, phase hooks, and pattern matching
sidebar:
  order: 10
---

import { Tabs, TabItem, Code } from '@astrojs/starlight/components';

The Compose API lets you intercept and reshape any signal the agent kernel emits — from system prompts to tool results to nudges — using a declarative composition model.

## Quick start

```ts
import { ReactiveAgents } from 'reactive-agents';
import { maxIterations, budgetLimit } from 'reactive-agents/compose/killswitches';

const agent = await ReactiveAgents.create()
  .withProvider('anthropic')
  .compose(budgetLimit({ maxTokens: 50_000 }))
  .compose(maxIterations(20))
  .compose((harness) => {
    harness.tap('observation.tool-result', (result, ctx) => {
      console.log(`[iter ${ctx.iteration}] tool result:`, result.content);
    });
  })
  .build();
```

## `.compose(fn)`

**Signature:** `compose(fn: (harness: Harness) => void): this`

Registers a composition block. Multiple `.compose()` calls accumulate in registration order.

`fn` receives a `Harness` instance with methods to register transforms, taps, and phase hooks. All registrations are compiled once at `.build()` time.

`.compose()` is the canonical entry point. `.withHarness()` is an identical alias.

## `harness.on(pattern, fn)` — Transform

Intercept and replace an emission's payload.

**Signature:**
```ts
harness.on(
  pattern: TagPattern | TagPattern[],
  fn: (payload: PayloadFor<P>, ctx: ContextFor<P>) =>
    | PayloadFor<P>          // replace payload
    | undefined              // keep current payload
    | null                   // suppress emission
    | Promise<...>
): Harness
```

**Pattern types:**

| Pattern | Matches |
|---|---|
| `'prompt.system'` | Exact tag |
| `'prompt.*'` | All single-segment `prompt.X` tags |
| `'nudge.**'` | All `nudge.X` and `nudge.X.Y` tags (multi-segment) |
| `'**'` | Every tag |
| `(tag) => boolean` | Custom predicate |

**Transform semantics:**

- Return a value → **replaces** current payload
- Return `undefined` → **keeps** current payload (pass-through)
- Return `null` → **suppresses** the emission (removed from pipeline)
- Multiple transforms on same tag chain in order: broadest pattern first, most-specific last

**Example — suppress all nudges in a bare-LLM ablation:**
```ts
harness.on('nudge.*', () => null)
```

**Example — localize system prompt:**
```ts
harness.on('prompt.system', (text, ctx) => `[locale: fr]\n${text}`)
```

## `harness.tap(pattern, fn)` — Side Effect

Observe an emission without changing it. Runs after all transforms.

**Signature:**
```ts
harness.tap(
  pattern: TagPattern | TagPattern[],
  fn: (payload: PayloadFor<P>, ctx: ContextFor<P>) => void | Promise<void>
): Harness
```

Taps run in registration order, after transforms are finalized. A tap that throws is a bug — they run unconditionally with the final value.

**Example — telemetry:**
```ts
harness.tap('**', (payload, ctx) => {
  otel.record(ctx.phase, ctx.iteration, payload);
});
```

## `harness.before(phase, fn)` — Phase Pre-Hook

Run before a kernel phase. Can abort or skip the iteration.

**Signature:**
```ts
harness.before(
  phase: Phase,
  fn: (ctx: { phase: Phase; iteration: number; state: KernelStateLike }) =>
    | void
    | Promise<void>
    | { readonly abort: 'stop' | 'terminate'; readonly reason?: string }
    | { readonly skip: true }
): Harness
```

**Return values:**

| Return | Effect |
|---|---|
| `void` / `undefined` | Continue normally |
| `{ abort: 'stop' }` | End loop gracefully (status: done) |
| `{ abort: 'terminate' }` | End loop as failure (status: failed) |
| `{ skip: true }` | Skip this iteration, continue loop |

**Example — custom iteration limit:**
```ts
harness.before('think', (ctx) => {
  if (ctx.iteration >= 15) return { abort: 'stop', reason: 'custom-limit' };
});
```

## `harness.after(phase, fn)` — Phase Post-Hook

Run after a kernel phase completes. Same signature as `.before()` but fires after.

## `harness.onError(phase, fn)` — Error Hook

Run when a phase throws. Can optionally recover by returning a replacement state.

**Signature:**
```ts
harness.onError(
  phase: Phase | '*',
  fn: (error: unknown, ctx: { phase: Phase | '*'; iteration: number }) =>
    | void
    | Promise<void>
    | { readonly recover: KernelStateLike }
): Harness
```

Use `'*'` to catch errors from any phase. Return `{ recover: newState }` to inject a replacement state and continue the loop.

## `harness.emit(tag, payload)` — Inject at Build Time

Inject a payload directly at build time. Use for initial seeding.

## `harness.use(fn)` — Sub-composition

Nest a composition block. Useful for reusable plugin patterns.

```ts
harness.use((h) => {
  h.tap('observation.tool-result', logFn);
  h.before('act', approvalFn);
});
```

## Available Phases

```
bootstrap → guardrail → cost-route → strategy-select → think → act
→ observe → verify → memory-flush → cost-track → audit → complete
```

Phase hooks fire in this order per iteration. `bootstrap` and `complete` fire once per run.

## Context Fields

All hook/transform callbacks receive a `ctx` with at minimum:

```ts
{
  iteration: number;   // 0-indexed
  phase: Phase;        // current phase name
  state: KernelStateLike;  // current kernel state snapshot
  strategy: string;    // active reasoning strategy ('reactive', 'tot', etc.)
}
```

Some tags carry richer contexts — see [Harness Tag Reference](/reference/harness-tags).

## Killswitches

Prebuilt compositions from `reactive-agents/compose/killswitches`:

```ts
import {
  budgetLimit, timeoutAfter, maxIterations,
  requireApprovalFor, watchdog, confidenceFloor
} from 'reactive-agents/compose/killswitches';
```

See [Composition Recipes](/cookbook/composition-recipes) for usage examples.
```

- [ ] **Step 1.4: Build docs site to verify no MDX errors**

```bash
cd apps/docs && bun run build 2>&1 | tail -20
```

Fix any frontmatter or MDX syntax errors.

- [ ] **Step 1.5: Commit**

```bash
git add apps/docs/src/content/docs/reference/compose-api.mdx
git commit -m "docs: add compose-api.mdx reference page"
```

---

## Task 2: harness-tags.mdx — Tag Catalog

**Files:**
- Create: `apps/docs/src/content/docs/reference/harness-tags.mdx`

- [ ] **Step 2.1: Read harness-types.ts for tag definitions and payloads**

```bash
cat packages/core/src/services/harness-types.ts
```

Note all 7 tags, their payload types, and context types.

- [ ] **Step 2.2: Write harness-tags.mdx**

```mdx
---
title: Harness Tag Reference
description: Complete catalog of harness emission tags, payloads, and contexts (Wave A–D)
sidebar:
  order: 11
---

Harness tags are the interception points that `.compose()` blocks can observe and reshape. Each tag has a typed payload and a typed context.

> **Note:** This catalog covers the Wave A–D tag set (7 tags). The full v0.12 catalog will expand to 24+ tags via build-time codegen.

## Tag Catalog

### `prompt.system`

Emitted when the kernel assembles the system prompt for an LLM call.

**Payload:** `string` — the full system prompt text  
**Context:** `BaseCtx`  
**Phase:** `think`

```ts
harness.on('prompt.system', (text, ctx) => {
  return `[tenant: ${ctx.strategy}]\n${text}`;
});
```

---

### `nudge.loop-detected`

Emitted when the loop detector identifies a repetitive pattern.

**Payload:** `string` — the nudge message injected into context  
**Context:** `NudgeCtx` — includes `trigger: string`, `severity: 'info' | 'warn' | 'critical'`  
**Phase:** `think`

```ts
harness.on('nudge.loop-detected', (msg, ctx) => {
  console.warn(`Loop at iter ${ctx.iteration} [${ctx.severity}]: ${ctx.trigger}`);
  return msg;  // pass through unchanged
});
```

---

### `nudge.healing-failure`

Emitted when tool call healing fails after all recovery stages.

**Payload:** `string` — the healing failure nudge message  
**Context:** `NudgeCtx` — includes `trigger: string`, `severity`  
**Phase:** `act`

---

### `message.tool-result`

Emitted when a tool result is added to the conversation thread (what the LLM sees).

**Payload:** `KernelMessageLike` — the message object:
```ts
type KernelMessageLike =
  | { role: 'assistant'; content: string; toolCalls?: unknown[] }
  | { role: 'tool_result'; toolCallId: string; toolName: string; content: string; isError?: boolean }
  | { role: 'user'; content: string }
```
**Context:** `ToolResultCtx` — includes `toolName`, `callId`, `healed: boolean`, `durationMs`  
**Phase:** `act`

```ts
// Redact PII from tool results before LLM sees them
harness.on('message.tool-result', (msg) => {
  if (msg.role === 'tool_result') {
    return { ...msg, content: redact(msg.content) };
  }
  return msg;
});
```

---

### `observation.tool-result`

Emitted when a tool result is recorded as an observation step (what systems observe).

**Payload:** `ObservationStepLike`:
```ts
type ObservationStepLike = {
  type: string;
  content?: string;
  metadata?: Record<string, unknown>;
}
```
**Context:** `ToolResultCtx`  
**Phase:** `act`

```ts
harness.tap('observation.tool-result', (obs, ctx) => {
  metrics.record('tool.duration', ctx.durationMs, { tool: ctx.toolName });
});
```

---

### `lifecycle.failure`

Emitted when the agent enters a failure state.

**Payload:** `LifecycleFailurePayload`:
```ts
type LifecycleFailurePayload = {
  reason: 'tool-error' | 'llm-refusal' | 'verifier-rejection';
  errorMessage: string;
  attemptNumber: number;
  failureStreak: number;
  currentStrategy: string;
}
```
**Context:** `BaseCtx`

```ts
harness.tap('lifecycle.failure', (failure) => {
  alerting.trigger({ reason: failure.reason, streak: failure.failureStreak });
});
```

---

### `control.strategy-evaluated`

Emitted when the strategy evaluator scores the current strategy.

**Payload:** `ControlStrategyEvaluatedPayload`:
```ts
type ControlStrategyEvaluatedPayload = {
  currentStrategy: string;
  score: number;
  failureStreak: number;
  recommendedAction: 'continue' | 'switch' | 'escalate';
  availableStrategies: string[];
}
```
**Context:** `BaseCtx`

```ts
harness.tap('control.strategy-evaluated', (eval) => {
  if (eval.recommendedAction === 'escalate') {
    notify.ops(`Strategy escalation: ${eval.currentStrategy} (score: ${eval.score})`);
  }
});
```

---

## Context Types

### `BaseCtx`
```ts
{
  iteration: number;
  phase: Phase;
  state: Readonly<KernelStateLike>;
  strategy: string;
}
```

### `NudgeCtx` (extends BaseCtx)
```ts
{
  trigger: string;   // what triggered the nudge
  severity: 'info' | 'warn' | 'critical';
}
```

### `ToolResultCtx` (extends BaseCtx)
```ts
{
  toolName: string;
  callId: string;
  healed: boolean;    // true if tool call was auto-healed
  durationMs: number; // wall-clock tool execution time
}
```
```

- [ ] **Step 2.3: Build docs to verify**

```bash
cd apps/docs && bun run build 2>&1 | tail -10
```

- [ ] **Step 2.4: Commit**

```bash
git add apps/docs/src/content/docs/reference/harness-tags.mdx
git commit -m "docs: add harness-tags.mdx tag catalog (Wave A-D, 7 tags)"
```

---

## Task 3: composition-recipes.mdx — 9 Cookbook Patterns

**Files:**
- Create: `apps/docs/src/content/docs/cookbook/composition-recipes.mdx`

- [ ] **Step 3.1: Check if cookbook directory exists**

```bash
ls apps/docs/src/content/docs/cookbook/ 2>/dev/null || echo "MISSING — create dir"
```

Create the directory if missing (write the file — Bun/Astro will handle directory creation).

- [ ] **Step 3.2: Read spec §8.9 for recipe table**

Read `wiki/Architecture/Design-Specs/2026-05-06-compose-harness-api.md` lines 550–566 for the 9 patterns.

- [ ] **Step 3.3: Write composition-recipes.mdx**

```mdx
---
title: Composition Recipes
description: Nine production-ready patterns for the Compose API, from compliance to telemetry
sidebar:
  order: 1
---

Each recipe is a complete, runnable `.compose()` block. Copy-paste and adapt.

## 1. Compliance / PII Redaction

Scrub sensitive data from tool results before the LLM sees them. Log everything to an audit trail.

```ts
import { ReactiveAgents } from 'reactive-agents';
import { redact } from './your-pii-redactor';
import { auditLog } from './your-audit-logger';

const agent = await ReactiveAgents.create()
  .withProvider('anthropic')
  .compose((harness) => {
    harness.on('observation.tool-result', (obs) => ({
      ...obs,
      content: obs.content ? redact(obs.content) : obs.content,
    }));
    harness.tap('**', (payload, ctx) => {
      auditLog({ tag: ctx.phase, iteration: ctx.iteration, payload });
    });
  })
  .build();
```

---

## 2. Localization

Translate nudges and system prompts for non-English deployments.

```ts
.compose((harness) => {
  harness.on('nudge.*', async (msg) => await translate(msg, 'fr'));
  harness.on('prompt.system', async (text) => await localize(text, { locale: 'fr-FR' }));
})
```

---

## 3. Multi-Tenant Context Injection

Inject tenant-specific headers into every system prompt.

```ts
.compose((harness) => {
  harness.on('prompt.system', (text, ctx) =>
    `[tenant: ${ctx.strategy}]\n[env: ${process.env.ENV}]\n\n${text}`
  );
})
```

---

## 4. A/B Variant Testing

Route 50% of runs to a prompt variant for controlled research.

```ts
let variant = 'control';

.compose((harness) => {
  harness.on('prompt.system', (text) =>
    Math.random() < 0.5 ? variantAPrompt(text) : text
  );
})
```

---

## 5. Bare-LLM Ablation

Disable every harness signal. Returns to pure ReAct baseline — useful for benchmarking harness overhead.

```ts
// This single line is the framework's own ablation mode
.compose((harness) => harness.on('nudge.*', () => null))
```

All nudges return `null` (suppressed). System prompts, tool results, and lifecycle events are unaffected.

---

## 6. Custom Termination Logic

Replace the default termination predicate with domain-specific criteria.

```ts
.compose((harness) => {
  harness.before('complete', (ctx) => {
    const output = (ctx.state as { output?: string }).output ?? '';
    if (!output.includes('REPORT_GENERATED')) {
      // Not done yet — prevent completion, loop continues
      return { abort: 'stop', reason: 'missing-report-sentinel' };
    }
  });
})
```

---

## 7. Healing Transparency

Surface auto-healing events to users and annotate healed results.

```ts
.compose((harness) => {
  harness.tap('nudge.healing-failure', (msg, ctx) => {
    console.warn(`[iter ${ctx.iteration}] Healing failed: ${ctx.trigger}`);
  });

  harness.on('observation.tool-result', (obs, ctx) => {
    if (ctx.healed) {
      return { ...obs, metadata: { ...obs.metadata, healed: true } };
    }
    return obs;
  });
})
```

---

## 8. Cost-Aware Routing

Track cumulative token spend and trigger budget alerts.

```ts
import { budgetLimit } from 'reactive-agents/compose/killswitches';

const agent = await ReactiveAgents.create()
  .withProvider('anthropic')
  .compose(budgetLimit({ maxTokens: 50_000, maxCostUSD: 0.50 }))
  .compose((harness) => {
    harness.tap('control.strategy-evaluated', (eval) => {
      costTracker.record(eval.currentStrategy, eval.score);
    });
  })
  .build();
```

---

## 9. Full Telemetry Export (OpenTelemetry)

Single line: every internal agent signal forwarded to OTel.

```ts
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('reactive-agents');

.compose((harness) => {
  harness.tap('**', (payload, ctx) => {
    const span = tracer.startSpan(`agent.${ctx.phase}`);
    span.setAttributes({
      'iteration': ctx.iteration,
      'strategy': ctx.strategy,
    });
    span.end();
  });
})
```

Pattern #9 is the foundation for the `@reactive-agents/otel` package planned for v0.12.

---

## Stacking Killswitches

Killswitches compose cleanly. First trigger wins, each records its source:

```ts
const agent = await ReactiveAgents.create()
  .withProvider('anthropic')
  .compose(budgetLimit({ maxCostUSD: 1.0 }))
  .compose(timeoutAfter({ wallClock: '5m' }))
  .compose(requireApprovalFor({ tools: ['send_email'], approver: uiApprove }))
  .compose(watchdog({ noProgressFor: '60s' }))
  .build();
```
```

- [ ] **Step 3.4: Build docs to verify**

```bash
cd apps/docs && bun run build 2>&1 | tail -10
```

- [ ] **Step 3.5: Commit**

```bash
git add apps/docs/src/content/docs/cookbook/composition-recipes.mdx
git commit -m "docs: add composition-recipes.mdx with 9 production patterns"
```

---

## Task 4: Update Stability + Index

**Files:**
- Modify: `apps/docs/src/content/docs/reference/stability.md` (or `.mdx`)
- Modify: `apps/docs/src/content/docs/index.mdx`

- [ ] **Step 4.1: Read current stability page**

```bash
cat apps/docs/src/content/docs/reference/stability.md 2>/dev/null || cat apps/docs/src/content/docs/reference/stability.mdx 2>/dev/null
```

- [ ] **Step 4.2: Add `.compose()` to stable API table**

Find the table of stable APIs and add `.compose()` alongside `.withProvider()`, `.withTools()`, etc.:

```md
| `.compose()` | `@stable` | v0.11+ | Harness composition entry point |
| `.withHarness()` | `@stable` | v0.10+ | Alias for `.compose()` |
```

If stability page doesn't exist, create a minimal one with this entry.

- [ ] **Step 4.3: Update index.mdx to reference compose**

Read current `apps/docs/src/content/docs/index.mdx`. Find the feature cards or tagline. Add a compose/harness card or mention:

```mdx
## Compose API

Shape any agent signal — system prompts, tool results, nudges — with `.compose()`.
One line enables full OpenTelemetry export. Six prebuilt killswitches ship in the box.

→ [Compose API Reference](/reference/compose-api) · [Tag Catalog](/reference/harness-tags) · [Recipes](/cookbook/composition-recipes)
```

- [ ] **Step 4.4: Final build + commit**

```bash
cd apps/docs && bun run build 2>&1 | tail -10
git add apps/docs/src/content/docs/
git commit -m "docs: mark .compose() @stable; add compose/harness to docs index"
```

---

## Task 5: wiki/Hot.md Update

- [ ] **Step 5.1: Update wiki/Hot.md**

Add Wave F completion note:
```md
## Recent: Wave F Docs Complete (2026-05-13)
- compose-api.mdx — full API reference
- harness-tags.mdx — 7-tag catalog (Wave A-D)
- composition-recipes.mdx — 9 production patterns
- Phase B (Compose API) complete; Phase C (v0.11 launch readiness) unblocked
```

- [ ] **Step 5.2: Commit**

```bash
git add wiki/Hot.md
git commit -m "docs: update Hot.md — Phase B complete, Wave F done"
```

---

## Self-Review Checklist

- [ ] All 3 MDX files have valid frontmatter (`title`, `description`, `sidebar.order`)
- [ ] `compose-api.mdx` covers: `.compose()`, `on`, `tap`, `before`, `after`, `onError`, `emit`, `use`, transform semantics, wildcard patterns, phase list, context fields
- [ ] `harness-tags.mdx` covers all 7 Wave A-D tags with payload types and usage examples
- [ ] `composition-recipes.mdx` covers all 9 spec §8.9 recipes with runnable code
- [ ] `apps/docs bun run build` passes with zero errors
- [ ] Stability page updated; index.mdx references compose
- [ ] No broken internal links (`/reference/...`, `/cookbook/...` paths match actual files)
