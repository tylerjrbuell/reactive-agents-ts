# Agentic UI Kit — P3 React Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete React binding (`@reactive-agents/react`) over the headless `@reactive-agents/ui-core` — hooks + reference components for every v1 family (Resume, Interact, Inbox, Render, Observe, Devtools), plus fixture-driven tests — so a React app consumes agent runs, durable interactions, inbox, and dynamic UI from the merged foundation.

**Architecture:** The binding is a THIN reactivity layer. All protocol parsing, stream connection, and state transitions live in `ui-core` (`connectRunStream`, `reduceRunState`); React hooks wrap those in `useState`/`useEffect`/`useRef`. Components are headless-first (unstyled primitives with `data-*` attributes + render-prop escape hatches) so consumers style them; a small styled reference layer ships for demos. Existing `useAgentStream`/`useAgent` are rewired onto ui-core (killing the hand-coupled `_tag` duplication flagged in the package's own `@unstable` header).

**Tech Stack:** React 18+ (peer dep), TypeScript strict, `@reactive-agents/ui-core` (workspace), Bun test + `@testing-library/react` + `happy-dom` for component tests, tsup multi-entry build.

**Spec:** `wiki/Architecture/Design-Specs/2026-07-02-agentic-ui-harness-components.md` §5 (v1 families) + §4 (protocol/endpoints). This plan is **P3** — the React binding only. P4 (vue/svelte parity) and P5 (demo + template) are separate plans. The foundation (ui-core + runtime server rail) is MERGED to main.

## Global Constraints

- Strict TypeScript, **NO `any` casts** — use `unknown` + guards or proper types (project rule).
- **Additive only:** existing `useAgentStream`/`useAgent`/`AgentStreamEvent`/`AgentHookState`/`UseAgentStreamReturn`/`UseAgentReturn` exports MUST remain importable with the same call shape (rewire internals, keep surface).
- React binding is **client-only** — no Effect, no Node built-ins, no `@reactive-agents/runtime` import in shipped code (runtime types may be imported `type`-only if unavoidable, but prefer ui-core's re-declared protocol). Components render in a browser.
- **Headless-first:** every component accepts `className`/`data-*` passthrough and a render-prop or `children` escape hatch; no CSS framework dependency. A styled layer, if any, is opt-in via a separate import.
- All tests run **keyless** and **offline**: drive hooks/components with recorded fixtures via `@reactive-agents/ui-core/testing` (`recordRunFixture`/`mockAgentEndpoint`) + `happy-dom`. Never hit a real endpoint or provider.
- Test commands need explicit timeouts: `bun test <path> --timeout 15000`.
- `@reactive-agents/ui-core` MUST be a real `dependencies` entry (not dev) — the binding re-exports its types at runtime.
- Conventional commits, **NO AI/co-author trailer**. Prefix shell with `rtk` where supported.
- Do NOT edit `apps/cortex/**` (Cortex integration is a separate effort/branch).
- tsup masks tsc errors — run `bunx tsc --noEmit` separately as the type gate (repo lesson).

## Verified Anchors (from the merged foundation — trust these)

- `@reactive-agents/ui-core` public exports (`packages/ui-core/src/index.ts`):
  - Protocol (`./protocol/events.js`): `PROTOCOL_VERSION`, `type UiStreamEvent` (union), `type UiRunStatus = "idle"|"streaming"|"awaiting-interaction"|"awaiting-approval"|"completed"|"error"|"cancelled"`, `type SeqStamped<E>`, `type PendingInteractionWire = {runId; interactionId; kind:"form"|"choice"|"confirmation"; prompt; schema:unknown}`, `parseUiStreamEvent`, `isTerminalEvent`.
  - `parsePartialObject(buf: string): Record<string, unknown>` (`./parse-partial.js`).
  - `connectRunStream(opts: ConnectOptions): AsyncGenerator<SeqStamped<UiStreamEvent>>`, `type ConnectOptions = {endpoint; body?; attach?:{runId;cursor?}; fetchImpl?; maxRetries?; retryDelayMs?; signal?}`, `type FetchLike`.
  - `initialRunState(): RunState`, `reduceRunState(state, event, opts?): RunState`, `type RunState = {status: UiRunStatus; runId?; text; output?; object?; events: readonly SeqStamped<UiStreamEvent>[]; pendingInteraction?: PendingInteractionWire; pendingApproval?:{runId;gateId;toolName;args}; abstention?:{reason;missing?}; cost?:{tokens;usd}; error?; lastSeq?}`, `type ReduceOptions = {objectMode?: boolean}`.
- `@reactive-agents/ui-core/testing` (subpath): `recordRunFixture(stream): Promise<RunFixture>`, `fixtureToSSE(fixture): Response`, `mockAgentEndpoint(fixture): (req)=>Promise<Response>`, `type RunFixture = {protocolVersion; events}`.
- Server endpoint helpers (`@reactive-agents/runtime`, for the JSDoc/examples only — the binding calls them over HTTP, not by import): `createAgentEndpoint`, `createRunAttachEndpoint`, `createInteractionEndpoint` (POST `{runId, interactionId, value}` → `{success, output, runId}`), `createApprovalEndpoint` (GET → pending[]; POST `{runId, decision:"approve"|"deny", reason?}`), `createInboxEndpoint` (GET → `{runId, task, status, updatedAt}[]`).
- Interaction/approval endpoints emit these wire events into the stream (from `enrichStream`): `InteractionRequested` (= `PendingInteractionWire`+`_tag`), `ApprovalRequested{runId,gateId,toolName,args}`, `RunPaused{runId,reason}`, `CostDelta{tokens,usd}`, then `StreamCompleted`.
- Current react package: hooks-only (`use-agent-stream.ts`, `use-agent.ts`, `types.ts`), `@unstable`, NO ui-core dep, tsup single-entry `src/index.ts`.

## File Structure

```
packages/react/
  package.json                     MODIFY: +ui-core dep, +@testing-library/react/happy-dom devDeps, multi-entry build, ./testing + ./styles subpath exports
  bunfig.toml                      CREATE: preload happy-dom for DOM tests
  src/index.ts                     MODIFY: export all new hooks + components (keep existing exports)
  src/hooks/
    use-run.ts                     useRun — the core hook (connect + reduceRunState → RunState + controls)
    use-agent-stream.ts            MODIFY: rewire onto useRun, preserve UseAgentStreamReturn surface
    use-agent.ts                   MODIFY: rewire onto useRun, preserve UseAgentReturn surface
    use-interactions.ts            useInteractions(endpoint) — pending list + respond()
    use-task-inbox.ts              useTaskInbox(endpoint) — durable runs list + refresh()
    use-run-cost.ts                useRunCost(state) — derive {tokens, usd}
    use-run-steps.ts               useRunSteps(state) — derive step/tool timeline entries
  src/components/
    AgentPrompt.tsx                renders a pending interaction (form/choice/confirmation) → onRespond
    ChoiceCard.tsx                 choice-kind interaction primitive
    ApprovalGate.tsx               pending approval → approve/deny
    TaskInbox.tsx                  inbox list (headless + render-prop rows)
    CostMeter.tsx                  cost display from useRunCost
    StepTimeline.tsx               step/tool timeline from useRunSteps
    AgentDevtools.tsx              dev-only floating overlay (runs, events, cost, replay)
    render/
      registry.ts                  UiNode type, ComponentRegistry, uiTreeSchema(registry)
      AgentSurface.tsx             progressive render of a UI-tree (RunState.object) via registry
  src/testing.ts                   re-export ui-core/testing (recordRunFixture, mockAgentEndpoint) for React test ergonomics
  src/styles.ts                    optional styled-reference className presets (opt-in)
  tests/
    use-run.test.tsx               core hook via fixture
    resume.test.tsx                useAgent({runId}) attach
    interactions.test.tsx          useInteractions + AgentPrompt/ChoiceCard/ApprovalGate
    inbox.test.tsx                 useTaskInbox + TaskInbox
    observe.test.tsx               useRunCost/useRunSteps + CostMeter/StepTimeline
    devtools.test.tsx              AgentDevtools overlay
    render.test.tsx                registry + uiTreeSchema + AgentSurface
    back-compat.test.tsx           existing useAgentStream/useAgent still work
```

Dependency direction: `react` → `ui-core` only. Never `react` → `runtime` in shipped code.

---

### Task 1: Package rewire + DOM test harness + core `useRun` hook

**Files:**
- Modify: `packages/react/package.json`
- Create: `packages/react/bunfig.toml`
- Create: `packages/react/src/hooks/use-run.ts`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/tests/use-run.test.tsx`

**Interfaces:**
- Consumes: ui-core `connectRunStream`, `initialRunState`, `reduceRunState`, `RunState`, `ConnectOptions`, `FetchLike`, `SeqStamped`, `UiStreamEvent`.
- Produces (every later hook builds on this):
  ```ts
  interface UseRunOptions {
    readonly endpoint: string;
    readonly fetchImpl?: FetchLike;      // injectable for tests
    readonly objectMode?: boolean;        // pass to reduceRunState
    readonly auto?: { prompt: string; body?: Record<string, unknown> }; // run on mount
    readonly attach?: { runId: string; cursor?: number }; // reattach mode
  }
  interface UseRunReturn {
    readonly state: RunState;             // the ui-core RunState, live
    readonly run: (prompt: string, body?: Record<string, unknown>) => void;
    readonly cancel: () => void;
    readonly reattach: (runId: string, cursor?: number) => void;
  }
  function useRun(opts: UseRunOptions): UseRunReturn;
  ```

- [ ] **Step 1: Add deps + multi-entry build to package.json.** Replace the `dependencies`(add)/`devDependencies`/`exports`/`scripts` sections so the file reads:

```json
{
  "name": "@reactive-agents/react",
  "version": "0.10.6",
  "description": "React hooks + components for Reactive Agents agentic UI — runs, durable interactions, inbox, dynamic render",
  "keywords": ["ai", "agents", "llm", "react", "react-hooks", "streaming", "ai-ui", "agent-ui", "generative-ui"],
  "type": "module",
  "exports": {
    ".": { "bun": "./dist/index.js", "types": "./dist/index.d.ts", "import": "./dist/index.js", "default": "./dist/index.js" },
    "./testing": { "bun": "./dist/testing.js", "types": "./dist/testing.d.ts", "import": "./dist/testing.js", "default": "./dist/testing.js" },
    "./styles": { "bun": "./dist/styles.js", "types": "./dist/styles.d.ts", "import": "./dist/styles.js", "default": "./dist/styles.js" }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "dependencies": { "@reactive-agents/ui-core": "workspace:*" },
  "peerDependencies": { "react": ">=18.0.0" },
  "devDependencies": {
    "@types/react": "^18.0.0",
    "@testing-library/react": "^16.0.0",
    "happy-dom": "^15.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "tsup": "^8.0.0",
    "typescript": "^6.0.0"
  },
  "scripts": {
    "build": "tsup src/index.ts src/testing.ts src/styles.ts --format esm --dts --out-dir dist --external react",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create `bunfig.toml`** so DOM globals exist in tests:

```toml
[test]
preload = ["@happy-dom/global-registrator/register"]
```

If `@happy-dom/global-registrator` is not resolvable, use the alternative in-test registration in Step 4 instead (a `beforeAll` that calls `GlobalRegistrator.register()` from `happy-dom`), and delete this file. Verify which works: `rtk grep -rn "GlobalRegistrator\|happy-dom" packages` to see if the repo already has a pattern; follow it.

- [ ] **Step 3: Install + write the failing test.**

Run `bun install` at repo root first. Then:

```tsx
// packages/react/tests/use-run.test.tsx
import { describe, expect, test, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderHook, waitFor, act } from "@testing-library/react";
import { mockAgentEndpoint, type RunFixture } from "@reactive-agents/ui-core/testing";
import type { FetchLike } from "@reactive-agents/ui-core";
import { useRun } from "../src/hooks/use-run.js";

beforeAll(() => {
  if (!globalThis.document) GlobalRegistrator.register();
});

const FIXTURE: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "TextDelta", text: "4", seq: 1 },
    { _tag: "StreamCompleted", output: "4", metadata: { cost: 0.001, tokensUsed: 10 }, runId: "r1", seq: 2 },
  ],
};

const fixtureFetch = (fixture: RunFixture): FetchLike => {
  const handler = mockAgentEndpoint(fixture);
  return async (input, init) => handler(new Request(new URL(String(input), "http://ra.test").toString(), init as RequestInit));
};

describe("useRun", () => {
  test("runs a prompt and reduces to completed state", async () => {
    const { result } = renderHook(() => useRun({ endpoint: "/api/agent", fetchImpl: fixtureFetch(FIXTURE) }));
    expect(result.current.state.status).toBe("idle");
    act(() => result.current.run("2+2"));
    await waitFor(() => expect(result.current.state.status).toBe("completed"));
    expect(result.current.state.output).toBe("4");
    expect(result.current.state.runId).toBe("r1");
    expect(result.current.state.cost).toEqual({ tokens: 10, usd: 0.001 });
  });

  test("auto-runs on mount when opts.auto is set", async () => {
    const { result } = renderHook(() =>
      useRun({ endpoint: "/api/agent", fetchImpl: fixtureFetch(FIXTURE), auto: { prompt: "go" } }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("completed"));
    expect(result.current.state.output).toBe("4");
  });
});
```

- [ ] **Step 4: Run to verify it fails.** `bun test packages/react/tests/use-run.test.tsx --timeout 15000` → FAIL (module not found / no DOM).

- [ ] **Step 5: Implement `use-run.ts`.**

```tsx
// packages/react/src/hooks/use-run.ts
import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectRunStream,
  initialRunState,
  reduceRunState,
  type FetchLike,
  type RunState,
} from "@reactive-agents/ui-core";

export interface UseRunOptions {
  readonly endpoint: string;
  readonly fetchImpl?: FetchLike;
  readonly objectMode?: boolean;
  readonly auto?: { readonly prompt: string; readonly body?: Record<string, unknown> };
  readonly attach?: { readonly runId: string; readonly cursor?: number };
}

export interface UseRunReturn {
  readonly state: RunState;
  readonly run: (prompt: string, body?: Record<string, unknown>) => void;
  readonly cancel: () => void;
  readonly reattach: (runId: string, cursor?: number) => void;
}

export function useRun(opts: UseRunOptions): UseRunReturn {
  const [state, setState] = useState<RunState>(initialRunState);
  const abortRef = useRef<AbortController | null>(null);

  const drive = useCallback(
    (connectOpts: Parameters<typeof connectRunStream>[0]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState(initialRunState());
      void (async () => {
        let next = initialRunState();
        try {
          for await (const event of connectRunStream({ ...connectOpts, signal: controller.signal })) {
            next = reduceRunState(next, event, { objectMode: opts.objectMode });
            setState(next);
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          const cause = err instanceof Error ? err.message : String(err);
          setState((s) => ({ ...s, status: "error", error: cause }));
        }
      })();
    },
    [opts.objectMode],
  );

  const run = useCallback(
    (prompt: string, body?: Record<string, unknown>) =>
      drive({ endpoint: opts.endpoint, body: { prompt, ...body }, fetchImpl: opts.fetchImpl }),
    [drive, opts.endpoint, opts.fetchImpl],
  );

  const reattach = useCallback(
    (runId: string, cursor?: number) =>
      drive({ endpoint: opts.endpoint, attach: { runId, cursor }, fetchImpl: opts.fetchImpl }),
    [drive, opts.endpoint, opts.fetchImpl],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, status: "cancelled" }));
  }, []);

  // auto-run / attach on mount
  useEffect(() => {
    if (opts.attach) reattach(opts.attach.runId, opts.attach.cursor);
    else if (opts.auto) run(opts.auto.prompt, opts.auto.body);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, run, cancel, reattach };
}
```

- [ ] **Step 6: Export from index.** Add to `packages/react/src/index.ts` (keep existing exports at top):

```ts
export { useRun, type UseRunOptions, type UseRunReturn } from "./hooks/use-run.js";
// Re-export ui-core protocol + state types for consumers.
export type { RunState, UiStreamEvent, UiRunStatus, PendingInteractionWire } from "@reactive-agents/ui-core";
```

- [ ] **Step 7: Run tests + typecheck.** `bun test packages/react/tests/use-run.test.tsx --timeout 15000` → 2 pass. Then `cd packages/react && bunx tsc --noEmit`. (If tsc complains it can't find ui-core types, build ui-core first: `bunx turbo run build --filter=@reactive-agents/ui-core`.)

- [ ] **Step 8: Commit.**

```bash
rtk git add packages/react bun.lock
rtk git commit -m "feat(react): rewire package onto ui-core + core useRun hook + DOM test harness"
```

---

### Task 2: Rewire `useAgentStream` / `useAgent` onto `useRun` (back-compat)

**Files:**
- Modify: `packages/react/src/hooks/use-agent-stream.ts`
- Modify: `packages/react/src/hooks/use-agent.ts` (move both under `hooks/`; update `index.ts` import paths)
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/tests/back-compat.test.tsx`

**Interfaces:**
- Consumes: `useRun` (Task 1).
- Produces: unchanged `useAgentStream(endpoint, requestInit?): UseAgentStreamReturn` and `useAgent(endpoint, requestInit?): UseAgentReturn` (surfaces in `types.ts` are authoritative — do NOT change them).

- [ ] **Step 1: Move the two hook files** into `packages/react/src/hooks/` (git mv). Update the imports in `index.ts` to `./hooks/use-agent-stream.js` and `./hooks/use-agent.js`.

- [ ] **Step 2: Write the failing back-compat test.**

```tsx
// packages/react/tests/back-compat.test.tsx
import { describe, expect, test, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderHook, waitFor, act } from "@testing-library/react";
import { mockAgentEndpoint, type RunFixture } from "@reactive-agents/ui-core/testing";
import { useAgentStream } from "../src/hooks/use-agent-stream.js";
import { useAgent } from "../src/hooks/use-agent.js";

beforeAll(() => { if (!globalThis.document) GlobalRegistrator.register(); });

const FIXTURE: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "TextDelta", text: "hel", seq: 1 },
    { _tag: "TextDelta", text: "lo", seq: 2 },
    { _tag: "StreamCompleted", output: "hello", metadata: {}, seq: 3 },
  ],
};
const patchFetch = (fixture: RunFixture) => {
  const handler = mockAgentEndpoint(fixture);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(new Request(new URL(String(input), "http://ra.test").toString(), init))) as typeof fetch;
};

describe("back-compat", () => {
  test("useAgentStream preserves {text,status,output,run,cancel}", async () => {
    patchFetch(FIXTURE);
    const { result } = renderHook(() => useAgentStream("/api/agent"));
    act(() => result.current.run("hi"));
    await waitFor(() => expect(result.current.status).toBe("completed"));
    expect(result.current.text).toBe("hello");
    expect(result.current.output).toBe("hello");
  });

  test("useAgent preserves {output,loading,error,run(): Promise}", async () => {
    patchFetch(FIXTURE);
    const { result } = renderHook(() => useAgent("/api/agent"));
    let resolved = "";
    await act(async () => { resolved = await result.current.run("hi"); });
    expect(resolved).toBe("hello");
    expect(result.current.output).toBe("hello");
    expect(result.current.loading).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails.** `bun test packages/react/tests/back-compat.test.tsx --timeout 15000` → FAIL (moved paths / not yet rewired).

- [ ] **Step 4: Rewire `use-agent-stream.ts`** to delegate to `useRun`, mapping `RunState` → the legacy `UseAgentStreamReturn`:

```tsx
// packages/react/src/hooks/use-agent-stream.ts
import { useMemo } from "react";
import type { AgentHookState, AgentStreamEvent, UseAgentStreamReturn } from "../types.js";
import { useRun } from "./use-run.js";

const toLegacyStatus = (s: string): AgentHookState =>
  s === "streaming" || s === "awaiting-interaction" || s === "awaiting-approval"
    ? "streaming"
    : s === "completed"
    ? "completed"
    : s === "error"
    ? "error"
    : "idle";

export function useAgentStream(
  endpoint: string,
  requestInit?: Omit<RequestInit, "method" | "body" | "signal">,
): UseAgentStreamReturn {
  const { state, run, cancel } = useRun({ endpoint });
  return useMemo(
    () => ({
      text: state.text,
      events: state.events as unknown as AgentStreamEvent[],
      status: toLegacyStatus(state.status),
      error: state.error ?? null,
      output: state.output ?? null,
      run: (prompt: string, body?: Record<string, unknown>) => run(prompt, body),
      cancel,
    }),
    [state, run, cancel],
  );
}
```

(Note: `requestInit` headers are dropped in this pass — the legacy hook forwarded them to `fetch`; ui-core's `connectRunStream` doesn't yet take custom headers. If a test or consumer needs it, add a `headers` option to `ConnectOptions` in ui-core in a follow-up and thread it — log a gap entry. For P3, header-less parity is acceptable; the surface is unchanged.)

- [ ] **Step 5: Rewire `use-agent.ts`** to delegate to `useRun` and expose the promise-returning `run`:

```tsx
// packages/react/src/hooks/use-agent.ts
import { useCallback, useMemo, useRef } from "react";
import type { UseAgentReturn } from "../types.js";
import { useRun } from "./use-run.js";

export function useAgent(
  endpoint: string,
  _requestInit?: Omit<RequestInit, "method" | "body" | "signal">,
): UseAgentReturn {
  const { state, run } = useRun({ endpoint });
  const resolverRef = useRef<{ resolve: (v: string) => void; reject: (e: Error) => void } | null>(null);
  const lastStatus = useRef(state.status);

  // Resolve/reject the pending promise when the run terminates.
  if (lastStatus.current !== state.status) {
    lastStatus.current = state.status;
    if (state.status === "completed") resolverRef.current?.resolve(state.output ?? "");
    else if (state.status === "error") resolverRef.current?.reject(new Error(state.error ?? "run failed"));
  }

  const runPromise = useCallback(
    (prompt: string, body?: Record<string, unknown>) =>
      new Promise<string>((resolve, reject) => {
        resolverRef.current = { resolve, reject };
        run(prompt, body);
      }),
    [run],
  );

  return useMemo(
    () => ({
      output: state.output ?? null,
      loading: state.status === "streaming" || state.status === "awaiting-interaction" || state.status === "awaiting-approval",
      error: state.error ?? null,
      run: runPromise,
    }),
    [state.output, state.status, state.error, runPromise],
  );
}
```

- [ ] **Step 6: Run tests + typecheck.** `bun test packages/react/tests/back-compat.test.tsx packages/react/tests/use-run.test.tsx --timeout 15000` → all pass. `cd packages/react && bunx tsc --noEmit` clean.

- [ ] **Step 7: Commit.**

```bash
rtk git add packages/react
rtk git commit -m "refactor(react): rewire useAgentStream/useAgent onto useRun (surface unchanged)"
```

---

### Task 3: Resume — `useAgent({ runId })` reattach hook + component-free e2e

**Files:**
- Create: `packages/react/src/hooks/use-run.ts` already supports `attach` (Task 1); this task adds the ergonomic `useResumableRun` wrapper + tests the cursor path.
- Create: `packages/react/src/hooks/use-resumable-run.ts`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/tests/resume.test.tsx`

**Interfaces:**
- Consumes: `useRun` (`attach` option).
- Produces:
  ```ts
  interface UseResumableRunOptions { endpoint: string; runId: string; cursor?: number; fetchImpl?: FetchLike; objectMode?: boolean }
  function useResumableRun(opts: UseResumableRunOptions): UseRunReturn; // auto-attaches on mount
  ```

- [ ] **Step 1: Write the failing test** — a fixture whose first event is `RunAttached` then a completion, proving the hook reduces an attach-replay stream to completed:

```tsx
// packages/react/tests/resume.test.tsx
import { describe, expect, test, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderHook, waitFor } from "@testing-library/react";
import { mockAgentEndpoint, type RunFixture } from "@reactive-agents/ui-core/testing";
import type { FetchLike } from "@reactive-agents/ui-core";
import { useResumableRun } from "../src/hooks/use-resumable-run.js";

beforeAll(() => { if (!globalThis.document) GlobalRegistrator.register(); });

const ATTACH_FIXTURE: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "RunAttached", runId: "r7", status: "streaming", resumeCursor: 2, protocolVersion: 1, seq: 2 },
    { _tag: "TextDelta", text: "resumed", seq: 3 },
    { _tag: "StreamCompleted", output: "resumed answer", metadata: {}, runId: "r7", seq: 4 },
  ],
};
const fixtureFetch = (fixture: RunFixture): FetchLike => {
  const handler = mockAgentEndpoint(fixture);
  return async (input, init) => handler(new Request(new URL(String(input), "http://ra.test").toString(), init as RequestInit));
};

describe("useResumableRun", () => {
  test("auto-attaches on mount and completes from replay", async () => {
    const { result } = renderHook(() =>
      useResumableRun({ endpoint: "/api/agent", runId: "r7", cursor: 0, fetchImpl: fixtureFetch(ATTACH_FIXTURE) }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("completed"));
    expect(result.current.state.runId).toBe("r7");
    expect(result.current.state.output).toBe("resumed answer");
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `bun test packages/react/tests/resume.test.tsx --timeout 15000` → FAIL (module not found).

- [ ] **Step 3: Implement `use-resumable-run.ts`.**

```tsx
// packages/react/src/hooks/use-resumable-run.ts
import { useRun, type UseRunReturn } from "./use-run.js";
import type { FetchLike } from "@reactive-agents/ui-core";

export interface UseResumableRunOptions {
  readonly endpoint: string;
  readonly runId: string;
  readonly cursor?: number;
  readonly fetchImpl?: FetchLike;
  readonly objectMode?: boolean;
}

/** Reattach to a durable run on mount, replaying from the given cursor. */
export function useResumableRun(opts: UseResumableRunOptions): UseRunReturn {
  return useRun({
    endpoint: opts.endpoint,
    fetchImpl: opts.fetchImpl,
    objectMode: opts.objectMode,
    attach: { runId: opts.runId, cursor: opts.cursor },
  });
}
```

- [ ] **Step 4: Export from index.** Add:

```ts
export { useResumableRun, type UseResumableRunOptions } from "./hooks/use-resumable-run.js";
```

- [ ] **Step 5: Run + typecheck.** `bun test packages/react/tests/resume.test.tsx --timeout 15000` → pass. tsc clean.

- [ ] **Step 6: Commit.**

```bash
rtk git add packages/react
rtk git commit -m "feat(react): useResumableRun — reattach to a durable run from cursor"
```

---

### Task 4: Interact — `useInteractions` hook + AgentPrompt / ChoiceCard / ApprovalGate

**Files:**
- Create: `packages/react/src/hooks/use-interactions.ts`
- Create: `packages/react/src/components/AgentPrompt.tsx`
- Create: `packages/react/src/components/ChoiceCard.tsx`
- Create: `packages/react/src/components/ApprovalGate.tsx`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/tests/interactions.test.tsx`

**Interfaces:**
- Consumes: ui-core `RunState.pendingInteraction` / `pendingApproval`; the interaction/approval endpoints (over HTTP).
- Produces:
  ```ts
  // Two shapes: (a) drive from a live RunState (in-stream pause), (b) poll a pending-list endpoint (inbox-style).
  interface UseInteractionsOptions {
    readonly interactionEndpoint: string;   // POST {runId, interactionId, value}
    readonly fetchImpl?: FetchLike;
  }
  interface UseInteractionsReturn {
    readonly respond: (runId: string, interactionId: string, value: unknown) => Promise<{ success: boolean; output: string }>;
    readonly pending: boolean;               // a respond() is in flight
    readonly error: string | null;
  }
  function useInteractions(opts: UseInteractionsOptions): UseInteractionsReturn;

  // Components (headless-first):
  interface AgentPromptProps {
    readonly interaction: PendingInteractionWire;
    readonly onRespond: (value: unknown) => void;
    readonly className?: string;
    readonly children?: (ctx: { interaction: PendingInteractionWire; submit: (v: unknown) => void }) => React.ReactNode; // render-prop escape hatch
  }
  interface ApprovalGateProps {
    readonly approval: { runId: string; gateId: string; toolName: string; args: unknown };
    readonly onDecide: (decision: "approve" | "deny", reason?: string) => void;
    readonly className?: string;
  }
  ```

- [ ] **Step 1: Write the failing test** (hook posts to endpoint; AgentPrompt renders choice + submits; ApprovalGate fires decide):

```tsx
// packages/react/tests/interactions.test.tsx
import { describe, expect, test, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderHook, render, fireEvent, act } from "@testing-library/react";
import type { FetchLike, PendingInteractionWire } from "@reactive-agents/ui-core";
import { useInteractions } from "../src/hooks/use-interactions.js";
import { AgentPrompt } from "../src/components/AgentPrompt.js";
import { ApprovalGate } from "../src/components/ApprovalGate.js";

beforeAll(() => { if (!globalThis.document) GlobalRegistrator.register(); });

describe("Interact", () => {
  test("useInteractions.respond posts and returns success", async () => {
    let body: unknown;
    const fetchImpl: FetchLike = async (_i, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ success: true, output: "done" }), { status: 200 });
    };
    const { result } = renderHook(() => useInteractions({ interactionEndpoint: "/api/interaction", fetchImpl }));
    let res: { success: boolean; output: string } = { success: false, output: "" };
    await act(async () => { res = await result.current.respond("r1", "i1", "blue"); });
    expect(res.success).toBe(true);
    expect(body).toEqual({ runId: "r1", interactionId: "i1", value: "blue" });
  });

  test("AgentPrompt renders a choice interaction and submits the picked value", () => {
    const interaction: PendingInteractionWire = {
      runId: "r1", interactionId: "i1", kind: "choice", prompt: "Pick one", schema: { options: ["red", "blue"] },
    };
    let submitted: unknown;
    const { getByText } = render(<AgentPrompt interaction={interaction} onRespond={(v) => (submitted = v)} />);
    expect(getByText("Pick one")).toBeDefined();
    fireEvent.click(getByText("blue"));
    expect(submitted).toBe("blue");
  });

  test("ApprovalGate fires approve/deny", () => {
    let decision = "";
    const { getByText } = render(
      <ApprovalGate approval={{ runId: "r1", gateId: "g1", toolName: "shell", args: {} }} onDecide={(d) => (decision = d)} />,
    );
    fireEvent.click(getByText(/approve/i));
    expect(decision).toBe("approve");
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `bun test packages/react/tests/interactions.test.tsx --timeout 15000` → FAIL.

- [ ] **Step 3: Implement `use-interactions.ts`.**

```tsx
// packages/react/src/hooks/use-interactions.ts
import { useCallback, useState } from "react";
import type { FetchLike } from "@reactive-agents/ui-core";

export interface UseInteractionsOptions {
  readonly interactionEndpoint: string;
  readonly fetchImpl?: FetchLike;
}
export interface UseInteractionsReturn {
  readonly respond: (runId: string, interactionId: string, value: unknown) => Promise<{ success: boolean; output: string }>;
  readonly pending: boolean;
  readonly error: string | null;
}

export function useInteractions(opts: UseInteractionsOptions): UseInteractionsReturn {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchImpl = opts.fetchImpl ?? fetch;

  const respond = useCallback(
    async (runId: string, interactionId: string, value: unknown) => {
      setPending(true);
      setError(null);
      try {
        const res = await fetchImpl(opts.interactionEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, interactionId, value }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { success: boolean; output: string };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return { success: false, output: "" };
      } finally {
        setPending(false);
      }
    },
    [fetchImpl, opts.interactionEndpoint],
  );

  return { respond, pending, error };
}
```

- [ ] **Step 4: Implement `ChoiceCard.tsx`** (used by AgentPrompt for the choice kind):

```tsx
// packages/react/src/components/ChoiceCard.tsx
import * as React from "react";

export interface ChoiceCardProps {
  readonly options: readonly string[];
  readonly onPick: (value: string) => void;
  readonly className?: string;
}

export function ChoiceCard({ options, onPick, className }: ChoiceCardProps): React.ReactElement {
  return (
    <div className={className} data-ra-choice>
      {options.map((opt) => (
        <button key={opt} type="button" data-ra-choice-option={opt} onClick={() => onPick(opt)}>
          {opt}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Implement `AgentPrompt.tsx`** (renders form/choice/confirmation; parses `schema`):

```tsx
// packages/react/src/components/AgentPrompt.tsx
import * as React from "react";
import type { PendingInteractionWire } from "@reactive-agents/ui-core";
import { ChoiceCard } from "./ChoiceCard.js";

export interface AgentPromptProps {
  readonly interaction: PendingInteractionWire;
  readonly onRespond: (value: unknown) => void;
  readonly className?: string;
  readonly children?: (ctx: { interaction: PendingInteractionWire; submit: (v: unknown) => void }) => React.ReactNode;
}

interface FormField { readonly name: string; readonly label?: string; readonly type?: string; readonly required?: boolean }

export function AgentPrompt({ interaction, onRespond, className, children }: AgentPromptProps): React.ReactElement {
  if (children) return <>{children({ interaction, submit: onRespond })}</>;

  return (
    <div className={className} data-ra-prompt data-ra-kind={interaction.kind}>
      <p data-ra-prompt-text>{interaction.prompt}</p>
      {interaction.kind === "choice" && (
        <ChoiceCard
          options={((interaction.schema as { options?: readonly string[] })?.options) ?? []}
          onPick={onRespond}
        />
      )}
      {interaction.kind === "confirmation" && (
        <div data-ra-confirm>
          <button type="button" onClick={() => onRespond(true)}>Yes</button>
          <button type="button" onClick={() => onRespond(false)}>No</button>
        </div>
      )}
      {interaction.kind === "form" && (
        <FormFields
          fields={((interaction.schema as { fields?: readonly FormField[] })?.fields) ?? []}
          onSubmit={onRespond}
        />
      )}
    </div>
  );
}

function FormFields({ fields, onSubmit }: { fields: readonly FormField[]; onSubmit: (v: Record<string, string>) => void }): React.ReactElement {
  const [values, setValues] = React.useState<Record<string, string>>({});
  return (
    <form
      data-ra-form
      onSubmit={(e) => { e.preventDefault(); onSubmit(values); }}
    >
      {fields.map((f) => (
        <label key={f.name} data-ra-field={f.name}>
          {f.label ?? f.name}
          <input
            type={f.type === "number" ? "number" : "text"}
            required={f.required}
            value={values[f.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        </label>
      ))}
      <button type="submit">Submit</button>
    </form>
  );
}
```

- [ ] **Step 6: Implement `ApprovalGate.tsx`.**

```tsx
// packages/react/src/components/ApprovalGate.tsx
import * as React from "react";

export interface ApprovalGateProps {
  readonly approval: { readonly runId: string; readonly gateId: string; readonly toolName: string; readonly args: unknown };
  readonly onDecide: (decision: "approve" | "deny", reason?: string) => void;
  readonly className?: string;
}

export function ApprovalGate({ approval, onDecide, className }: ApprovalGateProps): React.ReactElement {
  return (
    <div className={className} data-ra-approval data-ra-tool={approval.toolName}>
      <p data-ra-approval-text>Approve tool call: <code>{approval.toolName}</code>?</p>
      <pre data-ra-approval-args>{JSON.stringify(approval.args, null, 2)}</pre>
      <button type="button" onClick={() => onDecide("approve")}>Approve</button>
      <button type="button" onClick={() => onDecide("deny", "denied by user")}>Deny</button>
    </div>
  );
}
```

- [ ] **Step 7: Export from index.**

```ts
export { useInteractions, type UseInteractionsOptions, type UseInteractionsReturn } from "./hooks/use-interactions.js";
export { AgentPrompt, type AgentPromptProps } from "./components/AgentPrompt.js";
export { ChoiceCard, type ChoiceCardProps } from "./components/ChoiceCard.js";
export { ApprovalGate, type ApprovalGateProps } from "./components/ApprovalGate.js";
```

- [ ] **Step 8: Run tests + typecheck.** `bun test packages/react/tests/interactions.test.tsx --timeout 15000` → 3 pass. tsc clean.

- [ ] **Step 9: Commit.**

```bash
rtk git add packages/react
rtk git commit -m "feat(react): Interact family — useInteractions + AgentPrompt/ChoiceCard/ApprovalGate"
```

---

### Task 5: Inbox — `useTaskInbox` + `<TaskInbox>`

**Files:**
- Create: `packages/react/src/hooks/use-task-inbox.ts`
- Create: `packages/react/src/components/TaskInbox.tsx`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/tests/inbox.test.tsx`

**Interfaces:**
- Consumes: the inbox endpoint (GET → `{runId, task, status, updatedAt}[]`).
- Produces:
  ```ts
  interface InboxRun { readonly runId: string; readonly task: string; readonly status: string; readonly updatedAt: number }
  interface UseTaskInboxOptions { endpoint: string; fetchImpl?: FetchLike; pollMs?: number }
  interface UseTaskInboxReturn { runs: readonly InboxRun[]; loading: boolean; error: string | null; refresh: () => void }
  function useTaskInbox(opts: UseTaskInboxOptions): UseTaskInboxReturn;

  interface TaskInboxProps {
    readonly runs: readonly InboxRun[];
    readonly onSelect?: (runId: string) => void;
    readonly className?: string;
    readonly renderRow?: (run: InboxRun) => React.ReactNode;
  }
  ```

- [ ] **Step 1: Write the failing test.**

```tsx
// packages/react/tests/inbox.test.tsx
import { describe, expect, test, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderHook, render, waitFor, fireEvent } from "@testing-library/react";
import type { FetchLike } from "@reactive-agents/ui-core";
import { useTaskInbox, type InboxRun } from "../src/hooks/use-task-inbox.js";
import { TaskInbox } from "../src/components/TaskInbox.js";

beforeAll(() => { if (!globalThis.document) GlobalRegistrator.register(); });

const RUNS: InboxRun[] = [
  { runId: "r1", task: "research part", status: "awaiting-interaction", updatedAt: 2 },
  { runId: "r2", task: "summarize", status: "completed", updatedAt: 1 },
];

describe("Inbox", () => {
  test("useTaskInbox fetches runs on mount", async () => {
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify(RUNS), { status: 200 });
    const { result } = renderHook(() => useTaskInbox({ endpoint: "/api/inbox", fetchImpl }));
    await waitFor(() => expect(result.current.runs.length).toBe(2));
    expect(result.current.runs[0]!.runId).toBe("r1");
  });

  test("TaskInbox renders rows and fires onSelect", () => {
    let picked = "";
    const { getByText } = render(<TaskInbox runs={RUNS} onSelect={(id) => (picked = id)} />);
    fireEvent.click(getByText(/research part/));
    expect(picked).toBe("r1");
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `bun test packages/react/tests/inbox.test.tsx --timeout 15000` → FAIL.

- [ ] **Step 3: Implement `use-task-inbox.ts`.**

```tsx
// packages/react/src/hooks/use-task-inbox.ts
import { useCallback, useEffect, useState } from "react";
import type { FetchLike } from "@reactive-agents/ui-core";

export interface InboxRun {
  readonly runId: string;
  readonly task: string;
  readonly status: string;
  readonly updatedAt: number;
}
export interface UseTaskInboxOptions {
  readonly endpoint: string;
  readonly fetchImpl?: FetchLike;
  readonly pollMs?: number;
}
export interface UseTaskInboxReturn {
  readonly runs: readonly InboxRun[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

export function useTaskInbox(opts: UseTaskInboxOptions): UseTaskInboxReturn {
  const [runs, setRuns] = useState<readonly InboxRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchImpl = opts.fetchImpl ?? fetch;

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetchImpl(opts.endpoint, { method: "GET" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setRuns((await res.json()) as InboxRun[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchImpl, opts.endpoint]);

  useEffect(() => {
    refresh();
    if (!opts.pollMs) return;
    const id = setInterval(refresh, opts.pollMs);
    return () => clearInterval(id);
  }, [refresh, opts.pollMs]);

  return { runs, loading, error, refresh };
}
```

- [ ] **Step 4: Implement `TaskInbox.tsx`.**

```tsx
// packages/react/src/components/TaskInbox.tsx
import * as React from "react";
import type { InboxRun } from "../hooks/use-task-inbox.js";

export interface TaskInboxProps {
  readonly runs: readonly InboxRun[];
  readonly onSelect?: (runId: string) => void;
  readonly className?: string;
  readonly renderRow?: (run: InboxRun) => React.ReactNode;
}

export function TaskInbox({ runs, onSelect, className, renderRow }: TaskInboxProps): React.ReactElement {
  return (
    <ul className={className} data-ra-inbox>
      {runs.map((run) => (
        <li key={run.runId} data-ra-inbox-row data-ra-status={run.status} onClick={() => onSelect?.(run.runId)}>
          {renderRow ? renderRow(run) : (
            <>
              <span data-ra-inbox-task>{run.task}</span>
              <span data-ra-inbox-status>{run.status}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Export from index.**

```ts
export { useTaskInbox, type UseTaskInboxOptions, type UseTaskInboxReturn, type InboxRun } from "./hooks/use-task-inbox.js";
export { TaskInbox, type TaskInboxProps } from "./components/TaskInbox.js";
```

- [ ] **Step 6: Run tests + typecheck.** `bun test packages/react/tests/inbox.test.tsx --timeout 15000` → 2 pass. tsc clean.

- [ ] **Step 7: Commit.**

```bash
rtk git add packages/react
rtk git commit -m "feat(react): Inbox family — useTaskInbox + TaskInbox"
```

---

### Task 6: Observe — `useRunCost` / `useRunSteps` + `<CostMeter>` / `<StepTimeline>`

**Files:**
- Create: `packages/react/src/hooks/use-run-cost.ts`
- Create: `packages/react/src/hooks/use-run-steps.ts`
- Create: `packages/react/src/components/CostMeter.tsx`
- Create: `packages/react/src/components/StepTimeline.tsx`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/tests/observe.test.tsx`

**Interfaces:**
- Consumes: `RunState` (`cost`, `events`).
- Produces:
  ```ts
  function useRunCost(state: RunState): { tokens: number; usd: number };
  interface StepEntry { readonly kind: "tool" | "thought" | "iteration"; readonly label: string; readonly seq?: number; readonly durationMs?: number; readonly success?: boolean }
  function useRunSteps(state: RunState): readonly StepEntry[];
  interface CostMeterProps { readonly state: RunState; readonly className?: string }
  interface StepTimelineProps { readonly state: RunState; readonly className?: string }
  ```
  `useRunSteps` derives entries from `state.events` by `_tag`: `ToolCallStarted`/`ToolCallCompleted` → `tool`, `ThoughtEmitted` → `thought`, `IterationProgress` → `iteration`.

- [ ] **Step 1: Write the failing test.**

```tsx
// packages/react/tests/observe.test.tsx
import { describe, expect, test, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderHook, render } from "@testing-library/react";
import { initialRunState, reduceRunState, type RunState, type SeqStamped, type UiStreamEvent } from "@reactive-agents/ui-core";
import { useRunCost } from "../src/hooks/use-run-cost.js";
import { useRunSteps } from "../src/hooks/use-run-steps.js";
import { CostMeter } from "../src/components/CostMeter.js";
import { StepTimeline } from "../src/components/StepTimeline.js";

beforeAll(() => { if (!globalThis.document) GlobalRegistrator.register(); });

const build = (events: SeqStamped<UiStreamEvent>[]): RunState =>
  events.reduce((s, e) => reduceRunState(s, e), initialRunState());

describe("Observe", () => {
  const state = build([
    { _tag: "ToolCallStarted", toolName: "web-search", callId: "c1", seq: 1 },
    { _tag: "ToolCallCompleted", toolName: "web-search", callId: "c1", durationMs: 120, success: true, seq: 2 },
    { _tag: "CostDelta", tokens: 42, usd: 0.01, seq: 3 },
  ]);

  test("useRunCost reads cost from state", () => {
    const { result } = renderHook(() => useRunCost(state));
    expect(result.current).toEqual({ tokens: 42, usd: 0.01 });
  });

  test("useRunSteps derives a tool entry", () => {
    const { result } = renderHook(() => useRunSteps(state));
    const tool = result.current.find((e) => e.kind === "tool" && e.label.includes("web-search"));
    expect(tool).toBeDefined();
    expect(tool?.success).toBe(true);
  });

  test("CostMeter + StepTimeline render", () => {
    const { getByTestId } = render(<div><CostMeter state={state} /><StepTimeline state={state} /></div>);
    // no throw; DOM present
    expect(document.querySelector("[data-ra-cost]")).not.toBeNull();
    expect(document.querySelector("[data-ra-timeline]")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `bun test packages/react/tests/observe.test.tsx --timeout 15000` → FAIL.

- [ ] **Step 3: Implement `use-run-cost.ts`.**

```tsx
// packages/react/src/hooks/use-run-cost.ts
import { useMemo } from "react";
import type { RunState } from "@reactive-agents/ui-core";

export function useRunCost(state: RunState): { tokens: number; usd: number } {
  return useMemo(() => state.cost ?? { tokens: 0, usd: 0 }, [state.cost]);
}
```

- [ ] **Step 4: Implement `use-run-steps.ts`.**

```tsx
// packages/react/src/hooks/use-run-steps.ts
import { useMemo } from "react";
import type { RunState } from "@reactive-agents/ui-core";

export interface StepEntry {
  readonly kind: "tool" | "thought" | "iteration";
  readonly label: string;
  readonly seq?: number;
  readonly durationMs?: number;
  readonly success?: boolean;
}

export function useRunSteps(state: RunState): readonly StepEntry[] {
  return useMemo(() => {
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
  }, [state.events]);
}
```

- [ ] **Step 5: Implement `CostMeter.tsx` + `StepTimeline.tsx`.**

```tsx
// packages/react/src/components/CostMeter.tsx
import * as React from "react";
import type { RunState } from "@reactive-agents/ui-core";
import { useRunCost } from "../hooks/use-run-cost.js";

export interface CostMeterProps { readonly state: RunState; readonly className?: string }

export function CostMeter({ state, className }: CostMeterProps): React.ReactElement {
  const { tokens, usd } = useRunCost(state);
  return (
    <div className={className} data-ra-cost data-ra-usd={usd} data-ra-tokens={tokens}>
      <span data-ra-cost-usd>${usd.toFixed(4)}</span>
      <span data-ra-cost-tokens>{tokens} tok</span>
    </div>
  );
}
```

```tsx
// packages/react/src/components/StepTimeline.tsx
import * as React from "react";
import type { RunState } from "@reactive-agents/ui-core";
import { useRunSteps } from "../hooks/use-run-steps.js";

export interface StepTimelineProps { readonly state: RunState; readonly className?: string }

export function StepTimeline({ state, className }: StepTimelineProps): React.ReactElement {
  const steps = useRunSteps(state);
  return (
    <ol className={className} data-ra-timeline>
      {steps.map((s, i) => (
        <li key={`${s.seq ?? i}-${s.kind}`} data-ra-step={s.kind} data-ra-success={s.success}>
          {s.label}{s.durationMs !== undefined ? ` (${s.durationMs}ms)` : ""}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 6: Export from index.**

```ts
export { useRunCost } from "./hooks/use-run-cost.js";
export { useRunSteps, type StepEntry } from "./hooks/use-run-steps.js";
export { CostMeter, type CostMeterProps } from "./components/CostMeter.js";
export { StepTimeline, type StepTimelineProps } from "./components/StepTimeline.js";
```

- [ ] **Step 7: Run tests + typecheck.** `bun test packages/react/tests/observe.test.tsx --timeout 15000` → 3 pass. tsc clean.

- [ ] **Step 8: Commit.**

```bash
rtk git add packages/react
rtk git commit -m "feat(react): Observe family — useRunCost/useRunSteps + CostMeter/StepTimeline"
```

---

### Task 7: Render — UI-tree registry, `uiTreeSchema()`, `<AgentSurface>`

**Files:**
- Create: `packages/react/src/components/render/registry.ts`
- Create: `packages/react/src/components/render/AgentSurface.tsx`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/tests/render.test.tsx`

**Interfaces:**
- Consumes: `RunState.object` (populated when `useRun({ objectMode: true })` streams a UI tree via `streamObject`).
- Produces:
  ```ts
  interface UiNode { readonly type: string; readonly props?: Record<string, unknown>; readonly children?: readonly UiNode[]; readonly key?: string }
  type ComponentRegistry = Record<string, React.ComponentType<{ node: UiNode; children?: React.ReactNode }>>;
  function uiTreeSchema(registry: ComponentRegistry): { type: "object"; properties: Record<string, unknown> }; // a JSON-schema-ish descriptor constraining `type` to registry keys
  interface AgentSurfaceProps { readonly tree: unknown; readonly registry: ComponentRegistry; readonly className?: string }
  function AgentSurface(props: AgentSurfaceProps): React.ReactElement;
  ```
  Security stance (spec §4.4): `AgentSurface` renders ONLY registered node types; an unknown `type` renders a `data-ra-unknown` placeholder, never arbitrary HTML.

- [ ] **Step 1: Write the failing test.**

```tsx
// packages/react/tests/render.test.tsx
import { describe, expect, test, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render } from "@testing-library/react";
import * as React from "react";
import { AgentSurface, uiTreeSchema, type UiNode, type ComponentRegistry } from "../src/components/render/AgentSurface.js";

beforeAll(() => { if (!globalThis.document) GlobalRegistrator.register(); });

const registry: ComponentRegistry = {
  card: ({ children }) => <section data-ra-node="card">{children}</section>,
  text: ({ node }) => <p data-ra-node="text">{String(node.props?.value ?? "")}</p>,
};

describe("Render", () => {
  test("uiTreeSchema constrains type to registry keys", () => {
    const schema = uiTreeSchema(registry);
    const json = JSON.stringify(schema);
    expect(json).toContain("card");
    expect(json).toContain("text");
  });

  test("AgentSurface renders a registered tree progressively", () => {
    const tree: UiNode = { type: "card", children: [{ type: "text", props: { value: "hi" } }] };
    const { getByText } = render(<AgentSurface tree={tree} registry={registry} />);
    expect(getByText("hi")).toBeDefined();
  });

  test("unknown node type renders a safe placeholder, not markup", () => {
    const tree = { type: "script", props: { value: "<img onerror=alert(1)>" } };
    const { container } = render(<AgentSurface tree={tree} registry={registry} />);
    expect(container.querySelector("[data-ra-unknown]")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  test("partial/incomplete tree does not throw", () => {
    const partial = { type: "card", children: [{ type: "text" }, { }] };
    const { container } = render(<AgentSurface tree={partial} registry={registry} />);
    expect(container).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `bun test packages/react/tests/render.test.tsx --timeout 15000` → FAIL.

- [ ] **Step 3: Implement `registry.ts`.**

```tsx
// packages/react/src/components/render/registry.ts
import type * as React from "react";

export interface UiNode {
  readonly type: string;
  readonly props?: Record<string, unknown>;
  readonly children?: readonly UiNode[];
  readonly key?: string;
}

export type ComponentRegistry = Record<
  string,
  React.ComponentType<{ node: UiNode; children?: React.ReactNode }>
>;

/**
 * A JSON-schema-ish descriptor whose `type` field is an enum over the
 * registry's keys — pass to `.withOutputSchema(uiTreeSchema(registry))` on the
 * server so the model can only emit registered node types (hallucinated
 * components are unrepresentable, not merely rejected).
 */
export function uiTreeSchema(registry: ComponentRegistry): {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
} {
  const nodeTypes = Object.keys(registry);
  return {
    type: "object",
    properties: {
      type: { enum: nodeTypes },
      props: { type: "object" },
      children: { type: "array" },
      key: { type: "string" },
    },
  };
}

export function isUiNode(value: unknown): value is UiNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}
```

- [ ] **Step 4: Implement `AgentSurface.tsx`.**

```tsx
// packages/react/src/components/render/AgentSurface.tsx
import * as React from "react";
import { isUiNode, type ComponentRegistry, type UiNode } from "./registry.js";

export type { UiNode, ComponentRegistry } from "./registry.js";
export { uiTreeSchema } from "./registry.js";

export interface AgentSurfaceProps {
  readonly tree: unknown;
  readonly registry: ComponentRegistry;
  readonly className?: string;
}

function RenderNode({ node, registry }: { node: unknown; registry: ComponentRegistry }): React.ReactElement | null {
  if (!isUiNode(node)) return null;
  const Comp = registry[node.type];
  if (!Comp) return <span data-ra-unknown={node.type} />;
  const kids = (node.children ?? []).map((child, i) => (
    <RenderNode key={(child as UiNode).key ?? i} node={child} registry={registry} />
  ));
  return <Comp node={node}>{kids}</Comp>;
}

export function AgentSurface({ tree, registry, className }: AgentSurfaceProps): React.ReactElement {
  return (
    <div className={className} data-ra-surface>
      <RenderNode node={tree} registry={registry} />
    </div>
  );
}
```

- [ ] **Step 5: Export from index.**

```ts
export { AgentSurface, type AgentSurfaceProps, type UiNode, type ComponentRegistry, uiTreeSchema } from "./components/render/AgentSurface.js";
```

- [ ] **Step 6: Run tests + typecheck.** `bun test packages/react/tests/render.test.tsx --timeout 15000` → 4 pass. tsc clean.

- [ ] **Step 7: Commit.**

```bash
rtk git add packages/react
rtk git commit -m "feat(react): Render family — registry + uiTreeSchema + AgentSurface (allowlist, no arbitrary markup)"
```

---

### Task 8: Devtools — `<AgentDevtools>` overlay + testing re-export + final gate

**Files:**
- Create: `packages/react/src/components/AgentDevtools.tsx`
- Create: `packages/react/src/testing.ts`
- Create: `packages/react/src/styles.ts`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/tests/devtools.test.tsx`

**Interfaces:**
- Consumes: `RunState`, `useRunSteps`, `useRunCost`.
- Produces:
  ```ts
  interface AgentDevtoolsProps {
    readonly state: RunState;
    readonly enabled?: boolean;        // default: process.env.NODE_ENV !== "production"
    readonly onReplay?: () => void;    // wire to reattach/re-run
    readonly position?: "bottom-right" | "bottom-left";
  }
  function AgentDevtools(props: AgentDevtoolsProps): React.ReactElement | null;
  ```
  `src/testing.ts` re-exports `recordRunFixture`, `mockAgentEndpoint`, `fixtureToSSE`, `type RunFixture` from `@reactive-agents/ui-core/testing` so React consumers import test helpers from one place.

- [ ] **Step 1: Write the failing test.**

```tsx
// packages/react/tests/devtools.test.tsx
import { describe, expect, test, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render, fireEvent } from "@testing-library/react";
import { initialRunState, reduceRunState, type RunState } from "@reactive-agents/ui-core";
import { AgentDevtools } from "../src/components/AgentDevtools.js";

beforeAll(() => { if (!globalThis.document) GlobalRegistrator.register(); });

const state: RunState = reduceRunState(
  reduceRunState(initialRunState(), { _tag: "ToolCallStarted", toolName: "web-search", callId: "c1", seq: 1 }),
  { _tag: "CostDelta", tokens: 10, usd: 0.002, seq: 2 },
);

describe("AgentDevtools", () => {
  test("hidden when enabled=false", () => {
    const { container } = render(<AgentDevtools state={state} enabled={false} />);
    expect(container.querySelector("[data-ra-devtools]")).toBeNull();
  });

  test("shows overlay with cost + steps + replay when enabled", () => {
    let replayed = false;
    const { container, getByText } = render(<AgentDevtools state={state} enabled onReplay={() => (replayed = true)} />);
    expect(container.querySelector("[data-ra-devtools]")).not.toBeNull();
    fireEvent.click(getByText(/replay/i));
    expect(replayed).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** `bun test packages/react/tests/devtools.test.tsx --timeout 15000` → FAIL.

- [ ] **Step 3: Implement `AgentDevtools.tsx`** (composes the already-built Observe pieces + a replay button — bounded, per spec §5 "Devtools bounded to Observe hooks + replay"):

```tsx
// packages/react/src/components/AgentDevtools.tsx
import * as React from "react";
import type { RunState } from "@reactive-agents/ui-core";
import { CostMeter } from "./CostMeter.js";
import { StepTimeline } from "./StepTimeline.js";

export interface AgentDevtoolsProps {
  readonly state: RunState;
  readonly enabled?: boolean;
  readonly onReplay?: () => void;
  readonly position?: "bottom-right" | "bottom-left";
}

export function AgentDevtools({ state, enabled, onReplay, position = "bottom-right" }: AgentDevtoolsProps): React.ReactElement | null {
  const show = enabled ?? (typeof process !== "undefined" && process.env?.NODE_ENV !== "production");
  const [open, setOpen] = React.useState(true);
  if (!show) return null;
  return (
    <div data-ra-devtools data-ra-position={position} style={{ position: "fixed", [position.endsWith("right") ? "right" : "left"]: 8, bottom: 8, zIndex: 99999 }}>
      <button type="button" data-ra-devtools-toggle onClick={() => setOpen((o) => !o)}>
        RA · {state.status}
      </button>
      {open && (
        <div data-ra-devtools-panel>
          <CostMeter state={state} />
          <StepTimeline state={state} />
          <div data-ra-devtools-actions>
            <span data-ra-devtools-runid>{state.runId ?? "(no run)"}</span>
            {onReplay && <button type="button" onClick={onReplay}>Replay</button>}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `src/testing.ts`.**

```ts
// packages/react/src/testing.ts
/** React-side re-export of ui-core's fixture testing API (zero-token UI tests). */
export { recordRunFixture, mockAgentEndpoint, fixtureToSSE, type RunFixture } from "@reactive-agents/ui-core/testing";
```

- [ ] **Step 5: Create `src/styles.ts`** (opt-in styled-reference presets — minimal className maps, no CSS import):

```ts
// packages/react/src/styles.ts
/**
 * Opt-in class-name presets for the reference components. Consumers pass these
 * to the components' `className` props for a styled default; the components
 * themselves ship unstyled (headless-first). Pair with your own CSS that
 * targets these class names or the `data-ra-*` attributes.
 */
export const raStyles = {
  prompt: "ra-prompt",
  choice: "ra-choice",
  approval: "ra-approval",
  inbox: "ra-inbox",
  cost: "ra-cost",
  timeline: "ra-timeline",
  surface: "ra-surface",
} as const;
```

- [ ] **Step 6: Export from index.**

```ts
export { AgentDevtools, type AgentDevtoolsProps } from "./components/AgentDevtools.js";
```

- [ ] **Step 7: Run devtools test + FULL package gate.**

```bash
bun test packages/react --timeout 30000
cd packages/react && bun run build && bunx tsc --noEmit
```
Expected: all react tests green; tsup emits `dist/index.js`, `dist/testing.js`, `dist/styles.js` + d.ts; tsc clean.

- [ ] **Step 8: Cross-package build gate** (ensure ui-core + react build together, no drift):

```bash
bunx turbo run build --filter=@reactive-agents/ui-core --filter=@reactive-agents/react
```
Expected: both green.

- [ ] **Step 9: Commit.**

```bash
rtk git add packages/react bun.lock
rtk git commit -m "feat(react): AgentDevtools overlay + testing/styles subpaths — P3 React binding complete"
```

---

## Completion Criteria (P3 done =)

1. `bun test packages/react` green (all family tests + back-compat), keyless + offline via fixtures.
2. Existing `useAgentStream`/`useAgent` surfaces unchanged (back-compat test proves it).
3. Every v1 family has a React hook + at least one reference component: Resume (`useResumableRun`), Interact (`useInteractions` + AgentPrompt/ChoiceCard/ApprovalGate), Inbox (`useTaskInbox` + TaskInbox), Render (AgentSurface + registry + uiTreeSchema), Observe (useRunCost/useRunSteps + CostMeter/StepTimeline), Devtools (AgentDevtools).
4. Zero duplication of protocol/parse/stream logic — all delegated to ui-core.
5. `bunx tsc --noEmit` clean in `packages/react`; no `any`.
6. Package builds 3 entries (`.`, `./testing`, `./styles`); react is a peer dep, ui-core a real dependency.
7. AgentSurface renders only registered node types (security test passes).

## What follows (separate plans)

- **P4:** Vue + Svelte hook/composable parity + reference-component ports, driven by the same ui-core surface and the shared fixture format (`recordRunFixture`).
- **P5:** `apps/ui-demo` flagship ops-assistant + docs guides + `create-reactive-agent --template next-inbox`.
- **Cortex svelte integration** (separate effort): wire these families into `apps/cortex` via the Svelte binding (see `2026-07-02-agentic-ui-kit-cortex-showcase.md`).
