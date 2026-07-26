# Observability Overhaul — Unified Run-Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four verified logging defects (minimal-mode leak, sub-agent dashboard interrupting the parent stream, duplicate DEBUG lines, duplicate model-io dumps) and add a live-updating, collapsible one-line sub-agent summary — by routing sub-agent output through the parent's existing rendering machinery instead of letting every nested agent print independently.

**Architecture:** Implements the approved design at `wiki/Architecture/Design-Specs/2026-07-24-observability-unified-run-tree-design.md` — one canonical tree, one verbosity gate, no independent per-agent dashboard prints. Implementation-planning investigation found the *concrete* mechanism is narrower than a from-scratch event tree: each defect traces to a specific, already-identified line range, and the codebase already has a working precedent for "roll a child's data up into the parent" (`childRunLedger`, Wave C.2) that this plan reuses for dashboard data instead of inventing a parallel system.

**Tech Stack:** TypeScript, Effect-TS (Layer/Context.Tag/Effect.gen), Bun test runner, `chalk`+`boxen` (existing, no new deps).

## Global Constraints

- **Execution isolation:** this plan is implemented by subagents in a separate git worktree/branch — set up via `superpowers:using-git-worktrees` at execution time — kept isolated from the current branch's in-progress Wave C.2 ledger work. Do not touch any file under active Wave C.2 development (`packages/reasoning/src/kernel/state/` ledger merge code, `mergePassLedger`) except where a task below explicitly reads `extractChildRunLedger` as a *reference pattern* — read-only reference, no edits to that function.
- **No new dependencies.** Everything reuses `chalk`+`boxen`, already in `packages/observability/package.json`.
- **TDD, real Bun runner:** every task writes a failing test first. Run tests with `bun test <path> --timeout 10000` from the relevant package directory (Effect-TS async tests in this codebase need the explicit timeout; the suite hangs without it per project convention).
- **Frequent commits:** one commit per task, after its tests pass.
- **DRY / YAGNI:** don't add configuration knobs beyond what a task specifies. Don't touch `RA_DEBUG_ERRORS`/`REACTIVE_AGENTS_DEBUG` (unrelated, lower-level error-stack mechanism) or the `ObservableLogger`/`run-finalize.ts` non-live `"\n═══ Run Summary ═══"` fallback (a separate, dormant `.withLogging()` axis never exercised when only `.withObservability()` is set — confirmed by investigation, out of scope).

---

## Investigation summary (why these specific fixes)

Running `scratch.ts` (parent dispatching one `spawn-agent` sub-agent) across all four `.withObservability({ verbosity })` levels against a live Ollama model surfaced four defects and their exact root causes:

| Defect | Root cause (file:line) |
|---|---|
| D1 — `minimal` leaks full output | `packages/observability/src/logging/observable-logger.ts:109` — `ObservableLogger`'s own level filter defaults `minLevel` to `"debug"`, and its live-print at `:131-135` (`if (config.live) console.log(formatted)`) has **no awareness of the 4-tier `VerbosityLevel`** at all — that tier only gates the *other* logging system (`ObservabilityService`, `observability-service.ts:567`). |
| D2 — sub-agent prints its own full dashboard mid-parent-stream | `packages/runtime/src/execution-engine.ts:1655` — `obs.flush()` runs **once per execution-engine invocation**, i.e. once for the parent and once for *every* sub-agent (each has its own `ObservabilityService` instance, provisioned fresh per `createLightRuntime` call in `packages/runtime/src/builder/build-effect/sub-agent-executor.ts:425-460`). Nothing suppresses a child's own console dashboard. |
| D3 — duplicate DEBUG `[action]`/`[obs]` lines (one prefixed, one not) | `packages/runtime/src/execution-engine.ts:744-746` calls `subscribeReasoningStreamLogger(...)` once per execution-engine invocation, subscribing to the **shared** `EventBus` (`sharedEventBus`, `sub-agent-executor.ts:326,448` — G1, intentionally shared so parent observes child lifecycle). Neither subscription filters by `taskId`, so a child's `ReasoningStepCompleted` fires **both** the child's own listener (prefixed via the `config.logPrefix` wrap at `execution-engine.ts:216-231`) and the still-active parent listener (unprefixed) — one event, two prints. |
| D4 — duplicate model-io dumps (74 for a 2-agent run) | `packages/runtime/src/engine/phases/agent-loop/reasoning-stream-logger.ts:41-65` logs `model-io:${pass}` from `ReasoningStepCompleted.prompt`, and **separately** `:90-115` logs `model-io:direct-llm:...` from `LLMExchangeEmitted` for *every* actual LLM call. The code's own comment (`:87-88`) confirms `LLMExchangeEmitted` is "the single chokepoint" covering all strategies including reactive — so the reactive strategy's calls get logged twice. |

`AgentStarted`/`AgentCompleted` events (`packages/core/src/services/event-bus.ts:382-427`) already carry `taskId`, `agentId`, and `parentAgentId` (undefined for top-level agents) — the exact correlation data needed, already flowing through the shared bus. No new event plumbing is required; the fixes are: suppress redundant emission points, and roll child dashboard data up to one root print, reusing the existing `formatMetricsDashboard`/`DashboardData` formatter (`packages/observability/src/exporters/console-exporter.ts:629-903`), which already produces the clean, structured output style approved in the design spec.

---

### Task 1: Add console-suppression + dashboard-data extraction to `ObservabilityService`

**Files:**
- Modify: `packages/observability/src/observability-service.ts:47-112` (`ExporterConfig` type), `:536-588` (service implementation)
- Test: `packages/observability/tests/observability-service-dashboard.test.ts` (new)

**Interfaces:**
- Produces: `ObservabilityService.getDashboardData: () => Effect.Effect<DashboardData, never>` — new method, builds `DashboardData` from currently-buffered metrics without printing anything (reuses existing `buildDashboardData` from `console-exporter.ts:243`, already imported there).
- Produces: `ExporterConfig.console` (existing field, `packages/observability/src/observability-service.ts:64`) now also settable to `false` via a *runtime builder* option threaded in Task 2 — this task only makes the service correctly honor `console: false` for the new method's sibling behavior (it already does, at `:525-530`; this task verifies it and adds the new method alongside).

- [ ] **Step 1: Write the failing test for `getDashboardData`**

```typescript
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { ObservabilityService, ObservabilityServiceLive } from "../src/observability-service";

describe("ObservabilityService.getDashboardData", () => {
  test("builds DashboardData from buffered metrics without printing to console", async () => {
    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;
      yield* obs.setGauge("execution.tokens_used", 1234);
      yield* obs.setGauge("execution.success", 1);
      const data = yield* obs.getDashboardData();
      return data;
    });

    const logSpy = { calls: 0 };
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logSpy.calls++; originalLog(...args); };
    try {
      const data = await Effect.runPromise(
        Effect.provide(program, ObservabilityServiceLive({ console: false, verbosity: "normal" })),
      );
      expect(data.tokenCount).toBe(1234);
      expect(data.status).toBe("success");
      expect(logSpy.calls).toBe(0);
    } finally {
      console.log = originalLog;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/observability && bun test tests/observability-service-dashboard.test.ts --timeout 10000`
Expected: FAIL — `obs.getDashboardData is not a function`

- [ ] **Step 3: Add the method**

In `packages/observability/src/observability-service.ts`, add to the `ObservabilityService` `Context.Tag` interface (after `verbosity`, before the closing `>()`  at line ~433):

```typescript
    /**
     * Build the current DashboardData snapshot from buffered metrics without
     * printing anything. Used by a sub-agent's caller to roll its dashboard
     * up into the parent's single end-of-run print, instead of the child
     * printing its own.
     *
     * @returns DashboardData built from whatever metrics have been recorded so far
     */
    readonly getDashboardData: () => Effect.Effect<DashboardData, never>;
```

Add the import at the top of the file:

```typescript
import { buildDashboardData, type DashboardData } from "./exporters/console-exporter.js";
```

In the `ObservabilityServiceLive` implementation object (inside the `return { ... }` block at line ~536, alongside `flush`), add:

```typescript
        getDashboardData: () =>
          Effect.gen(function* () {
            const allMetrics = yield* metrics.getMetrics();
            return buildDashboardData(allMetrics, metrics);
          }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/observability && bun test tests/observability-service-dashboard.test.ts --timeout 10000`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/observability-service.ts packages/observability/tests/observability-service-dashboard.test.ts
git commit -m "feat(observability): add getDashboardData for console-free dashboard extraction"
```

---

### Task 2: Add `emitConsole: false` builder option and wire it for sub-agents

**Files:**
- Modify: `packages/runtime/src/builder/types.ts:624-686` (`ObservabilityOptions`)
- Modify: `packages/runtime/src/runtime.ts:776-795` (`obsExporterConfig` construction in `createLightRuntime`/`createRuntime` — both call sites at lines 776-795 and 1310-1330 per the earlier grep of `observabilityOptions?.verbosity` matches at :1102 and :1318)
- Modify: `packages/runtime/src/builder/build-effect/sub-agent-executor.ts:438-440`
- Test: `packages/runtime/tests/sub-agent-console-suppression.test.ts` (new — confirm exact test directory name matches sibling test files under `packages/runtime/tests/` before creating; if tests live elsewhere, e.g. `packages/runtime/src/**/*.test.ts`, follow that existing convention instead)

**Interfaces:**
- Consumes: `Task 1`'s `ObservabilityService` (`console: false` already suppresses printing via existing `observability-service.ts:525-530` logic — no change needed there).
- Produces: `ObservabilityOptions.emitConsole?: boolean` (default `true`), read by `runtime.ts` to set `console: false` in the `ExporterConfig` passed to `createObservabilityLayer`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { ObservabilityService } from "@reactive-agents/observability";
import { createLightRuntime } from "../src/runtime";

describe("emitConsole: false", () => {
  test("suppresses console dashboard while still recording metrics", async () => {
    const runtime = createLightRuntime({
      agentId: "test-agent",
      provider: "test",
      model: "test-model",
      enableObservability: true,
      observabilityOptions: { verbosity: "normal", emitConsole: false },
    });

    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;
      yield* obs.setGauge("execution.tokens_used", 42);
      return yield* obs.getDashboardData();
    });

    const logSpy = { calls: 0 };
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logSpy.calls++; originalLog(...args); };
    try {
      const data = await Effect.runPromise(Effect.provide(program, runtime));
      expect(data.tokenCount).toBe(42);
      expect(logSpy.calls).toBe(0);
    } finally {
      console.log = originalLog;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && bun test tests/sub-agent-console-suppression.test.ts --timeout 10000`
Expected: FAIL — type error or `emitConsole` has no effect (dashboard suppressed check fails because console isn't actually suppressed yet)

- [ ] **Step 3: Add `emitConsole` to `ObservabilityOptions`**

In `packages/runtime/src/builder/types.ts`, inside the `ObservabilityOptions` interface (after `logPrefix`, around line 648):

```typescript
    /**
     * Suppress this agent's own console dashboard/log printing while still
     * recording metrics/logs/spans. Used internally for sub-agents so only
     * the root agent's `flush()` prints a dashboard — a sub-agent's data is
     * rolled up into the parent's single dashboard instead (see
     * `sub-agent-executor.ts`).
     *
     * Default: `true` (agent prints its own console output).
     */
    readonly emitConsole?: boolean;
```

- [ ] **Step 4: Thread it into `obsExporterConfig` in `runtime.ts`**

At `packages/runtime/src/runtime.ts:778-790`, change:

```typescript
        const obsExporterConfig = {
          verbosity: options.observabilityOptions?.verbosity,
          live: options.observabilityOptions?.live,
          file: options.observabilityOptions?.file
            ? { filePath: options.observabilityOptions.file }
            : undefined,
```

to:

```typescript
        const obsExporterConfig = {
          verbosity: options.observabilityOptions?.verbosity,
          live: options.observabilityOptions?.live,
          console: options.observabilityOptions?.emitConsole === false ? false : undefined,
          file: options.observabilityOptions?.file
            ? { filePath: options.observabilityOptions.file }
            : undefined,
```

Apply the identical change at the second call site (`runtime.ts:~1318-1330`, same `obsExporterConfig` shape for the other runtime-construction function — verify both are literally the same object-literal pattern before editing; if one differs, match its actual field ordering rather than assuming identical structure).

- [ ] **Step 5: Set `emitConsole: false` for sub-agents**

At `packages/runtime/src/builder/build-effect/sub-agent-executor.ts:438-440`, change:

```typescript
        observabilityOptions: parentObservabilityOptions
          ? { ...parentObservabilityOptions, logPrefix: childLogPrefix }
          : { logPrefix: childLogPrefix },
```

to:

```typescript
        observabilityOptions: parentObservabilityOptions
          ? { ...parentObservabilityOptions, logPrefix: childLogPrefix, emitConsole: false }
          : { logPrefix: childLogPrefix, emitConsole: false },
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/runtime && bun test tests/sub-agent-console-suppression.test.ts --timeout 10000`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/builder/types.ts packages/runtime/src/runtime.ts packages/runtime/src/builder/build-effect/sub-agent-executor.ts packages/runtime/tests/sub-agent-console-suppression.test.ts
git commit -m "feat(runtime): add emitConsole option, suppress sub-agent console dashboards"
```

---

### Task 3: Roll the child's dashboard data up to the parent, print once at the root

**Files:**
- Modify: `packages/tools/src/adapters/agent-tool-adapter.ts:176-185` (`SubAgentRawResult`)
- Modify: `packages/runtime/src/builder/build-effect/sub-agent-executor.ts:539-616` (`childEffect`, success branch)
- Modify: `packages/observability/src/exporters/console-exporter.ts` (add a nested-dashboard formatter, additive — do not change `formatMetricsDashboard`'s existing signature/output for the no-children case, since that output is unit-tested elsewhere and used standalone)
- Modify: `packages/runtime/src/execution-engine.ts:1655` (root's `obs.flush()` call — needs the accumulated child dashboards)
- Test: `packages/observability/tests/nested-dashboard.test.ts` (new)

**Interfaces:**
- Consumes: `Task 1`'s `obs.getDashboardData()`, `Task 2`'s `emitConsole: false`.
- Produces: `DashboardData.children?: readonly { name: string; data: DashboardData }[]` (new optional field — additive, existing consumers that don't read it are unaffected). Produces: `formatMetricsDashboard(data, { nested?: boolean })` — same function, new optional second parameter, defaults preserve current single-box behavior exactly when `children` is absent.

- [ ] **Step 1: Write the failing test for nested formatting**

```typescript
import { describe, test, expect } from "bun:test";
import { formatMetricsDashboard, type DashboardData } from "../src/exporters/console-exporter";

const baseDashboard: DashboardData = {
  status: "success", totalDuration: 1000, stepCount: 1, tokenCount: 100,
  estimatedCost: 0, modelName: "m", provider: "test",
  phases: [], tools: [], alerts: [],
};

describe("formatMetricsDashboard nested rendering", () => {
  test("renders exactly one top-level box even with children", () => {
    const parent: DashboardData = {
      ...baseDashboard,
      children: [{ name: "bitcoin-price-finder", data: { ...baseDashboard, tokenCount: 50 } }],
    };
    const output = formatMetricsDashboard(parent);
    const boxCount = (output.match(/Agent Execution Summary/g) ?? []).length;
    expect(boxCount).toBe(1);
    expect(output).toContain("bitcoin-price-finder");
  });

  test("output for a childless dashboard is unchanged from before", () => {
    const output = formatMetricsDashboard(baseDashboard);
    expect(output).toContain("Agent Execution Summary");
    expect(output).not.toContain("Sub-agent");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/observability && bun test tests/nested-dashboard.test.ts --timeout 10000`
Expected: FAIL — `children` not recognized / sub-agent name missing from output

- [ ] **Step 3: Add `children` to `DashboardData` and render it**

In `packages/observability/src/exporters/console-exporter.ts`, add to `DashboardData` (after `alerts`, line ~94):

```typescript
  /** Sub-agent dashboards dispatched during this run, rolled up so only the root prints. */
  readonly children?: readonly { readonly name: string; readonly data: DashboardData }[];
```

At the end of `formatMetricsDashboard` (after the "Alerts & Insights" block, before `return lines.join("\n")`, around line 900):

```typescript
  // ── Sub-agents ───────────────────────────────────────────────────────────
  if (data.children && data.children.length > 0) {
    for (const child of data.children) {
      lines.push("");
      lines.push(chalk.hex(C_CYAN).bold(`Sub-agent: ${child.name}`));
      const childLines = formatMetricsDashboard(child.data).split("\n");
      for (const line of childLines) lines.push(`  ${line}`);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/observability && bun test tests/nested-dashboard.test.ts --timeout 10000`
Expected: PASS

- [ ] **Step 5: Thread the child's dashboard back through `sub-agent-executor.ts`**

> **Superseded (final whole-branch review, 2026-07-25):** the `childDashboard` field this step adds to `SubAgentRawResult`/`SubAgentResult` turned out to have zero consumers — the real transport is `ChildDashboardRegistry.record(...)` (Step 7), called before `raw` is built. Because `SubAgentResult` is the `spawn-agent` tool's return value, this dead field leaked the full `DashboardData` blob into the model's observation context. It was removed in commit `587b7cfa`. Keep the local `childDashboard` variable inside `childEffect` (it feeds `registry.record(...)`) — do not re-add it to `SubAgentRawResult`/`SubAgentResult`.

In `packages/tools/src/adapters/agent-tool-adapter.ts`, add to `SubAgentRawResult` (after `childRunLedger`, line ~184):

```typescript
  /** The child's DashboardData, captured with console printing suppressed (emitConsole:false), rolled up into the parent's single end-of-run dashboard. */
  readonly childDashboard?: unknown;
```

In `packages/runtime/src/builder/build-effect/sub-agent-executor.ts`, inside `childEffect` (the `Effect.gen` block starting at line 473), change the final line from:

```typescript
        return yield* subEngine.execute(taskObj);
```

to:

```typescript
        const execResult = yield* subEngine.execute(taskObj);
        const childObsOpt = yield* Effect.serviceOption(ObservabilityService);
        const childDashboard =
          childObsOpt._tag === "Some" ? yield* childObsOpt.value.getDashboardData() : undefined;
        return { execResult, childDashboard };
```

Then, at the success branch (`Exit.isSuccess(exit)`, line 589-590), change:

```typescript
      if (Exit.isSuccess(exit)) {
        const result = exit.value;
```

to:

```typescript
      if (Exit.isSuccess(exit)) {
        const { execResult: result, childDashboard } = exit.value;
```

and add `childDashboard` to the `raw: SubAgentRawResult` object literal (line ~606-614), following the exact same conditional-spread pattern already used for `stampedChildLedger` on the adjacent line:

```typescript
          ...(childDashboard ? { childDashboard } : {}),
```

(This is the same pattern as `...(stampedChildLedger ? { childRunLedger: stampedChildLedger } : {})` immediately above it — read that line for the exact surrounding syntax before editing.)

- [ ] **Step 6: Verify `finalizeSubAgentResult` forwards `childDashboard`**

`toolsMod.finalizeSubAgentResult({ name: t.name }, raw)` (sub-agent-executor.ts:615) converts `SubAgentRawResult` → `SubAgentResult`. Open `packages/tools/src/adapters/agent-tool-adapter.ts`'s `finalizeSubAgentResult` implementation (search for `export const finalizeSubAgentResult` or `function finalizeSubAgentResult` in that file) and confirm it does a `{...raw}`-style passthrough or explicit field list. If explicit, add `childDashboard: raw.childDashboard` to its return object and to the `SubAgentResult` interface (mirroring the existing `childRunLedger` field at line ~151, same file). Write a small unit test asserting `finalizeSubAgentResult({name: "x"}, {..., childDashboard: {tokenCount: 1}}).childDashboard` is defined, run it, confirm pass, before proceeding.

- [ ] **Step 7: Collect dispatched children's dashboards for the root's flush**

The parent needs a place to accumulate `{name, data}` pairs from every `spawn-agent` call before its own `obs.flush()` runs at `execution-engine.ts:1655`. Add a `Ref.Ref<{name: string; data: unknown}[]>` scoped per top-level run:

In `packages/runtime/src/builder/build-effect/sub-agent-executor.ts`, near wherever the spawn-agent tool handler processes a successful result (the code path that receives `finalizeSubAgentResult`'s return value and hands it back to the calling tool — locate this by searching for where `SubAgentResult` is consumed by `makeSpawnHandlers`/`spawnHandler` in this same file), append `{name: t.name, data: result.childDashboard}` (when defined) to a `ChildDashboardRegistry` — implement this as a new, minimal Effect service (`Context.Tag`) in `packages/observability/src/run-registry.ts`:

```typescript
import { Context, Effect, Ref } from "effect";

export interface ChildDashboardEntry {
  readonly name: string;
  readonly data: unknown;
}

export class ChildDashboardRegistry extends Context.Tag("ChildDashboardRegistry")<
  ChildDashboardRegistry,
  {
    readonly record: (entry: ChildDashboardEntry) => Effect.Effect<void, never>;
    readonly drain: () => Effect.Effect<readonly ChildDashboardEntry[], never>;
  }
>() {}

export const makeChildDashboardRegistry = Effect.gen(function* () {
  const ref = yield* Ref.make<ChildDashboardEntry[]>([]);
  return {
    record: (entry: ChildDashboardEntry) => Ref.update(ref, (xs) => [...xs, entry]),
    drain: () => Ref.get(ref),
  };
});
```

Register it as a shared Layer alongside the root's `ObservabilityService` (same place `eventBusLayer`/`metricsCollectorLayer` are merged in `runtime.ts` for the ROOT runtime construction only — sub-agents inherit it via the shared context, same mechanism as `sharedEventBus`). Because it is shared via the same `Effect.provide(subRuntime)` context chain as `sharedEventBus`, the child's `Effect.serviceOption(ChildDashboardRegistry)` in sub-agent-executor.ts resolves to the ROOT's registry, so `record()` always appends to one place regardless of nesting depth.

Call `registry.record({name: t.name, data: childDashboard})` right after computing `childDashboard` in Step 5, guarded by `Effect.serviceOption(ChildDashboardRegistry)` (no-op if absent, e.g. in tests that don't wire it).

- [ ] **Step 8: Root's flush() reads the registry and prints one nested dashboard**

At `packages/runtime/src/execution-engine.ts:1655`, before `yield* obs.flush()`, add:

```typescript
            const childRegistryOpt = yield* Effect.serviceOption(ChildDashboardRegistry);
            if (childRegistryOpt._tag === "Some" && !lp) {
              const children = yield* childRegistryOpt.value.drain();
              if (children.length > 0) {
                yield* obs.attachChildren?.(children) ?? Effect.void;
              }
            }
```

This requires one more small addition: an `attachChildren` method on `ObservabilityService` (Task 1's file) that stores the drained children so `flush()`'s existing `consoleExp.exportMetrics(allMetrics, metrics)` call can pass them through to `buildDashboardData`. Simplest concrete wiring: add `readonly attachChildren: (children: readonly {name: string; data: unknown}[]) => Effect.Effect<void, never>` to the service interface, backed by a `Ref` inside `ObservabilityServiceLive`, and change `flush()`'s `consoleExp.exportMetrics(allMetrics, metrics)` call to `consoleExp.exportMetrics(allMetrics, metrics, yield* Ref.get(childrenRef))`, threading a new optional third parameter through `exportMetrics` → `buildDashboardData` → the `children` field added in Step 3. Write the test for this exact chain (`obs.attachChildren([...])` then `obs.flush()` prints a dashboard containing the child's name) before implementing, per TDD — this step is large enough to warrant its own red/green cycle:

```typescript
test("flush() prints one dashboard containing the attached child", async () => {
  // capture console.log output, call attachChildren + flush, assert single
  // "Agent Execution Summary" box and the child's name both appear.
});
```

The `!lp` guard (only the root, i.e. `config.logPrefix` falsy, drains the registry) prevents a sub-agent from also trying to drain and print — only one place ever calls `attachChildren`+prints.

- [ ] **Step 9: Run full task 3 test suite, verify all pass**

Run: `cd packages/observability && bun test tests/nested-dashboard.test.ts --timeout 10000 && cd ../runtime && bun test tests/sub-agent-console-suppression.test.ts --timeout 10000`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add packages/observability/src packages/observability/tests packages/runtime/src packages/tools/src
git commit -m "feat(observability): roll sub-agent dashboards up into one root-level print"
```

---

### Task 4: Fix D1 — thread real verbosity into `ObservableLogger`

**Files:**
- Modify: `packages/observability/src/logging/observable-logger.ts:105-136`
- Modify: `packages/runtime/src/execution-engine.ts:1571-1576` (`loggerConfig` construction)
- Test: `packages/observability/tests/observable-logger-verbosity.test.ts` (new)

**Interfaces:**
- Consumes: existing `VerbosityLevel` type from `packages/observability/src/observability-service.ts:24-32`.
- Produces: `makeObservableLogger(config: { live: boolean; minLevel?: LogLevel; verbosity?: VerbosityLevel })` — new optional `verbosity` field.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { makeObservableLogger } from "../src/logging/observable-logger";

describe("ObservableLogger minimal verbosity", () => {
  test("does not print to console when verbosity is minimal, even with live:true", async () => {
    const logSpy = { calls: 0 };
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logSpy.calls++; originalLog(...args); };
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const logger = yield* makeObservableLogger({ live: true, verbosity: "minimal" });
          yield* logger.emit({ _tag: "phase_started", phase: "think", timestamp: new Date() });
        }),
      );
      expect(logSpy.calls).toBe(0);
    } finally {
      console.log = originalLog;
    }
  });

  test("still prints at normal verbosity with live:true", async () => {
    const logSpy = { calls: 0 };
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logSpy.calls++; originalLog(...args); };
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const logger = yield* makeObservableLogger({ live: true, verbosity: "normal" });
          yield* logger.emit({ _tag: "phase_started", phase: "think", timestamp: new Date() });
        }),
      );
      expect(logSpy.calls).toBe(1);
    } finally {
      console.log = originalLog;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/observability && bun test tests/observable-logger-verbosity.test.ts --timeout 10000`
Expected: FAIL — first test sees `logSpy.calls === 1` (leaks at minimal)

- [ ] **Step 3: Gate the live print on verbosity**

In `packages/observability/src/logging/observable-logger.ts`, change the `makeObservableLogger` signature (line 105-108) from:

```typescript
export function makeObservableLogger(config: {
  live: boolean;
  minLevel?: LogLevel;
}): Effect.Effect<ObservableLoggerService, never, never> {
```

to:

```typescript
export function makeObservableLogger(config: {
  live: boolean;
  minLevel?: LogLevel;
  verbosity?: "minimal" | "normal" | "verbose" | "debug";
}): Effect.Effect<ObservableLoggerService, never, never> {
```

Then in the `emit` function body (lines 116-136), change:

```typescript
        // If live, print to console
        if (config.live) {
          yield* Effect.sync(() => {
            console.log(formatted);
          });
        }
```

to:

```typescript
        // If live, print to console — but never at "minimal", which promises
        // no output except the final result (the 4-tier VerbosityLevel this
        // logger was previously unaware of).
        if (config.live && config.verbosity !== "minimal") {
          yield* Effect.sync(() => {
            console.log(formatted);
          });
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/observability && bun test tests/observable-logger-verbosity.test.ts --timeout 10000`
Expected: PASS (both tests)

- [ ] **Step 5: Wire the real verbosity through from `execution-engine.ts`**

At `packages/runtime/src/execution-engine.ts:1571-1575`, change:

```typescript
            const loggerConfig = {
              // In status mode the renderer owns all output; logger stays buffered
              live: isStatusMode ? false : (config.logging?.live ?? true),
              minLevel: config.logging?.minLevel,
            };
```

to:

```typescript
            const loggerConfig = {
              // In status mode the renderer owns all output; logger stays buffered
              live: isStatusMode ? false : (config.logging?.live ?? true),
              minLevel: config.logging?.minLevel,
              verbosity,
            };
```

(`verbosity` is already in scope at this point in the function, computed at line 200: `const verbosity = (obs?.verbosity?.() ?? config.observabilityVerbosity) ?? "normal";`.)

- [ ] **Step 6: Add an execution-engine-level regression test**

In whichever existing test file already exercises `execution-engine.ts` with `.withObservability({verbosity: "minimal"})` (search `packages/runtime/tests/` or `packages/runtime/src/**/*.test.ts` for an existing `verbosity` test to extend, following that file's existing setup pattern rather than duplicating engine bootstrap code) — add: run a task, assert zero `console.log` calls occurred (using the same spy pattern as Step 1) when `verbosity: "minimal"`.

- [ ] **Step 7: Run the full observability + runtime test suites**

Run: `cd packages/observability && bun test --timeout 10000 && cd ../runtime && bun test --timeout 10000`
Expected: all PASS, no new failures

- [ ] **Step 8: Commit**

```bash
git add packages/observability/src/logging/observable-logger.ts packages/observability/tests/observable-logger-verbosity.test.ts packages/runtime/src/execution-engine.ts
git commit -m "fix(observability): minimal verbosity now actually suppresses console output"
```

---

### Task 5: Fix D3 — gate the reasoning-stream-logger subscription to the root execution only

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts:742-746`
- Test: `packages/runtime/tests/reasoning-stream-logger-dedup.test.ts` (new)

**Interfaces:**
- Consumes: existing `subscribeReasoningStreamLogger` from `packages/runtime/src/engine/phases/agent-loop/reasoning-stream-logger.ts:28` (unchanged signature).
- No new interfaces produced — this is a call-site gate only.

- [ ] **Step 1: Write the failing test**

This test simulates the exact fan-out: two "executions" (parent + child) sharing one `EventBus`, each independently calling `subscribeReasoningStreamLogger`, and asserts today's behavior double-fires — then, after the fix, asserts the child's own call is skipped so only one debug line is produced per event.

```typescript
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { subscribeReasoningStreamLogger } from "../src/engine/phases/agent-loop/reasoning-stream-logger";
import { EventBus, EventBusLive } from "@reactive-agents/core";

describe("reasoning-stream-logger dedup", () => {
  test("only ONE subscriber (the root's) receives a shared-bus ReasoningStepCompleted event", async () => {
    const calls: string[] = [];
    const makeObs = (tag: string) => ({
      debug: (msg: string) => Effect.sync(() => { calls.push(`${tag}:${msg}`); }),
    }) as never;

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        // Root subscribes (this is the ONLY subscription that should exist
        // once execution-engine.ts is fixed to skip the call for sub-agents).
        yield* subscribeReasoningStreamLogger({
          eb, obs: makeObs("root"), logModelIO: false, isVerbose: true, isDebug: false,
        });
        yield* eb.publish({
          _tag: "ReasoningStepCompleted", taskId: "t1", strategy: "reactive",
          step: 1, totalSteps: 1, action: "web-search",
        } as never);
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(calls.filter((c) => c.includes("action")).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it currently passes in isolation, then confirm the real bug via a second assertion**

Run: `cd packages/runtime && bun test tests/reasoning-stream-logger-dedup.test.ts --timeout 10000`

This first test passes trivially (only one subscriber was ever registered in this unit test). The actual regression guard is the *call-site* gate in Step 3 — add a second test that constructs `execution-engine.ts`'s real gating logic directly (not the full engine, just the boolean condition) to make the intent explicit:

```typescript
  test("execution-engine skips the subscription when config.logPrefix is set (sub-agent)", () => {
    const shouldSubscribe = (logPrefix: string) => logPrefix === "";
    expect(shouldSubscribe("")).toBe(true);
    expect(shouldSubscribe("  │ ")).toBe(false);
  });
```

Expected: both PASS trivially — they encode the intended fix; the real verification is Step 4's actual call-site change plus Step 5's E2E rerun.

- [ ] **Step 3: Gate the call site**

At `packages/runtime/src/execution-engine.ts:742-746`, change:

```typescript
                  // ── Subscribe to reasoning steps for live streaming ──
                  // Body extracted to engine/phases/agent-loop/reasoning-stream-logger.ts (W23 step 6a-7).
                  const unsubscribeReasoningSteps = yield* subscribeReasoningStreamLogger({
                    eb, obs, logModelIO, isVerbose, isDebug,
                  });
```

to:

```typescript
                  // ── Subscribe to reasoning steps for live streaming ──
                  // Body extracted to engine/phases/agent-loop/reasoning-stream-logger.ts (W23 step 6a-7).
                  //
                  // Gated to the ROOT execution only (config.logPrefix unset). The
                  // EventBus is shared with every sub-agent (G1), so a single root
                  // subscription already observes every descendant's reasoning
                  // steps. Subscribing again per sub-agent caused each event to
                  // fire twice — once via the still-active root listener
                  // (unprefixed) and once via the child's own listener (prefixed) —
                  // since neither filtered by taskId. Root-only fixes this by
                  // construction: there is never more than one listener.
                  const unsubscribeReasoningSteps = lp
                    ? null
                    : yield* subscribeReasoningStreamLogger({
                        eb, obs, logModelIO, isVerbose, isDebug,
                      });
```

Check the `unsubscribeReasoningSteps` variable's later use (search for it further down in the same function, likely in a cleanup/`Effect.ensuring` block) and confirm calling it when `null` is a safe no-op (wrap with `if (unsubscribeReasoningSteps) unsubscribeReasoningSteps();` if it isn't already guarded).

- [ ] **Step 4: Run the test suite**

Run: `cd packages/runtime && bun test tests/reasoning-stream-logger-dedup.test.ts --timeout 10000`
Expected: PASS

- [ ] **Step 5: E2E confirm via scratch.ts (manual, not part of the automated suite)**

Re-run the exact reproduction from the design-spec investigation: `bun run scratch.ts` with `.withObservability({verbosity: 'verbose', live: true})`, piped to a file, and `grep -c` the `[action]`/`[obs]` DEBUG lines — confirm each logical event now appears exactly once (previously appeared twice, once prefixed once not). Record the before/after count in the task's commit message.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/execution-engine.ts packages/runtime/tests/reasoning-stream-logger-dedup.test.ts
git commit -m "fix(runtime): stop double-subscribing to the shared EventBus for sub-agent reasoning steps"
```

---

### Task 6: Fix D4 — stop double-logging model-io (rely solely on `LLMExchangeEmitted`)

**Files:**
- Modify: `packages/runtime/src/engine/phases/agent-loop/reasoning-stream-logger.ts:38-65`
- Test: `packages/runtime/tests/reasoning-stream-logger-model-io.test.ts` (new)

**Interfaces:**
- No signature changes — `subscribeReasoningStreamLogger`'s args/return type are unchanged. This removes a code branch, not an interface.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { subscribeReasoningStreamLogger } from "../src/engine/phases/agent-loop/reasoning-stream-logger";
import { EventBus, EventBusLive } from "@reactive-agents/core";

describe("reasoning-stream-logger model-io dedup", () => {
  test("a reactive-strategy LLM call logs model-io exactly once, via LLMExchangeEmitted only", async () => {
    const calls: string[] = [];
    const obs = { debug: (msg: string) => Effect.sync(() => { calls.push(msg); }) } as never;

    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* subscribeReasoningStreamLogger({
          eb, obs, logModelIO: true, isVerbose: true, isDebug: true,
        });
        // Same underlying call, emitted on both event types as reactive does today.
        yield* eb.publish({
          _tag: "ReasoningStepCompleted", taskId: "t1", strategy: "reactive", step: 1, totalSteps: 1,
          prompt: { system: "sys", user: "usr" },
        } as never);
        yield* eb.publish({
          _tag: "LLMExchangeEmitted", taskId: "t1", requestKind: "reactive", provider: "test",
          model: "m", messages: [{ role: "user", content: "usr" }], systemPrompt: "sys",
          response: { content: "resp" }, durationMs: 1, tokensUsed: 1, estimatedCost: 0,
        } as never);
      }).pipe(Effect.provide(EventBusLive)),
    );

    const modelIoCalls = calls.filter((c) => c.includes("model-io"));
    expect(modelIoCalls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runtime && bun test tests/reasoning-stream-logger-model-io.test.ts --timeout 10000`
Expected: FAIL — `modelIoCalls.length` is `2`

- [ ] **Step 3: Remove the `ReasoningStepCompleted` prompt-trace branch**

In `packages/runtime/src/engine/phases/agent-loop/reasoning-stream-logger.ts`, delete lines 40-65 (the entire `if (event.prompt && capturedLogModelIO) { ... }` block, including its two `return capturedObs.debug(...)` branches for the FC-messages case and the flat system+user fallback). The function now goes directly from the `eb.on("ReasoningStepCompleted", (event) => {` opening (line 39) to the `thought`/`action`/`observation` handling (currently line 66, `const rawContent = event.thought ?? event.action ?? event.observation ?? "";`).

Update the module-level doc comment (lines 1-11) to remove the now-inaccurate claim about rendering "the FC messages array if present" from `ReasoningStepCompleted` — model-io content now comes exclusively from `LLMExchangeEmitted` (lines 84-115, unchanged).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runtime && bun test tests/reasoning-stream-logger-model-io.test.ts --timeout 10000`
Expected: PASS

- [ ] **Step 5: Run the full reasoning-stream-logger-adjacent suite to confirm no other test depended on the removed branch**

Run: `cd packages/runtime && bun test --timeout 10000 -t "reasoning"`
Expected: all PASS. If any existing test asserted on `ReasoningStepCompleted`'s prompt being logged, update it to assert on `LLMExchangeEmitted` instead (same underlying call, correct chokepoint per Task 6's rationale) rather than deleting the coverage.

- [ ] **Step 6: E2E confirm via scratch.ts (manual)**

Re-run `bun run scratch.ts` with `.withObservability({verbosity: 'debug', live: true})`, piped, `grep -c model-io` — previously 74 for a 2-agent run; after Task 5 (dedup fix) and this task combined, expect roughly half or fewer, with zero exact-duplicate pairs at identical timestamps. Record the before/after count in the commit message.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/engine/phases/agent-loop/reasoning-stream-logger.ts packages/runtime/tests/reasoning-stream-logger-model-io.test.ts
git commit -m "fix(runtime): stop double-logging model-io, LLMExchangeEmitted is the single chokepoint"
```

---

### Task 7: Live-updating, collapsible one-line sub-agent summary

**Files:**
- Modify: `packages/observability/src/logging/status-renderer.ts:10-345`
- Modify: `packages/runtime/src/builder/build-effect/sub-agent-executor.ts:562-579, 589-594, 617-619` (remove the now-superseded `frame()`/`▶`/`◀` delimiter calls)
- Test: `packages/observability/tests/status-renderer-subagent.test.ts` (new)

**Interfaces:**
- Consumes: `AgentStarted`/`AgentCompleted`/`ToolCallStarted`/`ToolCallCompleted` events (`packages/core/src/services/event-bus.ts:382-427, 204-249`), already flowing on the shared `EventBus`.
- Produces: `StatusRenderer` gains no new public methods (its `start`/`stop`/`pushThinkChunk` interface is unchanged) — internally it now tracks a `Map<string, SubAgentLine>` keyed by `taskId` for any in-flight sub-agent, rendered as one collapsed line each.

Design simplification (documented here, not a silent gap): the approved design's "toggle whichever node is currently selected" assumes a cursor/focus model this linear-terminal renderer doesn't have. This task implements the simplest correct version instead: pressing `t` toggles expand/collapse for **all currently-running sub-agent lines together** (not per-line selection). With scratch.ts's typical one-sub-agent-at-a-time usage this is indistinguishable from per-line toggling; multi-sub-agent concurrent dispatch toggles as a group. A follow-on task can add per-line focus navigation if concurrent dispatch becomes common — out of scope here.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { makeStatusRenderer } from "../src/logging/status-renderer";
import { makeObservableLogger } from "../src/logging/observable-logger";
import { PassThrough } from "node:stream";

describe("StatusRenderer sub-agent collapse", () => {
  test("renders a collapsed one-line summary for a running sub-agent, freezes on completion", async () => {
    const out = new PassThrough();
    out.isTTY = true as never;
    let written = "";
    out.on("data", (chunk) => { written += chunk.toString(); });

    await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeObservableLogger({ live: false });
        const renderer = makeStatusRenderer(logger, out as never);
        yield* renderer.start();
        renderer.onAgentStarted({ taskId: "sub-1", agentId: "a2", parentAgentId: "a1", agentDisplayName: "bitcoin-price-finder" } as never);
        renderer.onAgentCompleted({ taskId: "sub-1", agentId: "a2", success: true, totalTokens: 6467, durationMs: 8900 } as never);
        renderer.stop();
      }),
    );

    expect(written).toContain("bitcoin-price-finder");
    expect(written).toContain("✓");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/observability && bun test tests/status-renderer-subagent.test.ts --timeout 10000`
Expected: FAIL — `renderer.onAgentStarted is not a function`

- [ ] **Step 3: Add sub-agent line tracking to `StatusRenderer`**

In `packages/observability/src/logging/status-renderer.ts`, add a new state shape and two new public methods. After the `RendererState` interface (line 25), add:

```typescript
interface SubAgentLine {
  readonly taskId: string;
  readonly name: string;
  status: "running" | "done" | "error";
  startMs: number;
  tokens: number;
  currentTool: string | null;
  expanded: boolean;
}
```

Inside `makeStatusRenderer`, alongside the existing `s: RendererState` (after line 55), add:

```typescript
  const subAgents = new Map<string, SubAgentLine>();
  let allSubAgentsExpanded = false;
```

Add two rendering helpers, near `printLine` (after line 235):

```typescript
  function subAgentLineText(sa: SubAgentLine): string {
    const elapsed = `${((Date.now() - sa.startMs) / 1000).toFixed(1)}s`;
    if (sa.status === "running") {
      const tool = sa.currentTool ? `  ${sa.currentTool}…` : "";
      return `├─ spawn-agent → ${sa.name}  ●  ${elapsed}${tool}`;
    }
    const icon = sa.status === "done" ? "✓" : "✗";
    return `├─ spawn-agent → ${sa.name}  ${icon}  ${elapsed}  ${sa.tokens.toLocaleString()} tok`;
  }
```

Add the two public methods to the returned object (alongside `start`/`stop`/`pushThinkChunk`, after line 343):

```typescript
    onAgentStarted: (event: { taskId: string; agentDisplayName?: string; agentId: string }): void => {
      subAgents.set(event.taskId, {
        taskId: event.taskId,
        name: event.agentDisplayName ?? event.agentId,
        status: "running",
        startMs: Date.now(),
        tokens: 0,
        currentTool: null,
        expanded: false,
      });
      printLine(subAgentLineText(subAgents.get(event.taskId)!));
    },

    onAgentCompleted: (event: { taskId: string; success: boolean; totalTokens: number }): void => {
      const sa = subAgents.get(event.taskId);
      if (!sa) return;
      sa.status = event.success ? "done" : "error";
      sa.tokens = event.totalTokens;
      printLine(subAgentLineText(sa));
      if (!event.success) sa.expanded = true; // auto-expand on failure — nested detail already streamed via the root's own subscription (Task 5)
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/observability && bun test tests/status-renderer-subagent.test.ts --timeout 10000`
Expected: PASS

- [ ] **Step 5: Wire `t` to toggle all running sub-agent lines**

In `togglePanel()` (line 177-187), the existing function only handles the single global thinking panel. Extend the `onKey` handler (line 191-203) — change:

```typescript
    if ((key === "t" || key === "T") && s.active) togglePanel();
```

to:

```typescript
    if ((key === "t" || key === "T") && s.active) {
      togglePanel();
      allSubAgentsExpanded = !allSubAgentsExpanded;
      for (const sa of subAgents.values()) sa.expanded = allSubAgentsExpanded;
    }
```

(Per the documented simplification above: this toggles every tracked sub-agent's `expanded` flag together, not one at a time.)

- [ ] **Step 6: Wire `AgentStarted`/`AgentCompleted`/`ToolCallStarted` into the renderer's subscription**

`makeStatusRenderer`'s `start()` currently subscribes only to `ObservableLogger`'s `LogEvent` stream (line 313-326), which has no concept of `AgentStarted`. The renderer needs the `EventBus` too. Change `makeStatusRenderer`'s signature (line 34-37) from:

```typescript
export function makeStatusRenderer(
  logger: ObservableLoggerService,
  out: NodeJS.WriteStream = process.stdout,
): StatusRenderer {
```

to:

```typescript
export function makeStatusRenderer(
  logger: ObservableLoggerService,
  out: NodeJS.WriteStream = process.stdout,
  eb?: EbLike | null,
): StatusRenderer {
```

adding `import type { EbLike } from "../../../runtime/src/engine/runtime-context.js";` — check first whether `EbLike` is already exported from `@reactive-agents/observability`'s own types (it's currently defined in `runtime`, a package `observability` should not depend on); if there's a circular-dependency risk, instead define a local minimal type in `status-renderer.ts`:

```typescript
interface EbLike {
  on: <T extends string>(tag: T, handler: (event: { _tag: T } & Record<string, unknown>) => void) => () => void;
}
```

and adapt the call sites in `execution-engine.ts` (wherever `makeStatusRenderer(logger)` is currently called, line ~1580) to pass `eb` as the third argument: `makeStatusRenderer(logger, process.stdout, eb)`.

In `start()` (line 312-326), after the existing `logger.subscribe(...)` call, add (guarded on `eb` being present):

```typescript
      if (eb) {
        eb.on("AgentStarted", (event) => { /* narrow via _tag check */ (returnedApi as StatusRenderer & { onAgentStarted: typeof onAgentStartedImpl }).onAgentStarted(event as never); });
        eb.on("AgentCompleted", (event) => { (returnedApi as StatusRenderer & { onAgentCompleted: typeof onAgentCompletedImpl }).onAgentCompleted(event as never); });
      }
```

Given the awkwardness of self-referencing the returned object from inside its own constructor, restructure instead: hoist `onAgentStarted`/`onAgentCompleted` (Step 3's implementations) to named local functions declared before `start()`, call the EventBus subscriptions with those named functions directly, and have the returned object's `onAgentStarted`/`onAgentCompleted` properties simply reference the same named functions. Confirm this compiles and the test from Step 1 still passes after this restructuring.

- [ ] **Step 7: Run full observability test suite**

Run: `cd packages/observability && bun test --timeout 10000`
Expected: all PASS

- [ ] **Step 8: Remove the now-superseded `▶ delegate`/`◀` delimiters**

In `packages/runtime/src/builder/build-effect/sub-agent-executor.ts`, delete:
- The `frame` helper and `parentObsOpt` lookup (lines 573-577)
- `yield* frame(...)` at line 579 (before dispatch)
- `yield* frame(...)` at lines 592-594 (success)
- `yield* frame(...)` at lines 618-619 (failure)
- Update the comment block at lines 563-572 to state that dispatch/completion framing is now handled by the live status renderer's collapsed sub-agent line (Task 7) instead of a logged delimiter pair.

- [ ] **Step 9: Run the sub-agent-executor test suite to confirm nothing depended on the delimiter text**

Run: `cd packages/runtime && bun test --timeout 10000 -t "sub-agent"`
Expected: all PASS. If a test asserted on `"▶ delegate"` or `"◀ "` appearing in output, update it to assert on the new collapsed-line format instead (`"spawn-agent → <name>"`).

- [ ] **Step 10: E2E confirm via a real TTY (manual, not automated)**

The redraw/expand-key path only activates when `process.stdout.isTTY` is true — this investigation's probes only exercised the non-TTY fallback (piped output). Run: `script -qc "bun run scratch.ts" /dev/null` (fakes a TTY) with `.withObservability({verbosity: 'normal', live: true})`, observe the collapsed sub-agent line updating live, press `t`, confirm it expands/collapses without crashing, let the run complete, confirm the line freezes to `✓`/`✗` with correct token count.

- [ ] **Step 11: Commit**

```bash
git add packages/observability/src/logging/status-renderer.ts packages/observability/tests/status-renderer-subagent.test.ts packages/runtime/src/builder/build-effect/sub-agent-executor.ts
git commit -m "feat(observability): live-updating collapsible one-line sub-agent summary"
```

---

### Task 8: Full-suite regression + updated E2E capture

**Files:**
- No new source files — verification only.
- Create: `wiki/Research/Debriefs/2026-07-24-observability-unified-run-tree-debrief.md` (after-action summary, per project convention for shipped work)

- [ ] **Step 1: Run the full monorepo test suite**

Run: `bunx turbo run test --filter=@reactive-agents/observability --filter=@reactive-agents/runtime --filter=@reactive-agents/tools`
Expected: all PASS, no regressions in packages touched by Tasks 1-7.

- [ ] **Step 2: Rerun scratch.ts across all four verbosity modes, piped (matching the original investigation's method)**

```bash
for mode in minimal normal verbose debug; do
  timeout 180 bun run scratch.ts > /tmp/post-fix-$mode.log 2>&1  # with .withObservability({verbosity: mode, live: true})
done
```

Confirm against the four defects: `minimal` output is now just the final result line (D1 fixed); `normal`/`verbose`/`debug` show exactly ONE dashboard at the true end, with the sub-agent appearing as a nested "Sub-agent: <name>" section inside it, not a separate mid-stream box (D2 fixed); `verbose`+ has no duplicate `[action]`/`[obs]` pairs (D3 fixed); `debug`'s `model-io` count is roughly half the original 74 with zero identical-timestamp duplicates (D4 fixed).

- [ ] **Step 3: Rerun once through a real TTY**

```bash
script -qc "bun run scratch.ts" /tmp/post-fix-tty.log
```

Confirm the collapsed sub-agent line updates live, `t` toggles it, and it freezes correctly on completion (Task 7's E2E check, now as part of the full-suite pass).

- [ ] **Step 4: Write the debrief**

Summarize: the four defects, their root causes, the fix per task, before/after evidence from Steps 2-3 (paste the specific counts/log excerpts that changed). Follow the existing debrief format — check `wiki/Research/Debriefs/` for a recent example (e.g. `2026-07-22-*-debrief.md`) and match its section structure.

- [ ] **Step 5: Commit**

```bash
git add wiki/Research/Debriefs/2026-07-24-observability-unified-run-tree-debrief.md
git commit -m "docs: debrief for observability unified run-tree overhaul"
```

---

## Self-review notes

- **Spec coverage:** §3.1 (data model) → implemented as `DashboardData.children` (Task 3), a narrower but equivalent realization of "structural nesting" than the design doc's generic `RunNode` tree — the design's *intent* (no sub-agent prints its own dashboard; nesting is structural, not string-prefixed) is fully met. §3.2 (rendering/verbosity gate) → Task 4 (D1) + existing `visibleNodes`-equivalent logic already in `ObservabilityService.flush()`'s `verbosityLevel !== "minimal"` check, now correctly extended to `ObservableLogger`. §3.3 (sub-agent interaction) → Task 7. §3.4 (error handling/redaction) → redaction was already centralized in `ObservabilityServiceLive` (`observability-service.ts:478-481`, confirmed during investigation, needed no fix); auto-expand-on-failure → Task 7 Step 3. §3.5 (testing) → each task's TDD steps plus Task 8's full-suite + E2E rerun.
- **Deferred from the design doc:** the exporter schema `nodeId`/`parentId` field mentioned as "left for the implementation plan to confirm" in the design doc — not needed. `AgentStarted`/`AgentCompleted` already carry `taskId`/`agentId`/`parentAgentId` natively; no file/OTLP exporter schema change is required by this plan.
- **Type consistency check:** `DashboardData.children`, `SubAgentRawResult.childDashboard`, `ChildDashboardEntry`, and `StatusRenderer.onAgentStarted`/`onAgentCompleted` names are used consistently across Tasks 3 and 7 as introduced.
