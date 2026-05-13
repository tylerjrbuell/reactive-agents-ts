---
type: implementation-plan
status: active
created: 2026-05-12
updated: 2026-05-12
completed: null
authored-by: claude-opus-4-7
priority: Phase D (deferred behind M3 ablation, Compose API Wave A, v0.11 launch-readiness)
related:
  - "[[Architecture/Specs/05-DESIGN-NORTH-STAR]]"
  - "[[Architecture/Design-Specs/2026-05-11-harness-research-integration]]"
  - "[[Planning/Implementation-Plans/2026-05-06-v0.11-launch-readiness]]"
---

# Decision & Rationale Traceability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement task-by-task. Most tasks follow TDD; schema-only additions allow a relaxed flow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture *why* every agent decision is made — tool selection, strategy switch, assumption, termination, curator action — as typed, queryable rationale across the existing harness, then surface it through a `rax:diagnose debrief` command so post-hoc reconstruction sees intent, not just actions.

**Architecture:** Introduce one typed `Rationale` shape in `packages/trace`. Add an *optional* `rationale?: Rationale` alongside existing free-text `reason: string` fields (no breaking changes; `reason` remains the source of truth until a future minor migrates consumers). Extend structured-output prompts in `packages/reasoning` so the model is *invited* to emit rationale alongside tool calls (parsed when present, never required at parse-time in v1). Add new events for assumptions, curator decisions, termination rationale, and alternatives considered. A new `rax:diagnose debrief` command renders the timeline.

**Tech Stack:** TypeScript, Effect, `@reactive-agents/trace` JSONL pipeline, structured output via `packages/reasoning/src/structured-output`, Zod schemas, existing `@reactive-agents/diagnose` CLI, `bun:test` (not vitest).

**Codebase state as of 2026-05-12:**
- Kernel was reorganized in Stage 5 from `strategies/kernel/` to `kernel/capabilities/<verb>/` and `kernel/loop/`.
- Single-owner termination is `packages/reasoning/src/kernel/loop/terminate.ts` (NOT a `termination-oracle.ts`). The Arbitrator at `kernel/capabilities/decide/arbitrator.ts` is the canonical decider; `terminate()` is the imperative gateway.
- Context curator lives at `packages/reasoning/src/context/context-curator.ts` (no `curator/` subdir).
- `ToolCallEvent.kind` is the discriminated pair `"tool-call-start" | "tool-call-end"`. Rationale attaches to `-start`.
- `KernelStateSnapshotEvent.status` does not include `"terminated"`; termination is signalled by the existing `terminatedBy: string | undefined` field on `status: "done" | "failed"`.
- `DecisionEvaluatedEvent`, `StrategySwitchedEvent`, `GuardFiredEvent` already have `reason: string`. This plan adds optional `rationale` alongside without breaking existing consumers.
- `packages/reasoning/src/structured-output/` exposes `extractStructuredOutput`, `repairJson`, `infer-required-tools`. There is no standalone `tool-call-schema.ts` today — the rationale prompt nudge attaches to existing tool-emission prompts under `kernel/capabilities/reason/think.ts` and `kernel/capabilities/act/tool-parsing.ts`.

**Related:**
- North Star v5.0: research-grounded amendments + Stanford Meta-Harness "raw traces essential" finding
- Compose API: rationale namespace should be exposable through compose hooks once Wave A lands (not in v1 of this plan)
- Skill: `.agents/skills/harness-improvement-loop/SKILL.md` — consumer of debrief output

---

## Priority Note

This plan sits at **Phase D-tier observability deepening**. It does NOT block:
1. M3 ablation (pre-Phase-B gate)
2. Compose API Wave A (v0.11 differentiator)
3. v0.11 launch-readiness Tier-1 (skill persistence, playground, etc.)
4. Phase 1.5 mechanism improvements (M3/M6/M7/M8/M10)

A reduced v1 (Tasks 1, 2, 3, 4, 6, 9 only) can ride alongside Phase B. Tasks 5, 7, 8, 10, 11 should defer until the Compose API surface is stable so the rationale namespace can plug into compose hooks rather than be hard-wired into kernel files.

---

## File Structure

### New files

- Create: `packages/trace/src/rationale.ts` — `Rationale` type + `RationaleSchema` (Zod)
- Create: `packages/trace/tests/rationale.test.ts`
- Create: `packages/reasoning/src/structured-output/rationale-schema.ts` — schema fragment exported for tool-call parsers
- Create: `packages/reasoning/src/kernel/capabilities/reason/assumption-detector.ts` — extracts AssumptionRecorded from think output
- Create: `packages/reasoning/tests/kernel/capabilities/reason/assumption-detector.test.ts`
- Create: `packages/diagnose/src/commands/debrief.ts` — new CLI command
- Create: `packages/diagnose/tests/commands/debrief.test.ts`
- Create: `packages/diagnose/src/debrief/renderer.ts` — markdown + JSON rendering
- Create: `packages/diagnose/src/debrief/types.ts` — `Debrief` shape
- Create: `packages/diagnose/src/debrief/build.ts` — fixture-loader + event folding
- Create: `packages/diagnose/tests/fixtures/debrief-trace.jsonl`
- Create: `packages/reasoning/src/kernel/capabilities/act/rationale-validator.ts` — refs validator (Task 10, deferred)
- Create: `packages/reasoning/tests/kernel/capabilities/act/rationale-validator.test.ts` (Task 10, deferred)
- Create: `scripts/check-rationale-coverage.ts` — CI gate (Task 11, deferred)

### Files modified

- Modify: `packages/trace/src/events.ts` — add `AssumptionRecordedEvent`, `AlternativesConsideredEvent`, `CuratorDecisionEvent`; add optional `rationale?: Rationale` to `ToolCallEvent` (on `tool-call-start`), `KernelStateSnapshotEvent`, `StrategySwitchedEvent`, `DecisionEvaluatedEvent`
- Modify: `packages/trace/src/index.ts` — export `Rationale`, `RationaleSchema`, new event types
- Modify: `packages/reasoning/src/structured-output/index.ts` — export `RationaleSchema` and `RationaleField`
- Modify: `packages/reasoning/src/kernel/capabilities/act/tool-parsing.ts` — parse optional `rationale` from structured tool calls
- Modify: `packages/reasoning/src/kernel/capabilities/act/act.ts` — pass `rationale` into `ToolCallEvent` recorder
- Modify: `packages/reasoning/src/kernel/capabilities/reason/think.ts` — invoke `assumption-detector`, emit `AssumptionRecordedEvent`; add prompt nudge for tool rationale
- Modify: `packages/reasoning/src/kernel/loop/terminate.ts` — accept optional `rationale` on `TerminateOptions`, attach to snapshot
- Modify: `packages/reasoning/src/kernel/loop/runner.ts` — forward `rationale` from `terminate()` into `KernelStateSnapshotEvent`
- Modify: `packages/reasoning/src/context/context-curator.ts` — emit `CuratorDecisionEvent` with `Rationale`
- Modify: `packages/reactive-intelligence/src/controller/handlers/stall-detector.ts` — attach `refs: ["scratch:goal"]` to dispatched rationale (Task 8, deferred)
- Modify: `packages/diagnose/src/cli.ts` — register `debrief` command (existing entry point; commands directory: `diff.ts`, `grep.ts`, `list.ts`, `replay.ts`)
- Modify: `packages/diagnose/src/commands/replay.ts` — include rationale lines in default view
- Modify: `.github/workflows/ci.yml` — wire `scripts/check-rationale-coverage.ts` gate (Task 11, deferred)
- Modify: `AGENTS.md` — document the new `rax:diagnose debrief` workflow

---

## Tasks

### Task 1: `Rationale` type + Zod schema

**Files:**
- Create: `packages/trace/src/rationale.ts`
- Create: `packages/trace/tests/rationale.test.ts`
- Modify: `packages/trace/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/trace/tests/rationale.test.ts
import { describe, it, expect } from "bun:test";
import { RationaleSchema, type Rationale } from "../src/rationale";

describe("Rationale", () => {
  it("accepts minimal rationale", () => {
    const r: Rationale = { why: "needs fresh data" };
    expect(RationaleSchema.parse(r)).toEqual(r);
  });

  it("caps why at 280 chars", () => {
    const long = "x".repeat(281);
    expect(() => RationaleSchema.parse({ why: long })).toThrow();
  });

  it("requires alternatives.rejectedBecause when alternatives present", () => {
    expect(() => RationaleSchema.parse({
      why: "picked tool A",
      alternatives: [{ option: "tool B" } as never],
    })).toThrow();
  });

  it("validates confidence in [0,1]", () => {
    expect(() => RationaleSchema.parse({ why: "x", confidence: 1.5 })).toThrow();
  });

  it("preserves refs[]", () => {
    const r = RationaleSchema.parse({ why: "x", refs: ["obs:1", "scratch:goal"] });
    expect(r.refs).toEqual(["obs:1", "scratch:goal"]);
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
bun test packages/trace/tests/rationale.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/trace/src/rationale.ts
import { z } from "zod";

export const RationaleSchema = z.object({
  why: z.string().min(1).max(280),
  refs: z.array(z.string()).optional(),
  alternatives: z
    .array(z.object({
      option: z.string().min(1),
      rejectedBecause: z.string().min(1).max(160),
    }))
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type Rationale = z.infer<typeof RationaleSchema>;
```

- [ ] **Step 4: Export from package index**

```ts
// packages/trace/src/index.ts — add
export { RationaleSchema, type Rationale } from "./rationale";
```

- [ ] **Step 5: Verify pass + commit**

```bash
bun test packages/trace/tests/rationale.test.ts
git add packages/trace/src/rationale.ts packages/trace/src/index.ts packages/trace/tests/rationale.test.ts
git commit -m "feat(trace): add Rationale type + Zod schema"
```

---

### Task 2: Extend trace events with optional rationale

**Files:**
- Modify: `packages/trace/src/events.ts`
- Create: `packages/trace/tests/events-rationale.test.ts`

Notes on existing shapes (verified against `packages/trace/src/events.ts` 2026-05-12):
- `ToolCallEvent.kind` is `"tool-call-start" | "tool-call-end"`. Rationale attaches to `-start`.
- `KernelStateSnapshotEvent.status` enum does NOT contain `"terminated"`; termination is signalled by the existing `terminatedBy: string | undefined` field on `status: "done" | "failed"`.
- `DecisionEvaluatedEvent` and `StrategySwitchedEvent` already carry `reason: string` — we keep that and ADD optional `rationale`.

- [ ] **Step 1: Write failing test for event shape**

```ts
// packages/trace/tests/events-rationale.test.ts
import { describe, it, expect } from "bun:test";
import type {
  ToolCallEvent,
  AssumptionRecordedEvent,
  CuratorDecisionEvent,
  AlternativesConsideredEvent,
  KernelStateSnapshotEvent,
} from "../src/events";

describe("rationale-bearing events", () => {
  it("ToolCallEvent (start) carries optional rationale", () => {
    const e: ToolCallEvent = {
      kind: "tool-call-start",
      runId: "r1", iter: 0, seq: 1, timestamp: 0,
      toolName: "web_search",
      args: {},
      rationale: { why: "needs fresh data" },
    };
    expect(e.rationale?.why).toBe("needs fresh data");
  });

  it("AssumptionRecordedEvent kind matches", () => {
    const e: AssumptionRecordedEvent = {
      kind: "assumption-recorded",
      runId: "r1", iter: 1, seq: 2, timestamp: 0,
      assumption: "user means USD",
      rationale: { why: "no currency specified", confidence: 0.6 },
    };
    expect(e.kind).toBe("assumption-recorded");
  });

  it("KernelStateSnapshotEvent carries terminationRationale when terminatedBy set", () => {
    const e: KernelStateSnapshotEvent = {
      kind: "kernel-state-snapshot",
      runId: "r1", iter: 3, seq: 9, timestamp: 0,
      status: "done",
      toolsUsed: [],
      scratchpadKeys: [],
      stepsCount: 0,
      stepsByType: {},
      outputPreview: null,
      outputLen: 0,
      messagesCount: 0,
      tokens: 0,
      cost: 0,
      llmCalls: 0,
      terminatedBy: "quality-threshold",
      pendingGuidance: undefined,
      terminationRationale: { why: "quality 0.92 ≥ threshold 0.90" },
    };
    expect(e.terminationRationale?.why).toContain("0.92");
  });
});
```

- [ ] **Step 2: Run — confirm FAIL** (new event kinds and optional fields don't exist)

- [ ] **Step 3: Extend `events.ts`**

```ts
// packages/trace/src/events.ts — additions
import type { Rationale } from "./rationale";

// extend existing:
export interface ToolCallEvent extends TraceEventBase {
  readonly kind: "tool-call-start" | "tool-call-end";
  readonly toolName: string;
  readonly args?: unknown;
  readonly durationMs?: number;
  readonly ok?: boolean;
  readonly error?: string;
  readonly rationale?: Rationale; // NEW — only set on "tool-call-start"
}

export interface KernelStateSnapshotEvent extends TraceEventBase {
  readonly kind: "kernel-state-snapshot";
  /* ...existing fields... */
  readonly terminationRationale?: Rationale; // NEW (set iff terminatedBy is set)
}

export interface StrategySwitchedEvent extends TraceEventBase {
  readonly kind: "strategy-switched";
  readonly from: string;
  readonly to: string;
  readonly reason: string;          // EXISTING — kept as source of truth
  readonly rationale?: Rationale;   // NEW — optional structured pair
}

export interface DecisionEvaluatedEvent extends TraceEventBase {
  readonly kind: "decision-evaluated";
  readonly decisionType: string;
  readonly confidence: number;
  readonly reason: string;          // EXISTING
  readonly rationale?: Rationale;   // NEW
}

// new events:
export interface AssumptionRecordedEvent extends TraceEventBase {
  readonly kind: "assumption-recorded";
  readonly assumption: string;
  readonly rationale: Rationale;
}

export interface AlternativesConsideredEvent extends TraceEventBase {
  readonly kind: "alternatives-considered";
  readonly chosen: string;
  readonly alternatives: readonly { readonly option: string; readonly rejectedBecause: string }[];
}

export interface CuratorDecisionEvent extends TraceEventBase {
  readonly kind: "curator-decision";
  readonly action: "kept" | "dropped" | "compressed" | "marked-untrusted";
  readonly targetRef: string;     // observation/scratchpad key
  readonly rationale: Rationale;
}

// extend discriminated union:
export type TraceEvent =
  | /* ...existing variants... */
  | AssumptionRecordedEvent
  | AlternativesConsideredEvent
  | CuratorDecisionEvent;
```

- [ ] **Step 4: Verify pass**

```bash
bun test packages/trace/tests
bun run --filter @reactive-agents/trace typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/trace/
git commit -m "feat(trace): rationale-bearing events (tool, assumption, curator, alternatives, termination)"
```

---

### Task 3: Tool-call structured output rationale field (optional)

**Files:**
- Create: `packages/reasoning/src/structured-output/rationale-schema.ts`
- Modify: `packages/reasoning/src/structured-output/index.ts`
- Create: `packages/reasoning/tests/structured-output/tool-call-rationale.test.ts`

**Design note:** v1 keeps `rationale` OPTIONAL in the parsed schema. The prompt nudges models to provide it, the parser captures it when present, but the schema MUST NOT reject tool calls that omit it — that would break every existing provider integration and add prompt-budget overhead on every iteration. A future `requireRationale: true` flag (post-Compose-API) can opt into strict mode.

- [ ] **Step 1: Failing test — schema accepts both with and without rationale**

```ts
// packages/reasoning/tests/structured-output/tool-call-rationale.test.ts
import { describe, it, expect } from "bun:test";
import { ToolCallWithRationaleSchema } from "../../src/structured-output/rationale-schema";

describe("ToolCallWithRationaleSchema", () => {
  it("accepts a tool call with rationale", () => {
    const parsed = ToolCallWithRationaleSchema.parse({
      tool: "web_search",
      args: { q: "anthropic" },
      rationale: { why: "needs current info" },
    });
    expect(parsed.rationale?.why).toBe("needs current info");
  });

  it("accepts a tool call WITHOUT rationale (v1: optional)", () => {
    const parsed = ToolCallWithRationaleSchema.parse({
      tool: "web_search",
      args: { q: "x" },
    });
    expect(parsed.rationale).toBeUndefined();
  });

  it("rejects malformed rationale", () => {
    expect(() => ToolCallWithRationaleSchema.parse({
      tool: "web_search",
      args: { q: "x" },
      rationale: { why: "" }, // empty why is invalid
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run — confirm FAIL**

- [ ] **Step 3: Implement schema fragment**

```ts
// packages/reasoning/src/structured-output/rationale-schema.ts
import { z } from "zod";
import { RationaleSchema } from "@reactive-agents/trace";

export const RationaleField = RationaleSchema.optional();

export const ToolCallWithRationaleSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  rationale: RationaleField,
});

export type ToolCallWithRationale = z.infer<typeof ToolCallWithRationaleSchema>;
```

```ts
// packages/reasoning/src/structured-output/index.ts — extend existing exports
export { RationaleField, ToolCallWithRationaleSchema, type ToolCallWithRationale } from "./rationale-schema.js";
```

- [ ] **Step 4: Update model prompt fragments**

In `packages/reasoning/src/kernel/capabilities/reason/think.ts` (the think-phase system-prompt builder), append one optional-rationale instruction near the tool-use guidance:

> "When you call a tool, you MAY include a short `rationale.why` (≤280 chars) explaining why this tool over alternatives. Cite observation or scratchpad keys in `rationale.refs` when relevant. Rationale is optional in v1 but improves post-hoc debriefs."

- [ ] **Step 5: Verify pass + commit**

```bash
bun test packages/reasoning/tests/structured-output/
git add packages/reasoning/src/structured-output/ packages/reasoning/tests/structured-output/ packages/reasoning/src/kernel/capabilities/reason/think.ts
git commit -m "feat(reasoning): optional rationale in tool-call structured output"
```

---

### Task 4: Wire rationale through act phase → `ToolCallEvent`

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/act/tool-parsing.ts` — extract `rationale` from parsed tool call
- Modify: `packages/reasoning/src/kernel/capabilities/act/act.ts` — pass into recorder
- Modify: `packages/reasoning/tests/kernel/capabilities/act/act.test.ts` (or nearest existing act-phase test)

- [ ] **Step 1: Failing test — `act.ts` emits `rationale` on `tool-call-start`**

```ts
// extend existing act test
import { describe, it, expect } from "bun:test";
import type { TraceEvent, ToolCallEvent } from "@reactive-agents/trace";

it("emits rationale on tool-call-start when present in structured output", async () => {
  const events: TraceEvent[] = [];
  const recorder = makeFakeRecorder(events);
  await runActPhase({
    structured: { tool: "calc", args: { x: 1 }, rationale: { why: "verify arithmetic" } },
    recorder,
    // ...
  });
  const toolEvent = events.find(
    (e): e is ToolCallEvent => e.kind === "tool-call-start"
  );
  expect(toolEvent?.rationale?.why).toBe("verify arithmetic");
});

it("omits rationale on tool-call-start when not provided (backwards-compat)", async () => {
  const events: TraceEvent[] = [];
  const recorder = makeFakeRecorder(events);
  await runActPhase({
    structured: { tool: "calc", args: { x: 1 } },
    recorder,
    // ...
  });
  const toolEvent = events.find(
    (e): e is ToolCallEvent => e.kind === "tool-call-start"
  );
  expect(toolEvent?.rationale).toBeUndefined();
});
```

- [ ] **Step 2: Confirm FAIL**
- [ ] **Step 3: Implement** — in `tool-parsing.ts` carry `rationale` through alongside `tool`/`args`; in `act.ts` pass it into `recorder.emit({...event, rationale})` only when defined.
- [ ] **Step 4: Verify pass**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(reasoning): thread tool-call rationale through act phase"
```

---

### Task 5: Assumption recording in think phase  ⚠️ DEFERRED until Compose API Wave A lands

**Files:**
- Create: `packages/reasoning/src/kernel/capabilities/reason/assumption-detector.ts`
- Create: `packages/reasoning/tests/kernel/capabilities/reason/assumption-detector.test.ts`
- Modify: `packages/reasoning/src/kernel/capabilities/reason/think.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "bun:test";
import { detectAssumptions } from "../../../../src/kernel/capabilities/reason/assumption-detector";

describe("assumption-detector", () => {
  it("extracts explicit 'I assume' statements", () => {
    const out = detectAssumptions("I assume the user wants USD because no currency given.");
    expect(out).toEqual([{
      assumption: "the user wants USD",
      rationale: { why: "no currency given" },
    }]);
  });

  it("returns [] when no assumption marker present", () => {
    expect(detectAssumptions("I will search the web.")).toEqual([]);
  });

  it("caps to 3 assumptions per iteration to avoid bloat", () => {
    const text = "I assume A. I assume B. I assume C. I assume D.";
    expect(detectAssumptions(text).length).toBe(3);
  });
});
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Implement** detector (regex over `/I (?:am )?assum(?:e|ing) (?<a>[^.]+?)(?: because (?<r>[^.]+))?\./gi`, cap at 3, fallback `why: "implicit"`)

- [ ] **Step 4: Hook into think phase**

In `packages/reasoning/src/kernel/capabilities/reason/think.ts` after model response parsing, call `detectAssumptions(thoughtText)` and emit one `AssumptionRecordedEvent` per result.

- [ ] **Step 5: Add prompt nudge**

Add to think-phase system prompt: *"If you make any assumption that fills in missing context, state it as 'I assume X because Y.' so it can be reviewed."*

- [ ] **Step 6: Verify pass + commit**

```bash
git commit -m "feat(reasoning): assumption detection + AssumptionRecordedEvent in think phase"
```

---

### Task 6: Termination rationale via `kernel/loop/terminate.ts`

**Files:**
- Modify: `packages/reasoning/src/kernel/loop/terminate.ts` — extend `TerminateOptions` with optional `rationale`
- Modify: `packages/reasoning/src/kernel/loop/runner.ts` — forward `rationale` from terminate-call sites into `KernelStateSnapshotEvent.terminationRationale`
- Modify: existing terminate-helper test (no `termination-oracle.ts` source file exists)

Notes:
- The plan previously referenced `strategies/kernel/utils/termination-oracle.ts`; that file does not exist. Per `kernel/loop/terminate.ts:1` the single-owner termination gateway is `terminate(state, opts)` and the canonical decider is the Arbitrator at `kernel/capabilities/decide/arbitrator.ts`. The `reason: string` field on `TerminateOptions` is REQUIRED today; we add optional `rationale?: Rationale` next to it.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "bun:test";
import { terminate } from "../../../../src/kernel/loop/terminate";
import type { Rationale } from "@reactive-agents/trace";

it("attaches rationale to terminated state when provided", () => {
  const rationale: Rationale = { why: "quality 0.92 ≥ threshold 0.90" };
  const next = terminate(state, { reason: "quality-threshold", rationale });
  expect(next.terminationRationale?.why).toMatch(/quality.*0\.92.*threshold/);
});
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Implement** — add `rationale?: Rationale` to `TerminateOptions`, persist on state (new `state.terminationRationale?: Rationale`).

- [ ] **Step 4: Wire into `KernelStateSnapshotEvent`** — in `runner.ts` snapshot emission, copy `state.terminationRationale` into `event.terminationRationale` when `state.terminatedBy` is set.

- [ ] **Step 5: Update callers of `terminate()`** — Arbitrator paths (`kernel/capabilities/decide/arbitrator.ts`), oracle nudge (`kernel/capabilities/decide/oracle-nudge.ts`), and any direct `terminate()` callsite found via `rg "\bterminate\("` in `packages/reasoning/src/kernel/`. Provide rationale where the reason is non-obvious; leave others bare (rationale is optional).

- [ ] **Step 6: Verify pass + commit**

```bash
git commit -m "feat(reasoning): terminate() accepts optional Rationale, surfaced in KernelStateSnapshot"
```

---

### Task 7: Curator decisions emit `CuratorDecisionEvent`  ⚠️ DEFERRED until Compose API Wave A lands

**Files:**
- Modify: `packages/reasoning/src/context/context-curator.ts` (NOT `context/curator/...` — flat layout)
- Modify: `packages/reasoning/tests/context/context-curator.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "bun:test";

it("emits CuratorDecisionEvent when an observation is marked untrusted", async () => {
  const events: TraceEvent[] = [];
  const recorder = makeFakeRecorder(events);
  await curator.curate({ observation, recorder });
  expect(events.find((e) => e.kind === "curator-decision")).toMatchObject({
    action: "marked-untrusted",
    rationale: expect.objectContaining({ why: expect.any(String) }),
  });
});
```

- [ ] **Step 2: Confirm FAIL**
- [ ] **Step 3: Implement** — wherever curator currently sets `trustLevel` or drops/compresses content, emit a `CuratorDecisionEvent` with the existing `trustJustification` mapped to `rationale.why` and the observation id mapped to `rationale.refs[]`.
- [ ] **Step 4: Verify pass + commit**

```bash
git commit -m "feat(reasoning): ContextCurator emits CuratorDecisionEvent with Rationale"
```

---

### Task 8: Stall handler attaches goal context  ⚠️ DEFERRED until Compose API Wave A lands

**Files:**
- Modify: `packages/reactive-intelligence/src/controller/handlers/stall-detector.ts`
- Modify: corresponding test file at `packages/reactive-intelligence/tests/stall-detector.test.ts`

- [ ] **Step 1: Failing test** — stall decision rationale carries `refs: ["scratch:goal"]` when goal scratchpad key is present (attach to the existing `DecisionEvaluatedEvent` emitted by the controller).

- [ ] **Step 2–5: Implement, verify, commit**

```bash
git commit -m "feat(ri): stall handler emits Rationale citing current goal scratchpad"
```

---

### Task 9: `rax:diagnose debrief` command

**Files:**
- Create: `packages/diagnose/src/debrief/types.ts`
- Create: `packages/diagnose/src/debrief/build.ts`
- Create: `packages/diagnose/src/debrief/renderer.ts`
- Create: `packages/diagnose/src/commands/debrief.ts`
- Create: `packages/diagnose/tests/commands/debrief.test.ts`
- Create: `packages/diagnose/tests/fixtures/debrief-trace.jsonl`
- Modify: `packages/diagnose/src/cli.ts` (existing entry — current commands: `diff.ts`, `grep.ts`, `list.ts`, `replay.ts`)

- [ ] **Step 1: Define `Debrief` shape**

```ts
// packages/diagnose/src/debrief/types.ts
import type { Rationale } from "@reactive-agents/trace";

export type DebriefStep = {
  iter: number;
  action: string;             // "think" | "tool:<name>" | "terminate"
  rationale?: Rationale;
};

export type Debrief = {
  runId: string;
  goal: string;
  path: DebriefStep[];
  assumptions: { assumption: string; rationale: Rationale }[];
  curatorActions: { action: string; targetRef: string; rationale: Rationale }[];
  alternatives: { iter: number; chosen: string; rejected: { option: string; rejectedBecause: string }[] }[];
  termination: { by: string; rationale?: Rationale };
  verdict?: { status: "success" | "failure"; judgeScore?: number };
};
```

- [ ] **Step 2: Failing test — debrief assembles a fixture trace correctly**

Use a small fixture JSONL with one of each rationale-bearing event.

```ts
import { describe, it, expect } from "bun:test";
import { buildDebrief } from "../../src/debrief/build";

it("assembles a Debrief from a fixture trace", async () => {
  const d = await buildDebrief("packages/diagnose/tests/fixtures/debrief-trace.jsonl");
  expect(d.path).toHaveLength(3);
  expect(d.path[0].rationale?.why).toBe("needs fresh data");
  expect(d.assumptions[0].assumption).toBe("user means USD");
});
```

- [ ] **Step 3: Confirm FAIL**

- [ ] **Step 4: Implement** — iterate `loadTrace()` events, fold rationale-bearing events into `Debrief` shape, run renderer for markdown.

- [ ] **Step 5: Register CLI command**

```ts
// packages/diagnose/src/commands/debrief.ts
import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";
import { buildDebrief } from "../debrief/build.js";
import { renderDebrief } from "../debrief/renderer.js";
import { resolveTracePath } from "../lib/resolve-trace-path.js";

export const debriefCommand = Command.make(
  "debrief",
  { runIdOrPath: Args.text({ name: "run-id-or-path" }) },
  ({ runIdOrPath }) =>
    Effect.gen(function* () {
      const tracePath = yield* resolveTracePath(runIdOrPath);
      const debrief = yield* buildDebrief(tracePath);
      yield* Console.log(renderDebrief(debrief, "markdown"));
    })
);
```

Register it via `packages/diagnose/src/cli.ts` alongside the existing `replay`/`grep`/`list`/`diff` commands.

- [ ] **Step 6: Markdown renderer matches the example shape**

```
Debrief: run abc-123
├─ Goal: <task summary>
├─ Path: think → act(web_search) → think → act(calculator) → done
├─ Why this path
│   • iter 1 chose web_search: "needs fresh price data" (refs: obs:1)
│   • iter 2 chose calculator: "verify the cited number"
├─ Assumptions
│   • "user means USD" (conf: 0.6, never confirmed)
├─ Curator
│   • iter 2 marked-untrusted obs:scrape-1 — "no audit trail"
└─ Verdict: success | judge: 0.84
```

- [ ] **Step 7: Verify pass + commit**

```bash
bun test packages/diagnose/tests/commands/debrief.test.ts
git commit -m "feat(diagnose): rax:diagnose debrief command + markdown renderer"
```

---

### Task 10: Confabulation guard — refs validation  ⚠️ DEFERRED until Compose API Wave A lands

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/act/act.ts` (or extract to a util)
- Create: `packages/reasoning/src/kernel/capabilities/act/rationale-validator.ts`
- Create: `packages/reasoning/tests/kernel/capabilities/act/rationale-validator.test.ts`

Goal: when `rationale.refs[]` is non-empty AND the current iteration has observation/scratchpad state available, every ref must resolve. Unknown refs → emit `decision-evaluated` with `confidence: 0` + log warning. **First-iteration / empty-state runs are exempt** to avoid false positives.

- [ ] **Step 1: Failing test** — invalid ref produces a flagged event; empty-state run does not
- [ ] **Step 2–5: Implement, verify, commit**

```bash
git commit -m "feat(reasoning): reject rationale citing unknown refs (anti-confabulation guard)"
```

---

### Task 11: CI coverage gate  ⚠️ DEFERRED until Compose API Wave A lands

**Files:**
- Create: `scripts/check-rationale-coverage.ts`
- Modify: `.github/workflows/ci.yml`

Goal: every `tool-call-start` event in fixture traces where the run terminated successfully SHOULD carry `rationale`. Every `kernel-state-snapshot` with `terminatedBy` set SHOULD carry `terminationRationale`. Threshold ≥ 80% (not 100%) for v1 to allow gradual model adoption.

- [ ] **Step 1: Failing test (the script itself fails on legacy fixture)**
- [ ] **Step 2: Implement script** — loads fixture traces, computes coverage ratio per category, exits non-zero on miss
- [ ] **Step 3: Regenerate fixtures using the new harness**
- [ ] **Step 4: Wire into CI as a non-blocking warning first, promote to required after one minor**
- [ ] **Step 5: Commit**

```bash
git commit -m "ci: rationale coverage gate on canonical probe traces (warn-only)"
```

---

### Task 12: Documentation

**Files:**
- Modify: `AGENTS.md` — add a "Decision Tracing" subsection under observability
- Modify: `apps/docs/src/content/docs/concepts/` — add `decision-tracing.mdx`
- Modify: `.agents/skills/harness-improvement-loop/SKILL.md` — replace ad-hoc rationale-reading guidance with `rax:diagnose debrief` workflow
- Modify: `CHANGELOG.md` — add entry under unreleased

- [ ] **Step 1–3: Write docs, link from sidebar, commit**

```bash
git commit -m "docs: decision tracing + rax:diagnose debrief workflow"
```

---

## Out of Scope (Deferred)

These belong to follow-up plans, intentionally not bundled here:

- **Divergence detector** — needs baseline traces, which only become meaningful once rationale coverage is established. Plan a Phase 2 once we have a corpus of debriefs.
- **Interactive replay** — stepping/breakpoints; useful but not required for *capturing* the why.
- **Judge verdict → trace round-trip** — separate plan; involves `packages/judge-server` API changes.
- **Channels-layer tracing** — `packages/channels` emits no events at all; a separate adapter-tracing plan.
- **Cost-router rationale** — wire after `cost-route` lifecycle phase is itself stable.
- **Self-improving controller** — that's the consumer of this plan's output; track separately.
- **Strict-mode `requireRationale: true`** — defer until model fleet is reliably emitting the field in optional mode.

---

## Success Criteria

Measurable, falsifiable from the trace itself. v1 thresholds are lower than the original spec to reflect optional-rationale design:

1. **Tool-call coverage (v1):** ≥ 50% of `tool-call-start` events on top-tier models (Opus/Sonnet/Gemini 2.5 Pro) carry `rationale.why` in fixture traces. Promote threshold each minor as adoption matures.
2. **Termination coverage:** ≥ 90% of `kernel-state-snapshot` events with `terminatedBy ∈ {quality, oracle, max-iterations, error}` carry `terminationRationale` (rationale is provided at the `terminate()` callsite, fully under our control).
3. **Assumption surfacing:** ≥ 1 `assumption-recorded` event per run on the ambiguous-input probe in `benchmarks/real-world.ts` when Task 5 lands.
4. **Curator coverage:** every `trustLevel: "untrusted"` observation has a co-emitted `curator-decision` event when Task 7 lands.
5. **Debrief usability:** `rax:diagnose debrief <runId>` produces a readable markdown timeline on every canonical harness probe in < 200ms.
6. **No regression:** existing probe pass rates from `harness-reports/loop-state.json` unchanged within ±1 iteration / ±5% tokens.
7. **Anti-confabulation (v1, Task 10):** invalid-refs rejection rate < 5% on top-tier models; first-iteration exemption produces no false positives.

---

## Self-Review Checklist

- [ ] Paths verified against current kernel layout (`kernel/capabilities/<verb>/` and `kernel/loop/`, not `strategies/kernel/phases/`)
- [ ] All event-shape extensions are additive and optional (no breaking changes to existing consumers)
- [ ] All tests use `bun:test` import, not `vitest`
- [ ] Task 6 targets `kernel/loop/terminate.ts` (the actual single-owner gateway), not a fictitious `termination-oracle.ts`
- [ ] Task 7 targets `context/context-curator.ts` (flat), not `context/curator/context-curator.ts`
- [ ] Optional-by-default rationale on tool-call schema; no breaking schema rejections
- [ ] Reduced v1 (Tasks 1, 2, 3, 4, 6, 9) explicitly scoped; Tasks 5/7/8/10/11 marked DEFERRED
- [ ] Type names consistent (`Rationale`, `RationaleSchema`, `*Event` discriminated by `kind`)
- [ ] Commit points well-defined and atomic per task
- [ ] CI gate is warn-only at first, prevents regression after promotion (Task 11)
- [ ] Out-of-scope work is named and tracked

---

## After Completion

- [ ] Update frontmatter: `status: completed`, `completed: YYYY-MM-DD`
- [ ] Move row in `[[Planning-Index]]` from "Active" to "Completed"
- [ ] Write debrief: `wiki/Research/Debriefs/2026-MM-DD-decision-rationale-traceability-debrief.md` — eat the dogfood by debriefing the run that built debrief
- [ ] Link from `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` (trace-observability section)
- [ ] Open follow-up plan: `decision-divergence-detector` (Phase 2)
