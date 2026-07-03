# Agentic UI Kit — Svelte Binding + Cortex Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Svelte binding families over `@reactive-agents/ui-core` (Interact, Resume, Observe + converge existing stream/structured families), then wire the flagship agentic-UI features into Cortex: Interact panel (durable `request_user_input`), chat→`connectRunStream` convergence, structured-output live preview, and (scoped) cursor attach/resume.

**Architecture:** Two phases. **Phase S** extends `@reactive-agents/svelte` with `writable`-store factories (the repo's shared-store idiom — NOT runes; peer `svelte>=4`) that delegate all protocol/stream/state logic to ui-core (`connectRunStream`, `reduceRunState`), killing the hand-coded SSE duplication. **Phase X** wires those families + the runtime server endpoints into Cortex (Elysia server + SvelteKit SPA), additively where possible (new panels/routes/watchers) to minimize collision with the concurrent `worktree-cortex-dynamic-sync` Cortex work.

**Tech Stack:** Svelte 5 `.svelte` components + `svelte/store` `writable` factories, Bun test (no DOM — direct factory calls + monkey-patched `fetch` / ui-core `mockAgentEndpoint`), Elysia (Bun) server, Effect-TS on the server, `@reactive-agents/ui-core` + `@reactive-agents/runtime` (workspace).

**Specs:** `wiki/Architecture/Design-Specs/2026-07-02-agentic-ui-harness-components.md` (§4 endpoints, §5 families) + `wiki/Planning/Implementation-Plans/2026-07-02-agentic-ui-kit-cortex-showcase.md` (5 ranked ops + dynamic-sync interplay). Foundation (ui-core + runtime server rail incl. `.withUserInteraction()`, `respondToInteraction`/`listPendingInteractions`, `createRunAttachEndpoint`) is MERGED to main.

## Global Constraints

- Strict TypeScript, **NO `any` casts** — `unknown` + guards.
- **Svelte binding stays store-based** (`writable` returning `{ subscribe, ...methods }`) — peer `svelte>=4.0.0`; NO `$state` rune classes (would break Svelte-4 peers). Match the existing `agent-stream.ts` pattern verbatim.
- **Additive:** existing `@reactive-agents/svelte` exports (`createAgentStream`/`createAgent`/`createStructuredStream`/`parsePartialObject` + their state types) MUST remain importable with the same shape (rewire internals, keep surface).
- Svelte binding is browser-safe: no Effect, no Node built-ins, no `@reactive-agents/runtime` import. Consume ui-core only.
- **Cortex changes additive-first:** new files (InteractPanel, interaction-watcher, new routes/methods) over edits to shared files. The ONE unavoidable edit to an existing shared file is `chat-store.ts` (op B) — flag it; the concurrent dyn worktree also edits Cortex, so keep the diff surgical.
- All tests keyless + offline. Svelte binding tests: `bun:test`, no DOM, drive factories directly + `globalThis.fetch` monkey-patch or ui-core `mockAgentEndpoint`. Cortex server tests: `bun:test` + in-memory Elysia (`app.handle(new Request(...))`) with mocked runner Layer. Never a real provider.
- Test commands need explicit timeouts (`--timeout 15000`).
- Conventional commits, **NO AI/co-author trailer**. Prefix shell with `rtk`.
- tsup masks tsc errors — run `bunx tsc --noEmit` separately (repo lesson). Cortex server is a Node-runtime consumer → framework packages must be **built to dist** before Cortex server/UI tests (`bunx turbo run build --filter='./packages/*'`).

## Verified Anchors (from the two code maps 2026-07-03 — trust these)

**Svelte binding (`packages/svelte`):**
- Exports (index.ts): `createAgentStream`, `createAgent`, `createStructuredStream`, `parsePartialObject` + state types `AgentStreamState`/`AgentState`/`StructuredStreamState` + `AgentStreamEvent`/`AgentHookState`/`UseAgentReturn`/`UseAgentStreamReturn`.
- Pattern (verbatim, `agent-stream.ts`): `const store = writable<State>({...}); ...; return { subscribe: store.subscribe, run, cancel }`. `run(prompt, body?): Promise<void>`. `AgentStreamState = { text; events; status:"idle"|"streaming"|"completed"|"error"; error; output }`.
- `createAgent` → `{ subscribe, run }`, `run(prompt, body?): Promise<string>`, `AgentState = { output; loading; error }`.
- `createStructuredStream(endpoint, requestInit?): { subscribe; run; cancel }`, `StructuredStreamState = { object; text; status; error }`.
- Depends on `@reactive-agents/ui-core` (only imports `parsePartialObject` today). Build: shared `tsup.config.base.ts` single-entry `src/index.ts`, externalizes `@reactive-agents/*`. Single `.` export. Adding a `./testing` subpath needs an entry override in package.json's build script.
- Tests: `packages/svelte/tests/*.test.ts`, `bun:test`, NO DOM, `captureSubscribe` helper (`store.subscribe(s => states.push(s))`), monkey-patched `globalThis.fetch` with `Response` (SSE body = `data: ${JSON.stringify(ev)}\n\n`).

**ui-core surface (consume):** `connectRunStream(opts): AsyncGenerator<SeqStamped<UiStreamEvent>>` (`ConnectOptions = {endpoint; body?; attach?:{runId;cursor?}; fetchImpl?; maxRetries?; retryDelayMs?; signal?}`); `FetchLike = (input: string|URL|Request, init?) => Promise<Response>`; `initialRunState(): RunState`; `reduceRunState(state, event, opts?): RunState` (`ReduceOptions = {objectMode?}`); `RunState = {status; runId?; text; output?; object?; events; pendingInteraction?; pendingApproval?; abstention?; cost?; error?; lastSeq?}`; `PendingInteractionWire = {runId; interactionId; kind:"form"|"choice"|"confirmation"; prompt; schema}`; `UiRunStatus`. `@reactive-agents/ui-core/testing`: `recordRunFixture`, `mockAgentEndpoint`, `fixtureToSSE`, `RunFixture`.

**Cortex (`apps/cortex`):**
- `apps/cortex/ui/package.json`: depends `@reactive-agents/svelte: workspace:*`, `@reactive-agents/trace: workspace:*`. NO `@reactive-agents/ui-core`.
- `apps/cortex/package.json` (shared by server): depends `@reactive-agents/core`, `@reactive-agents/runtime` (workspace). Server test: `bun test server/tests --timeout 15000`. UI test: `bun test src/lib --timeout 15000`.
- `build-cortex-agent.ts:382-394` — durable block `if (params.durableRuns?.enabled) { ...; b = b.withDurableRuns(opts); const ap = params.durableRuns.approvalPolicy; if (ap?.tools?.length) b = b.withApprovalPolicy({tools, mode:ap.mode??"detach"}); }`. `.withOutputSchema` wired earlier (372-377). Final `b.build()` at 399. `.withUserInteraction()` inserts after line 388.
- `runs.ts` — `runsRouter(storeLayer, runnerLayer)` Elysia factory (prefix `/api/runs`). Approval routes: `.get("/pending-approvals")` (255) → `{approvals: yield* runner.listPendingApprovals()}`; `.post("/:runId/approve")` (267) → `runner.approveApproval(runId, body?.reason)` → `{ok:true}`; `.post("/:runId/deny")` (284). Handler idiom = `Effect.gen(function*(){ const runner = yield* CortexRunnerService; ... }).pipe(Effect.provide(runnerLayer))` via `Effect.runPromise` in try/catch (500 on error). `/:runId/events` (397) → `store.getRunEvents(runId)`.
- `runner-service.ts` — `CortexRunnerService` interface (143-151) has `listPendingApprovals`/`approveApproval`/`denyApproval` ONLY. Impl starts 158; approve/deny impls at 536/555. **NO interaction methods.** The service wraps the built agent (approve/deny call the agent's durable methods internally).
- `approval-watcher.ts` — `startApprovalWatcher(pollMs=2500): ()=>void`; `setInterval` (88) polls `GET ${CORTEX_SERVER_URL}/api/runs/pending-approvals` (53), dedupe `Set` keyed `approval:${runId}|${gateId}`, `toast.prompt(...)`, `decide()` POSTs `/${runId}/${action}`. Mounted `routes/+layout.svelte:11`; `ApprovalPanel.svelte` on `routes/runs/+page.svelte:431`.
- `chat-store.ts` — `sendMessageStream(message): Promise<void>` (304), POST `${CORTEX_SERVER_URL}/api/chat/sessions/${sessionId}/chat/stream` (338/340), reader `res.body?.getReader()` (373), `buffer.split("\n\n")` (403), `JSON.parse` `data: ` lines → `AgentStreamEvent` (413-418), local event-union copy **lines 21-51** (the 4th copy to kill, GH #163).
- `chat.ts:300-347` — SSE `data: ${JSON.stringify(event)}\n\n` only, **NO `id:` lines**. Runtime `AgentStreamEvent` shape.
- `RunFinalDeliverable.svelte:15-33` — already takes `structuredObject?: unknown`/`structuredError?: string|null`, renders JSON block. Mounted `RunDetail.svelte:499-506` (`structuredObject={$runStore.structuredObject}`). `outputSchema` configured per-run (`runs.ts:71-72` DTO → `build-cortex-agent.ts:372-377`). Structured result arrives via LIVE WS (`run-store.ts:246 if ("object" in msg.payload) structuredObject = msg.payload.object`).
- `run-store.ts` — `createRunStore(runId, options?)` (200), `fetchFn = options?.fetchImpl ?? globalThis.fetch` (201), history `GET ${CORTEX_SERVER_URL}/api/runs/${runId}/events` (340), WS via `ws-client.ts`.
- `CORTEX_SERVER_URL` — `constants.ts:11-14` (browser origin; SSR fallback `http://localhost:4321`). UI calls raw `fetch(\`${CORTEX_SERVER_URL}/api/...\`)`.
- Server test harness (`api-runs.test.ts:1-45`): `new Elysia().use(runsRouter(CortexStoreServiceLive(db), mockRunnerLayer))`, `Database(":memory:")` + `applySchema(db)`, runner mocked via `Layer.succeed(CortexRunnerService, {...})`. Mock objects at `api-runs.test.ts:11-22,26-39,554,585` + `config-parity.test.ts:42` need any new interface method stubbed.

## Constraints that scope the Cortex ops (from the maps)

- **Op B (chat convergence):** works — `connectRunStream`/`reduceRunState` tolerate `data:`-only SSE (events without `seq` still reduce). Chat gets no cursor-resume (no `id:` lines) but doesn't need it. Kills the 4th event-union copy.
- **Op E (structured preview):** rides op B — `reduceRunState(..., {objectMode:true})` populates `state.object` via `parsePartialObject` as text streams. On the chat path this is free once op B lands. (The WS desk path delivers only the FINAL object; partial preview there is out of scope.)
- **Op C (cursor attach/resume) — PREREQUISITE, heaviest:** Cortex serves history from its own store (`getRunEvents`), NOT the framework `run_events` journal; durable runs are opt-in; `createRunAttachEndpoint` is not wired. A TRUE kit cursor-resume requires (a) durable runs enabled for the run, (b) mounting `createRunAttachEndpoint` against the run's `runs.db`, (c) a resume affordance in `run-store`/`RunDetail` that reconnects via `connectRunStream({attach})`. This fights the WS transport and Cortex's store-based history. **Phase X-C is gated: implement ONLY the additive attach endpoint + a durable-only resume affordance; do not convert the WS desk.** If it balloons, ship A/B/E and defer C (note in the handoff).

## File Structure

```
packages/svelte/
  package.json                 MODIFY: build multi-entry (+ ./testing), add ui-core/testing devDep note
  src/run.ts                   CREATE: createRun — writable + connectRunStream/reduceRunState core
  src/resumable.ts             CREATE: createResumableRun — attach mode
  src/interactions.ts          CREATE: createInteractions — respond to interaction endpoint
  src/observe.ts               CREATE: runCost(state)/runSteps(state) pure derivations
  src/agent-stream.ts          MODIFY: rewire onto createRun (surface unchanged)
  src/agent.ts                 MODIFY: rewire onto createRun (surface unchanged)
  src/structured-stream.ts     MODIFY: rewire onto createRun objectMode (surface unchanged)
  src/testing.ts               CREATE: re-export ui-core/testing
  src/index.ts                 MODIFY: export new families
  tests/{run,resumable,interactions,observe,back-compat}.test.ts   CREATE

apps/cortex/server/
  services/runner-service.ts   MODIFY: + listPendingInteractions/respondToInteraction on CortexRunnerService
  services/build-cortex-agent.ts  MODIFY: + .withUserInteraction() (line 388, inside durable guard)
  api/runs.ts                  MODIFY: + /pending-interactions (GET), /:runId/interaction (POST), (X-C) /:runId/attach
  tests/api-interactions.test.ts  CREATE; + interaction stubs in existing mock runner layers

apps/cortex/ui/src/lib/
  stores/interaction-watcher.ts   CREATE: mirror approval-watcher (op A)
  components/InteractPanel.svelte  CREATE: render pending interaction → respond (op A)
  stores/chat-store.ts             MODIFY: sendMessageStream → connectRunStream/reduceRunState; delete local union (op B); objectMode for preview (op E)
  components/RunFinalDeliverable.svelte  (already preview-capable; wire partial from chat state — op E)
  stores/run-store.ts + components/RunDetail.svelte  MODIFY (X-C only): durable-gated attach affordance
  routes/+layout.svelte            MODIFY: start interaction-watcher (op A)
  routes/runs/+page.svelte         MODIFY: mount InteractPanel (op A)
```

---

# Phase S — Svelte binding families

### Task S1: `createRun` core + rewire `createAgentStream`/`createAgent`

**Files:**
- Modify: `packages/svelte/package.json` (multi-entry build)
- Create: `packages/svelte/src/run.ts`
- Modify: `packages/svelte/src/agent-stream.ts`, `packages/svelte/src/agent.ts`
- Modify: `packages/svelte/src/index.ts`
- Test: `packages/svelte/tests/run.test.ts`, `packages/svelte/tests/back-compat.test.ts`

**Interfaces:**
- Consumes: ui-core `connectRunStream`, `initialRunState`, `reduceRunState`, `RunState`, `FetchLike`.
- Produces:
  ```ts
  interface CreateRunOptions { endpoint: string; fetchImpl?: FetchLike; objectMode?: boolean }
  interface RunStore {
    subscribe: (run: (state: RunState) => void) => () => void;   // Svelte store contract
    run: (prompt: string, body?: Record<string, unknown>) => void;
    reattach: (runId: string, cursor?: number) => void;
    cancel: () => void;
  }
  function createRun(opts: CreateRunOptions): RunStore;
  ```

- [ ] **Step 1: Multi-entry build.** In `packages/svelte/package.json`, change the build script + exports to add the `./testing` subpath (used in Task S5). Replace `"build"` and `"exports"`:

```json
  "exports": {
    ".": { "bun": "./dist/index.js", "types": "./dist/index.d.ts", "import": "./dist/index.js", "default": "./dist/index.js" },
    "./testing": { "bun": "./dist/testing.js", "types": "./dist/testing.d.ts", "import": "./dist/testing.js", "default": "./dist/testing.js" }
  },
  "scripts": {
    "build": "tsup src/index.ts src/testing.ts --format esm --dts --out-dir dist --external svelte --external @reactive-agents/ui-core",
    "typecheck": "tsc --noEmit"
  }
```

(The repo's shared `tsup.config.base.ts` is single-entry; this overrides it with an explicit entry list. `src/testing.ts` is created in Task S5 — for S1 the build will fail on the missing file, so create a one-line stub now: `packages/svelte/src/testing.ts` → `export {};`. Replace it fully in S5.)

- [ ] **Step 2: Write the failing test** for `createRun` (no DOM — drive the store directly + `mockAgentEndpoint`):

```ts
// packages/svelte/tests/run.test.ts
import { describe, expect, test } from "bun:test";
import { mockAgentEndpoint, type RunFixture } from "@reactive-agents/ui-core/testing";
import type { FetchLike, RunState } from "@reactive-agents/ui-core";
import { createRun } from "../src/run.js";

const FIXTURE: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "TextDelta", text: "4", seq: 1 },
    { _tag: "StreamCompleted", output: "4", metadata: { cost: 0.001, tokensUsed: 10 }, runId: "r1", seq: 2 },
  ],
};
const fixtureFetch = (f: RunFixture): FetchLike => {
  const h = mockAgentEndpoint(f);
  return async (input, init) => h(new Request(new URL(String(input), "http://ra.test").toString(), init as RequestInit));
};
const collect = (store: { subscribe: (fn: (s: RunState) => void) => () => void }) => {
  const states: RunState[] = [];
  const unsub = store.subscribe((s) => states.push(s));
  return { states, unsub };
};
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("createRun", () => {
  test("runs and reduces to completed", async () => {
    const store = createRun({ endpoint: "/api/agent", fetchImpl: fixtureFetch(FIXTURE) });
    const { states } = collect(store);
    store.run("2+2");
    await settle();
    const last = states.at(-1)!;
    expect(last.status).toBe("completed");
    expect(last.output).toBe("4");
    expect(last.runId).toBe("r1");
    expect(last.cost).toEqual({ tokens: 10, usd: 0.001 });
  });
});
```

- [ ] **Step 3: Run to verify it fails.** `bun test packages/svelte/tests/run.test.ts --timeout 15000` → FAIL (module not found).

- [ ] **Step 4: Implement `run.ts`.**

```ts
// packages/svelte/src/run.ts
import { writable } from "svelte/store";
import {
  connectRunStream,
  initialRunState,
  reduceRunState,
  type ConnectOptions,
  type FetchLike,
  type RunState,
} from "@reactive-agents/ui-core";

export interface CreateRunOptions {
  readonly endpoint: string;
  readonly fetchImpl?: FetchLike;
  readonly objectMode?: boolean;
}

export interface RunStore {
  subscribe: ReturnType<typeof writable<RunState>>["subscribe"];
  run: (prompt: string, body?: Record<string, unknown>) => void;
  reattach: (runId: string, cursor?: number) => void;
  cancel: () => void;
}

export function createRun(opts: CreateRunOptions): RunStore {
  const store = writable<RunState>(initialRunState());
  let controller: AbortController | null = null;

  const drive = (connectOpts: Omit<ConnectOptions, "signal" | "fetchImpl">) => {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    store.set(initialRunState());
    void (async () => {
      let next = initialRunState();
      try {
        for await (const event of connectRunStream({ ...connectOpts, fetchImpl: opts.fetchImpl, signal })) {
          next = reduceRunState(next, event, { objectMode: opts.objectMode });
          store.set(next);
        }
      } catch (err) {
        if (signal.aborted) return;
        const cause = err instanceof Error ? err.message : String(err);
        store.update((s) => ({ ...s, status: "error", error: cause }));
      }
    })();
  };

  return {
    subscribe: store.subscribe,
    run: (prompt, body) => drive({ endpoint: opts.endpoint, body: { prompt, ...body } }),
    reattach: (runId, cursor) => drive({ endpoint: opts.endpoint, attach: { runId, cursor } }),
    cancel: () => {
      controller?.abort();
      store.update((s) => ({ ...s, status: "cancelled" }));
    },
  };
}
```

- [ ] **Step 5: Write the back-compat test** (existing surfaces unchanged):

```ts
// packages/svelte/tests/back-compat.test.ts
import { describe, expect, test } from "bun:test";
import { mockAgentEndpoint, type RunFixture } from "@reactive-agents/ui-core/testing";
import { createAgentStream } from "../src/agent-stream.js";
import { createAgent } from "../src/agent.js";

const FIXTURE: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "TextDelta", text: "hel", seq: 1 },
    { _tag: "TextDelta", text: "lo", seq: 2 },
    { _tag: "StreamCompleted", output: "hello", metadata: {}, seq: 3 },
  ],
};
const patch = (f: RunFixture) => {
  const h = mockAgentEndpoint(f);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    h(new Request(new URL(String(input), "http://ra.test").toString(), init))) as typeof fetch;
};
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("svelte back-compat", () => {
  test("createAgentStream {text,status,output}", async () => {
    patch(FIXTURE);
    const s = createAgentStream("/api/agent");
    const states: Array<{ text: string; status: string; output: string | null }> = [];
    s.subscribe((st) => states.push({ text: st.text, status: st.status, output: st.output }));
    await s.run("hi");
    await settle();
    const last = states.at(-1)!;
    expect(last.status).toBe("completed");
    expect(last.text).toBe("hello");
    expect(last.output).toBe("hello");
  });

  test("createAgent run() resolves output", async () => {
    patch(FIXTURE);
    const a = createAgent("/api/agent");
    const out = await a.run("hi");
    expect(out).toBe("hello");
  });
});
```

- [ ] **Step 6: Rewire `agent-stream.ts`** to delegate to `createRun`, mapping `RunState` → `AgentStreamState` (keep the exported `AgentStreamState` type + `createAgentStream` signature exactly). Replace the file body:

```ts
// packages/svelte/src/agent-stream.ts
import { writable } from "svelte/store";
import { createRun } from "./run.js";
import type { AgentStreamEvent } from "./types.js";

export interface AgentStreamState {
  text: string;
  events: AgentStreamEvent[];
  status: "idle" | "streaming" | "completed" | "error";
  error: string | null;
  output: string | null;
}

const toLegacy = (s: string): AgentStreamState["status"] =>
  s === "streaming" || s === "awaiting-interaction" || s === "awaiting-approval"
    ? "streaming"
    : s === "completed"
    ? "completed"
    : s === "error"
    ? "error"
    : "idle";

export function createAgentStream(
  endpoint: string,
  _requestInit?: Omit<RequestInit, "method" | "body" | "signal">,
) {
  const inner = createRun({ endpoint });
  const store = writable<AgentStreamState>({ text: "", events: [], status: "idle", error: null, output: null });
  inner.subscribe((rs) =>
    store.set({
      text: rs.text,
      events: rs.events as unknown as AgentStreamEvent[],
      status: toLegacy(rs.status),
      error: rs.error ?? null,
      output: rs.output ?? null,
    }),
  );
  return {
    subscribe: store.subscribe,
    run: (prompt: string, body?: Record<string, unknown>): Promise<void> => {
      inner.run(prompt, body);
      return Promise.resolve();
    },
    cancel: () => inner.cancel(),
  };
}
```

(Existing tests that assert `run()` returns a promise still pass — it resolves immediately; the store drives state. If `smoke.test.ts` asserts `run()` awaits COMPLETION, adjust the rewire to resolve on terminal state — read `packages/svelte/tests/smoke.test.ts` first and match its contract. If it only checks `typeof run === "function"` + subscribed states, the above is fine.)

- [ ] **Step 7: Rewire `agent.ts`** onto `createRun` (resolve `run()` on terminal state):

```ts
// packages/svelte/src/agent.ts
import { writable } from "svelte/store";
import { createRun } from "./run.js";

export interface AgentState {
  output: string | null;
  loading: boolean;
  error: string | null;
}

export function createAgent(endpoint: string, _requestInit?: Omit<RequestInit, "method" | "body">) {
  const inner = createRun({ endpoint });
  const store = writable<AgentState>({ output: null, loading: false, error: null });
  let resolver: { resolve: (v: string) => void; reject: (e: Error) => void } | null = null;
  let last = "idle";
  inner.subscribe((rs) => {
    store.set({
      output: rs.output ?? null,
      loading: rs.status === "streaming" || rs.status === "awaiting-interaction" || rs.status === "awaiting-approval",
      error: rs.error ?? null,
    });
    if (rs.status !== last) {
      last = rs.status;
      if (rs.status === "completed") resolver?.resolve(rs.output ?? "");
      else if (rs.status === "error") resolver?.reject(new Error(rs.error ?? "run failed"));
    }
  });
  return {
    subscribe: store.subscribe,
    run: (prompt: string, body?: Record<string, unknown>): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        resolver = { resolve, reject };
        inner.run(prompt, body);
      }),
  };
}
```

- [ ] **Step 8: Export from index.** Add to `packages/svelte/src/index.ts`:

```ts
export { createRun, type CreateRunOptions, type RunStore } from "./run.js";
export type { RunState, UiStreamEvent, UiRunStatus, PendingInteractionWire } from "@reactive-agents/ui-core";
```

- [ ] **Step 9: Run tests + typecheck + existing suite.** `bun test packages/svelte/tests/run.test.ts packages/svelte/tests/back-compat.test.ts packages/svelte/tests/smoke.test.ts --timeout 15000` → all pass. `cd packages/svelte && bunx tsc --noEmit` (build ui-core dist first if types unresolved: `bunx turbo run build --filter=@reactive-agents/ui-core`).

- [ ] **Step 10: Commit.**

```bash
rtk git add packages/svelte bun.lock
rtk git commit -m "feat(svelte): createRun over ui-core + rewire agent-stream/agent (surface unchanged)"
```

---

### Task S2: `createResumableRun` (attach) + `createStructuredStream` rewire

**Files:**
- Create: `packages/svelte/src/resumable.ts`
- Modify: `packages/svelte/src/structured-stream.ts`
- Modify: `packages/svelte/src/index.ts`
- Test: `packages/svelte/tests/resumable.test.ts`, `packages/svelte/tests/structured.test.ts` (extend existing)

**Interfaces:**
- Consumes: `createRun` (S1).
- Produces:
  ```ts
  interface CreateResumableRunOptions { endpoint: string; runId: string; cursor?: number; fetchImpl?: FetchLike; objectMode?: boolean }
  function createResumableRun(opts: CreateResumableRunOptions): RunStore; // auto-attaches
  ```
  `createStructuredStream` keeps its signature/`StructuredStreamState`, delegates to `createRun({ objectMode: true })`.

- [ ] **Step 1: Write the failing resumable test** (fixture with `RunAttached` head):

```ts
// packages/svelte/tests/resumable.test.ts
import { describe, expect, test } from "bun:test";
import { mockAgentEndpoint, type RunFixture } from "@reactive-agents/ui-core/testing";
import type { FetchLike, RunState } from "@reactive-agents/ui-core";
import { createResumableRun } from "../src/resumable.js";

const ATTACH: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "RunAttached", runId: "r7", status: "streaming", resumeCursor: 2, protocolVersion: 1, seq: 2 },
    { _tag: "TextDelta", text: "resumed", seq: 3 },
    { _tag: "StreamCompleted", output: "resumed answer", metadata: {}, runId: "r7", seq: 4 },
  ],
};
const fixtureFetch = (f: RunFixture): FetchLike => {
  const h = mockAgentEndpoint(f);
  return async (input, init) => h(new Request(new URL(String(input), "http://ra.test").toString(), init as RequestInit));
};
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("createResumableRun", () => {
  test("auto-attaches and completes from replay", async () => {
    const store = createResumableRun({ endpoint: "/api/agent", runId: "r7", cursor: 0, fetchImpl: fixtureFetch(ATTACH) });
    const states: RunState[] = [];
    store.subscribe((s) => states.push(s));
    await settle();
    const last = states.at(-1)!;
    expect(last.status).toBe("completed");
    expect(last.runId).toBe("r7");
    expect(last.output).toBe("resumed answer");
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `bun test packages/svelte/tests/resumable.test.ts --timeout 15000` → FAIL.

- [ ] **Step 3: Implement `resumable.ts`.**

```ts
// packages/svelte/src/resumable.ts
import { createRun, type RunStore } from "./run.js";
import type { FetchLike } from "@reactive-agents/ui-core";

export interface CreateResumableRunOptions {
  readonly endpoint: string;
  readonly runId: string;
  readonly cursor?: number;
  readonly fetchImpl?: FetchLike;
  readonly objectMode?: boolean;
}

/** Reattach to a durable run immediately, replaying from the given cursor. */
export function createResumableRun(opts: CreateResumableRunOptions): RunStore {
  const store = createRun({ endpoint: opts.endpoint, fetchImpl: opts.fetchImpl, objectMode: opts.objectMode });
  store.reattach(opts.runId, opts.cursor);
  return store;
}
```

- [ ] **Step 4: Rewire `structured-stream.ts`** onto `createRun({objectMode:true})`, preserving `StructuredStreamState` + signature:

```ts
// packages/svelte/src/structured-stream.ts
import { writable } from "svelte/store";
import { createRun } from "./run.js";

export interface StructuredStreamState {
  object: Record<string, unknown>;
  text: string;
  status: "idle" | "streaming" | "completed" | "error";
  error: string | null;
}

const toLegacy = (s: string): StructuredStreamState["status"] =>
  s === "streaming" || s === "awaiting-interaction" || s === "awaiting-approval"
    ? "streaming"
    : s === "completed" ? "completed" : s === "error" ? "error" : "idle";

export function createStructuredStream(
  endpoint: string,
  _requestInit?: Omit<RequestInit, "method" | "body" | "signal">,
): { subscribe: ReturnType<typeof writable<StructuredStreamState>>["subscribe"]; run: (prompt: string, body?: Record<string, unknown>) => Promise<void>; cancel: () => void } {
  const inner = createRun({ endpoint, objectMode: true });
  const store = writable<StructuredStreamState>({ object: {}, text: "", status: "idle", error: null });
  inner.subscribe((rs) =>
    store.set({
      object: (rs.object as Record<string, unknown>) ?? {},
      text: rs.text,
      status: toLegacy(rs.status),
      error: rs.error ?? null,
    }),
  );
  return {
    subscribe: store.subscribe,
    run: (prompt, body) => { inner.run(prompt, body); return Promise.resolve(); },
    cancel: () => inner.cancel(),
  };
}
```

- [ ] **Step 5: Export from index.** Add:

```ts
export { createResumableRun, type CreateResumableRunOptions } from "./resumable.js";
```

- [ ] **Step 6: Run tests + typecheck.** `bun test packages/svelte/tests/resumable.test.ts packages/svelte/tests/structured-stream.test.ts --timeout 15000` → pass (existing structured-stream test must stay green — read it; if it monkey-patches SSE without `id:` lines, `connectRunStream` still reduces fine). tsc clean.

- [ ] **Step 7: Commit.**

```bash
rtk git add packages/svelte
rtk git commit -m "feat(svelte): createResumableRun + rewire createStructuredStream onto ui-core objectMode"
```

---

### Task S3: `createInteractions` (respond) + `runCost`/`runSteps` derivations + testing subpath

**Files:**
- Create: `packages/svelte/src/interactions.ts`
- Create: `packages/svelte/src/observe.ts`
- Create: `packages/svelte/src/testing.ts` (replace the S1 stub)
- Modify: `packages/svelte/src/index.ts`
- Test: `packages/svelte/tests/interactions.test.ts`, `packages/svelte/tests/observe.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface CreateInteractionsOptions { interactionEndpoint: string; fetchImpl?: FetchLike }
  interface InteractionsStore {
    subscribe: (fn: (s: { pending: boolean; error: string | null }) => void) => () => void;
    respond: (runId: string, interactionId: string, value: unknown) => Promise<{ success: boolean; output: string }>;
  }
  function createInteractions(opts: CreateInteractionsOptions): InteractionsStore;

  interface StepEntry { kind: "tool" | "thought" | "iteration"; label: string; seq?: number; durationMs?: number; success?: boolean }
  function runCost(state: RunState): { tokens: number; usd: number };
  function runSteps(state: RunState): readonly StepEntry[];
  ```
  `src/testing.ts` re-exports ui-core/testing.

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/svelte/tests/interactions.test.ts
import { describe, expect, test } from "bun:test";
import type { FetchLike } from "@reactive-agents/ui-core";
import { createInteractions } from "../src/interactions.js";

describe("createInteractions", () => {
  test("respond posts {runId,interactionId,value} and returns success", async () => {
    let body: unknown;
    const fetchImpl: FetchLike = async (_i, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ success: true, output: "done" }), { status: 200 });
    };
    const store = createInteractions({ interactionEndpoint: "/api/interaction", fetchImpl });
    const res = await store.respond("r1", "i1", "blue");
    expect(res.success).toBe(true);
    expect(body).toEqual({ runId: "r1", interactionId: "i1", value: "blue" });
  });
});
```

```ts
// packages/svelte/tests/observe.test.ts
import { describe, expect, test } from "bun:test";
import { initialRunState, reduceRunState, type RunState, type SeqStamped, type UiStreamEvent } from "@reactive-agents/ui-core";
import { runCost, runSteps } from "../src/observe.js";

const build = (events: SeqStamped<UiStreamEvent>[]): RunState =>
  events.reduce((s, e) => reduceRunState(s, e), initialRunState());

describe("observe", () => {
  const state = build([
    { _tag: "ToolCallCompleted", toolName: "web-search", callId: "c1", durationMs: 120, success: true, seq: 1 },
    { _tag: "CostDelta", tokens: 42, usd: 0.01, seq: 2 },
  ]);
  test("runCost reads cost", () => expect(runCost(state)).toEqual({ tokens: 42, usd: 0.01 }));
  test("runSteps derives a tool entry", () => {
    const tool = runSteps(state).find((e) => e.kind === "tool");
    expect(tool?.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify both fail.** `bun test packages/svelte/tests/interactions.test.ts packages/svelte/tests/observe.test.ts --timeout 15000` → FAIL.

- [ ] **Step 3: Implement `interactions.ts`.**

```ts
// packages/svelte/src/interactions.ts
import { writable } from "svelte/store";
import type { FetchLike } from "@reactive-agents/ui-core";

export interface CreateInteractionsOptions {
  readonly interactionEndpoint: string;
  readonly fetchImpl?: FetchLike;
}
export interface InteractionsStore {
  subscribe: ReturnType<typeof writable<{ pending: boolean; error: string | null }>>["subscribe"];
  respond: (runId: string, interactionId: string, value: unknown) => Promise<{ success: boolean; output: string }>;
}

export function createInteractions(opts: CreateInteractionsOptions): InteractionsStore {
  const store = writable<{ pending: boolean; error: string | null }>({ pending: false, error: null });
  const fetchImpl = opts.fetchImpl ?? fetch;
  const respond = async (runId: string, interactionId: string, value: unknown) => {
    store.set({ pending: true, error: null });
    try {
      const res = await fetchImpl(opts.interactionEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, interactionId, value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { success: boolean; output: string };
    } catch (err) {
      store.set({ pending: false, error: err instanceof Error ? err.message : String(err) });
      return { success: false, output: "" };
    } finally {
      store.update((s) => ({ ...s, pending: false }));
    }
  };
  return { subscribe: store.subscribe, respond };
}
```

- [ ] **Step 4: Implement `observe.ts`.**

```ts
// packages/svelte/src/observe.ts
import type { RunState } from "@reactive-agents/ui-core";

export interface StepEntry {
  readonly kind: "tool" | "thought" | "iteration";
  readonly label: string;
  readonly seq?: number;
  readonly durationMs?: number;
  readonly success?: boolean;
}

export function runCost(state: RunState): { tokens: number; usd: number } {
  return state.cost ?? { tokens: 0, usd: 0 };
}

export function runSteps(state: RunState): readonly StepEntry[] {
  const out: StepEntry[] = [];
  for (const e of state.events) {
    switch (e._tag) {
      case "ToolCallStarted":
        out.push({ kind: "tool", label: `→ ${(e as { toolName: string }).toolName}`, seq: e.seq });
        break;
      case "ToolCallCompleted": {
        const c = e as { toolName: string; durationMs: number; success: boolean };
        out.push({ kind: "tool", label: `✓ ${c.toolName}`, seq: e.seq, durationMs: c.durationMs, success: c.success });
        break;
      }
      case "ThoughtEmitted":
        out.push({ kind: "thought", label: (e as { content: string }).content.slice(0, 80), seq: e.seq });
        break;
      case "IterationProgress":
        out.push({ kind: "iteration", label: `iteration ${(e as { iteration: number }).iteration}`, seq: e.seq });
        break;
      default:
        break;
    }
  }
  return out;
}
```

- [ ] **Step 5: Implement `testing.ts`** (replace S1 stub):

```ts
// packages/svelte/src/testing.ts
/** Svelte-side re-export of ui-core's fixture testing API (zero-token UI tests). */
export { recordRunFixture, mockAgentEndpoint, fixtureToSSE, type RunFixture } from "@reactive-agents/ui-core/testing";
```

- [ ] **Step 6: Export from index.** Add:

```ts
export { createInteractions, type CreateInteractionsOptions, type InteractionsStore } from "./interactions.js";
export { runCost, runSteps, type StepEntry } from "./observe.js";
```

- [ ] **Step 7: Run tests + FULL package gate.** `bun test packages/svelte --timeout 20000` → all green. `cd packages/svelte && bun run build && bunx tsc --noEmit` — emits `dist/index.js` + `dist/testing.js` + d.ts; tsc clean. `bunx turbo run build --filter=@reactive-agents/ui-core --filter=@reactive-agents/svelte` green.

- [ ] **Step 8: Commit.**

```bash
rtk git add packages/svelte bun.lock
rtk git commit -m "feat(svelte): createInteractions + runCost/runSteps + testing subpath — binding families complete"
```

---

# Phase X — Cortex integration

> Prereq for all Phase X tasks: framework packages built to dist (`bunx turbo run build --filter='./packages/*'`) — Cortex server is a Node-runtime consumer. Add `@reactive-agents/ui-core: "workspace:*"` to `apps/cortex/ui/package.json` deps in Task X2, then `bun install`.

### Task X1: Server — interaction methods on CortexRunnerService + `.withUserInteraction()` + routes

**Files:**
- Modify: `apps/cortex/server/services/runner-service.ts`
- Modify: `apps/cortex/server/services/build-cortex-agent.ts`
- Modify: `apps/cortex/server/api/runs.ts`
- Test: `apps/cortex/server/tests/api-interactions.test.ts` + interaction stubs added to existing mock runner Layers (`api-runs.test.ts:11-22,26-39,554,585`, `config-parity.test.ts:42`)

**Interfaces:**
- Consumes: the built agent's `listPendingInteractions()` / `respondToInteraction(runId, interactionId, value)` (runtime, already on `ReactiveAgent`).
- Produces (added to `CortexRunnerService`):
  ```ts
  readonly listPendingInteractions: () => Effect.Effect<readonly { runId: string; interactionId: string; kind: string; prompt: string; schema: unknown; task: string; updatedAt: number }[], never>;
  readonly respondToInteraction: (runId: RunId, interactionId: string, value: unknown) => Effect.Effect<{ success: boolean; output: string }, CortexError>;
  ```
- Produces (routes on `/api/runs`): `.get("/pending-interactions")` → `{ interactions: [...] }`; `.post("/:runId/interaction", { body: { interactionId, value } })` → `{ success, output }`.

- [ ] **Step 1: Read the approval impls** you're mirroring: `sed -n '143,160p;530,575p' apps/cortex/server/services/runner-service.ts` (interface + approveApproval/denyApproval Live impl) and `sed -n '255,300p' apps/cortex/server/api/runs.ts`. The interaction methods mirror them: how the Live impl gets the agent handle for a run (the same mechanism `approveApproval` uses to call the agent's durable approve — reuse it for `respondToInteraction`).

- [ ] **Step 2: Write the failing route test.**

```ts
// apps/cortex/server/tests/api-interactions.test.ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { Effect, Layer } from "effect";
// import the same helpers api-runs.test.ts uses: CortexStoreServiceLive, applySchema, CortexRunnerService, runsRouter
import { runsRouter } from "../api/runs.js";
import { CortexRunnerService } from "../services/runner-service.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { applySchema } from "../db/schema.js"; // adjust import to the actual helper api-runs.test.ts uses

const mockRunner = Layer.succeed(CortexRunnerService, {
  // ...copy the full mock object shape from api-runs.test.ts, adding:
  listPendingInteractions: () => Effect.succeed([
    { runId: "r1", interactionId: "i1", kind: "choice", prompt: "Pick", schema: { options: ["a", "b"] }, task: "t", updatedAt: 1 },
  ]),
  respondToInteraction: (_runId: string, _iid: string, _v: unknown) => Effect.succeed({ success: true, output: "done" }),
} as unknown as typeof CortexRunnerService.Service);

const app = (db: Database) => new Elysia().use(runsRouter(CortexStoreServiceLive(db), mockRunner));

describe("interaction routes", () => {
  test("GET /pending-interactions", async () => {
    const db = new Database(":memory:"); applySchema(db);
    const res = await app(db).handle(new Request("http://localhost/api/runs/pending-interactions"));
    const json = (await res.json()) as { interactions: unknown[] };
    expect(json.interactions.length).toBe(1);
  });
  test("POST /:runId/interaction", async () => {
    const db = new Database(":memory:"); applySchema(db);
    const res = await app(db).handle(new Request("http://localhost/api/runs/r1/interaction", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interactionId: "i1", value: "a" }),
    }));
    const json = (await res.json()) as { success: boolean; output: string };
    expect(json.success).toBe(true);
  });
});
```

(Copy the EXACT mock-runner object + helper imports from `api-runs.test.ts` — this snippet lists only the added fields.)

- [ ] **Step 3: Run to verify it fails.** `cd apps/cortex && bun test server/tests/api-interactions.test.ts --timeout 15000` → FAIL.

- [ ] **Step 4: Add interface methods** to `CortexRunnerService` (after line 151) — the two signatures in Interfaces above. Add interaction stubs to EVERY existing mock runner Layer the test suite builds (grep hits: `api-runs.test.ts:11-22,26-39,554,585`, `config-parity.test.ts:42`) so those suites still compile.

- [ ] **Step 5: Implement the Live methods** in `runner-service.ts` (after the deny impl ~line 555), mirroring `approveApproval`'s agent-handle access: `respondToInteraction` calls the agent's `respondToInteraction`; `listPendingInteractions` calls the agent's `listPendingInteractions` (map to the DTO shape). Follow the exact Effect + error-mapping idiom of approve/deny.

- [ ] **Step 6: Wire `.withUserInteraction()`** in `build-cortex-agent.ts` — insert after line 388 (`b = b.withDurableRuns(opts);`), inside the `if (params.durableRuns?.enabled)` guard:

```ts
    b = b.withDurableRuns(opts);
    b = b.withUserInteraction();  // durable-guarded; enables request_user_input pauses
```

- [ ] **Step 7: Add routes** to `runs.ts` (mirror approve/deny, ~after line 300):

```ts
    .get("/pending-interactions", async ({ set }) => {
      const program = Effect.gen(function* () {
        const runner = yield* CortexRunnerService;
        return { interactions: yield* runner.listPendingInteractions() };
      });
      try { return await Effect.runPromise(program.pipe(Effect.provide(runnerLayer))); }
      catch (e) { set.status = 500; return { error: String(e) }; }
    })
    .post("/:runId/interaction", async ({ params, body, set }) => {
      const program = Effect.gen(function* () {
        const runner = yield* CortexRunnerService;
        return yield* runner.respondToInteraction(
          params.runId as RunId,
          (body as { interactionId: string }).interactionId,
          (body as { value: unknown }).value,
        );
      });
      try { return await Effect.runPromise(program.pipe(Effect.provide(runnerLayer))); }
      catch (e) { set.status = 500; return { error: String(e) }; }
    }, { body: t.Object({ interactionId: t.String(), value: t.Unknown() }) })
```

- [ ] **Step 8: Build framework + run cortex server tests.** `bunx turbo run build --filter='./packages/*'` then `cd apps/cortex && bun test server/tests --timeout 20000` → new interaction tests pass + existing runs/config-parity suites stay green.

- [ ] **Step 9: Commit.**

```bash
rtk git add apps/cortex/server
rtk git commit -m "feat(cortex-server): request_user_input rail — runner methods + .withUserInteraction() + /interaction routes"
```

---

### Task X2: UI — InteractPanel + interaction-watcher (op A) + ui-core dep

**Files:**
- Modify: `apps/cortex/ui/package.json` (add `@reactive-agents/ui-core` dep)
- Create: `apps/cortex/ui/src/lib/stores/interaction-watcher.ts`
- Create: `apps/cortex/ui/src/lib/components/InteractPanel.svelte`
- Modify: `apps/cortex/ui/src/routes/+layout.svelte`, `apps/cortex/ui/src/routes/runs/+page.svelte`
- Test: `apps/cortex/ui/src/lib/stores/interaction-watcher.test.ts`

**Interfaces:**
- Consumes: `@reactive-agents/svelte` `createInteractions`; `PendingInteractionWire` from ui-core; the `/pending-interactions` + `/:runId/interaction` routes (X1).
- Produces: `startInteractionWatcher(pollMs?): () => void` (mirror `approval-watcher.ts`); `<InteractPanel />` (mirror `ApprovalPanel.svelte`).

- [ ] **Step 1: Add ui-core dep + install.** `apps/cortex/ui/package.json` dependencies: add `"@reactive-agents/ui-core": "workspace:*"`. Run `bun install` at repo root.

- [ ] **Step 2: Write the failing watcher test** (mirror `apps/cortex/ui/src/lib/stores/ws-client.test.ts`/existing store tests — monkey-patch fetch):

```ts
// apps/cortex/ui/src/lib/stores/interaction-watcher.test.ts
import { describe, expect, test, afterEach } from "bun:test";
import { startInteractionWatcher } from "./interaction-watcher.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe("interaction-watcher", () => {
  test("polls pending-interactions and exposes them", async () => {
    let calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("pending-interactions")) {
        calls += 1;
        return new Response(JSON.stringify({ interactions: [{ runId: "r1", interactionId: "i1", kind: "choice", prompt: "Pick", schema: { options: ["a"] }, task: "t", updatedAt: 1 }] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const stop = startInteractionWatcher(10);
    await new Promise((r) => setTimeout(r, 40));
    stop();
    expect(calls).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run to verify it fails.** `cd apps/cortex && bun test src/lib/stores/interaction-watcher.test.ts --timeout 15000` → FAIL.

- [ ] **Step 4: Implement `interaction-watcher.ts`** — clone `approval-watcher.ts` (read it first), swapping `pending-approvals`→`pending-interactions`, the dedupe key to `interaction:${runId}|${interactionId}`, and the toast/decision to a pending-interactions store the panel reads. Keep the `setInterval(pollMs)` + `CORTEX_SERVER_URL` fetch idiom identical.

- [ ] **Step 5: Implement `InteractPanel.svelte`** — mirror `ApprovalPanel.svelte`: subscribe to the interaction store, render each pending interaction's `prompt` + `kind`-specific control (choice → buttons from `schema.options`; confirmation → Yes/No; form → inputs), POST the response to `/:runId/interaction` via `createInteractions` (from `@reactive-agents/svelte`) or a raw `fetch(\`${CORTEX_SERVER_URL}/api/runs/${runId}/interaction\`)`. Match the component's Svelte-5 `$state`/`$derived` idiom used in ApprovalPanel.

- [ ] **Step 6: Mount** — in `routes/+layout.svelte` (mirror line 11 approval import + start) call `startInteractionWatcher()`; in `routes/runs/+page.svelte` render `<InteractPanel />` next to `<ApprovalPanel />` (line 431).

- [ ] **Step 7: Run UI tests + build.** `cd apps/cortex && bun test src/lib --timeout 20000` → green. Build the UI (`bun run build` in `apps/cortex/ui` if it has a build; else `bunx tsc --noEmit` / svelte-check per the app's gate — check `apps/cortex/ui/package.json` scripts).

- [ ] **Step 8: Commit.**

```bash
rtk git add apps/cortex/ui bun.lock
rtk git commit -m "feat(cortex-ui): Interact panel + interaction-watcher — durable request_user_input UX"
```

---

### Task X3: UI — converge chat-store onto `connectRunStream` (op B) + structured preview (op E)

**Files:**
- Modify: `apps/cortex/ui/src/lib/stores/chat-store.ts`
- Test: `apps/cortex/ui/src/lib/stores/chat-store.test.ts` (extend the existing one)

**Interfaces:**
- Consumes: `@reactive-agents/svelte` `createRun` / ui-core `connectRunStream` + `reduceRunState`.
- Produces: `sendMessageStream` internals swapped to ui-core; the local `AgentStreamEvent` union (lines 21-51) DELETED in favor of ui-core's `UiStreamEvent`; `objectMode:true` so a partial `state.object` is available for the deliverable preview (op E).

- [ ] **Step 1: Read `chat-store.ts` fully** (`cat apps/cortex/ui/src/lib/stores/chat-store.ts`) — note how `sendMessageStream` maps events to `activeTurns`, and what the existing `chat-store.test.ts` asserts (its contract MUST stay green).

- [ ] **Step 2: Write/extend the failing test** — assert the converged path still accumulates text + completes, driven by a `data:`-only SSE `Response` (no `id:` lines, as chat.ts emits), AND that a streamed JSON object surfaces a partial object. Model the fetch mock on the existing `chat-store.test.ts` SSE builder. Assert: after a stream of `TextDelta` + `StreamCompleted`, the store's active turn has the full text; and with an object-shaped stream + objectMode, a partial object is exposed.

- [ ] **Step 3: Run to verify it fails/regresses appropriately.** `cd apps/cortex && bun test src/lib/stores/chat-store.test.ts --timeout 15000`.

- [ ] **Step 4: Convert `sendMessageStream`** — replace the `getReader()`/`buffer.split("\n\n")`/`JSON.parse(data:)` loop (~lines 373-420) with:

```ts
import { connectRunStream, reduceRunState, initialRunState, type RunState } from "@reactive-agents/ui-core";
// ...
const streamUrl = `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId!)}/chat/stream`;
let rs: RunState = initialRunState();
for await (const ev of connectRunStream({
  endpoint: streamUrl,
  body: { /* the same POST body the old fetch sent */ },
  objectMode: true as unknown as never, // objectMode is a reduce option — pass via reduceRunState below
})) {
  rs = reduceRunState(rs, ev, { objectMode: true });
  // map rs → activeTurns exactly as the old _tag switch did:
  //   rs.text → turn text; rs.status → turn status; rs.object → structured preview; rs.output on complete
  applyRunStateToActiveTurn(rs);
}
```

(Note: `connectRunStream` has no `objectMode` option — objectMode belongs to `reduceRunState`. Drop it from the connect call; pass `{objectMode:true}` to `reduceRunState`. Extract an `applyRunStateToActiveTurn(rs)` helper that reproduces the OLD event→turn mapping from `rs` fields, so the UI behavior is unchanged.) Then DELETE the local `AgentStreamEvent` union (lines 21-51) and its header comment; import types from `@reactive-agents/ui-core` where still needed.

- [ ] **Step 5: Structured preview (op E)** — expose `rs.object` on the active turn / run-store so `RunFinalDeliverable.svelte` (already `structuredObject`-capable, mounted `RunDetail.svelte:499`) shows the partial object as it streams. If the chat path feeds a different component than RunDetail, wire the partial into that component's `structuredObject` prop. No new component needed — the render already exists.

- [ ] **Step 6: Run tests + build.** `cd apps/cortex && bun test src/lib --timeout 20000` → chat-store test green (converged). Build/typecheck the UI.

- [ ] **Step 7: Commit.**

```bash
rtk git add apps/cortex/ui
rtk git commit -m "refactor(cortex-ui): converge chat streaming onto ui-core connectRunStream + partial structured preview (kills 4th event-union copy, GH #163)"
```

---

### Task X4 (SCOPED / optional): cursor attach/resume (op C)

**PREREQUISITE — read before starting.** Cortex serves run history from its own store (`getRunEvents`), not the framework `run_events` journal; the runtime `createRunAttachEndpoint` is unwired; durable runs are opt-in. TRUE kit cursor-resume is only meaningful for runs built with `.withDurableRuns()`. This task ships the **additive, durable-only** slice; it does NOT convert the WS desk. If it exceeds the box below, STOP, ship X1–X3, and log op C as deferred in `wiki/Research/2026-07-agentic-ui-gap-log.md`.

**Files:**
- Modify: `apps/cortex/server/api/runs.ts` (mount attach endpoint for durable runs)
- Modify: `apps/cortex/ui/src/lib/stores/run-store.ts` (durable-gated reattach via `connectRunStream`)
- Test: `apps/cortex/server/tests/api-attach.test.ts`

**Interfaces:**
- Consumes: runtime `createRunAttachEndpoint(agent)` (returns `(req, {runId}) => Promise<Response>`); the agent's `getDurableInfo()`.
- Produces: `.get("/:runId/attach")` on `/api/runs` that delegates to the runtime attach handler when the run's agent has durable info; else 404. UI reattach in `run-store` that, for a durable run, connects `connectRunStream({ endpoint: attachUrl, attach: { runId, cursor } })` on reconnect.

- [ ] **Step 1: Write the failing server test** — a durable run's `/:runId/attach?cursor=0` returns an SSE `Response` beginning with a `RunAttached` event. Build a real durable agent on the `test` provider in the test (mirror the runtime's own `approval-real-pause-resume` setup), or mock the runner's attach delegation.

- [ ] **Step 2: Run to verify it fails.** `cd apps/cortex && bun test server/tests/api-attach.test.ts --timeout 20000`.

- [ ] **Step 3: Mount the attach route** in `runs.ts` — resolve the run's agent (same mechanism the runner uses), call `createRunAttachEndpoint(agent)(req, { runId })`, return its `Response`. If the agent has no `getDurableInfo()`, `set.status = 404`.

- [ ] **Step 4: UI reattach** — in `run-store.ts`, add a `reattach(cursor?)` that, for a durable run, drives `connectRunStream({ endpoint: \`${CORTEX_SERVER_URL}/api/runs/${runId}/attach\`, attach: { runId, cursor } })` and folds events via `reduceRunState`, updating the store the same way the WS handler does. Gate on a `durable` flag from the run detail. Do NOT remove the WS path — attach is a supplement (reconnect/replay), not a replacement.

- [ ] **Step 5: Run tests + build.** Server + UI suites green.

- [ ] **Step 6: Commit.**

```bash
rtk git add apps/cortex
rtk git commit -m "feat(cortex): durable-run cursor attach/resume — attach endpoint + reconnect (additive to WS)"
```

---

## Completion Criteria

**Phase S (svelte binding):**
1. `bun test packages/svelte` green (new families + back-compat), keyless/offline via ui-core fixtures.
2. Existing `createAgentStream`/`createAgent`/`createStructuredStream`/`parsePartialObject` surfaces unchanged.
3. All stream/state logic delegates to ui-core (`connectRunStream`/`reduceRunState`) — zero hand-coded SSE parsing remains in the package.
4. `bunx tsc --noEmit` clean; no `any`; build emits `.` + `./testing`.

**Phase X (Cortex):**
5. Interact: a durable run that calls `request_user_input` pauses; `<InteractPanel>` shows the question; responding resumes the run (op A). Server interaction routes green; `.withUserInteraction()` also auto-surfaces in `AgentConfigPanel` via the capability manifest (free — dynamic-sync synergy).
6. Chat: `sendMessageStream` runs through `connectRunStream`/`reduceRunState`; the local event-union copy (chat-store.ts:21-51) is deleted; chat-store test green (op B).
7. Structured preview: a streaming JSON deliverable renders progressively via `state.object` (op E).
8. (If shipped) op C: a durable run reattaches from cursor via the attach endpoint (else deferred + logged).
9. Cortex server + UI test suites green; framework built to dist first.

## Collision note (concurrent `worktree-cortex-dynamic-sync`)

That worktree has uncommitted-to-main Cortex edits (full A/B/C/D + generic renderer). This plan touches `apps/cortex/server/{runner-service,build-cortex-agent,api/runs}.ts` + `apps/cortex/ui/{routes,stores/chat-store,components}`. Keep every change surgical and additive; when merging this branch, expect to reconcile `runs.ts` / `build-cortex-agent.ts` / `chat-store.ts` against that worktree. Coordinate merge order with the dyn effort (as with the foundation merge).

## What follows

- P4 (vue parity) — mirror Phase S for `@reactive-agents/vue`.
- P5 — `apps/ui-demo` flagship + docs + `create-reactive-agent --template`.
- Cortex desk WS→SSE convergence (larger, separate) — only if op C proves the value.
