---
type: implementation-plan
status: active
created: 2026-10-23
completed: null
authored-by: OpenCode
related: "[[../Architecture/Design-Specs/2026-10-23-canonical-chat-engine-design|canonical chat engine design]]"
---

# Canonical Chat Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract one canonical `ChatEngine` in `packages/runtime` and delegate all five chat surfaces (`agent.chat`, `agent.session`, `agent.run` history semantics, `agent.runStream` history semantics, `GatewayChatManager`) onto it, fixing the seven catalogued chat defects while adding `session.runStream()`.

**Architecture:** New `packages/runtime/src/chat/engine.ts` — a class with injected plain-async capabilities (the GatewayChatManager shape generalized). Existing pure helpers (`withHistoryBlock`, `applyHistoryWindow`, `applyHistoryWindowWithOverflow`, `formatHistoryBlock`) keep single responsibility; the engine composes them. Facades keep public signatures; buggy semantics are corrected underneath. Removal ledger in the spec governs deletion (relocation, not duplication).

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Effect-TS at host edges only (`runtime.runPromise`), Bun test runner, `SessionStoreService` from `@reactive-agents/memory`.

**Spec:** `wiki/Architecture/Design-Specs/2026-10-23-canonical-chat-engine-design.md` (the plan argues from the spec; executors read both). Ratified decisions: A1 non-breaking, A2 all five surfaces, A3 streaming included, A4 ChatEngine module, A5 elegance rule, A6 public API delta.

## Global Constraints

- Effect discipline per `CODING_STANDARDS.md`: no `any` / `as any`, no untyped returns, no `throw` in new Effect code; errors ride `packages/runtime/src/errors.ts` / `Data.TaggedError` conventions.
- Error pools may not rise: counts of `new Error(` and `instanceof *Error` in `packages/runtime/src` must not increase vs the current baseline (capture baseline before Task 1; compare after Task 8).
- Every test run is scoped and carries a timeout: `bun test <specific-file> --timeout 15000`. Full suite or other packages are NOT run per task (repo terminal rules).
- Typecheck per task: `bun run --cwd packages/runtime typecheck` (expected: clean, 0 errors).
- One concern per commit; commit messages reference the task (`feat(chat): ...` / `fix(chat): ...` / `test(chat): ...`). Never add `Co-Authored-By` trailers (commit-msg hook rejects them).
- Worktree: execute in a dedicated branch worktree created with `superpowers:using-git-worktrees`, branched from `dev`.
- Warden routing (standing team-ownership contract, root `AGENTS.md`): every task touching `packages/runtime/src/**` is executed by a subagent acting as **runtime-warden** — the scheduler passes a `MissionBrief` (per `.agents/skills/mission-brief/SKILL.md`) and consumes the `UpwardReport` (per `.agents/skills/upward-report/SKILL.md`). The parent (not the warden) runs verifiers (typecheck + scoped tests) and decides accept/re-dispatch/escalate per the dispatcher FSM. Reviewers must never be asked to re-review their own work.
- Canonical session ids: `sess_<scope>_<unique>` where scope ∈ `agent | session | gateway`. Legacy keys (`gateway-chat-<agentId>-<sender>`, `chat_<ts>`) remain readable via load fallback only. New writes always canonical.
- **Inheritance law (spec A7):** chat mechanics exist ONLY in `chat/engine.ts`. Facade changes in Tasks 5-7 must be capability wiring + delegation only — no branching chat logic, no duplicated recording/windowing/prompt assembly. Engine-optional capabilities carry engine defaults; hosts must not pin mechanic constants (window sizes, budgets) at construction unless genuinely host-specific. Verify in Task 8's census.
- Public API delta locked by spec A6: add `session.runStream()`, `agent.session()` unchanged in type, `SessionOptions.persistOnEnd` removed, `ChatOptions.maxIterations` becomes honored (was ignored). No signatures or returns change shape for existing methods.

## Review Focus

The spec implies but no single task's happy-path test covers; each line is pinned in the named task:

1. **First empty turn** on a host with no loader and no in-memory history: engine must not crash, must not emit a history block, must return a normal `ChatReply`. Pinned in Task 3.
2. **`useTools: true` on a host that injected no `runTask`:** typed rejection naming the missing capability, never a silent fallback to the direct path (silent fallback would route an agentic request out of the reasoning loop). Pinned in Task 2.
3. **Overflow handler rejects/throws:** the error propagates to the caller (the handler owns summary content; swallowing would silently discard conversation context). Pinned in Task 3.
4. **Long persisted session (>40 turns) without `onOverflow`:** prompt gets the 40-turn/8k drop-oldest window; persisted storage keeps everything; no summary turn appears. Pinned in Task 6.
5. **Legacy gateway sessions** persisted under `gateway-chat-...` keys: still loadable post-refactor, and a new save switches the key to canonical without losing the loaded turns. Pinned in Task 7.

---

### Task 1: ChatEngine module — types + direct path turn

**Files:**
- Create: `packages/runtime/src/chat/engine.ts`
- Test: `packages/runtime/tests/chat/engine-direct-turn.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `ChatReply`, `ChatOptions`, `HistoryOverflowHandler` types from `../src/chat.js`; `applyHistoryWindow` from `../src/gateway-context-formatting.js`.
- Produces (all later tasks rely on these EXACT names/shapes):

```ts
export interface ChatEngineCapabilities {
  readonly runTask?: (input: string, opts: { history: readonly ChatMessage[] }) => Promise<AgentResult>
  readonly runStreamTask?: (input: string, opts: {
    history: readonly ChatMessage[]
    density?: StreamDensity
    signal?: AbortSignal
  }) => RunHandle
  readonly complete: (params: {
    messages: readonly { role: 'user' | 'assistant'; content: string }[]
    systemPrompt: string
  }) => Promise<{ message: string; tokens?: number; cost?: number }>
  readonly publishTurn?: (turn: ChatTurnEvent) => Promise<void>
  readonly saveHistory?: (sessionId: string, messages: readonly ChatMessage[]) => Promise<void>
  readonly loadHistory?: (sessionId: string) => Promise<readonly ChatMessage[]>
  readonly systemPrompt?: (message: string) => string
  readonly contextSummary?: (message: string) => string
}
export interface ChatEngineOptions {
  readonly sessionId: string
  readonly maxWindowTurns?: number   // default 40
  readonly maxWindowChars?: number   // default 8000
  readonly onOverflow?: HistoryOverflowHandler
  readonly maxDirectTokens?: number  // default 4096
}
export interface TurnOptions extends ChatOptions {
  readonly recordUserText?: string
  readonly density?: StreamDensity
  readonly signal?: AbortSignal
}
export class ChatEngine {
  constructor(deps: ChatEngineCapabilities, options?: ChatEngineOptions)
  turn(message: string, options?: TurnOptions): Promise<ChatReply>
  history(): ChatMessage[]
  end(): Promise<void>
}
```

Type-only imports for `AgentResult`, `ChatTurnEvent` (from `@reactive-agents/core`), `StreamDensity`/`RunHandle` (from `../stream-types.js` / `../run-controller.js`) — check exact current import surface in `chat.ts`/`reactive-agent.ts` and mirror it; do NOT widen any existing export.

- [ ] **Step 1: Write the failing test**

In `packages/runtime/tests/chat/engine-direct-turn.test.ts`, build fake capabilities locally:

```ts
import { describe, it, expect } from "bun:test";
import { ChatEngine } from "../../src/chat/engine.js";
import type { ChatMessage } from "../../src/chat.js";

function makeDeps() {
  const calls: { systemPrompt: string; messages: string[] }[] = [];
  return {
    calls,
    deps: {
      complete: async ({ messages, systemPrompt }) => {
        calls.push({ systemPrompt, messages: messages.map((m) => m.content) });
        return { message: `echo:${messages[messages.length - 1]!.content}` };
      },
    },
  };
}

it("direct turn: routes to complete, applies persona + budget semantics", async () => {
  const { calls, deps } = makeDeps();
  const engine = new ChatEngine(deps, { sessionId: "sess_agent_test", maxDirectTokens: 256 });
  const reply = await engine.turn("hi there", {
    extraContext: "extra block",
  });
  expect(calls[0]!.systemPrompt).toContain("extra block");
  expect(reply.message).toBe("echo:hi there");
});

it("records both turns and exposes history() / end()", async () => {
  const { deps } = makeDeps();
  const engine = new ChatEngine(deps, { sessionId: "sess_agent_test" });
  await engine.turn("one");
  await engine.turn("two");
  const h = engine.history();
  expect(h.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  expect(h[1]!.content).toBe("echo:one");
  await engine.end();
  expect(engine.history()).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/chat/engine-direct-turn.test.ts --timeout 15000`
Expected: FAIL, module not found (`engine.js`).

- [ ] **Step 3: Implement the engine skeleton + direct path in `packages/runtime/src/chat/engine.ts`**

Direct path in `turn()`: compose system prompt as
`[systemPrompt?.(message)] + [contextSummary?.(message)] + [options.extraContext]` joined
by `---` separators (order: persona, context summary, extra context; empty parts skipped).
When no `systemPrompt` capability is wired the engine falls back to the same generic
conversational string `directChat` uses today (parity default, never a blank system prompt),
messages = `history.map(m => ({role, content}))` + current message. Truncate/derive
`maxDirectTokens` handling: pass through to the `complete` call site the way
`chat.ts:directChat` passes `budgetTokens` today (fold `directChat`'s mechanics here; the
function itself is deleted in Task 8). Recording: push user turn
(`recordUserText ?? message`) then assistant turn after the reply. `end()` clears history
and returns the save promise when `saveHistory` exists (same contract as `AgentSession.end()`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/runtime/tests/chat/engine-direct-turn.test.ts --timeout 15000`
Expected: PASS. Then `bun run --cwd packages/runtime typecheck` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/chat/engine.ts packages/runtime/tests/chat/engine-direct-turn.test.ts
git commit -m "feat(chat): ChatEngine module with types + direct-path turn (engine plan Task 1)"
```

---

### Task 2: Tool-path turn, reply assembly, publishing, capability guard

**Files:**
- Modify: `packages/runtime/src/chat/engine.ts`
- Test: `packages/runtime/tests/chat/engine-tool-turn.test.ts`

**Interfaces:**
- Consumes: Task 1's `ChatEngine`, `TurnOptions`, capability ports.
- Produces: complete `turn()` behavior — tool path (`runTask`), full reply assembly (mirror the mapping at reactive-agent.ts:1910-1934 today: `toolsUsed` from `metadata.toolCalls` with debrief fallback, `tokens`, `steps`, `cost`, `reasoningSteps`, `scratchpad`, `citationCheck`), CANONICAL rejection types, `publishTurn` invocation.

- [ ] **Step 1: Write the failing test**

`packages/runtime/tests/chat/engine-tool-turn.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { ChatEngine } from "../../src/chat/engine.js";
import type { ChatMessage } from "../../src/chat.js";

function resultStub(output: string) {
  return {
    output,
    success: true,
    taskId: "t1",
    metadata: {
      stepsCount: 2,
      tokensUsed: 42,
      toolCalls: [{ name: "file-read", arguments: {} }],
      reasoningSteps: [{ type: "thought", content: "think" }],
      scratchpad: { k: "v" },
    },
  } as unknown as Parameters<NonNullable<
    ConstructorParameters<typeof ChatEngine>[0]["runTask"]
  >>[1] extends never ? never : Awaited<ReturnType<NonNullable<ConstructorParameters<typeof ChatEngine>[0]["runTask"]>>>;
}

it("tool turn: runTask receives history; reply assembled from AgentResult", async () => {
  const seen: { input: string; history: readonly ChatMessage[] }[] = [];
  const publishCalls: unknown[] = [];
  const engine = new ChatEngine(
    {
      complete: async () => ({ message: "unused" }),
      runTask: async (input, opts) => {
        seen.push({ input, history: opts.history });
        return {
          output: "did it",
          success: true,
          taskId: "t1",
          metadata: {
            stepsCount: 2,
            tokensUsed: 42,
            toolCalls: [{ name: "file-read", arguments: {} }],
            reasoningSteps: [{ type: "thought", content: "think" }],
            scratchpad: { k: "v" },
          },
        } as never; // typed via AgentResult, not `any`
      },
      publishTurn: async (t) => publishCalls.push(t),
    },
    { sessionId: "sess_session_abc" }
  );
  await engine.turn("first", { useTools: true });
  const reply = await engine.turn("second", { useTools: true });
  expect(seen[1]!.history!.map((m) => m.content)).toEqual(["first", "did it"]);
  expect(reply.toolsUsed).toEqual(["file-read"]);
  expect(reply.steps).toBe(2);
  expect(publishCalls.length).toBe(4); // user+assistant per turn via publishTurn
});
```

(Write the stub as `AgentResult`-shaped, typed via the runtime package's own `AgentResult` type import, not `as never`/`as any` — the sketch above only shows the fields every assertion needs.)

```ts
it("useTools:true with no runTask capability is a typed rejection, not a direct fallback", async () => {
  const engine = new ChatEngine(
    { complete: async () => ({ message: "unused" }) },
    { sessionId: "sess_session_abc" }
  );
  await expect(engine.turn("do work", { useTools: true })).rejects.toThrow(/runTask/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/chat/engine-tool-turn.test.ts --timeout 15000`
Expected: FAIL (reroutes to `complete`, no typed rejection, no publishing).

- [ ] **Step 3: Implement tool path in `engine.ts`**

`turn()` with `useTools` resolving true: require `runTask` else reject with a tagged error
whose message names the missing capability (`ChatEngineCapabilityError` in
`packages/runtime/src/chat/engine-errors.ts`, `Data.TaggedError` per repo error-algebra
template). Input handed to `runTask` = `[contextSummary?.(message) ?? "", message].
filter(Boolean).join("\n\n---\n\n")` — preserving today's "Context from prior run" +
"New request" semantics WITHOUT hardcoding the string in the engine (contextSummary
capability is the composition point). Task text rendering of prior turns stays owned by
`run()`'s `withHistoryBlock` — the engine passes the raw turn list as `history`. After the
result: assemble the `ChatReply` with the exact field mapping used by `agent.chat()`'s tool
path today (fold that mapping verbatim). Record turns; publish
`{ routedVia: "react-loop", sessionId, taskId: result.taskId }` turns via `publishTurn`;
persist if present. All swallow-sites (persist/publish) use `emitErrorSwallowed` with a
site tag naming `chat/engine.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/runtime/tests/chat/engine-tool-turn.test.ts --timeout 15000`
Expected: PASS. Then `bun run --cwd packages/runtime typecheck` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/chat/engine.ts packages/runtime/src/chat/engine-errors.ts packages/runtime/tests/chat/engine-tool-turn.test.ts
git commit -m "feat(chat): engine tool-path turn + typed capability guard + publishTurn (engine plan Task 2)"
```

---

### Task 3: History resolution, persistence, windowing, overflow, canonical ids

**Files:**
- Modify: `packages/runtime/src/chat/engine.ts`
- Test: `packages/runtime/tests/chat/engine-history.test.ts`

**Interfaces:**
- Consumes: Task 1/2 engine; `applyHistoryWindow`, `applyHistoryWindowWithOverflow` from `../src/gateway-context-formatting.js`.
- Produces: `nextSessionId(scope: "agent" | "session" | "gateway", parts: string[]): string` (canonical generator, format `sess_<scope>_<...parts joined by _>`); load-once resolution; per-turn save; window caps applied; overflow splice.

- [ ] **Step 1: Write the failing test**

`packages/runtime/tests/chat/engine-history.test.ts` covers:

```ts
// 1. canonical id generator
expect(nextSessionId("agent", ["agent-1"])).toMatch(/^sess_agent_agent-1-/);
expect(nextSessionId("gateway", ["gw-agent", "sender@example"])).toMatch(/^sess_gateway_/);

// 2. first empty turn: no loadHistory (absent), no history block, normal reply
const engine = new ChatEngine(depsWithoutLoader, { sessionId: "sess_agent_x" });
const reply = await engine.turn("hello");
expect(reply.message).toContain("hello"); // normal reply, no throw

// 3. loadHistory resolves on first turn only
//    (loader spy: expect 1 call for two turns)

// 4. saveHistory invoked after every turn when present
//    (save spy: expect 2 calls after two turns; last call carries 4 messages)

// 5. window caps: 45 persisted turns + maxWindowTurns default -> exactly last 40 sent to complete/runTask
//    (runTask stub records opts.history length; loader supplies 45 turns)

// 6. onOverflow: dropped turns spliced as one synthetic assistant "Summary of earlier conversation:" turn
//    (HistoryOverflowHandler spy resolves "2 old turns summary"; assert first message content)

// 7. Review Focus #3: rejecting handler propagates
//    (onOverflow returns Promise.reject(new Error("summarizer down")) -> engine.turn rejects)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/chat/engine-history.test.ts --timeout 15000`
Expected: FAIL (no `nextSessionId`, loader unresolved, no windowing).

- [ ] **Step 3: Implement in `engine.ts`**

- `nextSessionId`: pure function, exported; unique suffix = `crypto.randomUUID()` compressed (`replace(/-/g, "").slice(0, 12)`).
- Constructor stores `sessionId`, caps, handlers. First `turn()`/`streamTurn()` with no in-memory history calls `loadHistory(sessionId)` exactly once; result seeds state. `turn()` then: resolve window (`applyHistoryWindow(history, maxWindowTurns, maxWindowChars)`), if `onOverflow` and dropped > 0 use `applyHistoryWindowWithOverflow` for the turns handed to the path call, record turns on the FULL unwindowed state, save the FULL state (`saveHistory`). Summarizer failure propagates (see Review Focus #3) — persist/publish remain the only swallow-sites.
- Windowed history is handed to `runTask` in `opts.history` (run path windows again internally on render; double-trim is a no-op and keeps `run()` standalone semantics intact).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/runtime/tests/chat/engine-history.test.ts --timeout 15000`
Expected: PASS. Then `bun run --cwd packages/runtime typecheck` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/chat/engine.ts packages/runtime/tests/chat/engine-history.test.ts
git commit -m "feat(chat): engine history resolution + windowing + overflow + canonical session ids (engine plan Task 3)"
```

---

### Task 4: streamTurn — streaming chat with recording + persistence

**Files:**
- Modify: `packages/runtime/src/chat/engine.ts`
- Test: `packages/runtime/tests/chat/engine-stream-turn.test.ts`

**Interfaces:**
- Consumes: Task 1-3 engine; `RunHandle` shape from `../src/run-controller.js`.
- Produces: `streamTurn(message: string, options?: TurnOptions): RunHandle` — yields `AgentStreamEvent` unaltered, records turns after the terminal event, persists, publishes `ChatTurn`s with `routedVia: "react-loop"`.

- [ ] **Step 1: Write the failing test**

`packages/runtime/tests/chat/engine-stream-turn.test.ts`:

```ts
// stub runStreamTask returns a generator yielding a canned event sequence:
// { _tag: "TextDelta", text: "hel" }, { _tag: "TextDelta", text: "lo" },
// { _tag: "StreamCompleted", output: "hello", taskId: "t9" }

it("streams unaltered and records the assistant turn from StreamCompleted", async () => {
  const saves: { sessionId: string; messages: ChatMessage[] }[] = [];
  const engine = new ChatEngine(
    {
      complete: async () => ({ message: "unused" }),
      runStreamTask: (_input, _opts) => makeStubHandle(),
      saveHistory: async (sessionId, messages) => { saves.push({ sessionId, messages }); },
    },
    { sessionId: "sess_session_s1" }
  );
  let text = "";
  for await (const ev of engine.streamTurn("say hi", { useTools: true })) {
    if (ev._tag === "TextDelta") text += ev.text;
  }
  expect(text).toBe("hello");
  expect(saves[0]!.messages.some((m) => m.content === "hello" && m.role === "assistant")).toBe(true);
});

it("streamTurn without runStreamTask is a typed rejection naming the capability", async () => {
  const engine = new ChatEngine({ complete: async () => ({ message: "x" }) }, { sessionId: "s" });
  expect(() => engine.streamTurn("hi")).toThrow(/runStreamTask/);
});
```

`makeStubHandle` mirrors the `RunHandle` contract: an async generator with `pause/resume/stop/terminate/status/inspect` delegating or no-oping.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/runtime/tests/chat/engine-stream-turn.test.ts --timeout 15000`
Expected: FAIL.

- [ ] **Step 3: Implement `streamTurn` in `engine.ts`**

Typed rejection (same `ChatEngineCapabilityError`) when `runStreamTask` is absent and
`useTools`-equivalent streaming was requested. Otherwise: resolve history as `turn()` does,
call `runStreamTask(message, { history, density, signal })`, return a wrapper `RunHandle`
whose generator tees the inner one event-for-event and captures the terminal
`StreamCompleted` (or `StreamError`) to record the assistant turn, then persist + publish
(both swallow-tagged). Verbs (`pause/resume/stop/terminate/status/inspect`) delegate to the
inner handle.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/runtime/tests/chat/engine-stream-turn.test.ts --timeout 15000`
Expected: PASS. Then `bun run --cwd packages/runtime typecheck` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/chat/engine.ts packages/runtime/tests/chat/engine-stream-turn.test.ts
git commit -m "feat(chat): engine streamTurn with tee'd recording + RunHandle passthrough (engine plan Task 4)"
```

---

### Task 5: Facade 1 — `agent.chat()` delegates; agent-level defects fixed

**Files:**
- Modify: `packages/runtime/src/reactive-agent.ts` (`chat()` ~1817-1935, `_chatHistory` ~386, session wiring sites)
- Modify: `packages/runtime/src/chat.ts` (only where shared impl moves; do NOT delete `directChat` yet — Task 8 owns deletions)
- Test: `packages/runtime/tests/chat/agent-chat-engine-parity.test.ts`

**Interfaces:**
- Consumes: Task 1-4 `ChatEngine`, `nextSessionId`.
- Produces: `agent.chat(message, options?, _history?, _sessionId?)` — public signature byte-identical, body delegates to a lazily-constructed agent-scoped engine (capabilities wired inside `ReactiveAgent`, Effect stays at that boundary). Equivalence pin products: task-text equality vs `run()`.

- [ ] **Step 1: Write the failing tests**

`packages/runtime/tests/chat/agent-chat-engine-parity.test.ts`:

```ts
// RED pins (must fail pre-rewire):
// 1. persona pin: agent built with withPersona({name:"Quokka", ...}); direct-path turn
//    reaches the provider with system prompt containing "Quokka" — observe via a
//    capturing LLM harness following the recording pattern in
//    tests/chat-routing-behavioral.test.ts (ProviderName "test" + prompt capture).
// 2. tool-path recording pin: agent.chat(..., {useTools: true}) then
//    agent.chat("what did you just do", {useTools:false}); the second turn's
//    messages include the FIRST turn's assistant reply (today they do not — red).
// 3. maxIterations honored: ChatOptions.maxIterations no longer ignored
//    (derive pin from the existing routing-behavioral suite's options plumbing).
// 4. equivalence: engine tool-path task text == manual run(input, {history: windowed}) task text
//    (construct both via the same test provider; compare the captured task text strings).
// 5. ChatTurn events carry canonical sess_agent_* sessionId.
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/runtime/tests/chat/agent-chat-engine-parity.test.ts --timeout 15000`
Expected: FAIL on pins 1, 2, 5 (persona absent, recording missing, legacy id).

- [ ] **Step 3: Rewire `agent.chat()` in `reactive-agent.ts`**

- Lazy agent-scoped engine: `private _defaultChatEngine?: ChatEngine`, created on first
  `chat()` with `nextSessionId("agent", [this.agentId])` and capabilities built from
  services this class already resolves (`run()` wrapper, `gatewayComplete`-backed
  `complete`, EventBus `publishTurn`, systemPrompt from the persona binding the builder
  produced, contextSummary from `buildChatSystemContext(taskContext, lastDebrief,
  observations)` closure).
- `_chatHistory` field and its accumulation blocks: REPLACED by engine state (loop the
  body down to a delegate call; keep the public 4-arg signature).
- `options.maxIterations` forwarded to the engine turn (engine forwards to `runTask`
  plumbing as `run()` options) — the "Default: 5" doc becomes true.
- All existing tests in `tests/chat.test.ts`, `tests/chat-routing-behavioral.test.ts`,
  `tests/chat-verify-citations.test.ts`, `tests/chat-history-seeds-kernel.test.ts` must
  stay green unmodified.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/runtime/tests/chat/agent-chat-engine-parity.test.ts packages/runtime/tests/chat.test.ts packages/runtime/tests/chat-routing-behavioral.test.ts packages/runtime/tests/chat-verify-citations.test.ts packages/runtime/tests/chat-history-seeds-kernel.test.ts --timeout 15000`
Expected: PASS all, zero existing-test edits. Then typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/reactive-agent.ts packages/runtime/src/chat.ts packages/runtime/tests/chat/agent-chat-engine-parity.test.ts
git commit -m "fix(chat): agent.chat delegates to ChatEngine; persona, recording, maxIterations fixed (engine plan Task 5)"
```

---

### Task 6: Facade 2 — `AgentSession` facade + `session.runStream()` + persistOnEnd removal

**Files:**
- Modify: `packages/runtime/src/chat.ts` (AgentSession class rewrite)
- Modify: `packages/runtime/src/reactive-agent.ts` (`session()` ~1966-2038)
- Modify: `packages/runtime/src/chat.ts` (SessionOptions)
- Test: `packages/runtime/tests/chat/session-engine-facade.test.ts`

**Interfaces:**
- Consumes: Task 1-4 engine; `session()` construction deps.
- Produces: `AgentSession` public methods `.chat()` / `.history()` / `.end()` unchanged; NEW `session.runStream(message: string, options?: { readonly density?: StreamDensity; readonly signal?: AbortSignal }): RunHandle` (this locks the plan's exact shape over the spec's §4 shorthand); `SessionOptions` = `{ persist?: boolean; id?: string; maxAgeDays?: number; onOverflow?: HistoryOverflowHandler }` — `persistOnEnd` deleted.

- [ ] **Step 1: Write the failing tests**

`packages/runtime/tests/chat/session-engine-facade.test.ts`:

```ts
// 1. session({persist:true, id:"custom"}) round-trips through engine save/load
//    (SQLite via memory layer — follow the wiring pattern in session-store-wiring.test.ts)
// 2. RED (Review Focus #4): seed 45 turns via persists; new session same id; ask
//    "summarize" via session.chat — provider prompt contains <= 40 turns, NO summary
//    turn; then session_history() (via .history()) still has all 45 + additions.
// 3. RED: session.runStream("task", { density: "full" }) yields StreamCompleted and
//    the turn is recorded + persisted when persist:true.
// 4. RED: SessionOptions persistOnEnd — a typecheck-level pin: a small type assertion
//    file asserting typeof of the field is never (implement as a @ts-expect-error test
//    or "exhaustive keys" assertion, following the repo's type-pin conventions).
// 5. onOverflow splicing works through session.chat (reuse engine-level semantics).
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/runtime/tests/chat/session-engine-facade.test.ts --timeout 15000 && bun run --cwd packages/runtime typecheck`
Expected: FAIL on 2, 3, 4 (persistOnEnd still present).

- [ ] **Step 3: Rewrite AgentSession as the facade**

`AgentSession` keeps its constructor visibility pattern but internally holds one
per-session `ChatEngine` — construction args map 1:1 from today's
persist/loader/onOverflow plumbing inside reactive-agent.ts `session()`. All methods
delegate. `runStream` forwards to `engine.streamTurn`. `onEnd` behavior preserved:
`end()` flushes save + clears (engine end()). Capability wiring from reactive-agent.ts
`session()` passes `saveHistory`/`loadHistory` only when `persist` — the
`sess_<ts>_<rand>` shape for default ids becomes `nextSessionId("session", [])`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/runtime/tests/chat/session-engine-facade.test.ts packages/runtime/tests/session-store-wiring.test.ts --timeout 15000`
Expected: PASS; `session-store-wiring.test.ts` untouched. Then typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/chat.ts packages/runtime/src/reactive-agent.ts packages/runtime/tests/chat/session-engine-facade.test.ts
git commit -m "feat(chat): AgentSession becomes engine facade + session.runStream + persistOnEnd removed (engine plan Task 6)"
```

---

### Task 7: Facade 3 — GatewayChatManager delegates; legacy-key fallback; golden instruction pin

**Files:**
- Modify: `packages/runtime/src/gateway-context-formatting.ts` (GatewayChatManager class only; pure helpers untouched)
- Test: `packages/runtime/tests/chat/gateway-engine-delegation.test.ts`

**Interfaces:**
- Consumes: Task 1-4 engine; existing `GatewayChatManagerDeps` (unchanged shape), `formatHistoryBlock`, `formatEpisodicContext`, `buildEnrichedInstruction`, `channelOutboundToolGuidance`.
- Produces: per-sender engines inside the manager; deps' `saveSession`/`findById` wrapped as engine capabilities; `recordUserText` for raw user content.

- [ ] **Step 1: Write the failing tests**

`packages/runtime/tests/chat/gateway-engine-delegation.test.ts`:

```ts
// GOLDEN pin: buildEnrichedInstruction output for a canned input is byte-identical to a
// captured pre-refactor string constant (capture in Step 1 BEFORE any edit, store as
// the test's const).
// RED pins:
// 1. legacy key: deps.findById returns messages for "gateway-chat-<agentId>-<sender>";
//    sendMessage through the manager resolves those turns (history reaches executeEvent).
// 2. new save writes sessionId "sess_gateway_<agentId>_<sender>" canonical.
// 3. ChatTurn publishing uses the canonical id.
// 4. raw user message (not the enriched instruction) recorded as the user turn
//    (deps.saveSession captures messages; assert messages[idx].content === raw message).
// 5. episodic block + outbound guidance still present in the instruction (unchanged).
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/runtime/tests/chat/gateway-engine-delegation.test.ts --timeout 15000`
Expected: GOLDEN passes pre-edit (capture first), RED pins 1-4 fail.

- [ ] **Step 3: Rewire the manager**

`GatewayChatManager` holds `engines: Map<senderId, ChatEngine>`; `handleMessage`
constructs/reuses the sender's engine with `nextSessionId("gateway", [agentId, sender])`,
and a `loadHistory` capability that tries canonical `findById` FIRST then the legacy
`gateway-chat-` key. The enriched instruction (unchanged builder) goes through the
engine tool path via a `runTask` capability backed by `deps.executeEvent`, with
`recordUserText: message`. Save/episode-log block stays in the manager but now persists
through the engine's save capability (`deps.saveSession`) — verbatim behavior otherwise.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/runtime/tests/chat/gateway-engine-delegation.test.ts packages/runtime/tests/gateway-chat.test.ts packages/runtime/tests/gateway-chat-mode.test.ts --timeout 15000`
Expected: PASS all golden + red pins; gateway tests untouched. Then typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/gateway-context-formatting.ts packages/runtime/tests/chat/gateway-engine-delegation.test.ts
git commit -m "feat(chat): GatewayChatManager delegates to ChatEngine; canonical ids + legacy fallback (engine plan Task 7)"
```

---

### Task 8: Removal ledger sweep + equivalences + gates

**Files:**
- Modify: `packages/runtime/src/chat.ts` (delete `directChat` etc. per ledger)
- Modify: `packages/runtime/src/reactive-agent.ts` (dead code left from Tasks 5-7)
- Modify: file-size ceiling ledger (per quality program — locate the ledger file the invariant script reads; add `chat/engine.ts` entry)
- Test: census run + existing suites

**Interfaces:**
- Consumes: all prior tasks.
- Produces: spec R1-R10 dispositions cleared; shrink-only gates green.

- [ ] **Step 1: Census and delete per ledger**

For each ledger row (spec §5): verify disposition with grep + compile, then delete:
- R1: `_chatHistory` references = 0 (`grep -rn "_chatHistory" packages/runtime/src`).
- R6: `directChat` symbol gone; its logic already folded into engine (Task 1) — delete now.
- R8/R9: caller-census every export in `chat.ts` + `engine.ts`; delete orphans with the
  evidence in the commit message.
- R10: one canonical id site + documented legacy fallback (no stray literals).
- **A7 facade-mechanics census:** inspect `agent.chat()` body, `AgentSession` methods, and
  `GatewayChatManager.handleMessage` — each must contain ONLY capability wiring + delegation.
  Any surviving branching chat logic (routing decisions, turn recording, windowing calls,
  prompt assembly outside capability wiring) is relocated into the engine before done.

- [ ] **Step 2: Run equivalences + full scoped suites + gates**

Run: `bun test packages/runtime/tests/chat packages/runtime/tests/builder-with-session-persistence.test.ts --timeout 15000`
Run (census): `grep -rn "_chatHistory\|directChat\|persistOnEnd" packages/runtime/src | wc -l` → 0
Run (gates): error-pool counts vs baseline captured in Global Constraints step 0 of
execution: `grep -c "new Error(" packages/runtime/src/**.ts` and `instanceof` count — must
be ≤ baseline. `bun run --cwd packages/runtime typecheck` — 0 errors.
Expected: PASS; ledger rows R1-R10 each have a one-line proof stored in the debrief draft.

- [ ] **Step 3: Run scoped package suite for the commit**

Run: `bun test packages/runtime --timeout 15000` (full runtime package once)
Expected: 0 new failures vs baseline (pre-existing #214 cast-ceiling excludes).

- [ ] **Step 4: Commit + file-size ledger registration**

```bash
git add packages/runtime/src packages/runtime/tests/<ledger test if any> <ceiling ledger file>
git commit -m "chore(chat): removal ledger sweep R1-R10 + engine file-size registration (engine plan Task 8)"
```

---

### Task 9: Docs, changeset, planning index

**Files:**
- Modify: `.changeset/<new>.md` (changeset)
- Modify: `apps/docs/src/content/docs/features/streaming.md`, `apps/docs/src/content/docs/features/gateway.md`, `apps/docs/src/content/docs/reference/builder-api.md`
- Modify: `AGENTS.md` chat entry points table rows if any cite removed symbols
- Modify: `wiki/Planning/Planning-Index.md` (plan row status), `wiki/Architecture/Design-Specs/2026-10-23-canonical-chat-engine-design.md` (status line)

**Interfaces:**
- Consumes: shipped API (`session.runStream`, ChatEngine exports, persistOnEnd removal).
- Produces: user-facing truth + release note ready.

- [ ] **Step 1: Changeset**

`bun run changeset` → minor bump note documenting: `session.runStream()` addition,
ChatEngine semantic fixes (persona on direct path, window-by-default, symmetric
recording, canonical session ids with legacy fallback, honored maxIterations,
configurable direct budget), `SessionOptions.persistOnEnd` removal.

- [ ] **Step 2: Docs sync**

Update the three docs pages for the new/changed surfaces; correct any old signature
(cross-check with `grep -rn "maxIterations" apps/docs/src/content/docs`); regenerate
test metrics via the metrics workflow (`bun run --cwd apps/docs metrics:sync-readme`).

- [ ] **Step 3: Wiki + index truth**

Flip plan frontmatter `status: completed` + `completed: 2026-10-23` (adjust date to actual
completion), update Planning-Index row, set the spec's status line from
"implementation plan pending" to implemented, append the debrief pointer when written.

- [ ] **Step 4: Commit**

```bash
git add .changeset apps/docs AGENTS.md wiki/Planning/Planning-Index.md wiki/Architecture/Design-Specs/2026-10-23-canonical-chat-engine-design.md
git commit -m "docs(chat): canonical chat engine docs + changeset + index truth (engine plan Task 9)"
```

---

## Post-plan (parent-side, not in tasks)

- Whole-branch review (fresh reviewer subagent, most capable model).
- Debrief file `wiki/Research/Debriefs/2026-10-23-canonical-chat-engine-debrief.md`
  recording: defect catalog → fix mapping, R1-R10 ledger proofs, actual LOC net,
  error-pool deltas, any accepted leftovers → DEBT-REGISTER.
- Merge per repo convention: worktree branch → `dev` (not `main`).
