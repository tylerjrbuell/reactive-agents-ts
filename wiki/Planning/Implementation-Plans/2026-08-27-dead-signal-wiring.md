---
aliases: [Dead Signal Wiring, Event Catalog Repair]
tags: [plan, observability, event-bus, wiring, telemetry]
date: 2026-08-27
status: READY
spec: "wiki/Decisions/2026-08-24-external-research-convergence-amendment.md"
---

# Dead Signal Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every event in the EventBus catalog that has a consumer and no producer, delete the ones that have neither, and add the gate that makes the whole defect class unable to merge again.

**Architecture:** Three missing producers are added at the sites that already hold the data (`observable-llm.ts`, the compaction site, the budget killswitch). Nine never-referenced tags are deleted from the catalog. One generalised CI gate then asserts the invariant over all 75 tags: *any tag with a consumer must have a producer.*

**Tech Stack:** TypeScript (strict, no `any`), Effect-TS, Bun test runner, bash for the gate.

**Spec:** `wiki/Decisions/2026-08-24-external-research-convergence-amendment.md` — F-1 named one instance of this defect (`LLMRequestCompleted`, 9 consumers / 0 producers). This plan closes the rest of the class that F-1's fix left standing.

## Background — the catalog (swept 2026-08-27, 1,327 source files)

The sweep enumerated all 75 `_tag` declarations in `packages/core/src/services/event-bus.ts` and counted producer files (`_tag: "X"` outside the declaration) against consumer files, across `packages/**` and `apps/**` including Cortex's nested `server/` and `ui/src/` trees, excluding `dist/`, `node_modules/`, and tests.

**Consumers with zero producers — dead signals, ranked by impact:**

| Tag | Consumers | Impact |
|---|---|---|
| `LLMRequestStarted` | 2 | **RA emits no LLM spans to OpenTelemetry at all** (see D-1) |
| `CompressionApplied` | 1 | Compaction has no audit event; a shipped example subscribes to it |
| `BudgetExhausted` | 1 | `budget.exhausted` metric reads zero even when budgets abort runs |
| `TextDeltaReceived` | 1 | Vestigial duplicate of the `StreamEvent` channel (see D-4) |

**Zero producers AND zero consumers — dead declarations (9):** `EventsMerged`,
`ExecutionLoopIteration`, `GatewayStarted`, `GatewayStopped`,
`MemorySnapshotSaved`, `MessageSent`, `PolicyDecisionMade`, `SessionCreated`,
`SessionEnded`.

**Producers with zero internal consumers (19): NOT a defect, do not "fix".**
`AgentCreated`, `TaskCreated`, `TriggerFired`, `AgentStopped` and the rest are
the framework's *public* subscription surface — a user's `.on("AgentCreated")`
is the consumer, and it lives outside this repo. This mirrors the standing
project rule that public exports without internal callers are not dead code.
They are listed here only so a future sweep does not re-flag them.

### D-1 — the load-bearing one

`LLMRequestStarted` is declared at `event-bus.ts:492` with the JSDoc *"Bookend
pair with LLMRequestCompleted."* Nothing emits it. The consequence is not a
missing counter:

- `packages/observe/src/tracer.ts:118` — `spans.llmCalls.set(...)` happens **only**
  inside the `LLMRequestStarted` case arm. The map is therefore always empty.
- `packages/observe/src/tracer.ts:123-124` — the `LLMRequestCompleted` arm opens
  `const span = spans.llmCalls.get(event.requestId); if (!span) break;`

Every LLM call hits that early break. RA's OpenTelemetry integration emits tool
spans (`ToolCallStarted` has real producers) and **zero LLM spans** — the
OpenInference-conventioned spans that are the primary reason to trace an agent
at all. The same break also caps what the F-1 fix bought: `LLMRequestCompleted`
now fires correctly and, in the observe path, still lands on `break`.

The fix needs no new plumbing. `observable-llm.ts` already has the three
pre-call points (`:207`, `:214`, `:227`, each a `const start = Date.now()`), and
`diagnostics.ts:639-642` already derives a deterministic request id as
`` `${taskId}:${iteration}:${requestKind}` `` from `request.traceContext`, with a
comment recording that no id is threaded today. The same derivation is available
at request start, so the bookend correlates without threading anything new.

## Global Constraints

- **Strict TypeScript. No `any` casts.** Use `unknown` plus guards. Do not raise the `as unknown as` ceiling gate.
- **Never default a missing measurement to 0.** A field a provider or call site does not report must be *absent*, not coerced. This is the invariant the F-1 slice enforced throughout; it binds here too.
- **Deleting a tag is a public API change.** The nine dead tags are removed from the union in one commit with a CHANGELOG entry. If any is re-exported from `packages/reactive-agents/src/index.ts`, remove it there too.
- **Do not "wire" the 19 producer-only tags.** They are the public subscription surface.
- **No `Co-Authored-By` or `Claude-Session` trailers in commit messages.** Hard project rule.
- Verification: `bunx turbo run build`; `bun test --timeout 60000`; `./scripts/check-cross-cutting.sh`.
- Commit after every task, conventional-commit prefixes.

## File Structure

**Created:**
- `scripts/check-event-wiring.sh` — the generalised gate.
- `packages/observe/src/llm-span.test.ts` — proves an LLM span is opened and closed.

**Modified:**
- `packages/reasoning/src/kernel/observable-llm.ts` — emit `LLMRequestStarted` at the three pre-call points.
- `packages/reasoning/src/kernel/utils/diagnostics.ts` — export the request-id derivation so both bookends share one definition.
- `packages/reasoning/src/assembly/compaction.ts` — emit `CompressionApplied`.
- `packages/compose/src/killswitches/budget-limit.ts` — emit `BudgetExhausted`.
- `packages/core/src/services/event-bus.ts` — delete 10 tags (9 dead + `TextDeltaReceived`).
- `apps/cortex/ui/src/lib/stores/run-store.ts` — drop the dead `TextDeltaReceived` arm.
- `scripts/check-cross-cutting.sh` — add the new check.
- `CHANGELOG.md`.

---

### Task 1: Share one request-id derivation between the bookends

**Files:**
- Modify: `packages/reasoning/src/kernel/utils/diagnostics.ts:639-642`
- Test: `packages/reasoning/src/kernel/utils/request-id.test.ts` (create)

**Interfaces:**
- Produces: `export function deriveRequestId(args: { taskId: string; iteration: number; requestKind: string }): string`. Task 2 consumes it.

**Why first:** the start and completed events must agree on the id or the span
never closes. One exported function is the only way to guarantee that; two
call sites each building the same template string is how they drift.

- [ ] **Step 1: Write the failing test**

Create `packages/reasoning/src/kernel/utils/request-id.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { deriveRequestId } from "./diagnostics.js";

describe("deriveRequestId", () => {
  it("is stable for the same task, iteration and kind", () => {
    const a = deriveRequestId({ taskId: "t1", iteration: 2, requestKind: "complete" });
    const b = deriveRequestId({ taskId: "t1", iteration: 2, requestKind: "complete" });
    expect(a).toBe(b);
    expect(a).toBe("t1:2:complete");
  });

  it("separates iterations and kinds", () => {
    expect(deriveRequestId({ taskId: "t1", iteration: 2, requestKind: "complete" }))
      .not.toBe(deriveRequestId({ taskId: "t1", iteration: 3, requestKind: "complete" }));
    expect(deriveRequestId({ taskId: "t1", iteration: 2, requestKind: "complete" }))
      .not.toBe(deriveRequestId({ taskId: "t1", iteration: 2, requestKind: "stream" }));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/reasoning/src/kernel/utils/request-id.test.ts`
Expected: FAIL — `deriveRequestId` is not exported.

- [ ] **Step 3: Extract the derivation**

In `packages/reasoning/src/kernel/utils/diagnostics.ts`, replace the inline
template at line 642 with a call to a new exported function defined above it:

```ts
/**
 * The id that correlates `LLMRequestStarted` with `LLMRequestCompleted`.
 *
 * Derived, not minted: both bookends can compute it independently from
 * `request.traceContext`, so no id has to be threaded through the LLM service
 * boundary. Two calls of the SAME kind in the SAME iteration would collide —
 * accepted, because the kernel makes at most one call per (iteration, kind),
 * and a collision degrades to a reused span rather than a wrong one.
 */
export function deriveRequestId(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly requestKind: string;
}): string {
  return `${args.taskId}:${args.iteration}:${args.requestKind}`;
}
```

and at the former line 642:

```ts
        requestId: deriveRequestId(args),
```

Delete the now-stale "No requestId is threaded into this function today" comment.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/reasoning/src/kernel/utils/request-id.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/kernel/utils/
git commit -m "refactor(reasoning): one shared derivation for the LLM request id"
```

---

### Task 2: Emit `LLMRequestStarted` — restore the OTel LLM span tree

**Files:**
- Modify: `packages/reasoning/src/kernel/observable-llm.ts:207, 214, 227`
- Test: `packages/observe/src/llm-span.test.ts` (create)

**Interfaces:**
- Consumes: `deriveRequestId` (Task 1).
- Produces: nothing later consumes.

- [ ] **Step 1: Write the failing test**

Create `packages/observe/src/llm-span.test.ts`. It drives the tracer's event
handler with a bookend pair and asserts a span is opened and ended — the
behaviour that is silently absent today:

```ts
import { describe, expect, it } from "bun:test";

// Pins the invariant D-1 broke: a COMPLETED event with no preceding STARTED
// produces no span at all, because spans.llmCalls is only ever populated by
// the started arm. If someone deletes the LLMRequestStarted producer again,
// this test goes red instead of the span tree going quietly empty.
describe("observe tracer — LLM span bookends", () => {
  it("opens a span on LLMRequestStarted and ends it on LLMRequestCompleted", async () => {
    const { spans, handle } = await makeTestTracer();
    handle({
      _tag: "LLMRequestStarted",
      taskId: "t1", requestId: "t1:0:complete",
      model: "m", provider: "p", contextSize: 100,
    });
    expect(spans.open()).toBe(1);
    handle({
      _tag: "LLMRequestCompleted",
      taskId: "t1", requestId: "t1:0:complete",
      tokensUsed: 10, durationMs: 5, estimatedCost: 0.001,
    });
    expect(spans.open()).toBe(0);
    expect(spans.ended()).toBe(1);
  });

  it("records nothing when only the completed half arrives (the D-1 shape)", async () => {
    const { spans, handle } = await makeTestTracer();
    handle({
      _tag: "LLMRequestCompleted",
      taskId: "t1", requestId: "t1:0:complete",
      tokensUsed: 10, durationMs: 5, estimatedCost: 0.001,
    });
    expect(spans.ended()).toBe(0);
  });
});
```

Write `makeTestTracer()` as a local helper in the same file: build the tracer
against an in-memory OTel span exporter (the repo already depends on
`@opentelemetry/sdk-trace-base`; use `InMemorySpanExporter` +
`SimpleSpanProcessor`), and expose `handle` as the tracer's event dispatch.
Read `packages/observe/src/tracer.ts`'s export shape first and match it — if the
dispatch is not separately exported, export it for the test rather than
reaching into module internals.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/observe/src/llm-span.test.ts`
Expected: FAIL — the first test's `spans.open()` is 0 after the started event,
because nothing in the system produces it and the helper has nothing to drive.
(The second test passes from the start; it pins the current behaviour so the
fix does not over-correct into creating spans from a bare completed event.)

- [ ] **Step 3: Emit the event at all three pre-call points**

In `packages/reasoning/src/kernel/observable-llm.ts`, at each of the three
`const start = Date.now();` lines (`complete` :207, `completeStructured` :214,
`stream` :227), publish before delegating to `inner`:

```ts
            const start = Date.now();
            yield* emitLLMRequestStarted(request, "complete");
            const response = yield* inner.complete(request);
```

with `"completeStructured"` and `"stream"` as the kind at the other two sites.
Add the helper alongside `emitForRequest` in the same file:

```ts
/**
 * The START half of the LLM bookend (D-1). Publishes best-effort: a failure to
 * emit telemetry must never fail the model call, so this catches into the
 * existing swallow channel exactly as `emitForRequest` does.
 *
 * `traceContext` is absent for calls outside the kernel loop (reflexion / ToT /
 * plan-execute sub-calls); those fall back to the same placeholders
 * `emitForRequest` uses, so both halves still agree on the id.
 */
const emitLLMRequestStarted = (request: LLMRequest, requestKind: string) =>
  Effect.gen(function* () {
    const ebOpt = yield* Effect.serviceOption(EventBus);
    if (ebOpt._tag === "None") return;
    const taskId = request.traceContext?.taskId ?? PLACEHOLDER_TASK_ID;
    const iteration = request.traceContext?.iteration ?? PLACEHOLDER_ITERATION;
    yield* ebOpt.value.publish({
      _tag: "LLMRequestStarted",
      taskId,
      requestId: deriveRequestId({ taskId, iteration, requestKind }),
      model: request.model ?? "unknown",
      provider: request.provider ?? "unknown",
      contextSize: estimateContextSize(request),
    });
  }).pipe(
    Effect.catchAll((err) =>
      emitErrorSwallowed({ site: "reasoning/src/kernel/observable-llm.ts:emitLLMRequestStarted", tag: errorTag(err) }),
    ),
  );
```

`contextSize` is declared as a required `number` on the event. Read
`request.messages` and sum the rendered character length divided by 4 ONLY if
the file already has such a helper; if it does not, use the token count the
request carries when present and otherwise **omit this producer's contextSize
by widening the event's field to optional** — do not invent an estimate and
present it as a measurement. Widening is the correct choice here: an OTel
attribute that is absent is honest, one that is fabricated is not.

Confirm `emitForRequest` at the completion site derives its id via
`deriveRequestId` with the SAME `requestKind` strings, so the pair matches.

- [ ] **Step 4: Run the tests**

Run: `bun test packages/observe/ packages/reasoning/src/kernel/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/kernel/observable-llm.ts packages/observe/
git commit -m "fix(reasoning,observe): emit LLMRequestStarted — OTel LLM spans were never created"
```

---

### Task 3: Emit `CompressionApplied` and `BudgetExhausted`

**Files:**
- Modify: `packages/reasoning/src/assembly/compaction.ts`
- Modify: `packages/compose/src/killswitches/budget-limit.ts`
- Test: `packages/reasoning/src/assembly/compaction-event.test.ts` (create)
- Test: `packages/compose/src/killswitches/budget-limit.test.ts` (extend or create)

**Interfaces:** none produced for later tasks.

**Batched deliberately:** both are the same one-line shape — a site that
already performs the action and already holds the numbers, missing only its
publish. Reviewing them as one diff is cheaper than two dispatches.

- [ ] **Step 1: Write the failing tests**

For compaction, assert that applying compaction publishes the event with the
before/after sizes it already computes:

```ts
it("publishes CompressionApplied when compaction actually runs", async () => {
  const events = await captureEvents(() => runCompactionOnOversizedThread());
  const applied = events.filter((e) => e._tag === "CompressionApplied");
  expect(applied.length).toBe(1);
  expect(applied[0].originalTokens).toBeGreaterThan(applied[0].compactedTokens);
});

it("publishes nothing when compaction does not run", async () => {
  const events = await captureEvents(() => runCompactionOnSmallThread());
  expect(events.filter((e) => e._tag === "CompressionApplied").length).toBe(0);
});
```

For the budget killswitch, assert the abort still happens AND the event fires:

```ts
it("publishes BudgetExhausted when the token budget aborts the run", async () => {
  const { result, events } = await runWithKillswitch(
    budgetLimit({ maxTokens: 100 }),
    { stateTokens: 150 },
  );
  expect(result?.abort).toBe("stop");
  const ev = events.find((e) => e._tag === "BudgetExhausted");
  expect(ev?.budgetType).toBe("tokens");
  expect(ev?.limit).toBe(100);
  expect(ev?.used).toBe(150);
});

it("publishes nothing while the run is under budget", async () => {
  const { result, events } = await runWithKillswitch(
    budgetLimit({ maxTokens: 100 }),
    { stateTokens: 50 },
  );
  expect(result).toBeUndefined();
  expect(events.some((e) => e._tag === "BudgetExhausted")).toBe(false);
});
```

Read each file's existing test neighbours first and match their harness helpers
rather than inventing `captureEvents` / `runWithKillswitch` if equivalents exist.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test packages/reasoning/src/assembly/compaction-event.test.ts packages/compose/src/killswitches/`
Expected: FAIL — no `CompressionApplied` / `BudgetExhausted` is ever published.

- [ ] **Step 3: Add the two producers**

In `compaction.ts`, at the point where compaction has run and the before/after
sizes are known, publish `CompressionApplied` with those figures. Publish only
on the path where compaction actually applied — never on the inspect-and-skip
path, or the event stops meaning what its name says.

In `budget-limit.ts`, the hook currently returns the abort directly. Publish
`BudgetExhausted` immediately before each of the two `return { abort ... }`
statements, with `budgetType: "tokens"` / `"cost"` and the real `limit` / `used`
values already in scope. If the killswitch's hook signature has no EventBus
access, thread it the way sibling killswitches do — read
`packages/compose/src/killswitches/` for the established pattern before adding a
new one.

- [ ] **Step 4: Run the tests**

Run: `bun test packages/reasoning/src/assembly/ packages/compose/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/assembly/ packages/compose/src/killswitches/
git commit -m "fix(reasoning,compose): publish CompressionApplied and BudgetExhausted"
```

---

### Task 4: Delete the ten dead tags

**Files:**
- Modify: `packages/core/src/services/event-bus.ts`
- Modify: `apps/cortex/ui/src/lib/stores/run-store.ts:252`
- Modify: `packages/reactive-agents/src/index.ts` (only if any deleted tag is re-exported)
- Modify: `CHANGELOG.md`

**Interfaces:** none.

**Tags to delete (9 with zero producers and zero consumers):** `EventsMerged`,
`ExecutionLoopIteration`, `GatewayStarted`, `GatewayStopped`,
`MemorySnapshotSaved`, `MessageSent`, `PolicyDecisionMade`, `SessionCreated`,
`SessionEnded`.

**Plus `TextDeltaReceived` (1 consumer, 0 producers).** It is a vestigial
duplicate: real streaming runs on the separate `StreamEvent` channel
(`packages/runtime/src/stream-types.ts:18`, `_tag: "TextDelta"`), and Cortex's
store already handles both — `run-store.ts:252` reads
`msg.type === "TextDeltaReceived" || msg.type === "TextDelta"`, and only the
second arm has ever fired. Delete the EventBus tag and the dead first arm; leave
the `StreamEvent` channel untouched.

- [ ] **Step 1: Confirm each deletion is safe**

For every one of the ten, run the check before deleting it:

```bash
grep -rn '"<TAG>"' packages apps --include='*.ts' --include='*.svelte' \
  | grep -v '/dist/' | grep -v node_modules
```

Expected: only the declaration in `event-bus.ts` (plus, for
`TextDeltaReceived`, the two Cortex lines named above). **If any tag returns
another hit, do not delete it** — record it in the commit body as retained, and
say why. A sweep is evidence, not permission.

- [ ] **Step 2: Delete them**

Remove each tag's member from the union in `event-bus.ts`, keeping the file's
section comments coherent. Remove the `TextDeltaReceived` arm in
`run-store.ts:252` so the condition reads `msg.type === "TextDelta"`.

- [ ] **Step 3: Build and test**

Run: `bunx turbo run build && bun test --timeout 60000`
Expected: build 37/37, suite 0 failures. A type error here means a consumer
existed that Step 1's grep missed — restore that tag and note it.

- [ ] **Step 4: CHANGELOG**

```markdown
### Removed
- Ten never-emitted `AgentEvent` tags: `EventsMerged`, `ExecutionLoopIteration`,
  `GatewayStarted`, `GatewayStopped`, `MemorySnapshotSaved`, `MessageSent`,
  `PolicyDecisionMade`, `SessionCreated`, `SessionEnded`, `TextDeltaReceived`.
  None had a producer. Streaming text has always arrived on the `StreamEvent`
  channel as `TextDelta`, which is unchanged.
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/event-bus.ts apps/cortex CHANGELOG.md
git commit -m "refactor(core): delete ten AgentEvent tags that never had a producer"
```

---

### Task 5: The gate that closes the class

**Files:**
- Create: `scripts/check-event-wiring.sh`
- Modify: `scripts/check-cross-cutting.sh`

**Interfaces:** none.

**Why this is the actual fix.** `scripts/check-cost-accounting.sh` already
asserts one instance of this invariant — *`LLMRequestCompleted` has a
producer* — written narrowly for F-1. Generalised over the catalog it converts
"dead event" from something an audit finds months later into something that
cannot merge. F-1 survived for months precisely because nothing checked.

- [ ] **Step 1: Write the gate**

Create `scripts/check-event-wiring.sh`:

```bash
#!/usr/bin/env bash
# Every AgentEvent tag with a CONSUMER must have a PRODUCER.
#
# Finding F-1 (2026-08-24): `LLMRequestCompleted` shipped with nine consumers
# and zero producers for months — the per-call cost stream was structurally
# empty across the bench runner, both observability collectors, the tracer and
# the Cortex readouts. The 2026-08-27 sweep found three more of the same shape,
# one of which (`LLMRequestStarted`) meant RA emitted no OpenTelemetry LLM spans
# at all, because the span map is only ever populated by that event's handler.
#
# A tag with producers and NO consumers is NOT a violation: those are the
# framework's public subscription surface, and the consumer is user code outside
# this repo.
set -euo pipefail
cd "$(dirname "$0")/.."

BUS="packages/core/src/services/event-bus.ts"
FILES=$(find packages apps -type d \( -name dist -o -name node_modules \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.svelte' \) -print \
  | grep -v '\.test\.' | grep -v '\.spec\.')

TAGS=$(grep -oE 'readonly _tag: "[A-Za-z]+"' "$BUS" | grep -oE '"[A-Za-z]+"' | tr -d '"' | sort -u)

VIOLATIONS=""
for t in $TAGS; do
  producers=$(grep -l "_tag: \"$t\"" $FILES 2>/dev/null | grep -v "$BUS" | wc -l | tr -d ' ')
  [ "$producers" != "0" ] && continue
  consumers=$(grep -l "\"$t\"" $FILES 2>/dev/null | grep -v "$BUS" \
    | xargs -r grep -L "_tag: \"$t\"" 2>/dev/null | wc -l | tr -d ' ')
  [ "$consumers" = "0" ] && continue
  VIOLATIONS="${VIOLATIONS}\n  $t — $consumers consumer file(s), 0 producers"
done

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: AgentEvent tags are consumed but never produced:"
  printf "%b\n" "$VIOLATIONS"
  echo ""
  echo "Either publish the event at the site that owns the fact, or delete the"
  echo "tag and its consumers. A consumer reading a tag nothing emits is a"
  echo "silently empty metric, span, or UI panel — not a latent feature."
  exit 1
fi
echo "OK: every consumed AgentEvent tag has a producer."
```

`chmod +x scripts/check-event-wiring.sh`.

- [ ] **Step 2: Prove it is red-on-cut**

Comment out the `LLMRequestStarted` publish added in Task 2, run
`./scripts/check-event-wiring.sh`, and confirm it FAILS naming that tag. Restore
the line and confirm it passes. A gate never observed failing is not known to
work — this is the same discipline `check-volatile-placement.sh` and
`check-ablatable.sh` follow.

- [ ] **Step 3: Wire it into the cascade**

In `scripts/check-cross-cutting.sh`, append a check in the shape of checks 9 and
10 (mktemp, delegate, FAIL/OK lines), and renumber the labels. Coordinate the
final count with the W3 plan if that plan has already added its own check —
whichever lands second renumbers.

- [ ] **Step 4: Run everything**

Run: `bunx turbo run build && bun test --timeout 60000 && ./scripts/check-cross-cutting.sh`
Expected: build 37/37; suite 0 failures; all checks OK.

- [ ] **Step 5: Commit**

```bash
git add scripts/
git commit -m "test(scripts): gate that every consumed AgentEvent tag has a producer"
```

---

## Out of scope

- **The 19 producer-only tags.** Public subscription surface, not defects.
- **`toolDisclosureMode`.** Covered by `2026-08-27-harness-control-surface.md`
  Task 5; do not duplicate the work here.
- **The structural proposal in the companion analysis** (one canonical LLM-call
  record projected into event / trace / ledger / metrics, rather than four
  independent emissions). That is a ratification-level change to 09 and needs an
  amendment before any code moves. This plan deliberately fixes the wiring
  inside the current shape.
