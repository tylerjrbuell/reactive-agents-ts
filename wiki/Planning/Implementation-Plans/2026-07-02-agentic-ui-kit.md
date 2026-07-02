# Agentic UI Kit — Foundation (P1 ui-core + P2 server rail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless `@reactive-agents/ui-core` package (wire protocol, resumable SSE client, run state machine, fixture testing) and the runtime server rail (event journal, interaction pause/resume, identity scoping, endpoint helpers with wallet guards) — the foundation every binding, demo, and template builds on.

**Architecture:** New zero-dependency client package `packages/ui-core` declares the versioned wire protocol; `packages/runtime` grows a `server/` module (endpoint helpers) plus durable-store extensions (`run_events` journal, `run_interactions` table, identity columns). The `request_user_input` meta-tool mirrors the shipped approval pause rail exactly: kernel terminates cleanly with `meta.awaitingInteractionFor`, run persists as `awaiting-interaction`, a later `respondToInteraction()` re-drives from checkpoint with the user's value injected as the tool result.

**Tech Stack:** TypeScript (strict, no `any`), Effect-TS in runtime/reasoning packages, plain TS (no Effect) in ui-core, Bun test runner, tsup builds, SQLite (bun:sqlite) durable store.

**Spec:** `wiki/Architecture/Design-Specs/2026-07-02-agentic-ui-harness-components.md`. This plan covers spec phases **P1 + P2**. P3 (React binding + components + devtools), P4 (vue/svelte parity), P5 (demo + docs + template) get their own plans once this protocol foundation is merged — planning them against an unbuilt protocol would produce placeholder-riddled tasks.

## Global Constraints

- Strict TypeScript. **No `any` casts** — use `unknown` + guards or proper types (project feedback rule).
- Effect-TS mandatory patterns in `packages/runtime` / `packages/reasoning` / `packages/tools` (see `effect-ts-patterns` skill). `packages/ui-core` is **Effect-free by design** — it runs in browsers.
- All tests must pass **keyless** (no `.env`, no Ollama): use the deterministic `test` provider / in-memory SQLite `:memory:` / mocked `fetch`. Never add a test that touches a real provider.
- Test commands need explicit timeouts where they spawn runtimes: `bun test <path> --timeout 15000`.
- Additive-only public API: never remove or rename existing exports of `@reactive-agents/{react,vue,svelte,runtime}`; supersede via re-export.
- Wire protocol is **additive-only** after this plan lands; every event carries `_tag`; protocol version constant `PROTOCOL_VERSION = 1`.
- Commit after every task (conventional commits, no AI co-author trailers).
- Prefix shell commands with `rtk` where supported (`rtk git`, `rtk grep`).
- Do NOT touch `packages/benchmarks` (uncommitted competitive-bench WIP lives there).

## Verified Anchors (from codebase mapping 2026-07-02 — trust these, re-verify only if a step fails)

- `AgentStreamEvent` union: `packages/runtime/src/stream-types.ts:13-91` — tags `TextDelta{text}`, `StreamCompleted{output, metadata, taskId?, agentId?, toolSummary?, runId?, pendingApproval?}`, `StreamError{cause}`, `IterationProgress{iteration,maxIterations,toolsCalledThisStep?,status}`, `StreamCancelled{reason,iterationsCompleted}`, full-density `PhaseStarted/PhaseCompleted/ThoughtEmitted/ToolCallStarted/ToolCallCompleted`.
- `AgentStream.toSSE(stream): Response` `packages/runtime/src/agent-stream.ts:106-158`; writes `data: ${JSON.stringify(event)}\n\n`.
- `agent.runStream(input, {density?, signal?, history?}): RunHandle` `reactive-agent.ts:1451`; `RunHandle` = AsyncGenerator<AgentStreamEvent> + controls (`run-controller.ts:91-97`).
- RunStore: `packages/runtime/src/services/run-store.ts` — tables `runs` (L178: run_id, agent_id, task, status, config_hash, created_at, updated_at), `run_checkpoints` (L188), `run_approvals` (L197). `RunStatus = "running"|"paused"|"awaiting-approval"|"completed"|"failed"` (L48). `RunStoreLive(dbPath)` (L167), `RunStoreService` tag (L134). **No event journal exists.**
- Approval pause: `packages/reasoning/src/kernel/capabilities/act/act.ts:220-239` — terminates kernel with `meta.awaitingApprovalFor {gateId, toolName, args}`; `execute-stream.ts:246-289` + `persistApprovalPause` (execute-stream L40-62) persist row + status; `StreamCompleted.pendingApproval` carries it to clients. Resume: `approveRun/denyRun` (`reactive-agent.ts:879/891`) → `decideAndResumeRun` (L896-935) → `runDurable({resume:{stateJson, decision:{gateId,status,reason}}})`; decision applied in `packages/reasoning/src/kernel/loop/runner.ts:418-435` before the loop.
- `resumeRun(runId)` L822, `listRuns({status?})` L861, `listPendingApprovals()` L941, `runDurable` private L1026-1098. Durable helpers: `engine/durable-resume.ts` (`loadResumePayload` L44, `persistApprovalPauseAt` L161, `decideApprovalRecord` L105, `listDurableRuns` L79).
- `.withDurableRuns(options?: {dir?, checkpointEvery?})` `builder.ts:1079`; detach-mode approval requires durable runs — validation at `builder.ts:2186-2195` (mirror this for `.withUserInteraction()`).
- Builder inline-field recipe: `withLlmTimeout` `builder.ts:1837-1840` + private field ~L395 + threading `runtime.ts:391`.
- Meta-tools: `KernelMetaToolsSchema` `packages/reasoning/src/types/kernel-meta-tools.ts:28-46` (has `abstain`, `checkpoint`, …). Offering gate: `think.ts:316-325` (`augmentedToolSchemas` = tools + `finalAnswerTool` + gated `abstainToolSchema` via `shouldOfferAbstain` from `./abstain-gate.js`). Handlers: `act/meta-tool-handlers.ts` (`ABSTAIN_TOOL_NAME` L138, `metaToolRegistry` L155). Tool definition precedent: `packages/tools/src/skills/final-answer.ts:6`.
- `AgentResultMetadata` `packages/runtime/src/builder/types.ts:760` — has `cost: number` (USD), `tokensUsed`, `duration`, `stepsCount`.
- `parse-partial.ts`: `packages/vue/src/parse-partial.ts` and `packages/svelte/src/parse-partial.ts` are **byte-identical**; react has none.
- Package template: `packages/vue/package.json` (tsup build, bun/import/default export conditions, `files: [dist]`).
- Test provider: `TestLLMServiceLayer(scenario, quirk?)` `packages/llm-provider/src/testing.ts:348`.

## File Structure

```
packages/ui-core/                          NEW package @reactive-agents/ui-core
  package.json / tsconfig.json
  src/index.ts                             public exports
  src/protocol/events.ts                   UiStreamEvent union, guards, PROTOCOL_VERSION, parseUiStreamEvent
  src/parse-partial.ts                     canonical copy (moved from vue/svelte)
  src/stream/connect.ts                    connectRunStream — SSE client, cursor resume, reconnect
  src/state/run-machine.ts                 initialRunState / reduceRunState
  src/testing/fixtures.ts                  RunFixture, recordRunFixture, fixtureToSSE, mockAgentEndpoint
  tests/{protocol,parse-partial,connect,run-machine,fixtures}.test.ts

packages/runtime/src/
  services/run-store.ts                    MODIFY: run_events + run_interactions tables, identity columns, new methods
  stream-types.ts                          MODIFY: StreamCompleted gains pendingInteraction?, abstention?
  engine/durable-resume.ts                 MODIFY: persistInteractionPauseAt, decideInteractionRecord, getPendingInteractionAt
  engine/execute-stream.ts                 MODIFY: persist interaction pause (mirror approval block)
  reactive-agent.ts                        MODIFY: respondToInteraction, listPendingInteractions, getDurableInfo
  builder.ts                               MODIFY: withUserInteraction() + build() validation
  server/guards.ts                         NEW: createEndpointGuards (rate/concurrency/anonymous/budget)
  server/journal.ts                        NEW: journaled stream tee + attach replay
  server/endpoints.ts                      NEW: createAgentEndpoint/RunAttach/Interaction/Approval/Inbox
  index.ts                                 MODIFY: export server helpers
packages/runtime/tests/server/*.test.ts    NEW tests

packages/reasoning/src/
  types/kernel-meta-tools.ts               MODIFY: userInteraction flag
  kernel/capabilities/act/act.ts           MODIFY: request_user_input intercept
  kernel/capabilities/reason/think.ts      MODIFY: offer request_user_input schema
packages/tools/src/skills/request-user-input.ts   NEW tool definition

packages/vue/src/parse-partial.ts          MODIFY: re-export from ui-core
packages/svelte/src/parse-partial.ts       MODIFY: re-export from ui-core

wiki/Research/2026-07-agentic-ui-gap-log.md  NEW (Task 1 creates; every task appends when friction hit)
```

Dependency direction: `ui-core` depends on NOTHING (workspace or external). `runtime` gains dep on `ui-core` (type-only, for protocol). `vue`/`svelte` gain dep on `ui-core`. Never the reverse.

---

# Part 1 — `@reactive-agents/ui-core`

### Task 1: Scaffold `packages/ui-core` + gap log

**Files:**
- Create: `packages/ui-core/package.json`
- Create: `packages/ui-core/tsconfig.json`
- Create: `packages/ui-core/src/index.ts`
- Create: `wiki/Research/2026-07-agentic-ui-gap-log.md`

**Interfaces:**
- Produces: buildable empty package `@reactive-agents/ui-core` with `bun`/`import` export conditions; later tasks add sources and export them from `src/index.ts`.

- [ ] **Step 1: Create package.json** (mirrors `packages/vue/package.json` conventions, version matches repo baseline `0.10.6`):

```json
{
  "name": "@reactive-agents/ui-core",
  "version": "0.10.6",
  "description": "Headless core for Reactive Agents UI bindings — wire protocol, resumable stream client, run state machines, fixture testing",
  "keywords": ["ai", "agents", "llm", "typescript", "streaming", "ai-ui", "agent-ui", "headless"],
  "type": "module",
  "exports": {
    ".": {
      "bun": "./dist/index.js",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./testing": {
      "bun": "./dist/testing/fixtures.js",
      "types": "./dist/testing/fixtures.d.ts",
      "import": "./dist/testing/fixtures.js",
      "default": "./dist/testing/fixtures.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^6.0.0"
  },
  "scripts": {
    "build": "tsup src/index.ts src/testing/fixtures.ts --format esm --dts --out-dir dist",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create tsconfig.json** — copy `packages/vue/tsconfig.json` verbatim (same strictness), adjusting nothing unless it references vue types; if it does, drop that `types`/`lib` entry.

- [ ] **Step 3: Create src/index.ts placeholder export**

```ts
/**
 * @reactive-agents/ui-core — headless core for agent UI bindings.
 * Effect-free and dependency-free by design: this package runs in browsers.
 */
export const PROTOCOL_VERSION = 1;
```

- [ ] **Step 4: Create the gap log** at `wiki/Research/2026-07-agentic-ui-gap-log.md`:

```markdown
# Agentic UI Kit — Framework Gap Log

Standing order (spec §10): every framework friction hit while building the UI kit
gets an entry here with production context. Format per entry:

## GAP-N: <title>
- **Hit while:** <task / what you were doing>
- **Expected:** <what the framework should have offered>
- **Actual:** <what exists / what you had to do instead>
- **Severity:** blocker | workaround | papercut
```

- [ ] **Step 5: Verify build + workspace resolution**

Run: `cd packages/ui-core && bun run build && bun run typecheck`
Expected: tsup emits `dist/index.js` + `dist/index.d.ts`, tsc clean.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/ui-core wiki/Research/2026-07-agentic-ui-gap-log.md
rtk git commit -m "feat(ui-core): scaffold headless UI core package + gap log"
```

---

### Task 2: Wire protocol — `UiStreamEvent` union, guards, parser

**Files:**
- Create: `packages/ui-core/src/protocol/events.ts`
- Modify: `packages/ui-core/src/index.ts`
- Test: `packages/ui-core/tests/protocol.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `PROTOCOL_VERSION: 1`
  - `type UiStreamEvent` — discriminated union on `_tag` (all variants below)
  - `type UiRunStatus = "idle" | "streaming" | "awaiting-interaction" | "awaiting-approval" | "completed" | "error" | "cancelled"`
  - `parseUiStreamEvent(raw: string): UiStreamEvent | null` — JSON parse + `_tag` presence check
  - `isTerminalEvent(e: UiStreamEvent): boolean` — true for `StreamCompleted | StreamError | StreamCancelled | LimitExceeded`
  - `type SeqStamped<E> = E & { seq?: number }`

The base tags **structurally match** the server's `AgentStreamEvent` wire JSON (`stream-types.ts:13-91`) — ui-core re-declares them because it cannot depend on runtime. New tags extend the wire protocol; four tags are **reserved** (declared in the union, never emitted in v1): `ObjectDelta`, `UiTreeDelta`, `TrustEvent`, `StepEvent`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui-core/tests/protocol.test.ts
import { describe, expect, test } from "bun:test";
import {
  PROTOCOL_VERSION,
  parseUiStreamEvent,
  isTerminalEvent,
  type UiStreamEvent,
} from "../src/protocol/events.js";

describe("ui-core protocol", () => {
  test("version constant", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  test("parses a TextDelta wire line", () => {
    const e = parseUiStreamEvent('{"_tag":"TextDelta","text":"hi"}');
    expect(e).toEqual({ _tag: "TextDelta", text: "hi" });
  });

  test("parses new-tag events", () => {
    const attach = parseUiStreamEvent(
      '{"_tag":"RunAttached","runId":"r1","status":"awaiting-interaction","resumeCursor":7,"protocolVersion":1}',
    );
    expect(attach?._tag).toBe("RunAttached");
    const ir = parseUiStreamEvent(
      '{"_tag":"InteractionRequested","runId":"r1","interactionId":"i1","kind":"choice","prompt":"pick one","schema":{"options":["a","b"]}}',
    );
    expect(ir?._tag).toBe("InteractionRequested");
  });

  test("rejects garbage and untagged JSON", () => {
    expect(parseUiStreamEvent("not json")).toBeNull();
    expect(parseUiStreamEvent('{"text":"no tag"}')).toBeNull();
    expect(parseUiStreamEvent('{"_tag":42}')).toBeNull();
  });

  test("terminal classification", () => {
    const done = { _tag: "StreamCompleted", output: "x", metadata: {} } as UiStreamEvent;
    const delta = { _tag: "TextDelta", text: "x" } as UiStreamEvent;
    const limited = {
      _tag: "LimitExceeded",
      kind: "rateLimit",
      retryAfterMs: 1000,
    } as UiStreamEvent;
    expect(isTerminalEvent(done)).toBe(true);
    expect(isTerminalEvent(limited)).toBe(true);
    expect(isTerminalEvent(delta)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui-core/tests/protocol.test.ts`
Expected: FAIL — cannot resolve `../src/protocol/events.js`.

- [ ] **Step 3: Implement protocol module**

```ts
// packages/ui-core/src/protocol/events.ts
/**
 * Versioned wire protocol between Reactive Agents server endpoints and UI
 * bindings. Additive-only after v1: never remove or repurpose a _tag.
 *
 * Base tags mirror the server's AgentStreamEvent JSON shape
 * (packages/runtime/src/stream-types.ts) — re-declared here because ui-core
 * must stay dependency-free and browser-safe.
 */
export const PROTOCOL_VERSION = 1 as const;

export type UiRunStatus =
  | "idle"
  | "streaming"
  | "awaiting-interaction"
  | "awaiting-approval"
  | "completed"
  | "error"
  | "cancelled";

export interface ResultMetadataWire {
  readonly duration?: number;
  readonly cost?: number;
  readonly tokensUsed?: number;
  readonly stepsCount?: number;
  readonly [key: string]: unknown;
}

// ── Base tags (server-originated, exist today) ────────────────────────────
export interface TextDelta {
  readonly _tag: "TextDelta";
  readonly text: string;
}
export interface StreamCompleted {
  readonly _tag: "StreamCompleted";
  readonly output: string;
  readonly metadata: ResultMetadataWire;
  readonly taskId?: string;
  readonly agentId?: string;
  readonly runId?: string;
  readonly pendingApproval?: {
    readonly runId: string;
    readonly gateId: string;
    readonly toolName: string;
    readonly args: unknown;
  };
  readonly pendingInteraction?: PendingInteractionWire;
  readonly abstention?: { readonly reason: string; readonly missing?: readonly string[] };
}
export interface StreamError {
  readonly _tag: "StreamError";
  readonly cause: string;
}
export interface StreamCancelled {
  readonly _tag: "StreamCancelled";
  readonly reason: string;
  readonly iterationsCompleted: number;
}
export interface IterationProgress {
  readonly _tag: "IterationProgress";
  readonly iteration: number;
  readonly maxIterations: number;
  readonly toolsCalledThisStep?: readonly string[];
  readonly status: string;
}
export interface ToolCallStarted {
  readonly _tag: "ToolCallStarted";
  readonly toolName: string;
  readonly callId: string;
}
export interface ToolCallCompleted {
  readonly _tag: "ToolCallCompleted";
  readonly toolName: string;
  readonly callId: string;
  readonly durationMs: number;
  readonly success: boolean;
}
export interface ThoughtEmitted {
  readonly _tag: "ThoughtEmitted";
  readonly content: string;
  readonly iteration: number;
}
export interface PhaseStarted {
  readonly _tag: "PhaseStarted";
  readonly phase: string;
  readonly timestamp: number;
}
export interface PhaseCompleted {
  readonly _tag: "PhaseCompleted";
  readonly phase: string;
  readonly durationMs: number;
}

// ── New tags (this kit) ───────────────────────────────────────────────────
export interface PendingInteractionWire {
  readonly runId: string;
  readonly interactionId: string;
  readonly kind: "form" | "choice" | "confirmation";
  readonly prompt: string;
  readonly schema: unknown;
}
export interface RunAttached {
  readonly _tag: "RunAttached";
  readonly runId: string;
  readonly status: string;
  readonly resumeCursor: number;
  readonly protocolVersion: number;
}
export interface InteractionRequested extends PendingInteractionWire {
  readonly _tag: "InteractionRequested";
}
export interface ApprovalRequested {
  readonly _tag: "ApprovalRequested";
  readonly runId: string;
  readonly gateId: string;
  readonly toolName: string;
  readonly args: unknown;
}
export interface RunPaused {
  readonly _tag: "RunPaused";
  readonly runId: string;
  readonly reason: "awaiting-interaction" | "awaiting-approval";
}
export interface Abstained {
  readonly _tag: "Abstained";
  readonly reason: string;
  readonly missing?: readonly string[];
}
export interface CostDelta {
  readonly _tag: "CostDelta";
  readonly tokens: number;
  readonly usd: number;
}
export interface LimitExceeded {
  readonly _tag: "LimitExceeded";
  readonly kind: "rateLimit" | "budget" | "concurrency" | "anonymous";
  readonly retryAfterMs?: number;
}

// ── Reserved tags (declared for forward-compat; NOT emitted in v1) ───────
export interface ObjectDelta {
  readonly _tag: "ObjectDelta";
  readonly partial: unknown;
}
export interface UiTreeDelta {
  readonly _tag: "UiTreeDelta";
  readonly partial: unknown;
}
export interface TrustEvent {
  readonly _tag: "TrustEvent";
  readonly claimId: string;
  readonly verdict: string;
  readonly sources: readonly string[];
}
export interface StepEvent {
  readonly _tag: "StepEvent";
  readonly step: unknown;
}

export type UiStreamEvent =
  | TextDelta
  | StreamCompleted
  | StreamError
  | StreamCancelled
  | IterationProgress
  | ToolCallStarted
  | ToolCallCompleted
  | ThoughtEmitted
  | PhaseStarted
  | PhaseCompleted
  | RunAttached
  | InteractionRequested
  | ApprovalRequested
  | RunPaused
  | Abstained
  | CostDelta
  | LimitExceeded
  | ObjectDelta
  | UiTreeDelta
  | TrustEvent
  | StepEvent;

/** Journal-stamped variant: server assigns a monotonic per-run sequence. */
export type SeqStamped<E> = E & { readonly seq?: number };

const TERMINAL_TAGS: ReadonlySet<UiStreamEvent["_tag"]> = new Set([
  "StreamCompleted",
  "StreamError",
  "StreamCancelled",
  "LimitExceeded",
]);

export const isTerminalEvent = (e: UiStreamEvent): boolean => TERMINAL_TAGS.has(e._tag);

/** Parse one SSE `data:` payload. Returns null for anything not a tagged event. */
export const parseUiStreamEvent = (raw: string): UiStreamEvent | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "_tag" in value &&
      typeof (value as { _tag: unknown })._tag === "string"
    ) {
      return value as UiStreamEvent;
    }
    return null;
  } catch {
    return null;
  }
};
```

- [ ] **Step 4: Export from index** — replace `packages/ui-core/src/index.ts` content:

```ts
/**
 * @reactive-agents/ui-core — headless core for agent UI bindings.
 * Effect-free and dependency-free by design: this package runs in browsers.
 */
export * from "./protocol/events.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/ui-core/tests/protocol.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
rtk git add packages/ui-core
rtk git commit -m "feat(ui-core): versioned wire protocol — UiStreamEvent union, parser, guards"
```

---

### Task 3: Canonical `parse-partial` (dedupe vue/svelte copies)

**Files:**
- Create: `packages/ui-core/src/parse-partial.ts` (content moved from `packages/vue/src/parse-partial.ts`)
- Modify: `packages/vue/src/parse-partial.ts` → re-export
- Modify: `packages/svelte/src/parse-partial.ts` → re-export
- Modify: `packages/vue/package.json`, `packages/svelte/package.json` (add dep)
- Modify: `packages/ui-core/src/index.ts`
- Test: `packages/ui-core/tests/parse-partial.test.ts`

**Interfaces:**
- Produces: `parsePartialObject(text: string): unknown | undefined` exported from `@reactive-agents/ui-core` (exact signature = whatever `packages/vue/src/parse-partial.ts` exports today — read it first and keep the export name `parsePartialObject` and signature identical).
- Consumes: nothing.

- [ ] **Step 1: Read the current canonical file**

Run: `cat packages/vue/src/parse-partial.ts` — note the exact exported names and signature. `diff packages/vue/src/parse-partial.ts packages/svelte/src/parse-partial.ts` must report identical (verified 2026-07-02; if it no longer does, STOP and log a gap entry before proceeding).

- [ ] **Step 2: Write the failing test** (behavioral pin — partial JSON tolerance):

```ts
// packages/ui-core/tests/parse-partial.test.ts
import { describe, expect, test } from "bun:test";
import { parsePartialObject } from "../src/parse-partial.js";

describe("parsePartialObject", () => {
  test("parses complete JSON", () => {
    expect(parsePartialObject('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  test("parses truncated object (mid-stream)", () => {
    const partial = parsePartialObject('{"a":1,"b":"tru');
    expect(partial).toBeDefined();
    expect((partial as { a: number }).a).toBe(1);
  });

  test("parses truncated nested array", () => {
    const partial = parsePartialObject('{"items":[{"id":1},{"id":');
    expect(partial).toBeDefined();
  });

  test("returns undefined for non-JSON prose", () => {
    expect(parsePartialObject("hello world")).toBeUndefined();
  });
});
```

(If the actual function returns `null` rather than `undefined` for prose, adjust the last assertion to match the moved implementation — behavior must not change in this task.)

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test packages/ui-core/tests/parse-partial.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Move the file** — copy `packages/vue/src/parse-partial.ts` **verbatim** to `packages/ui-core/src/parse-partial.ts`. Add to `packages/ui-core/src/index.ts`:

```ts
export * from "./parse-partial.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/ui-core/tests/parse-partial.test.ts`
Expected: PASS.

- [ ] **Step 6: Re-point vue + svelte** — replace the body of `packages/vue/src/parse-partial.ts` AND `packages/svelte/src/parse-partial.ts` each with:

```ts
/** Canonical implementation lives in @reactive-agents/ui-core (moved 2026-07). */
export * from "@reactive-agents/ui-core";
```

Wait — that re-exports the whole core. Narrow it to exactly the names the file previously exported, e.g. if the original exported `parsePartialObject`:

```ts
/** Canonical implementation lives in @reactive-agents/ui-core (moved 2026-07). */
export { parsePartialObject } from "@reactive-agents/ui-core";
```

Add to both `packages/vue/package.json` and `packages/svelte/package.json` dependencies:

```json
"dependencies": {
  "@reactive-agents/ui-core": "workspace:*"
}
```

(If a `dependencies` block already exists, merge; check first with `cat`.)

- [ ] **Step 7: Verify all three packages typecheck + existing tests pass**

Run: `bun install && cd packages/vue && bun run typecheck && cd ../svelte && bun run typecheck && cd ../.. && bun test packages/vue packages/svelte packages/ui-core`
Expected: clean typechecks; all existing vue/svelte tests still green.

- [ ] **Step 8: Commit**

```bash
rtk git add packages/ui-core packages/vue packages/svelte bun.lock
rtk git commit -m "refactor(ui-core): single canonical parse-partial, vue/svelte re-export"
```

---

### Task 4: Resumable SSE stream client — `connectRunStream`

**Files:**
- Create: `packages/ui-core/src/stream/connect.ts`
- Modify: `packages/ui-core/src/index.ts`
- Test: `packages/ui-core/tests/connect.test.ts`

**Interfaces:**
- Produces:

```ts
interface ConnectOptions {
  readonly endpoint: string;
  readonly body?: Record<string, unknown>;      // POST body for new runs
  readonly attach?: { runId: string; cursor?: number }; // GET reattach mode
  readonly fetchImpl?: typeof fetch;            // injectable for tests
  readonly maxRetries?: number;                 // default 3
  readonly retryDelayMs?: number;               // default 500 (doubles per retry)
  readonly signal?: AbortSignal;
}
function connectRunStream(opts: ConnectOptions): AsyncGenerator<SeqStamped<UiStreamEvent>>;
```

Behavior contract: POST `{prompt,...body}` to `endpoint` (new-run mode) or GET `endpoint/:runId?cursor=N` (attach mode); parse SSE lines (`id:` → seq, `data:` → event via `parseUiStreamEvent`); track highest seq seen; on network drop BEFORE a terminal event, reconnect in attach mode from `cursor = lastSeq` with exponential backoff up to `maxRetries`; stop cleanly on terminal event or abort.

- Consumes: `parseUiStreamEvent`, `isTerminalEvent`, `SeqStamped` (Task 2).

- [ ] **Step 1: Write the failing test** — mock `fetch` returning hand-built SSE `ReadableStream`s:

```ts
// packages/ui-core/tests/connect.test.ts
import { describe, expect, test } from "bun:test";
import { connectRunStream } from "../src/stream/connect.js";
import type { UiStreamEvent } from "../src/protocol/events.js";

const sse = (events: Array<{ seq?: number; event: object }>, opts?: { dropAfter?: number }) => {
  const chunks: string[] = [];
  events.forEach(({ seq, event }, i) => {
    if (opts?.dropAfter !== undefined && i >= opts.dropAfter) return;
    if (seq !== undefined) chunks.push(`id: ${seq}\n`);
    chunks.push(`data: ${JSON.stringify(event)}\n\n`);
  });
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      if (opts?.dropAfter !== undefined) {
        controller.error(new Error("network drop"));
      } else {
        controller.close();
      }
    },
  });
};

const okResponse = (body: ReadableStream<Uint8Array>) =>
  new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });

describe("connectRunStream", () => {
  test("yields parsed events and stops at terminal", async () => {
    const fetchImpl: typeof fetch = async () =>
      okResponse(
        sse([
          { seq: 1, event: { _tag: "TextDelta", text: "he" } },
          { seq: 2, event: { _tag: "TextDelta", text: "llo" } },
          { seq: 3, event: { _tag: "StreamCompleted", output: "hello", metadata: {} } },
        ]),
      );
    const got: UiStreamEvent[] = [];
    for await (const e of connectRunStream({ endpoint: "/api/agent", body: { prompt: "hi" }, fetchImpl })) {
      got.push(e);
    }
    expect(got.map((e) => e._tag)).toEqual(["TextDelta", "TextDelta", "StreamCompleted"]);
    expect((got[0] as { seq?: number }).seq).toBe(1);
  });

  test("reconnects from cursor after mid-stream drop", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    let call = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      call += 1;
      if (call === 1) {
        // first connection drops after 2 events
        return okResponse(
          sse(
            [
              { seq: 1, event: { _tag: "TextDelta", text: "a" } },
              { seq: 2, event: { _tag: "TextDelta", text: "b" } },
              { seq: 3, event: { _tag: "StreamCompleted", output: "ab", metadata: {} } },
            ],
            { dropAfter: 2 },
          ),
        );
      }
      // reconnect: server replays from cursor
      return okResponse(
        sse([{ seq: 3, event: { _tag: "StreamCompleted", output: "ab", metadata: {}, runId: "r1" } }]),
      );
    };
    const got: UiStreamEvent[] = [];
    for await (const e of connectRunStream({
      endpoint: "/api/agent",
      body: { prompt: "x" },
      attach: { runId: "r1" }, // enables reconnect target
      fetchImpl,
      retryDelayMs: 1,
    })) {
      got.push(e);
    }
    expect(got.map((e) => e._tag)).toEqual(["TextDelta", "TextDelta", "StreamCompleted"]);
    expect(calls.length).toBe(2);
    expect(calls[1]!.url).toContain("cursor=2");
    expect(calls[1]!.method).toBe("GET");
  });

  test("gives up after maxRetries and yields StreamError", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("refused");
    };
    const got: UiStreamEvent[] = [];
    for await (const e of connectRunStream({
      endpoint: "/api/agent",
      attach: { runId: "r9" },
      fetchImpl,
      maxRetries: 2,
      retryDelayMs: 1,
    })) {
      got.push(e);
    }
    expect(got.at(-1)?._tag).toBe("StreamError");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui-core/tests/connect.test.ts --timeout 15000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `connect.ts`**

```ts
// packages/ui-core/src/stream/connect.ts
import {
  isTerminalEvent,
  parseUiStreamEvent,
  type SeqStamped,
  type UiStreamEvent,
} from "../protocol/events.js";

export interface ConnectOptions {
  readonly endpoint: string;
  readonly body?: Record<string, unknown>;
  readonly attach?: { readonly runId: string; readonly cursor?: number };
  readonly fetchImpl?: typeof fetch;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const attachUrl = (endpoint: string, runId: string, cursor: number | undefined): string => {
  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  const q = cursor !== undefined ? `?cursor=${cursor}` : "";
  return `${base}/${encodeURIComponent(runId)}${q}`;
};

async function* readSse(
  res: Response,
): AsyncGenerator<SeqStamped<UiStreamEvent>> {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingSeq: number | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("id: ")) {
        const n = Number(line.slice(4).trim());
        pendingSeq = Number.isFinite(n) ? n : undefined;
        continue;
      }
      if (!line.startsWith("data: ")) continue;
      const event = parseUiStreamEvent(line.slice(6).trim());
      if (event === null) continue;
      const stamped: SeqStamped<UiStreamEvent> =
        pendingSeq !== undefined ? { ...event, seq: pendingSeq } : event;
      pendingSeq = undefined;
      yield stamped;
    }
  }
}

/**
 * Connect to an agent run stream with automatic cursor-based resume.
 * New-run mode: POST { ...body } to endpoint.
 * Attach mode (or reconnect): GET endpoint/:runId?cursor=N.
 */
export async function* connectRunStream(
  opts: ConnectOptions,
): AsyncGenerator<SeqStamped<UiStreamEvent>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.retryDelayMs ?? 500;

  let lastSeq: number | undefined = opts.attach?.cursor;
  let attempt = 0;
  let firstConnection = true;

  for (;;) {
    try {
      const res =
        firstConnection && opts.body !== undefined
          ? await fetchImpl(opts.endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(opts.body),
              signal: opts.signal,
            })
          : await fetchImpl(
              attachUrl(opts.endpoint, opts.attach?.runId ?? "", lastSeq),
              { method: "GET", signal: opts.signal },
            );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      firstConnection = false;
      attempt = 0; // successful connection resets the retry budget

      for await (const event of readSse(res)) {
        if (event.seq !== undefined) lastSeq = event.seq;
        yield event;
        if (isTerminalEvent(event)) return;
      }
      // Stream ended without a terminal event → treat as a drop.
      throw new Error("stream ended before terminal event");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        yield { _tag: "StreamCancelled", reason: "aborted", iterationsCompleted: 0 };
        return;
      }
      const canReconnect = opts.attach?.runId !== undefined && attempt < maxRetries;
      if (!canReconnect) {
        const cause = err instanceof Error ? err.message : String(err);
        yield { _tag: "StreamError", cause };
        return;
      }
      attempt += 1;
      await sleep(baseDelay * 2 ** (attempt - 1));
    }
  }
}
```

- [ ] **Step 4: Export from index** — add to `packages/ui-core/src/index.ts`:

```ts
export { connectRunStream, type ConnectOptions } from "./stream/connect.js";
```

- [ ] **Step 5: Run tests**

Run: `bun test packages/ui-core/tests/connect.test.ts --timeout 15000`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
rtk git add packages/ui-core
rtk git commit -m "feat(ui-core): resumable SSE client with cursor reconnect + backoff"
```

---

### Task 5: Run state machine — `reduceRunState`

**Files:**
- Create: `packages/ui-core/src/state/run-machine.ts`
- Modify: `packages/ui-core/src/index.ts`
- Test: `packages/ui-core/tests/run-machine.test.ts`

**Interfaces:**
- Produces (bindings in P3/P4 wrap exactly this):

```ts
interface RunState {
  readonly status: UiRunStatus;
  readonly runId?: string;
  readonly text: string;                            // accumulated TextDelta
  readonly output?: string;                         // final output
  readonly object?: unknown;                        // parse-partial derived (when objectMode)
  readonly events: readonly SeqStamped<UiStreamEvent>[];
  readonly pendingInteraction?: PendingInteractionWire;
  readonly pendingApproval?: { runId: string; gateId: string; toolName: string; args: unknown };
  readonly abstention?: { reason: string; missing?: readonly string[] };
  readonly cost?: { tokens: number; usd: number };
  readonly error?: string;
  readonly lastSeq?: number;
}
function initialRunState(): RunState;
function reduceRunState(state: RunState, event: SeqStamped<UiStreamEvent>, opts?: { objectMode?: boolean }): RunState;
```

- Consumes: protocol types (Task 2), `parsePartialObject` (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui-core/tests/run-machine.test.ts
import { describe, expect, test } from "bun:test";
import { initialRunState, reduceRunState } from "../src/state/run-machine.js";
import type { SeqStamped, UiStreamEvent } from "../src/protocol/events.js";

const feed = (events: SeqStamped<UiStreamEvent>[], objectMode = false) =>
  events.reduce((s, e) => reduceRunState(s, e, { objectMode }), initialRunState());

describe("reduceRunState", () => {
  test("accumulates text and completes", () => {
    const s = feed([
      { _tag: "TextDelta", text: "he", seq: 1 },
      { _tag: "TextDelta", text: "llo", seq: 2 },
      { _tag: "StreamCompleted", output: "hello", metadata: { cost: 0.01, tokensUsed: 42 }, runId: "r1", seq: 3 },
    ]);
    expect(s.status).toBe("completed");
    expect(s.text).toBe("hello");
    expect(s.output).toBe("hello");
    expect(s.runId).toBe("r1");
    expect(s.lastSeq).toBe(3);
    expect(s.cost).toEqual({ tokens: 42, usd: 0.01 });
  });

  test("interaction pause", () => {
    const s = feed([
      { _tag: "TextDelta", text: "thinking", seq: 1 },
      {
        _tag: "InteractionRequested",
        runId: "r1",
        interactionId: "i1",
        kind: "choice",
        prompt: "pick",
        schema: { options: ["a", "b"] },
        seq: 2,
      },
      { _tag: "RunPaused", runId: "r1", reason: "awaiting-interaction", seq: 3 },
    ]);
    expect(s.status).toBe("awaiting-interaction");
    expect(s.pendingInteraction?.interactionId).toBe("i1");
  });

  test("approval pause via ApprovalRequested", () => {
    const s = feed([
      { _tag: "ApprovalRequested", runId: "r1", gateId: "g1", toolName: "shell", args: { cmd: "rm" }, seq: 1 },
      { _tag: "RunPaused", runId: "r1", reason: "awaiting-approval", seq: 2 },
    ]);
    expect(s.status).toBe("awaiting-approval");
    expect(s.pendingApproval?.gateId).toBe("g1");
  });

  test("objectMode derives partial object from text", () => {
    const s = feed(
      [
        { _tag: "TextDelta", text: '{"name":"Ada","sco', seq: 1 },
        { _tag: "TextDelta", text: 're":9}', seq: 2 },
      ],
      true,
    );
    expect(s.object).toEqual({ name: "Ada", score: 9 });
  });

  test("abstention and error terminal states", () => {
    const a = feed([
      { _tag: "Abstained", reason: "missing tool", missing: ["db"], seq: 1 },
      { _tag: "StreamCompleted", output: "", metadata: {}, seq: 2 },
    ]);
    expect(a.abstention?.reason).toBe("missing tool");
    expect(a.status).toBe("completed");

    const e = feed([{ _tag: "StreamError", cause: "boom", seq: 1 }]);
    expect(e.status).toBe("error");
    expect(e.error).toBe("boom");
  });

  test("RunAttached restores runId and cursor", () => {
    const s = feed([
      { _tag: "RunAttached", runId: "r7", status: "awaiting-interaction", resumeCursor: 12, protocolVersion: 1, seq: 12 },
    ]);
    expect(s.runId).toBe("r7");
    expect(s.lastSeq).toBe(12);
  });

  test("LimitExceeded is a terminal error state", () => {
    const s = feed([{ _tag: "LimitExceeded", kind: "budget", seq: 1 }]);
    expect(s.status).toBe("error");
    expect(s.error).toContain("budget");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui-core/tests/run-machine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reducer**

```ts
// packages/ui-core/src/state/run-machine.ts
import { parsePartialObject } from "../parse-partial.js";
import type {
  PendingInteractionWire,
  SeqStamped,
  UiRunStatus,
  UiStreamEvent,
} from "../protocol/events.js";

export interface RunState {
  readonly status: UiRunStatus;
  readonly runId?: string;
  readonly text: string;
  readonly output?: string;
  readonly object?: unknown;
  readonly events: readonly SeqStamped<UiStreamEvent>[];
  readonly pendingInteraction?: PendingInteractionWire;
  readonly pendingApproval?: {
    readonly runId: string;
    readonly gateId: string;
    readonly toolName: string;
    readonly args: unknown;
  };
  readonly abstention?: { readonly reason: string; readonly missing?: readonly string[] };
  readonly cost?: { readonly tokens: number; readonly usd: number };
  readonly error?: string;
  readonly lastSeq?: number;
}

export const initialRunState = (): RunState => ({
  status: "idle",
  text: "",
  events: [],
});

export interface ReduceOptions {
  readonly objectMode?: boolean;
}

export const reduceRunState = (
  state: RunState,
  event: SeqStamped<UiStreamEvent>,
  opts: ReduceOptions = {},
): RunState => {
  const base: RunState = {
    ...state,
    events: [...state.events, event],
    lastSeq: event.seq ?? state.lastSeq,
  };

  switch (event._tag) {
    case "TextDelta": {
      const text = base.text + event.text;
      const object = opts.objectMode ? parsePartialObject(text) ?? base.object : base.object;
      return { ...base, status: "streaming", text, object };
    }
    case "RunAttached":
      return { ...base, runId: event.runId, status: statusFromRun(event.status) };
    case "InteractionRequested": {
      const { _tag: _drop, ...pending } = event;
      return { ...base, runId: event.runId, pendingInteraction: pending };
    }
    case "ApprovalRequested":
      return {
        ...base,
        runId: event.runId,
        pendingApproval: {
          runId: event.runId,
          gateId: event.gateId,
          toolName: event.toolName,
          args: event.args,
        },
      };
    case "RunPaused":
      return { ...base, status: event.reason };
    case "Abstained":
      return { ...base, abstention: { reason: event.reason, missing: event.missing } };
    case "CostDelta":
      return { ...base, cost: { tokens: event.tokens, usd: event.usd } };
    case "StreamCompleted": {
      const meta = event.metadata;
      const cost =
        typeof meta.tokensUsed === "number" || typeof meta.cost === "number"
          ? { tokens: meta.tokensUsed ?? 0, usd: meta.cost ?? 0 }
          : base.cost;
      // A completion that carries a pending gate is a pause, not a finish.
      if (event.pendingInteraction !== undefined) {
        return {
          ...base,
          runId: event.runId ?? base.runId,
          pendingInteraction: event.pendingInteraction,
          status: "awaiting-interaction",
          cost,
        };
      }
      if (event.pendingApproval !== undefined) {
        return {
          ...base,
          runId: event.runId ?? base.runId,
          pendingApproval: event.pendingApproval,
          status: "awaiting-approval",
          cost,
        };
      }
      return {
        ...base,
        status: "completed",
        runId: event.runId ?? base.runId,
        output: event.output,
        abstention: event.abstention ?? base.abstention,
        cost,
      };
    }
    case "StreamError":
      return { ...base, status: "error", error: event.cause };
    case "StreamCancelled":
      return { ...base, status: "cancelled" };
    case "LimitExceeded":
      return { ...base, status: "error", error: `limit exceeded: ${event.kind}` };
    default:
      // Progress/observability tags (IterationProgress, ToolCall*, Thought*,
      // Phase*, reserved tags) accumulate in events[] without a state change.
      return base.status === "idle" ? { ...base, status: "streaming" } : base;
  }
};

const statusFromRun = (runStatus: string): UiRunStatus => {
  switch (runStatus) {
    case "awaiting-interaction":
      return "awaiting-interaction";
    case "awaiting-approval":
      return "awaiting-approval";
    case "completed":
      return "completed";
    case "failed":
      return "error";
    default:
      return "streaming";
  }
};
```

- [ ] **Step 4: Export from index** — add:

```ts
export {
  initialRunState,
  reduceRunState,
  type RunState,
  type ReduceOptions,
} from "./state/run-machine.js";
```

- [ ] **Step 5: Run tests**

Run: `bun test packages/ui-core/tests/run-machine.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
rtk git add packages/ui-core
rtk git commit -m "feat(ui-core): pure run state machine consuming the wire protocol"
```

---

### Task 6: Fixture testing — `recordRunFixture` / `mockAgentEndpoint`

**Files:**
- Create: `packages/ui-core/src/testing/fixtures.ts`
- Test: `packages/ui-core/tests/fixtures.test.ts`

**Interfaces:**
- Produces (public testing API, subpath `@reactive-agents/ui-core/testing`):

```ts
interface RunFixture {
  readonly protocolVersion: number;
  readonly events: readonly SeqStamped<UiStreamEvent>[];
}
function recordRunFixture(stream: AsyncIterable<SeqStamped<UiStreamEvent>>): Promise<RunFixture>;
function fixtureToSSE(fixture: RunFixture): Response;           // replays exact SSE bytes
function mockAgentEndpoint(fixture: RunFixture): (req: Request) => Promise<Response>;
```

`mockAgentEndpoint` replays the fixture for any request — zero tokens, zero network. This same fixture format is the contract-fixture set the P4 binding parity tests consume.

- Consumes: protocol types (Task 2), `connectRunStream` (Task 4 — used in the round-trip test).

- [ ] **Step 1: Write the failing test** (round-trip is the whole point):

```ts
// packages/ui-core/tests/fixtures.test.ts
import { describe, expect, test } from "bun:test";
import { connectRunStream } from "../src/stream/connect.js";
import {
  fixtureToSSE,
  mockAgentEndpoint,
  recordRunFixture,
  type RunFixture,
} from "../src/testing/fixtures.js";
import type { SeqStamped, UiStreamEvent } from "../src/protocol/events.js";

const FIXTURE: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "TextDelta", text: "4", seq: 1 },
    { _tag: "StreamCompleted", output: "4", metadata: { cost: 0.001, tokensUsed: 10 }, runId: "r1", seq: 2 },
  ],
};

describe("fixtures", () => {
  test("mockAgentEndpoint replays fixture through connectRunStream", async () => {
    const handler = mockAgentEndpoint(FIXTURE);
    const fetchImpl: typeof fetch = async (input, init) =>
      handler(new Request(String(input), init as RequestInit));
    const got: UiStreamEvent[] = [];
    for await (const e of connectRunStream({ endpoint: "/api/agent", body: { prompt: "2+2" }, fetchImpl })) {
      got.push(e);
    }
    expect(got).toEqual(FIXTURE.events as UiStreamEvent[]);
  });

  test("recordRunFixture captures a stream verbatim", async () => {
    async function* src(): AsyncGenerator<SeqStamped<UiStreamEvent>> {
      yield { _tag: "TextDelta", text: "x", seq: 1 };
      yield { _tag: "StreamCompleted", output: "x", metadata: {}, seq: 2 };
    }
    const fixture = await recordRunFixture(src());
    expect(fixture.protocolVersion).toBe(1);
    expect(fixture.events.length).toBe(2);
  });

  test("record → replay round-trip is lossless", async () => {
    const handler = mockAgentEndpoint(FIXTURE);
    const fetchImpl: typeof fetch = async (input, init) =>
      handler(new Request(String(input), init as RequestInit));
    const rerecorded = await recordRunFixture(
      connectRunStream({ endpoint: "/x", body: {}, fetchImpl }),
    );
    expect(rerecorded.events).toEqual(FIXTURE.events);
  });

  test("fixtureToSSE emits id: lines for seq", async () => {
    const text = await fixtureToSSE(FIXTURE).text();
    expect(text).toContain("id: 1\n");
    expect(text).toContain('data: {"_tag":"TextDelta"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui-core/tests/fixtures.test.ts --timeout 15000`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement fixtures**

```ts
// packages/ui-core/src/testing/fixtures.ts
import {
  PROTOCOL_VERSION,
  type SeqStamped,
  type UiStreamEvent,
} from "../protocol/events.js";

export interface RunFixture {
  readonly protocolVersion: number;
  readonly events: readonly SeqStamped<UiStreamEvent>[];
}

/** Capture every event of a run stream into a serializable fixture. */
export const recordRunFixture = async (
  stream: AsyncIterable<SeqStamped<UiStreamEvent>>,
): Promise<RunFixture> => {
  const events: SeqStamped<UiStreamEvent>[] = [];
  for await (const e of stream) events.push(e);
  return { protocolVersion: PROTOCOL_VERSION, events };
};

/** Serialize a fixture back to the exact SSE wire format. */
export const fixtureToSSE = (fixture: RunFixture): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of fixture.events) {
        const { seq, ...rest } = event;
        if (seq !== undefined) controller.enqueue(encoder.encode(`id: ${seq}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(rest)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
};

/**
 * Fetch-compatible handler that replays a recorded fixture for ANY request.
 * Zero tokens, zero network, zero flake — drop into Vitest/Playwright/Storybook.
 */
export const mockAgentEndpoint =
  (fixture: RunFixture) =>
  async (_req: Request): Promise<Response> =>
    fixtureToSSE(fixture);
```

Note the `seq` destructure in `fixtureToSSE`: seq travels as the SSE `id:` line (matching the real server), NOT inside the JSON — that's why the round-trip test passes through `connectRunStream`'s stamping.

- [ ] **Step 4: Run tests**

Run: `bun test packages/ui-core/tests/fixtures.test.ts --timeout 15000`
Expected: PASS (4 tests).

- [ ] **Step 5: Full package check + build**

Run: `bun test packages/ui-core && cd packages/ui-core && bun run build && bun run typecheck`
Expected: all green; dist contains `index.js` + `testing/fixtures.js` + d.ts files.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/ui-core
rtk git commit -m "feat(ui-core): fixture record/replay + mockAgentEndpoint (zero-token UI tests)"
```

---

# Part 2 — Runtime server rail

### Task 7: `run_events` journal + identity columns + `run_interactions` table in RunStore

**Files:**
- Modify: `packages/runtime/src/services/run-store.ts`
- Test: `packages/runtime/tests/server/run-store-extensions.test.ts`

**Interfaces:**
- Consumes: existing `RunStore` interface + `RunStoreLive(dbPath)` (`run-store.ts:79-167`).
- Produces (later tasks call these — exact names):

```ts
// added to RunStatus union:
type RunStatus = "running" | "paused" | "awaiting-approval" | "awaiting-interaction" | "completed" | "failed";

// added to RunStore interface (all Effect.Effect<..., never> like existing methods):
appendRunEvent(runId: string, seq: number, eventJson: string): Effect<void>;
listRunEvents(runId: string, afterSeq?: number): Effect<readonly RunEventRecord[]>;   // ordered by seq ASC
nextEventSeq(runId: string): Effect<number>;                                          // max(seq)+1, starts at 1
putInteraction(r: { runId: string; interactionId: string; kind: string; schemaJson: string; prompt: string }): Effect<void>;  // status 'pending'
getPendingInteraction(runId: string): Effect<InteractionRecord | undefined>;
decideInteraction(runId: string, interactionId: string, valueJson: string): Effect<boolean>;  // pending → answered

interface RunEventRecord { readonly seq: number; readonly eventJson: string; readonly createdAt: number }
interface InteractionRecord {
  readonly runId: string; readonly interactionId: string; readonly kind: string;
  readonly schemaJson: string; readonly prompt: string;
  readonly status: "pending" | "answered"; readonly valueJson?: string;
}

// createRun gains optional identity:
createRun(r: { runId; agentId; task; configHash; userId?: string; orgId?: string }): Effect<void>;
// listRuns gains identity filter (backward-compatible overloadless signature change):
listRuns(filter?: { status?: RunStatus; userId?: string }): Effect<readonly RunRecord[]>;
// RunRecord gains: readonly userId?: string; readonly orgId?: string;
```

SQLite DDL added inside `RunStoreLive` (same `CREATE TABLE IF NOT EXISTS` style as existing, run-store.ts:178-209):

```sql
CREATE TABLE IF NOT EXISTS run_events (
  run_id TEXT NOT NULL, seq INTEGER NOT NULL, event_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS run_interactions (
  run_id TEXT NOT NULL, interaction_id TEXT NOT NULL, kind TEXT NOT NULL,
  schema_json TEXT NOT NULL, prompt TEXT NOT NULL,
  status TEXT NOT NULL, value_json TEXT,
  created_at INTEGER NOT NULL, decided_at INTEGER,
  PRIMARY KEY (run_id, interaction_id)
);
```

Identity columns on the existing `runs` table (created by old DBs without them) — guarded ALTER right after table creation:

```ts
const runsCols = db.query<{ name: string }, []>("PRAGMA table_info(runs)").all().map((c) => c.name);
if (!runsCols.includes("user_id")) db.run("ALTER TABLE runs ADD COLUMN user_id TEXT");
if (!runsCols.includes("org_id")) db.run("ALTER TABLE runs ADD COLUMN org_id TEXT");
```

(Adapt the db-handle variable name / query style to what `RunStoreLive` actually uses at run-store.ts:167-210 — same file, follow the surrounding idiom.)

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/tests/server/run-store-extensions.test.ts
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { RunStoreLive, RunStoreService } from "../../src/services/run-store.js";

const withStore = <A>(f: (store: typeof RunStoreService.Service) => Effect.Effect<A>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* RunStoreService;
      return yield* f(store);
    }).pipe(Effect.provide(RunStoreLive(":memory:"))),
  );

describe("run-store extensions", () => {
  test("event journal: append, seq, list after cursor", async () => {
    const events = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.createRun({ runId: "r1", agentId: "a", task: "t", configHash: "h" });
        const s1 = yield* store.nextEventSeq("r1");
        yield* store.appendRunEvent("r1", s1, '{"_tag":"TextDelta","text":"a"}');
        const s2 = yield* store.nextEventSeq("r1");
        yield* store.appendRunEvent("r1", s2, '{"_tag":"TextDelta","text":"b"}');
        return {
          all: yield* store.listRunEvents("r1"),
          after1: yield* store.listRunEvents("r1", 1),
        };
      }),
    );
    expect(events.all.map((e) => e.seq)).toEqual([1, 2]);
    expect(events.after1.map((e) => e.seq)).toEqual([2]);
  });

  test("identity columns: createRun with userId, listRuns filters", async () => {
    const runs = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.createRun({ runId: "u1-r", agentId: "a", task: "t", configHash: "h", userId: "u1" });
        yield* store.createRun({ runId: "u2-r", agentId: "a", task: "t", configHash: "h", userId: "u2" });
        return yield* store.listRuns({ userId: "u1" });
      }),
    );
    expect(runs.length).toBe(1);
    expect(runs[0]!.runId).toBe("u1-r");
    expect(runs[0]!.userId).toBe("u1");
  });

  test("interactions: put pending, read, decide", async () => {
    const out = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.createRun({ runId: "r2", agentId: "a", task: "t", configHash: "h" });
        yield* store.putInteraction({
          runId: "r2",
          interactionId: "i1",
          kind: "choice",
          schemaJson: '{"options":["a","b"]}',
          prompt: "pick",
        });
        const pending = yield* store.getPendingInteraction("r2");
        const decided = yield* store.decideInteraction("r2", "i1", '"a"');
        const afterDecide = yield* store.getPendingInteraction("r2");
        return { pending, decided, afterDecide };
      }),
    );
    expect(out.pending?.interactionId).toBe("i1");
    expect(out.pending?.status).toBe("pending");
    expect(out.decided).toBe(true);
    expect(out.afterDecide).toBeUndefined();
  });

  test("awaiting-interaction is a valid run status", async () => {
    const run = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.createRun({ runId: "r3", agentId: "a", task: "t", configHash: "h" });
        yield* store.setStatus("r3", "awaiting-interaction");
        return yield* store.getRun("r3");
      }),
    );
    expect(run?.status).toBe("awaiting-interaction");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/runtime/tests/server/run-store-extensions.test.ts --timeout 15000`
Expected: FAIL — `appendRunEvent` not a function / type errors.

- [ ] **Step 3: Implement** — in `run-store.ts`: extend `RunStatus`, `RunRecord` (+`userId?`, `orgId?`), the `RunStore` interface, the DDL block, the guarded ALTERs, and the `RunStoreLive` method implementations. Follow the exact idiom of the neighbouring methods (`putApproval`/`decideApproval` at the bottom of the Live implementation are the closest models — same `Effect.sync` + prepared-statement style). `nextEventSeq` = `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM run_events WHERE run_id = ?`. `decideInteraction` returns `res.changes > 0` like `decideApproval`. `listRuns` adds `AND user_id = ?` when the filter is present.

- [ ] **Step 4: Run new + existing store tests**

Run: `bun test packages/runtime/tests/server/run-store-extensions.test.ts --timeout 15000 && bun test packages/runtime --timeout 30000`
Expected: new tests PASS; zero regressions in the existing runtime suite.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/runtime/src/services/run-store.ts packages/runtime/tests/server/run-store-extensions.test.ts
rtk git commit -m "feat(runtime): run_events journal, run_interactions table, identity columns on runs"
```

---

### Task 8: `request_user_input` tool definition + kernel meta-tool flag

**Files:**
- Create: `packages/tools/src/skills/request-user-input.ts`
- Modify: `packages/tools/src/index.ts` (export it — find where `finalAnswerTool` is exported and mirror)
- Modify: `packages/reasoning/src/types/kernel-meta-tools.ts`
- Test: `packages/tools/tests/request-user-input.test.ts` (or the tools package's existing test dir convention — check `ls packages/tools/tests` first and follow it)

**Interfaces:**
- Consumes: `ToolDefinition` type as used by `packages/tools/src/skills/final-answer.ts:6`.
- Produces:
  - `requestUserInputTool: ToolDefinition` with name `"request_user_input"`, exported from `@reactive-agents/tools`
  - `REQUEST_USER_INPUT_TOOL_NAME = "request_user_input"` const
  - `KernelMetaToolsSchema` gains `userInteraction: Schema.optional(Schema.Boolean)`

Tool input schema (what the model must supply):

```
kind:   "form" | "choice" | "confirmation"   (required)
prompt: string                                (required — what to ask the user)
schema: object                                (required — kind-specific:
         form   → { fields: [{ name, label, type: "text"|"number"|"boolean", required? }] }
         choice → { options: string[] }
         confirmation → {} )
```

- [ ] **Step 1: Read the model file**

Run: `cat packages/tools/src/skills/final-answer.ts` — copy its exact `ToolDefinition` structure (schema style, description conventions, execute stub pattern). Meta-tools like `final_answer` are intercepted by the kernel and never executed as normal tools; mirror whatever `final-answer.ts` does for its `execute`/handler field.

- [ ] **Step 2: Write the failing test**

```ts
// packages/tools/tests/request-user-input.test.ts  (adjust dir to package convention)
import { describe, expect, test } from "bun:test";
import { requestUserInputTool, REQUEST_USER_INPUT_TOOL_NAME } from "../src/skills/request-user-input.js";

describe("request_user_input tool definition", () => {
  test("name and shape", () => {
    expect(REQUEST_USER_INPUT_TOOL_NAME).toBe("request_user_input");
    expect(requestUserInputTool.name).toBe("request_user_input");
    expect(requestUserInputTool.description.length).toBeGreaterThan(20);
  });

  test("schema declares kind/prompt/schema params", () => {
    const json = JSON.stringify(requestUserInputTool);
    expect(json).toContain("kind");
    expect(json).toContain("prompt");
    expect(json).toContain("schema");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test packages/tools/tests/request-user-input.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the tool definition** — structural mirror of `final-answer.ts` with:

```ts
export const REQUEST_USER_INPUT_TOOL_NAME = "request_user_input";
```

name `request_user_input`, description:

> "Pause this run and ask the human user for input. Use ONLY when you cannot proceed without information or a decision that the user must provide (a choice between options, a confirmation, or structured form values). The run suspends durably until the user responds; their response arrives as this tool's result. Do not use it for information you can obtain with other tools."

and parameters `kind` (enum form|choice|confirmation), `prompt` (string), `schema` (object) — in whatever schema dialect `final-answer.ts` uses. Export both from the package index next to `finalAnswerTool`.

- [ ] **Step 5: Add the kernel flag** — in `packages/reasoning/src/types/kernel-meta-tools.ts` add to `KernelMetaToolsSchema` (after `abstain`):

```ts
  /** Agentic-UI: offer request_user_input — model may pause the run durably
   *  to ask the human for a form/choice/confirmation. Requires durable runs;
   *  enabled via builder .withUserInteraction(). */
  userInteraction: Schema.optional(Schema.Boolean),
```

- [ ] **Step 6: Run tests + typecheck both packages**

Run: `bun test packages/tools/tests/request-user-input.test.ts && cd packages/reasoning && bunx tsc --noEmit -p tsconfig.json && cd ../tools && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/tools packages/reasoning/src/types/kernel-meta-tools.ts
rtk git commit -m "feat(tools,reasoning): request_user_input meta-tool definition + kernel flag"
```

---

### Task 9: Kernel interaction pause — offer + intercept (mirror of approval rail)

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/reason/think.ts` (~L316-325, offering gate)
- Modify: `packages/reasoning/src/kernel/capabilities/act/act.ts` (~L220-239, intercept)
- Modify: `packages/reasoning/src/kernel/state/kernel-state.ts` (meta field)
- Test: `packages/reasoning/src/kernel/__tests__/interaction-pause.test.ts` (follow the directory convention of existing kernel tests — `rtk grep -rln "awaitingApprovalFor" packages/reasoning/src` and put the test next to the approval-pause tests if they exist)

**Interfaces:**
- Consumes: `requestUserInputTool`, `REQUEST_USER_INPUT_TOOL_NAME` (Task 8); `KernelMetaToolsConfig.userInteraction` (Task 8); existing `terminate(...)`, `transitionState(...)`, `meta.awaitingApprovalFor` pattern (act.ts:220-239 verbatim in Verified Anchors).
- Produces: kernel state `meta.awaitingInteractionFor?: { interactionId: string; kind: string; prompt: string; schemaJson: string }`; terminate reason `"awaiting-interaction"`. Runtime (Task 10) reads exactly this field name.

- [ ] **Step 1: Add the meta field** — in `kernel-state.ts`, next to wherever `awaitingApprovalFor` is declared in the meta type (find with `rtk grep -n "awaitingApprovalFor" packages/reasoning/src/kernel/state/kernel-state.ts`):

```ts
readonly awaitingInteractionFor?: {
  readonly interactionId: string;
  readonly kind: string;
  readonly prompt: string;
  readonly schemaJson: string;
};
```

- [ ] **Step 2: Write the failing test** — drive the kernel with the deterministic provider emitting a `request_user_input` tool call and assert clean termination with the meta field set. Model the test harness on the nearest existing kernel test that uses `TestLLMServiceLayer` with a `toolCall` turn (find one: `rtk grep -rln "TestLLMServiceLayer" packages/reasoning/src | head -3` — copy its setup verbatim, then change the scenario):

```ts
// packages/reasoning/src/kernel/__tests__/interaction-pause.test.ts
// (setup copied from the nearest TestLLMServiceLayer kernel test — keep its
//  layer wiring; only the scenario + assertions below are specific)
import { describe, expect, test } from "bun:test";
// ... same imports as the model test ...

describe("request_user_input pause", () => {
  test("kernel terminates with awaiting-interaction when model calls request_user_input", async () => {
    const scenario = [
      {
        toolCall: {
          name: "request_user_input",
          args: {
            kind: "choice",
            prompt: "Which shipping speed?",
            schema: { options: ["standard", "express"] },
          },
        },
      },
    ];
    // run the kernel exactly as the model test does, with
    // metaTools: { userInteraction: true } threaded into KernelInput
    const result = await runKernelWithScenario(scenario, { metaTools: { userInteraction: true } });
    expect(result.terminatedBy).toBe("awaiting-interaction");
    expect(result.state.meta.awaitingInteractionFor?.kind).toBe("choice");
    expect(result.state.meta.awaitingInteractionFor?.prompt).toBe("Which shipping speed?");
  });

  test("tool NOT offered when userInteraction flag off", async () => {
    // same scenario, metaTools: {} — the deterministic provider's tool call
    // must resolve to a normal unknown-tool path, NOT an interaction pause
    const result = await runKernelWithScenario(scenario, { metaTools: {} });
    expect(result.state.meta.awaitingInteractionFor).toBeUndefined();
  });
});
```

(`runKernelWithScenario` here stands for the model test's existing runner helper — reuse its real name. If assertions on `terminatedBy` differ in shape from the actual kernel result type, match the shape the approval-pause path produces — grep `"awaiting-approval"` in kernel tests for the exact assertion idiom.)

- [ ] **Step 3: Run to verify failure**

Run: `bun test packages/reasoning/src/kernel/__tests__/interaction-pause.test.ts --timeout 15000`
Expected: FAIL — tool not offered / no pause.

- [ ] **Step 4: Implement offering** — in `think.ts` where `augmentedToolSchemas` is assembled (L316-325), mirror the abstain line:

```ts
...(input.metaTools?.userInteraction === true ? [requestUserInputToolSchema] : []),
```

`requestUserInputToolSchema` = the schema view of `requestUserInputTool` in the same form `abstainToolSchema` takes (see how `abstain-gate.js` exports it; import from `@reactive-agents/tools` the same way `finalAnswerTool` is imported at think.ts:31-38). Unlike abstain there is NO iteration gate — the model may ask on iteration 0.

- [ ] **Step 5: Implement intercept** — in `act.ts`, directly after the approval-gating block (L220-239), same style:

```ts
const interactionCall = normalizedPendingCalls.find(
  (c) => c.name === REQUEST_USER_INPUT_TOOL_NAME,
);
if (interactionCall) {
  const args = interactionCall.arguments as {
    kind?: string;
    prompt?: string;
    schema?: unknown;
  };
  const paused = transitionState(state, {
    meta: {
      ...state.meta,
      awaitingInteractionFor: {
        interactionId: crypto.randomUUID(),
        kind: typeof args.kind === "string" ? args.kind : "confirmation",
        prompt: typeof args.prompt === "string" ? args.prompt : "",
        schemaJson: JSON.stringify(args.schema ?? {}),
      },
    },
  });
  return terminate(paused, {
    reason: "awaiting-interaction",
    deliverable: sentinelDeliverable("awaiting_interaction"),
  });
}
```

(Adapt `transitionState`/`terminate`/`sentinelDeliverable` call shapes to the exact ones in the approval block 15 lines above — they are verbatim in Verified Anchors. If `terminate`'s reason is a closed union, extend it where `"awaiting-approval"` is declared.)

- [ ] **Step 6: Run tests**

Run: `bun test packages/reasoning/src/kernel/__tests__/interaction-pause.test.ts --timeout 15000 && bun test packages/reasoning --timeout 60000`
Expected: new tests PASS; full reasoning suite green (no approval-path regressions).

- [ ] **Step 7: Commit**

```bash
rtk git add packages/reasoning
rtk git commit -m "feat(reasoning): request_user_input kernel pause — offer gate + act intercept"
```

---

### Task 10: Durable interaction persistence + `respondToInteraction` resume

**Files:**
- Modify: `packages/runtime/src/engine/durable-resume.ts` (add `persistInteractionPauseAt`, `decideInteractionRecord`, `getPendingInteractionAt`)
- Modify: `packages/runtime/src/engine/execute-stream.ts` (persist pause; extend `StreamCompleted` emission)
- Modify: `packages/runtime/src/stream-types.ts` (add `pendingInteraction?`, `abstention?` to `StreamCompleted` — additive)
- Modify: `packages/runtime/src/reactive-agent.ts` (add `respondToInteraction`, `listPendingInteractions`, `getDurableInfo`; extend `runDurable` resume decision)
- Test: `packages/runtime/tests/server/interaction-rail.test.ts`

**Interfaces:**
- Consumes: Task 7 store methods; Task 9 `meta.awaitingInteractionFor` + terminate reason; existing approval rail as the structural template (`persistApprovalPauseAt` durable-resume.ts:161, `decideAndResumeRun` reactive-agent.ts:896-935, decision application runner.ts:418-435).
- Produces (endpoints in Task 12 call exactly these):

```ts
// ReactiveAgent public methods:
respondToInteraction(runId: string, interactionId: string, value: unknown): Promise<AgentResult>;
listPendingInteractions(): Promise<readonly {
  runId: string; interactionId: string; kind: string; prompt: string; schema: unknown; task: string; updatedAt: number;
}[]>;
getDurableInfo(): { dbPath: string; agentId: string } | undefined;   // undefined when .withDurableRuns() not configured

// stream-types.ts StreamCompleted additions (additive, optional):
pendingInteraction?: { runId: string; interactionId: string; kind: string; prompt: string; schema: unknown };
abstention?: { reason: string; missing?: readonly string[] };
```

Resume semantics: `respondToInteraction` decides the interaction record, reloads the checkpoint, and re-drives via the same `runDurable({resume})` path approvals use, with the resume decision carrying `{ interactionId, valueJson }`; the runner injects `valueJson` as the observation/tool-result of the pending `request_user_input` call (exactly how an approved tool's decision is applied at runner.ts:418-435 — extend that application site to handle the interaction variant).

- [ ] **Step 1: Read the approval rail end-to-end** (30 minutes well spent — you are cloning it):

Run: `sed -n '880,940p' packages/runtime/src/reactive-agent.ts && sed -n '150,200p' packages/runtime/src/engine/durable-resume.ts && sed -n '240,300p' packages/runtime/src/engine/execute-stream.ts && sed -n '400,450p' packages/reasoning/src/kernel/loop/runner.ts`

- [ ] **Step 2: Write the failing test** — full rail: run pauses on interaction → row persisted → respond → run completes with the value visible to the model. Use the deterministic provider: turn 1 = `request_user_input` tool call; turn 2 (after resume) = final answer echoing the injected value:

```ts
// packages/runtime/tests/server/interaction-rail.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgentBuilder } from "../../src/builder.js";

const durableDir = () => mkdtempSync(join(tmpdir(), "ra-interaction-"));

const buildAgent = (dir: string) =>
  new ReactiveAgentBuilder("interaction-e2e")
    .withProvider("test")
    .withTestScenario([
      {
        toolCall: {
          name: "request_user_input",
          args: { kind: "choice", prompt: "Which option?", schema: { options: ["red", "blue"] } },
        },
      },
      { match: "blue", text: "You picked blue. FINAL." },
      { text: "fallback" },
    ])
    .withDurableRuns({ dir })
    .withUserInteraction()
    .build();

describe("interaction rail e2e", () => {
  test("pause → persist → respond → resume → complete", async () => {
    const dir = durableDir();
    const agent = await buildAgent(dir);

    const first = await agent.run("help me choose");
    // Run paused: not a success, interaction pending
    const pending = await agent.listPendingInteractions();
    expect(pending.length).toBe(1);
    expect(pending[0]!.kind).toBe("choice");
    expect(pending[0]!.prompt).toBe("Which option?");

    const result = await agent.respondToInteraction(pending[0]!.runId, pending[0]!.interactionId, "blue");
    expect(result.success).toBe(true);
    expect(result.output).toContain("blue");

    const stillPending = await agent.listPendingInteractions();
    expect(stillPending.length).toBe(0);
  });

  test("getDurableInfo exposes dbPath when durable configured", async () => {
    const dir = durableDir();
    const agent = await buildAgent(dir);
    const info = agent.getDurableInfo();
    expect(info?.dbPath).toContain(dir);
  });
});
```

NOTE on `.withTestScenario` + `.withUserInteraction()`: `.withUserInteraction()` does not exist until Task 11. For THIS task, thread the flag the low-level way the builder threads metaTools (`withMetaTools({ /* existing */ })` extended, or a direct config field) — implement whichever is smallest, then Task 11 adds the public sugar and this test switches to it. If wiring order becomes a fight, implement Task 11's builder method as part of this task and fold Task 11's steps in — note it in the commit message. Also verify the exact builder-scenario API name: `rtk grep -rn "withTestScenario" packages/runtime/src/builder.ts | head -2` (memory says it exists and forces provider=test).

- [ ] **Step 3: Run to verify failure**

Run: `bun test packages/runtime/tests/server/interaction-rail.test.ts --timeout 20000`
Expected: FAIL.

- [ ] **Step 4: Implement, cloning the approval rail piece by piece**

1. `durable-resume.ts`: add — signatures mirroring `persistApprovalPauseAt` (L161) / `decideApprovalRecord` (L105) / `getPendingApprovalAt` (L124):

```ts
export const persistInteractionPauseAt = (args: {
  dbPath: string; runId: string;
  interaction: { interactionId: string; kind: string; prompt: string; schemaJson: string };
}): Effect.Effect<void> => /* setStatus 'awaiting-interaction' + putInteraction */

export const decideInteractionRecord = (args: {
  dbPath: string; runId: string; interactionId: string; valueJson: string;
}): Effect.Effect<void, InteractionStateError> => /* decideInteraction; fail if no pending row */

export const getPendingInteractionAt = (args: {
  dbPath: string; runId: string;
}): Effect.Effect<InteractionRecord | undefined>
```

Add `InteractionStateError` next to `ApprovalStateError` (same tagged-error idiom).

2. `stream-types.ts`: add the two optional fields to `StreamCompleted` (shapes in Interfaces above).

3. `execute-stream.ts`: after the existing `awaitingApprovalFor` detection block (L246-289), add the mirror: when the terminal state carries `meta.awaitingInteractionFor`, call `persistInteractionPause` (local sibling of `persistApprovalPause` L40-62) and emit `StreamCompleted` with `pendingInteraction` populated (schema parsed from `schemaJson`).

4. `reactive-agent.ts`:
   - `getDurableInfo()` — expose `this._durableResume` dir + agentId as `{ dbPath: join(dir, "runs.db"), agentId }`, `undefined` when not configured (match how `runDurable`/`listRuns` compute the db path — grep `runs.db` in the file and reuse).
   - `listPendingInteractions()` — clone `listPendingApprovals` (L941): `listDurableRuns(status:'awaiting-interaction')` + `getPendingInteractionAt` per run; parse `schemaJson` to `schema`.
   - `respondToInteraction(runId, interactionId, value)` — clone `decideAndResumeRun` (L896-935): `decideInteractionRecord` → `loadResumePayload` → `this.runDurable({ ..., resume: { stateJson, interaction: { interactionId, valueJson: JSON.stringify(value) } } })`.
   - Extend `runDurable`'s resume option type with the `interaction` variant alongside `decision`.

5. Decision application: find where the approval `decision` reaches the kernel (`reasoning-think.ts:232` seeds `ApprovalDecisionRef` → `runner.ts:418-435` applies). Add the interaction variant on the same path: when resume carries `interaction`, the runner resolves the pending `request_user_input` call with observation `The user responded: <valueJson>` and clears `meta.awaitingInteractionFor`. Clone the approval-decision application block; the only semantic difference is the observation payload (approvals re-run/skip the gated tool; interactions ALWAYS just inject the value as the tool result).

- [ ] **Step 5: Run tests**

Run: `bun test packages/runtime/tests/server/interaction-rail.test.ts --timeout 20000 && bun test packages/runtime --timeout 60000 && bun test packages/reasoning --timeout 60000`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/runtime packages/reasoning
rtk git commit -m "feat(runtime): durable interaction rail — persist pause, respondToInteraction resume"
```

---

### Task 11: `.withUserInteraction()` builder method + validation

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Test: `packages/runtime/tests/server/with-user-interaction.test.ts`

**Interfaces:**
- Produces: `withUserInteraction(): this` on `ReactiveAgentBuilder` — sets kernel metaTools `userInteraction: true`; `build()` fails with a clear error when durable runs are not configured (mirror of the approval-detach validation at builder.ts:2186-2195).
- Consumes: Task 8 kernel flag; Task 10 rail.

- [ ] **Step 1: Write the failing test**

```ts
// packages/runtime/tests/server/with-user-interaction.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgentBuilder } from "../../src/builder.js";

describe(".withUserInteraction()", () => {
  test("build() fails without durable runs", async () => {
    await expect(
      new ReactiveAgentBuilder("no-durable").withProvider("test").withUserInteraction().build(),
    ).rejects.toThrow(/durable/i);
  });

  test("build() succeeds with durable runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-wui-"));
    const agent = await new ReactiveAgentBuilder("with-durable")
      .withProvider("test")
      .withDurableRuns({ dir })
      .withUserInteraction()
      .build();
    expect(agent).toBeDefined();
  });
});
```

(If `build()` in the current builder is sync-throwing rather than promise-rejecting for validation errors, match the idiom of the approval-detach validation test — grep for a test asserting the builder.ts:2186-2195 error.)

- [ ] **Step 2: Run to verify failure** — `bun test packages/runtime/tests/server/with-user-interaction.test.ts --timeout 15000`. Expected: FAIL (method missing).

- [ ] **Step 3: Implement** — inline-field recipe (builder.ts:1837 model):

```ts
/** Enable agent-initiated user interaction: the model may call
 *  request_user_input to pause the run durably and ask the human for a
 *  form / choice / confirmation. Requires .withDurableRuns(). */
withUserInteraction(): this {
  this._userInteraction = true;
  return this;
}
```

Private field `private _userInteraction = false` near L395. In `build()` validation (next to the approval-detach check at 2186-2195):

```ts
if (this._userInteraction && !this._durableRuns) {
  throw new BuildValidationError(
    ".withUserInteraction() requires .withDurableRuns() — interaction pauses persist to the durable store.",
  );
}
```

(Use the same error class/mechanism that block uses.) Thread the flag into the resolved metaTools config where `_metaTools` is folded into the kernel payload (grep `userInteraction` will show the kernel-side field from Task 8; find the runtime fold point with `rtk grep -n "abstain" packages/runtime/src/builder/build-effect/runtime-construction.ts` and mirror).

Then update Task 10's test to use `.withUserInteraction()` if it used the low-level wiring.

- [ ] **Step 4: Run tests** — `bun test packages/runtime/tests/server --timeout 30000`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/runtime
rtk git commit -m "feat(runtime): .withUserInteraction() builder method with durable-runs validation"
```

---

### Task 12: Endpoint guards — `createEndpointGuards` (wallet protection)

**Files:**
- Create: `packages/runtime/src/server/guards.ts`
- Test: `packages/runtime/tests/server/guards.test.ts`

**Interfaces:**
- Produces (Task 13 consumes):

```ts
export interface EndpointLimits {
  readonly rateLimit?: { requests: number; window: Window };          // per identity (or IP-less anonymous bucket)
  readonly anonymous?: { runs: number; window: Window };              // null-identity runs
  readonly maxConcurrentRunsPerUser?: number;
  readonly budgetPerUser?: { usd: number; window: Window };
}
export type Window = "1m" | "1h" | "1d";
export type GuardDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly kind: "rateLimit" | "budget" | "concurrency" | "anonymous"; readonly retryAfterMs?: number };
export interface EndpointGuards {
  checkRunStart(userId: string | null): GuardDecision;
  onRunStart(userId: string | null): void;      // increments counters + concurrency
  onRunEnd(userId: string | null, costUsd: number): void;  // decrements concurrency, records spend
}
export function createEndpointGuards(limits: EndpointLimits, clock?: () => number): EndpointGuards;
export const DEFAULT_LIMITS: EndpointLimits; // rate 20/1m, anonymous 3/1h, concurrency 2, budget 0.50/1d
```

In-memory sliding-window counters per process (documented limitation: multi-instance deployments need a shared store — out of scope v1, note in JSDoc). `clock` injectable for tests. Plain TS module (no Effect needed — it's synchronous counter math), but keep it internal to runtime.

- [ ] **Step 1: Write the failing test** (killswitch-honesty rule: drive REAL state through the REAL fire path — no mocking the guard internals):

```ts
// packages/runtime/tests/server/guards.test.ts
import { describe, expect, test } from "bun:test";
import { createEndpointGuards, DEFAULT_LIMITS } from "../../src/server/guards.js";

describe("endpoint guards", () => {
  test("rate limit fires after N requests in window and resets after window", () => {
    let now = 0;
    const g = createEndpointGuards({ rateLimit: { requests: 2, window: "1m" } }, () => now);
    expect(g.checkRunStart("u1").allowed).toBe(true);
    g.onRunStart("u1");
    expect(g.checkRunStart("u1").allowed).toBe(true);
    g.onRunStart("u1");
    const third = g.checkRunStart("u1");
    expect(third.allowed).toBe(false);
    if (!third.allowed) expect(third.kind).toBe("rateLimit");
    now += 61_000;
    expect(g.checkRunStart("u1").allowed).toBe(true);
  });

  test("anonymous cap independent of identified users", () => {
    let now = 0;
    const g = createEndpointGuards({ anonymous: { runs: 1, window: "1h" } }, () => now);
    g.onRunStart(null);
    const second = g.checkRunStart(null);
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.kind).toBe("anonymous");
    expect(g.checkRunStart("u1").allowed).toBe(true);
  });

  test("concurrency releases on run end", () => {
    const g = createEndpointGuards({ maxConcurrentRunsPerUser: 1 }, () => 0);
    g.onRunStart("u1");
    expect(g.checkRunStart("u1").allowed).toBe(false);
    g.onRunEnd("u1", 0);
    expect(g.checkRunStart("u1").allowed).toBe(true);
  });

  test("budget accumulates recorded spend and blocks over cap", () => {
    let now = 0;
    const g = createEndpointGuards({ budgetPerUser: { usd: 0.1, window: "1d" } }, () => now);
    g.onRunStart("u1");
    g.onRunEnd("u1", 0.09);
    expect(g.checkRunStart("u1").allowed).toBe(true);
    g.onRunStart("u1");
    g.onRunEnd("u1", 0.02); // total 0.11 > 0.10
    const blocked = g.checkRunStart("u1");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.kind).toBe("budget");
    now += 24 * 60 * 60 * 1000 + 1;
    expect(g.checkRunStart("u1").allowed).toBe(true);
  });

  test("DEFAULT_LIMITS shape", () => {
    expect(DEFAULT_LIMITS.rateLimit).toEqual({ requests: 20, window: "1m" });
    expect(DEFAULT_LIMITS.anonymous).toEqual({ runs: 3, window: "1h" });
    expect(DEFAULT_LIMITS.maxConcurrentRunsPerUser).toBe(2);
    expect(DEFAULT_LIMITS.budgetPerUser).toEqual({ usd: 0.5, window: "1d" });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun test packages/runtime/tests/server/guards.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — sliding-window = per-key array of timestamps pruned on read; spend = per-key array of `{at, usd}` pruned on read; concurrency = per-key counter. ~120 LOC, zero deps:

```ts
// packages/runtime/src/server/guards.ts
/**
 * In-memory wallet/abuse guards for public agent endpoints.
 * LIMITATION (documented, v1): counters are per-process. Multi-instance
 * deployments need a shared store — planned, not built (see gap log).
 */
export type Window = "1m" | "1h" | "1d";
const WINDOW_MS: Record<Window, number> = { "1m": 60_000, "1h": 3_600_000, "1d": 86_400_000 };

export interface EndpointLimits {
  readonly rateLimit?: { readonly requests: number; readonly window: Window };
  readonly anonymous?: { readonly runs: number; readonly window: Window };
  readonly maxConcurrentRunsPerUser?: number;
  readonly budgetPerUser?: { readonly usd: number; readonly window: Window };
}

export const DEFAULT_LIMITS: EndpointLimits = {
  rateLimit: { requests: 20, window: "1m" },
  anonymous: { runs: 3, window: "1h" },
  maxConcurrentRunsPerUser: 2,
  budgetPerUser: { usd: 0.5, window: "1d" },
};

export type GuardDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly kind: "rateLimit" | "budget" | "concurrency" | "anonymous";
      readonly retryAfterMs?: number;
    };

export interface EndpointGuards {
  checkRunStart(userId: string | null): GuardDecision;
  onRunStart(userId: string | null): void;
  onRunEnd(userId: string | null, costUsd: number): void;
}

const ANON = " anonymous";

export const createEndpointGuards = (
  limits: EndpointLimits,
  clock: () => number = () => Date.now(),
): EndpointGuards => {
  const requestTimes = new Map<string, number[]>();
  const spends = new Map<string, Array<{ at: number; usd: number }>>();
  const concurrent = new Map<string, number>();

  const prune = <T extends number | { at: number }>(arr: T[], windowMs: number, now: number): T[] => {
    const cutoff = now - windowMs;
    return arr.filter((x) => (typeof x === "number" ? x : x.at) > cutoff);
  };

  return {
    checkRunStart(userId) {
      const now = clock();
      const key = userId ?? ANON;

      if (userId === null && limits.anonymous) {
        const times = prune(requestTimes.get(ANON) ?? [], WINDOW_MS[limits.anonymous.window], now);
        requestTimes.set(ANON, times);
        if (times.length >= limits.anonymous.runs) {
          return { allowed: false, kind: "anonymous", retryAfterMs: WINDOW_MS[limits.anonymous.window] };
        }
      }

      if (limits.rateLimit) {
        const times = prune(requestTimes.get(key) ?? [], WINDOW_MS[limits.rateLimit.window], now);
        requestTimes.set(key, times);
        if (times.length >= limits.rateLimit.requests) {
          return { allowed: false, kind: "rateLimit", retryAfterMs: WINDOW_MS[limits.rateLimit.window] };
        }
      }

      if (limits.maxConcurrentRunsPerUser !== undefined) {
        if ((concurrent.get(key) ?? 0) >= limits.maxConcurrentRunsPerUser) {
          return { allowed: false, kind: "concurrency" };
        }
      }

      if (limits.budgetPerUser) {
        const entries = prune(spends.get(key) ?? [], WINDOW_MS[limits.budgetPerUser.window], now);
        spends.set(key, entries);
        const total = entries.reduce((s, e) => s + e.usd, 0);
        if (total >= limits.budgetPerUser.usd) {
          return { allowed: false, kind: "budget", retryAfterMs: WINDOW_MS[limits.budgetPerUser.window] };
        }
      }

      return { allowed: true };
    },

    onRunStart(userId) {
      const now = clock();
      const key = userId ?? ANON;
      requestTimes.set(key, [...(requestTimes.get(key) ?? []), now]);
      concurrent.set(key, (concurrent.get(key) ?? 0) + 1);
    },

    onRunEnd(userId, costUsd) {
      const now = clock();
      const key = userId ?? ANON;
      concurrent.set(key, Math.max(0, (concurrent.get(key) ?? 0) - 1));
      if (costUsd > 0) spends.set(key, [...(spends.get(key) ?? []), { at: now, usd: costUsd }]);
    },
  };
};
```

Wait — the rate-limit test above increments via `onRunStart` and the anonymous check reads `requestTimes` under the ANON key: with `anonymous` configured but `rateLimit` absent, `onRunStart(null)` must still record the timestamp — it does (single `requestTimes` shared by both checks). Keep that coupling; the tests pin it.

- [ ] **Step 4: Run tests** — `bun test packages/runtime/tests/server/guards.test.ts`. Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/runtime/src/server/guards.ts packages/runtime/tests/server/guards.test.ts
rtk git commit -m "feat(runtime): endpoint wallet guards — rate/anonymous/concurrency/budget windows"
```

---### Task 13: Endpoint helpers — journaled SSE, attach, interaction, approval, inbox

**Files:**
- Create: `packages/runtime/src/server/journal.ts`
- Create: `packages/runtime/src/server/endpoints.ts`
- Modify: `packages/runtime/src/index.ts` (exports)
- Modify: `packages/runtime/package.json` (add `"@reactive-agents/ui-core": "workspace:*"` dependency — type imports only)
- Test: `packages/runtime/tests/server/endpoints.test.ts`

**Interfaces:**
- Consumes: `agent.runStream` (reactive-agent.ts:1451), `AgentStream.toSSE` idiom (agent-stream.ts:106 — we re-implement serialization to add `id:` lines), Task 7 journal methods, Task 10 `respondToInteraction`/`listPendingInteractions`/`getDurableInfo`, Task 12 guards, `approveRun`/`denyRun`/`listRuns`/`listPendingApprovals` (existing).
- Produces (public API, exported from `@reactive-agents/runtime`):

```ts
export interface IdentityResolver {
  (req: Request): Promise<{ userId: string; orgId?: string } | null>;
}
export interface AgentEndpointOptions {
  readonly identify?: IdentityResolver;
  readonly limits?: EndpointLimits | false;   // false = no guards; default DEFAULT_LIMITS
  readonly density?: "tokens" | "full";
}
export function createAgentEndpoint(agent: ReactiveAgent, opts?: AgentEndpointOptions): (req: Request) => Promise<Response>;
export function createRunAttachEndpoint(agent: ReactiveAgent): (req: Request, params: { runId: string }) => Promise<Response>;
export function createInteractionEndpoint(agent: ReactiveAgent): (req: Request) => Promise<Response>;   // POST {runId, interactionId, value}
export function createApprovalEndpoint(agent: ReactiveAgent): (req: Request) => Promise<Response>;      // GET → pending[], POST {runId, decision, reason?}
export function createInboxEndpoint(agent: ReactiveAgent, opts: { identify: IdentityResolver }): (req: Request) => Promise<Response>; // GET → runs for identity
```

Wire behavior of `createAgentEndpoint`:
1. `identify` resolves (null if absent/unresolved) → `guards.checkRunStart` → on deny, **200 SSE response containing a single `LimitExceeded` event** (bindings render it; a bare 429 JSON is also acceptable to curl users — send SSE with status 200 plus `Retry-After` header when `retryAfterMs` present).
2. Body `{ prompt: string }` (reject 400 on missing/non-string).
3. Journal: if `agent.getDurableInfo()` returns info, every emitted event is stamped `id: <seq>` and appended to `run_events` via the store; else events flow unstamped (attach/resume simply unavailable — document in JSDoc).
4. Event enrichment (in `journal.ts` `enrichAndJournal` transform): passthrough all `AgentStreamEvent`s; when `StreamCompleted` arrives with `pendingApproval` → inject `ApprovalRequested` + `RunPaused{reason:"awaiting-approval"}` before it; with `pendingInteraction` → inject `InteractionRequested` + `RunPaused{reason:"awaiting-interaction"}`; always inject a final `CostDelta{tokens: metadata.tokensUsed ?? 0, usd: metadata.cost ?? 0}` before `StreamCompleted`. (Live per-iteration CostDelta needs an EventBus→stream bridge the runtime doesn't expose — **log as GAP entry**, emit final-only in v1.)
5. `guards.onRunStart` before streaming; `guards.onRunEnd(userId, metadata.cost ?? 0)` when `StreamCompleted`/`StreamError` observed.

`createRunAttachEndpoint`: GET with `?cursor=N` → replay journal events `afterSeq=N` as SSE (with `id:` lines), prefixed by `RunAttached{runId, status: run.status, resumeCursor: lastSeq, protocolVersion: 1}`; if run status is `running`, poll the journal every 500ms and stream new rows until a terminal event lands (v1 cross-request live-tail; same-process pub/sub is a logged GAP).

- [ ] **Step 1: Write the failing test** — in-process, real agent on `test` provider + durable dir, calling the handlers as plain functions:

```ts
// packages/runtime/tests/server/endpoints.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgentBuilder } from "../../src/builder.js";
import {
  createAgentEndpoint,
  createInboxEndpoint,
  createInteractionEndpoint,
  createRunAttachEndpoint,
} from "../../src/server/endpoints.js";

const sseEvents = async (res: Response): Promise<Array<{ seq?: number; e: { _tag: string } & Record<string, unknown> }>> => {
  const text = await res.text();
  const out: Array<{ seq?: number; e: { _tag: string } & Record<string, unknown> }> = [];
  let seq: number | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("id: ")) seq = Number(line.slice(4));
    if (line.startsWith("data: ")) {
      out.push({ seq, e: JSON.parse(line.slice(6)) });
      seq = undefined;
    }
  }
  return out;
};

const durableAgent = async (dir: string) =>
  new ReactiveAgentBuilder("endpoint-e2e")
    .withProvider("test")
    .withTestScenario([{ text: "hello from agent" }])
    .withDurableRuns({ dir })
    .build();

describe("endpoint helpers", () => {
  test("createAgentEndpoint streams journaled SSE with seq ids and CostDelta", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-"));
    const agent = await durableAgent(dir);
    const handler = createAgentEndpoint(agent, { limits: false });
    const res = await handler(
      new Request("http://x/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      }),
    );
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const events = await sseEvents(res);
    const tags = events.map((x) => x.e._tag);
    expect(tags).toContain("TextDelta");
    expect(tags).toContain("CostDelta");
    expect(tags.at(-1)).toBe("StreamCompleted");
    expect(events[0]!.seq).toBe(1);
    // seq strictly increasing
    const seqs = events.map((x) => x.seq).filter((s): s is number => s !== undefined);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  test("attach endpoint replays from cursor with RunAttached head", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-"));
    const agent = await durableAgent(dir);
    const run = await createAgentEndpoint(agent, { limits: false })(
      new Request("http://x/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      }),
    );
    const all = await sseEvents(run);
    const runId = (all.at(-1)!.e as { runId?: string }).runId;
    expect(runId).toBeDefined();

    const attach = createRunAttachEndpoint(agent);
    const res = await attach(new Request(`http://x/api/agent/${runId}?cursor=1`), { runId: runId! });
    const replayed = await sseEvents(res);
    expect(replayed[0]!.e._tag).toBe("RunAttached");
    expect((replayed[0]!.e as { resumeCursor: number }).resumeCursor).toBeGreaterThanOrEqual(1);
    // no event with seq <= cursor replayed
    const seqs = replayed.slice(1).map((x) => x.seq).filter((s): s is number => s !== undefined);
    expect(seqs.every((s) => s > 1)).toBe(true);
  });

  test("guards deny → single LimitExceeded event", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-"));
    const agent = await durableAgent(dir);
    const handler = createAgentEndpoint(agent, {
      limits: { anonymous: { runs: 0, window: "1h" } },
    });
    const res = await handler(
      new Request("http://x/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      }),
    );
    const events = await sseEvents(res);
    expect(events.length).toBe(1);
    expect(events[0]!.e._tag).toBe("LimitExceeded");
    expect((events[0]!.e as { kind: string }).kind).toBe("anonymous");
  });

  test("inbox lists runs for resolved identity only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-"));
    const agent = await durableAgent(dir);
    const asUser = (userId: string) => async () => ({ userId });
    // run one task as u1
    await (await createAgentEndpoint(agent, { limits: false, identify: asUser("u1") })(
      new Request("http://x/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      }),
    )).text();
    const inbox = createInboxEndpoint(agent, { identify: asUser("u1") });
    const res = await inbox(new Request("http://x/api/inbox"));
    const runs = (await res.json()) as Array<{ runId: string; status: string }>;
    expect(runs.length).toBe(1);

    const other = createInboxEndpoint(agent, { identify: asUser("u2") });
    const emptyRuns = (await (await other(new Request("http://x/api/inbox"))).json()) as unknown[];
    expect(emptyRuns.length).toBe(0);
  });

  test("interaction endpoint answers a pending interaction", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-ep-"));
    const agent = await new ReactiveAgentBuilder("endpoint-interaction")
      .withProvider("test")
      .withTestScenario([
        { toolCall: { name: "request_user_input", args: { kind: "confirmation", prompt: "Proceed?", schema: {} } } },
        { match: "yes", text: "Confirmed. Done." },
        { text: "fallback" },
      ])
      .withDurableRuns({ dir })
      .withUserInteraction()
      .build();

    const run = await createAgentEndpoint(agent, { limits: false })(
      new Request("http://x/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "do the thing" }),
      }),
    );
    const events = await sseEvents(run);
    const ir = events.find((x) => x.e._tag === "InteractionRequested");
    expect(ir).toBeDefined();
    const { runId, interactionId } = ir!.e as { runId: string; interactionId: string };

    const respond = createInteractionEndpoint(agent);
    const res = await respond(
      new Request("http://x/api/interaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, interactionId, value: "yes" }),
      }),
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as { success: boolean; output: string };
    expect(result.success).toBe(true);
    expect(result.output).toContain("Confirmed");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun test packages/runtime/tests/server/endpoints.test.ts --timeout 30000`. Expected: FAIL.

- [ ] **Step 3: Implement `journal.ts`** — the enrich/journal/serialize transform:

```ts
// packages/runtime/src/server/journal.ts
import { Effect } from "effect";
import type { AgentStreamEvent } from "../stream-types.js";
import { RunStoreLive, RunStoreService } from "../services/run-store.js";

type WireEvent = Record<string, unknown> & { _tag: string };

/** Enrich the raw agent stream with kit protocol events (pause markers, CostDelta). */
export async function* enrichStream(
  src: AsyncIterable<AgentStreamEvent>,
): AsyncGenerator<WireEvent> {
  for await (const event of src) {
    if (event._tag === "StreamCompleted") {
      const done = event as WireEvent & {
        metadata?: { tokensUsed?: number; cost?: number };
        runId?: string;
        pendingApproval?: { runId: string; gateId: string; toolName: string; args: unknown };
        pendingInteraction?: { runId: string; interactionId: string; kind: string; prompt: string; schema: unknown };
      };
      if (done.pendingInteraction) {
        yield { _tag: "InteractionRequested", ...done.pendingInteraction };
        yield { _tag: "RunPaused", runId: done.pendingInteraction.runId, reason: "awaiting-interaction" };
      }
      if (done.pendingApproval) {
        yield { _tag: "ApprovalRequested", ...done.pendingApproval };
        yield { _tag: "RunPaused", runId: done.pendingApproval.runId, reason: "awaiting-approval" };
      }
      yield {
        _tag: "CostDelta",
        tokens: done.metadata?.tokensUsed ?? 0,
        usd: done.metadata?.cost ?? 0,
      };
      yield done;
      return;
    }
    yield event as WireEvent;
  }
}

export interface JournalHandle {
  append(event: WireEvent): Promise<number>; // returns assigned seq
  list(afterSeq: number): Promise<Array<{ seq: number; event: WireEvent }>>;
  status(): Promise<string | undefined>;
}

export const openJournal = (dbPath: string, runId: string): JournalHandle => {
  const program = <A>(f: (store: typeof RunStoreService.Service) => Effect.Effect<A>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        return yield* f(store);
      }).pipe(Effect.provide(RunStoreLive(dbPath))),
    );
  return {
    append: (event) =>
      program((store) =>
        Effect.gen(function* () {
          const seq = yield* store.nextEventSeq(runId);
          yield* store.appendRunEvent(runId, seq, JSON.stringify(event));
          return seq;
        }),
      ),
    list: async (afterSeq) => {
      const rows = await program((store) => store.listRunEvents(runId, afterSeq));
      return rows.map((r) => ({ seq: r.seq, event: JSON.parse(r.eventJson) as WireEvent }));
    },
    status: async () => (await program((store) => store.getRun(runId)))?.status,
  };
};

/** Serialize wire events to SSE, stamping id: lines when a journal assigns seqs. */
export const toJournaledSSE = (
  events: AsyncIterable<WireEvent>,
  journal: JournalHandle | undefined,
): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          if (journal) {
            const seq = await journal.append(event);
            controller.enqueue(encoder.encode(`id: ${seq}\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ _tag: "StreamError", cause })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
```

CAVEAT for the implementer: `openJournal` per-call layer construction opens the SQLite file per operation — fine for v1 tests, measurable overhead under load. If run-store idiom offers a cheaper reuse pattern (check how `durable-resume.ts` helpers open stores per call — they do the same), keep it and move on; otherwise log a GAP entry.

The `runId` needed to open the journal comes from the run itself: `runStream` events don't carry runId until `StreamCompleted` (stream-types.ts:33). **Check `_runStreamImpl`/`execute-stream.ts` for where the durable runId is computed (`hash(agentId:taskId:startMs)`, execute-stream.ts:199-241)**. If it is not exposed before streaming starts, add a small additive change: `runStream` options gain `onRunId?: (runId: string) => void` fired when the durable run row is created — that is the correct hook point (execute-stream.ts:199-241). This is exactly the kind of missing primitive the gap log wants — log it AND fix it additively.

- [ ] **Step 4: Implement `endpoints.ts`**

```ts
// packages/runtime/src/server/endpoints.ts
import type { ReactiveAgent } from "../reactive-agent.js";
import { createEndpointGuards, DEFAULT_LIMITS, type EndpointLimits } from "./guards.js";
import { enrichStream, openJournal, toJournaledSSE, type JournalHandle } from "./journal.js";

export interface IdentityResolver {
  (req: Request): Promise<{ userId: string; orgId?: string } | null>;
}

export interface AgentEndpointOptions {
  readonly identify?: IdentityResolver;
  readonly limits?: EndpointLimits | false;
  readonly density?: "tokens" | "full";
}

const sseSingle = (event: Record<string, unknown>, headers?: Record<string, string>): Response =>
  new Response(`data: ${JSON.stringify(event)}\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...headers },
  });

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

export const createAgentEndpoint = (agent: ReactiveAgent, opts: AgentEndpointOptions = {}) => {
  const guards =
    opts.limits === false ? undefined : createEndpointGuards(opts.limits ?? DEFAULT_LIMITS);

  return async (req: Request): Promise<Response> => {
    const identity = opts.identify ? await opts.identify(req) : null;
    const userId = identity?.userId ?? null;

    if (guards) {
      const decision = guards.checkRunStart(userId);
      if (!decision.allowed) {
        return sseSingle(
          { _tag: "LimitExceeded", kind: decision.kind, retryAfterMs: decision.retryAfterMs },
          decision.retryAfterMs !== undefined
            ? { "Retry-After": String(Math.ceil(decision.retryAfterMs / 1000)) }
            : undefined,
        );
      }
    }

    let body: { prompt?: unknown };
    try {
      body = (await req.json()) as { prompt?: unknown };
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }
    if (typeof body.prompt !== "string" || body.prompt.length === 0) {
      return json({ error: "body.prompt (string) is required" }, 400);
    }

    guards?.onRunStart(userId);
    const durable = agent.getDurableInfo();

    // Ordering guarantee this relies on: execute-stream creates the durable
    // run row (and thus the runId) BEFORE the first event is emitted
    // (execute-stream.ts:199-241), so onRunId fires before any event flows.
    let resolveJournal: (j: JournalHandle | undefined) => void = () => {};
    const journalReady = new Promise<JournalHandle | undefined>((resolve) => {
      resolveJournal = resolve;
    });

    const raw = agent.runStream(body.prompt, {
      density: opts.density ?? "full",
      identity: identity ?? undefined,
      onRunId:
        durable === undefined
          ? undefined
          : (runId: string) => resolveJournal(openJournal(durable.dbPath, runId)),
    });
    if (durable === undefined) resolveJournal(undefined);

    async function* guarded() {
      try {
        for await (const event of enrichStream(raw)) {
          yield event;
          if (event._tag === "StreamCompleted" || event._tag === "StreamError") {
            const cost =
              event._tag === "StreamCompleted"
                ? ((event as { metadata?: { cost?: number } }).metadata?.cost ?? 0)
                : 0;
            guards?.onRunEnd(userId, cost);
          }
        }
      } catch (err) {
        guards?.onRunEnd(userId, 0);
        throw err;
      }
    }

    // Pull the first event before awaiting the journal so onRunId has fired;
    // then serialize the full (first + rest) sequence with the journal handle.
    const iterator = guarded()[Symbol.asyncIterator]();
    const first = await iterator.next();
    const journal = await journalReady;
    async function* withFirst() {
      if (!first.done) yield first.value;
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value;
      }
    }
    return toJournaledSSE(withFirst(), journal);
  };
};
```

Implementer note: the first-event pull above is what guarantees `journalReady` has settled without racing (onRunId fires during run setup, before event 1). If `runStream` cannot accept the two new additive options (`onRunId`, `identity`) without deep surgery, STOP and re-read execute-stream.ts:199-241 — the run row creation is the single correct hook point; thread a callback from `_runStreamImpl` options to that site. Log a GAP entry either way (the framework lacked a run-handle-before-first-event primitive).

Then the remaining four helpers, which are thin:

```ts
export const createRunAttachEndpoint = (agent: ReactiveAgent) => {
  return async (req: Request, params: { runId: string }): Promise<Response> => {
    const durable = agent.getDurableInfo();
    if (!durable) return json({ error: "durable runs not configured" }, 404);
    const cursor = Number(new URL(req.url).searchParams.get("cursor") ?? "0");
    const journal = openJournal(durable.dbPath, params.runId);
    const status = await journal.status();
    if (status === undefined) return json({ error: "run not found" }, 404);

    async function* replay() {
      let last = Number.isFinite(cursor) ? cursor : 0;
      const existing = await journal.list(last);
      const head = {
        _tag: "RunAttached",
        runId: params.runId,
        status,
        resumeCursor: existing.at(-1)?.seq ?? last,
        protocolVersion: 1,
      };
      yield { seq: undefined, event: head };
      for (const row of existing) {
        last = row.seq;
        yield { seq: row.seq, event: row.event };
      }
      // live-tail while the run is still executing in some process
      while ((await journal.status()) === "running") {
        await new Promise((r) => setTimeout(r, 500));
        for (const row of await journal.list(last)) {
          last = row.seq;
          yield { seq: row.seq, event: row.event };
        }
      }
    }
    // serialize with pre-assigned seqs (no re-journaling)
    return replaySSE(replay());
  };
};

export const createInteractionEndpoint = (agent: ReactiveAgent) => {
  return async (req: Request): Promise<Response> => {
    const body = (await req.json()) as { runId?: string; interactionId?: string; value?: unknown };
    if (typeof body.runId !== "string" || typeof body.interactionId !== "string") {
      return json({ error: "runId and interactionId are required" }, 400);
    }
    const result = await agent.respondToInteraction(body.runId, body.interactionId, body.value);
    return json({ success: result.success, output: result.output, runId: body.runId });
  };
};

export const createApprovalEndpoint = (agent: ReactiveAgent) => {
  return async (req: Request): Promise<Response> => {
    if (req.method === "GET") return json(await agent.listPendingApprovals());
    const body = (await req.json()) as { runId?: string; decision?: string; reason?: string };
    if (typeof body.runId !== "string" || (body.decision !== "approve" && body.decision !== "deny")) {
      return json({ error: "runId and decision ('approve'|'deny') required" }, 400);
    }
    const result =
      body.decision === "approve"
        ? await agent.approveRun(body.runId, { reason: body.reason })
        : await agent.denyRun(body.runId, body.reason ?? "denied via endpoint");
    return json({ success: result.success, output: result.output, runId: body.runId });
  };
};

export const createInboxEndpoint = (agent: ReactiveAgent, opts: { identify: IdentityResolver }) => {
  return async (req: Request): Promise<Response> => {
    const identity = await opts.identify(req);
    if (identity === null) return json([], 200);
    const runs = await agent.listRuns({ userId: identity.userId });
    return json(
      runs.map((r) => ({ runId: r.runId, task: r.task, status: r.status, updatedAt: r.updatedAt })),
    );
  };
};
```

`replaySSE` — local serializer for pre-stamped events (no re-journaling), add it in `journal.ts`:

```ts
export const replaySSE = (
  rows: AsyncIterable<{ seq: number | undefined; event: Record<string, unknown> }>,
): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const { seq, event } of rows) {
          if (seq !== undefined) controller.enqueue(encoder.encode(`id: ${seq}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
};
```

Identity threading into `createRun` (so inbox filtering works): `runStream` gains additive option `identity?: { userId: string; orgId?: string }` threaded to `createDurableRun`'s new columns (execute-stream.ts:199-241). Same additive-option pattern as `onRunId`.

- [ ] **Step 5: Export** — add to `packages/runtime/src/index.ts`:

```ts
export {
  createAgentEndpoint,
  createRunAttachEndpoint,
  createInteractionEndpoint,
  createApprovalEndpoint,
  createInboxEndpoint,
  type AgentEndpointOptions,
  type IdentityResolver,
} from "./server/endpoints.js";
export { DEFAULT_LIMITS, type EndpointLimits, type Window as LimitWindow } from "./server/guards.js";
```

- [ ] **Step 6: Run tests**

Run: `bun test packages/runtime/tests/server --timeout 60000 && bun test packages/runtime --timeout 60000`
Expected: all server tests PASS (including the 5 endpoint tests); no regressions.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/runtime
rtk git commit -m "feat(runtime): server endpoint helpers — journaled SSE, attach, interaction, approval, inbox, guards"
```

---

### Task 14: Cross-package integration proof + protocol round-trip + build gate

**Files:**
- Test: `packages/runtime/tests/server/protocol-roundtrip.test.ts`
- Modify (if drift found): whatever the round-trip exposes

**Interfaces:**
- Consumes: everything above. This is the task that proves ui-core (client) and runtime (server) speak the same wire protocol — the seam most likely to lie.

- [ ] **Step 1: Write the round-trip test** — real agent behind `createAgentEndpoint`, consumed by `connectRunStream`, reduced by `reduceRunState`; then a mid-stream reattach via `createRunAttachEndpoint`:

```ts
// packages/runtime/tests/server/protocol-roundtrip.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  connectRunStream,
  initialRunState,
  reduceRunState,
  type RunState,
} from "@reactive-agents/ui-core";
import { recordRunFixture } from "@reactive-agents/ui-core/testing";
import { ReactiveAgentBuilder } from "../../src/builder.js";
import { createAgentEndpoint, createRunAttachEndpoint } from "../../src/server/endpoints.js";

describe("client/server protocol round-trip", () => {
  test("ui-core state machine fully consumes a real endpoint stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-rt-"));
    const agent = await new ReactiveAgentBuilder("roundtrip")
      .withProvider("test")
      .withTestScenario([{ text: "final answer text" }])
      .withDurableRuns({ dir })
      .build();
    const handler = createAgentEndpoint(agent, { limits: false });
    const fetchImpl: typeof fetch = async (input, init) =>
      handler(new Request(String(input), init as RequestInit));

    let state: RunState = initialRunState();
    for await (const e of connectRunStream({ endpoint: "/api/agent", body: { prompt: "go" }, fetchImpl })) {
      state = reduceRunState(state, e);
    }
    expect(state.status).toBe("completed");
    expect(state.output).toBe("final answer text");
    expect(state.runId).toBeDefined();
    expect(state.lastSeq).toBeGreaterThan(0);
    expect(state.cost).toBeDefined();
  });

  test("attach replay reduces to the same terminal state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-rt-"));
    const agent = await new ReactiveAgentBuilder("roundtrip2")
      .withProvider("test")
      .withTestScenario([{ text: "replayed answer" }])
      .withDurableRuns({ dir })
      .build();
    const run = createAgentEndpoint(agent, { limits: false });
    const attach = createRunAttachEndpoint(agent);

    // full run first
    let live: RunState = initialRunState();
    const liveFetch: typeof fetch = async (i, init) => run(new Request(String(i), init as RequestInit));
    for await (const e of connectRunStream({ endpoint: "/a", body: { prompt: "x" }, fetchImpl: liveFetch })) {
      live = reduceRunState(live, e);
    }

    // then replay from scratch through the attach endpoint
    const attachFetch: typeof fetch = async (input) => {
      const url = new URL(String(input), "http://x");
      const runId = url.pathname.split("/").at(-1)!;
      return attach(new Request(url), { runId: decodeURIComponent(runId) });
    };
    let replayed: RunState = initialRunState();
    for await (const e of connectRunStream({
      endpoint: "/a",
      attach: { runId: live.runId!, cursor: 0 },
      fetchImpl: attachFetch,
    })) {
      replayed = reduceRunState(replayed, e);
    }
    expect(replayed.status).toBe("completed");
    expect(replayed.output).toBe(live.output);
  });

  test("fixture recorded from real endpoint replays deterministically", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-rt-"));
    const agent = await new ReactiveAgentBuilder("roundtrip3")
      .withProvider("test")
      .withTestScenario([{ text: "fixture me" }])
      .withDurableRuns({ dir })
      .build();
    const handler = createAgentEndpoint(agent, { limits: false });
    const fetchImpl: typeof fetch = async (i, init) => handler(new Request(String(i), init as RequestInit));
    const fixture = await recordRunFixture(
      connectRunStream({ endpoint: "/a", body: { prompt: "x" }, fetchImpl }),
    );
    expect(fixture.events.at(-1)?._tag).toBe("StreamCompleted");
    expect(fixture.events.some((e) => e._tag === "CostDelta")).toBe(true);
  });
});
```

Note: this test file imports `@reactive-agents/ui-core` by package name from inside runtime — workspace resolution handles it (bun workspaces + `bun` export condition, runs from src without rebuild per repo convention).

- [ ] **Step 2: Run** — `bun test packages/runtime/tests/server/protocol-roundtrip.test.ts --timeout 30000`. Expected: PASS if Tasks 2-13 are honest; any failure here is a real protocol seam bug — fix the SOURCE (protocol/serialization), never the test.

- [ ] **Step 3: Full gates** (keyless — CI parity):

Run: `mv .env /tmp/ra-env-aside 2>/dev/null; bun test packages/ui-core packages/runtime packages/reasoning packages/tools --timeout 120000; EXIT=$?; mv /tmp/ra-env-aside .env 2>/dev/null; exit $EXIT`
Then: `bunx turbo run build --filter=@reactive-agents/ui-core --filter=@reactive-agents/runtime --filter=@reactive-agents/reasoning --filter=@reactive-agents/tools --filter=@reactive-agents/vue --filter=@reactive-agents/svelte`
And per-package `bunx tsc --noEmit` in ui-core, runtime, reasoning, tools (tsup masks tsc errors — run tsc separately, known repo lesson).
Expected: all green.

- [ ] **Step 4: Review the gap log** — `cat wiki/Research/2026-07-agentic-ui-gap-log.md`; every task that hit friction (onRunId hook, identity threading, per-iteration CostDelta, live-tail polling, per-op store opening) must have an entry. If fewer than 3 entries exist at this point, entries were skipped — reconstruct them from the commits.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/runtime wiki/Research/2026-07-agentic-ui-gap-log.md
rtk git commit -m "test(runtime): client/server protocol round-trip — ui-core consumes real endpoints"
```

---

## Completion Criteria (Part 1 + 2 done =)

1. `bun test packages/ui-core packages/runtime packages/reasoning packages/tools` green **keyless**.
2. Round-trip test proves: real agent → endpoint → SSE → `connectRunStream` → `reduceRunState` → completed state with runId/seq/cost.
3. Interaction e2e proves: model asks → run pauses durably → `respondToInteraction` → run completes with the user's value.
4. Attach endpoint replays a finished run from cursor 0 to the same terminal state.
5. Guards e2e prove: anonymous cap yields a single `LimitExceeded` SSE event.
6. vue/svelte still green with parse-partial re-exported from ui-core.
7. Gap log has ≥3 substantive entries.
8. `bunx tsc --noEmit` clean in every touched package (not just tsup).

## What follows (separate plans, after this merges)

- **P3 plan:** React binding (`useAgent({runId})`, `useInteractions`, `useTaskInbox`, `useRunCost`, `useRunSteps`) + reference components (`<AgentPrompt>`, `<ChoiceCard>`, `<ApprovalGate>`, `<TaskInbox>`, `<AgentSurface>` + registry + `uiTreeSchema()`, `<CostMeter>`, `<StepTimeline>`) + `<AgentDevtools>` overlay.
- **P4 plan:** vue/svelte hook parity driven by the shared contract fixtures (Task 6 format).
- **P5 plan:** `apps/ui-demo` flagship ops-assistant + 3 docs guides + `create-reactive-agent --template next-inbox`.
