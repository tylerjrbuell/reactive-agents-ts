# Agentic UI Kit — Plan 1: ui-core Shared Controllers + React Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the framework-agnostic UI logic that currently lives React-local (generative-UI tree schema + reconcile, task-inbox fetch, interaction/approval POST) into `@reactive-agents/ui-core`, then rewire React onto it with zero behavior change — so Svelte and Vue bindings (Plans 2–3) reuse one shared implementation instead of triplicating it.

**Architecture:** `ui-core` gains three headless, dependency-free modules (`render/tree.ts`, `inbox/controller.ts`, `interaction/controller.ts`). React's `registry.ts`, `AgentSurface.tsx`, `use-task-inbox.ts`, and `use-interactions.ts` are rewired to import from ui-core; React keeps only the reactivity glue and the React-typed `ComponentRegistry`. A new `decideApproval()` helper closes a real gap (no approval-decision POST helper exists today — `ApprovalGate` leaves the POST to consumers). All exports additive; no public React signature changes.

**Tech Stack:** TypeScript strict (no `any`), `@reactive-agents/ui-core` (Effect-free, dependency-free, browser-safe — **no `react` import may enter ui-core**), Bun test runner, tsup build (single `src/index.ts` entry — new modules bundle transitively via index imports, no build-script change).

## Global Constraints

- Strict TypeScript. **No `any` casts** — use `unknown` + guards or proper types.
- `packages/ui-core` is **Effect-free and dependency-free by design** (runs in browsers). It must NOT import `react`, `vue`, `svelte`, `effect`, or any workspace package. Internal cross-module imports use relative `./` / `../` paths with `.js` extensions.
- All tests pass **keyless** (no `.env`, no Ollama): pure functions + mocked `fetch`. Never touch a real provider.
- **Additive-only public API:** never remove or rename existing exports of `@reactive-agents/{react,ui-core}`. Types moved to ui-core must be **re-exported** from their old React location so downstream imports keep resolving.
- Under Bun, `@reactive-agents/*` resolve from `src/` (the `bun` export condition) — editing ui-core `src` is live for React tests with **zero rebuild** (only rebuild for npm-publish / Node-runtime / `.d.ts` validation).
- Commit after every task (conventional commits, **no AI co-author trailers**).
- Prefix shell commands with `rtk` where supported (`rtk git`, `rtk grep`).
- Do NOT touch `packages/benchmarks` (uncommitted WIP).
- Log any framework friction to `wiki/Research/2026-07-agentic-ui-gap-log.md` (spec §10).

## Verified Anchors (from codebase mapping 2026-07-05 — trust these, re-verify only if a step fails)

- `FetchLike` type: `packages/ui-core/src/stream/connect.ts:15-18` — `(input: string | URL | Request, init?: RequestInit) => Promise<Response>`; re-exported from `ui-core` index.
- ui-core index exports today (`packages/ui-core/src/index.ts`): `./protocol/events.js` (`*`), `./parse-partial.js` (`*`), `connectRunStream`+`ConnectOptions`+`FetchLike` from `./stream/connect.js`, `initialRunState`/`reduceRunState`/`RunState`/`ReduceOptions` from `./state/run-machine.js`.
- ui-core build: `packages/ui-core/package.json:29` — `tsup src/index.ts src/testing/fixtures.ts --format esm --dts --out-dir dist`. New `src/render|inbox|interaction/*.ts` bundle into `index.js` via `index.ts` re-exports — **no build-script edit needed**.
- React registry (to lift): `packages/react/src/components/render/registry.ts:1-39` — `UiNode`, `ComponentRegistry` (React-typed), `uiTreeSchema(registry)`, `isUiNode`.
- React AgentSurface (consumer): `packages/react/src/components/render/AgentSurface.tsx:1-30` — imports `{ isUiNode, type ComponentRegistry }` from `./registry.js`; re-exports `type { UiNode, ComponentRegistry }` + `{ uiTreeSchema }`.
- React task-inbox (to lift): `packages/react/src/hooks/use-task-inbox.ts:1-54` — `InboxRun` type + fetch/json/ok logic in `refresh`.
- React interactions (to lift): `packages/react/src/hooks/use-interactions.ts:1-43` — `respond` POSTs `{runId,interactionId,value}`, returns `{success,output}`.
- React ApprovalGate: `packages/react/src/components/ApprovalGate.tsx:1-24` — fires `onDecide("approve"|"deny", reason?)` callback; **no POST helper exists** (the gap `decideApproval` fills).
- React public re-exports (`packages/react/src/index.ts`): `type InboxRun` from `./hooks/use-task-inbox.js`; `AgentSurface`/`UiNode`/`ComponentRegistry`/`uiTreeSchema` from `./components/render/AgentSurface.js`; `useInteractions` from `./hooks/use-interactions.js`. All must keep resolving.
- Fixture testing API (unchanged reference): `packages/ui-core/src/testing/fixtures.ts` — `recordRunFixture`, `fixtureToSSE`, `mockAgentEndpoint`.

## File Structure

```
packages/ui-core/src/
  render/tree.ts             NEW — UiNode, isUiNode, uiTreeSchema, reconcileUiTree (NO react import)
  inbox/controller.ts        NEW — InboxRun, fetchInbox
  interaction/controller.ts  NEW — InteractionResult, respondToInteraction, decideApproval
  index.ts                   MODIFY — export the three modules
packages/ui-core/tests/
  render-tree.test.ts        NEW
  inbox-controller.test.ts   NEW
  interaction-controller.test.ts NEW

packages/react/src/
  components/render/registry.ts    MODIFY — re-export node types/schema from ui-core; keep React-typed ComponentRegistry
  components/render/AgentSurface.tsx MODIFY — none required (imports flow through registry.js) — verify only
  hooks/use-task-inbox.ts          MODIFY — call ui-core fetchInbox; re-export InboxRun from ui-core
  hooks/use-interactions.ts        MODIFY — call ui-core respondToInteraction
```

Dependency direction: `ui-core` depends on nothing; `react` depends on `ui-core`. Never the reverse.

---

### Task 1: ui-core render tree module — `UiNode` schema, `uiTreeSchema`, `reconcileUiTree`

**Files:**
- Create: `packages/ui-core/src/render/tree.ts`
- Modify: `packages/ui-core/src/index.ts`
- Test: `packages/ui-core/tests/render-tree.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (React backfill + Plans 2–3 consume these):
  - `interface UiNode { readonly type: string; readonly props?: Record<string, unknown>; readonly children?: readonly UiNode[]; readonly key?: string }`
  - `isUiNode(value: unknown): value is UiNode`
  - `uiTreeSchema(registry: Record<string, unknown>): { readonly type: "object"; readonly properties: Record<string, unknown> }` — `type` enum over `Object.keys(registry)` (widened from React's `ComponentRegistry` param so any binding's registry-like object works; `ComponentRegistry` is assignable).
  - `reconcileUiTree(prev: UiNode | undefined, partial: unknown): UiNode | undefined` — pure progressive merge: partial's fields win, `props` shallow-merged, `children` merged positionally + recursively. Non-node `partial` returns `prev` unchanged. (Forward-compat for `UiTreeDelta`/`ObjectDelta` progressive render; server does not emit these in v1.)

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui-core/tests/render-tree.test.ts
import { describe, expect, test } from "bun:test";
import { isUiNode, uiTreeSchema, reconcileUiTree } from "../src/render/tree.js";
import type { UiNode } from "../src/render/tree.js";

describe("isUiNode", () => {
  test("accepts a node with a string type", () => {
    expect(isUiNode({ type: "card" })).toBe(true);
  });
  test("rejects non-objects and typeless objects", () => {
    expect(isUiNode(null)).toBe(false);
    expect(isUiNode("card")).toBe(false);
    expect(isUiNode({ props: {} })).toBe(false);
    expect(isUiNode({ type: 42 })).toBe(false);
  });
});

describe("uiTreeSchema", () => {
  test("type enum is the registry keys", () => {
    const schema = uiTreeSchema({ card: {}, table: {} });
    expect(schema.type).toBe("object");
    expect((schema.properties.type as { enum: string[] }).enum).toEqual(["card", "table"]);
  });
});

describe("reconcileUiTree", () => {
  test("undefined prev returns the partial as the tree", () => {
    const out = reconcileUiTree(undefined, { type: "card", props: { title: "a" } });
    expect(out).toEqual({ type: "card", props: { title: "a" } });
  });
  test("non-node partial keeps prev unchanged", () => {
    const prev: UiNode = { type: "card", props: { title: "a" } };
    expect(reconcileUiTree(prev, "not a node")).toEqual(prev);
    expect(reconcileUiTree(prev, undefined)).toEqual(prev);
  });
  test("shallow-merges props, partial wins per key", () => {
    const out = reconcileUiTree(
      { type: "card", props: { title: "a", body: "old" } },
      { type: "card", props: { body: "new" } },
    );
    expect(out?.props).toEqual({ title: "a", body: "new" });
  });
  test("merges children positionally and recursively", () => {
    const prev: UiNode = {
      type: "list",
      children: [{ type: "row", props: { id: 1 } }],
    };
    const partial = {
      type: "list",
      children: [{ type: "row", props: { label: "one" } }, { type: "row", props: { id: 2 } }],
    };
    const out = reconcileUiTree(prev, partial);
    expect(out?.children?.[0]).toEqual({ type: "row", props: { id: 1, label: "one" } });
    expect(out?.children?.[1]).toEqual({ type: "row", props: { id: 2 } });
  });
  test("preserves key from partial then prev", () => {
    expect(reconcileUiTree({ type: "card", key: "k1" }, { type: "card" })?.key).toBe("k1");
    expect(reconcileUiTree({ type: "card", key: "k1" }, { type: "card", key: "k2" })?.key).toBe("k2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui-core/tests/render-tree.test.ts`
Expected: FAIL — cannot resolve `../src/render/tree.js`.

- [ ] **Step 3: Implement the module**

```ts
// packages/ui-core/src/render/tree.ts
/**
 * Framework-agnostic generative-UI tree: node schema, registry-driven output
 * schema, and a pure progressive-render reconcile. No DOM, no framework deps.
 * Bindings (react/vue/svelte) provide the render surface; this owns the logic.
 */
export interface UiNode {
  readonly type: string;
  readonly props?: Record<string, unknown>;
  readonly children?: readonly UiNode[];
  readonly key?: string;
}

export const isUiNode = (value: unknown): value is UiNode =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

/**
 * A JSON-schema-ish descriptor whose `type` field is an enum over the
 * registry's keys — pass to `.withOutputSchema(uiTreeSchema(registry))` on the
 * server so the model can only emit registered node types (hallucinated
 * components are unrepresentable, not merely rejected). Accepts any
 * registry-like object; a binding's typed `ComponentRegistry` is assignable.
 */
export function uiTreeSchema(registry: Record<string, unknown>): {
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

/**
 * Merge a streamed partial tree onto the accumulated tree. Partial's fields
 * win; `props` shallow-merge; `children` merge positionally and recursively.
 * A non-node partial leaves `prev` untouched (tolerant of noise mid-stream).
 */
export const reconcileUiTree = (
  prev: UiNode | undefined,
  partial: unknown,
): UiNode | undefined => {
  if (!isUiNode(partial)) return prev;
  if (prev === undefined) return partial;

  const prevKids = prev.children ?? [];
  const partialKids = partial.children ?? [];
  const len = Math.max(prevKids.length, partialKids.length);
  const children: UiNode[] = [];
  for (let i = 0; i < len; i++) {
    const merged = reconcileUiTree(prevKids[i], partialKids[i]);
    if (merged !== undefined) children.push(merged);
  }

  const key = partial.key ?? prev.key;
  const merged: UiNode = {
    type: partial.type,
    props: { ...prev.props, ...partial.props },
    ...(children.length > 0 ? { children } : {}),
    ...(key !== undefined ? { key } : {}),
  };
  return merged;
};
```

- [ ] **Step 4: Export from index** — add to `packages/ui-core/src/index.ts`:

```ts
export { type UiNode, isUiNode, uiTreeSchema, reconcileUiTree } from "./render/tree.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/ui-core/tests/render-tree.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/ui-core/src/render packages/ui-core/src/index.ts packages/ui-core/tests/render-tree.test.ts
rtk git commit -m "feat(ui-core): framework-agnostic UI-tree schema + progressive reconcile"
```

---

### Task 2: ui-core inbox controller — `InboxRun`, `fetchInbox`

**Files:**
- Create: `packages/ui-core/src/inbox/controller.ts`
- Modify: `packages/ui-core/src/index.ts`
- Test: `packages/ui-core/tests/inbox-controller.test.ts`

**Interfaces:**
- Consumes: `FetchLike` from `../stream/connect.js`.
- Produces:
  - `interface InboxRun { readonly runId: string; readonly task: string; readonly status: string; readonly updatedAt: number }`
  - `fetchInbox(opts: { readonly endpoint: string; readonly fetchImpl?: FetchLike }): Promise<readonly InboxRun[]>` — GET `endpoint`, throw `Error("HTTP <status>")` on non-ok, else parse JSON array. (Reactivity/polling stays in the binding; this owns fetch + validation.)

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui-core/tests/inbox-controller.test.ts
import { describe, expect, test } from "bun:test";
import { fetchInbox, type InboxRun } from "../src/inbox/controller.js";
import type { FetchLike } from "../src/stream/connect.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("fetchInbox", () => {
  test("GETs the endpoint and returns the run array", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const rows: InboxRun[] = [{ runId: "r1", task: "t", status: "completed", updatedAt: 5 }];
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return jsonResponse(rows);
    };
    const out = await fetchInbox({ endpoint: "/api/inbox", fetchImpl });
    expect(out).toEqual(rows);
    expect(calls[0]).toEqual({ url: "/api/inbox", method: "GET" });
  });

  test("throws on non-ok status", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error: "nope" }, 500);
    await expect(fetchInbox({ endpoint: "/api/inbox", fetchImpl })).rejects.toThrow("HTTP 500");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui-core/tests/inbox-controller.test.ts`
Expected: FAIL — cannot resolve `../src/inbox/controller.js`.

- [ ] **Step 3: Implement the module**

```ts
// packages/ui-core/src/inbox/controller.ts
import type { FetchLike } from "../stream/connect.js";

/** A durable run as surfaced by the inbox endpoint (createInboxEndpoint). */
export interface InboxRun {
  readonly runId: string;
  readonly task: string;
  readonly status: string;
  readonly updatedAt: number;
}

/** Fetch the durable-run inbox for the resolved identity. Throws on non-ok. */
export const fetchInbox = async (opts: {
  readonly endpoint: string;
  readonly fetchImpl?: FetchLike;
}): Promise<readonly InboxRun[]> => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(opts.endpoint, { method: "GET" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as InboxRun[];
};
```

- [ ] **Step 4: Export from index** — add to `packages/ui-core/src/index.ts`:

```ts
export { type InboxRun, fetchInbox } from "./inbox/controller.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/ui-core/tests/inbox-controller.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/ui-core/src/inbox packages/ui-core/src/index.ts packages/ui-core/tests/inbox-controller.test.ts
rtk git commit -m "feat(ui-core): task-inbox fetch controller"
```

---

### Task 3: ui-core interaction controller — `respondToInteraction`, `decideApproval`

**Files:**
- Create: `packages/ui-core/src/interaction/controller.ts`
- Modify: `packages/ui-core/src/index.ts`
- Test: `packages/ui-core/tests/interaction-controller.test.ts`

**Interfaces:**
- Consumes: `FetchLike` from `../stream/connect.js`.
- Produces:
  - `interface InteractionResult { readonly success: boolean; readonly output: string; readonly error?: string }`
  - `respondToInteraction(opts: { readonly endpoint: string; readonly runId: string; readonly interactionId: string; readonly value: unknown; readonly fetchImpl?: FetchLike }): Promise<InteractionResult>` — POST `{runId,interactionId,value}` JSON; on non-ok/throw returns `{success:false,output:"",error}`.
  - `decideApproval(opts: { readonly endpoint: string; readonly runId: string; readonly gateId: string; readonly decision: "approve" | "deny"; readonly reason?: string; readonly fetchImpl?: FetchLike }): Promise<InteractionResult>` — POST `{runId,gateId,decision,reason}` JSON; same error contract. **New — closes the missing approval-POST gap.**

Design note: both return a result object carrying `error` (never throw) so every binding wraps them with identical `pending`/`error` reactive state and no duplicated try/catch.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui-core/tests/interaction-controller.test.ts
import { describe, expect, test } from "bun:test";
import { respondToInteraction, decideApproval } from "../src/interaction/controller.js";
import type { FetchLike } from "../src/stream/connect.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("respondToInteraction", () => {
  test("POSTs the interaction payload and returns the server result", async () => {
    let captured: { url: string; body: unknown; method: string } | null = null;
    const fetchImpl: FetchLike = async (input, init) => {
      captured = { url: String(input), method: init?.method ?? "GET", body: JSON.parse(String(init?.body)) };
      return jsonResponse({ success: true, output: "resumed" });
    };
    const out = await respondToInteraction({
      endpoint: "/api/interaction",
      runId: "r1",
      interactionId: "i1",
      value: { choice: "a" },
      fetchImpl,
    });
    expect(out).toEqual({ success: true, output: "resumed" });
    expect(captured).toEqual({
      url: "/api/interaction",
      method: "POST",
      body: { runId: "r1", interactionId: "i1", value: { choice: "a" } },
    });
  });

  test("returns an error result (never throws) on non-ok", async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({}, 409);
    const out = await respondToInteraction({
      endpoint: "/api/interaction",
      runId: "r1",
      interactionId: "i1",
      value: 1,
      fetchImpl,
    });
    expect(out.success).toBe(false);
    expect(out.output).toBe("");
    expect(out.error).toContain("409");
  });
});

describe("decideApproval", () => {
  test("POSTs the approval decision payload", async () => {
    let captured: unknown = null;
    const fetchImpl: FetchLike = async (_input, init) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ success: true, output: "approved" });
    };
    const out = await decideApproval({
      endpoint: "/api/approval",
      runId: "r1",
      gateId: "g1",
      decision: "approve",
      fetchImpl,
    });
    expect(out).toEqual({ success: true, output: "approved" });
    expect(captured).toEqual({ runId: "r1", gateId: "g1", decision: "approve", reason: undefined });
  });

  test("carries a deny reason and returns an error result on network failure", async () => {
    const denyImpl: FetchLike = async (_input, init) => {
      expect(JSON.parse(String(init?.body)).reason).toBe("too risky");
      return jsonResponse({ success: true, output: "denied" });
    };
    const denied = await decideApproval({
      endpoint: "/api/approval",
      runId: "r1",
      gateId: "g1",
      decision: "deny",
      reason: "too risky",
      fetchImpl: denyImpl,
    });
    expect(denied.output).toBe("denied");

    const throwImpl: FetchLike = async () => {
      throw new Error("refused");
    };
    const failed = await decideApproval({
      endpoint: "/api/approval",
      runId: "r1",
      gateId: "g1",
      decision: "approve",
      fetchImpl: throwImpl,
    });
    expect(failed.success).toBe(false);
    expect(failed.error).toBe("refused");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui-core/tests/interaction-controller.test.ts`
Expected: FAIL — cannot resolve `../src/interaction/controller.js`.

- [ ] **Step 3: Implement the module**

```ts
// packages/ui-core/src/interaction/controller.ts
import type { FetchLike } from "../stream/connect.js";

/** Uniform result of a client→server durable-rail POST (interaction/approval). */
export interface InteractionResult {
  readonly success: boolean;
  readonly output: string;
  readonly error?: string;
}

const postJson = async (
  fetchImpl: FetchLike,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<InteractionResult> => {
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { success: boolean; output: string };
    return { success: json.success, output: json.output };
  } catch (err) {
    return { success: false, output: "", error: err instanceof Error ? err.message : String(err) };
  }
};

/** Answer a durable `request_user_input` interaction; run resumes server-side. */
export const respondToInteraction = (opts: {
  readonly endpoint: string;
  readonly runId: string;
  readonly interactionId: string;
  readonly value: unknown;
  readonly fetchImpl?: FetchLike;
}): Promise<InteractionResult> =>
  postJson(opts.fetchImpl ?? fetch, opts.endpoint, {
    runId: opts.runId,
    interactionId: opts.interactionId,
    value: opts.value,
  });

/** Approve or deny a durable approval gate; run resumes with the decision. */
export const decideApproval = (opts: {
  readonly endpoint: string;
  readonly runId: string;
  readonly gateId: string;
  readonly decision: "approve" | "deny";
  readonly reason?: string;
  readonly fetchImpl?: FetchLike;
}): Promise<InteractionResult> =>
  postJson(opts.fetchImpl ?? fetch, opts.endpoint, {
    runId: opts.runId,
    gateId: opts.gateId,
    decision: opts.decision,
    reason: opts.reason,
  });
```

- [ ] **Step 4: Export from index** — add to `packages/ui-core/src/index.ts`:

```ts
export {
  type InteractionResult,
  respondToInteraction,
  decideApproval,
} from "./interaction/controller.js";
```

- [ ] **Step 5: Run test + typecheck to verify**

Run: `bun test packages/ui-core/tests/interaction-controller.test.ts && cd packages/ui-core && bun run typecheck && cd ../..`
Expected: tests PASS; `tsc --noEmit` clean (confirms no `react` leaked into ui-core, no `any`).

- [ ] **Step 6: Commit**

```bash
rtk git add packages/ui-core/src/interaction packages/ui-core/src/index.ts packages/ui-core/tests/interaction-controller.test.ts
rtk git commit -m "feat(ui-core): interaction + approval POST controllers (closes missing approval helper)"
```

---

### Task 4: React backfill — rewire generative-UI registry onto ui-core

**Files:**
- Modify: `packages/react/src/components/render/registry.ts`
- Verify (no edit expected): `packages/react/src/components/render/AgentSurface.tsx`
- Test: existing `packages/react/tests/render.test.tsx` (must stay green)

**Interfaces:**
- Consumes: `UiNode`, `isUiNode`, `uiTreeSchema` from `@reactive-agents/ui-core` (Task 1).
- Produces: unchanged public surface — `UiNode`, `ComponentRegistry`, `uiTreeSchema`, `isUiNode` still exported from `./registry.js` (and transitively from the React package index). `ComponentRegistry` stays React-typed and local.

- [ ] **Step 1: Rewrite `registry.ts` to re-export from ui-core**

```ts
// packages/react/src/components/render/registry.ts
import type * as React from "react";
import type { UiNode } from "@reactive-agents/ui-core";

// Node schema, guard, and output-schema generator now live in ui-core
// (shared across react/vue/svelte). Re-export to preserve this module's API.
export type { UiNode } from "@reactive-agents/ui-core";
export { isUiNode, uiTreeSchema, reconcileUiTree } from "@reactive-agents/ui-core";

/** React-specific: maps node `type` → the React component that renders it. */
export type ComponentRegistry = Record<
  string,
  React.ComponentType<{ node: UiNode; children?: React.ReactNode }>
>;
```

- [ ] **Step 2: Confirm `AgentSurface.tsx` needs no change**

Run: `rtk grep -n "from \"./registry.js\"" packages/react/src/components/render/AgentSurface.tsx`
Expected: it imports `{ isUiNode, type ComponentRegistry }` and re-exports `type { UiNode, ComponentRegistry }` + `{ uiTreeSchema }` — all still provided by the rewritten `registry.ts`. No edit needed. (If a symbol were missing, tsc in Step 3 would fail.)

- [ ] **Step 3: Run the React render suite + typecheck**

Run: `bun test packages/react/tests/render.test.tsx --timeout 15000 && cd packages/react && bun run typecheck && cd ../..`
Expected: render tests PASS unchanged; `tsc --noEmit` clean. (Bun resolves `@reactive-agents/ui-core` from `src` — Task 1's edits are live, no rebuild.)

- [ ] **Step 4: Commit**

```bash
rtk git add packages/react/src/components/render/registry.ts
rtk git commit -m "refactor(react): AgentSurface registry re-exports ui-core node schema"
```

---

### Task 5: React backfill — rewire inbox + interactions onto ui-core controllers

**Files:**
- Modify: `packages/react/src/hooks/use-task-inbox.ts`
- Modify: `packages/react/src/hooks/use-interactions.ts`
- Test: existing `packages/react/tests/inbox.test.tsx`, `packages/react/tests/interactions.test.tsx` (must stay green)

**Interfaces:**
- Consumes: `fetchInbox`, `InboxRun`, `respondToInteraction` from `@reactive-agents/ui-core` (Tasks 2–3).
- Produces: unchanged public surface — `useTaskInbox`/`UseTaskInboxReturn`/`InboxRun` and `useInteractions`/`UseInteractionsReturn` keep identical signatures. `InboxRun` now re-exported from ui-core (the React package index re-export at `index.ts` keeps resolving).

- [ ] **Step 1: Rewire `use-task-inbox.ts` to call `fetchInbox`**

```ts
// packages/react/src/hooks/use-task-inbox.ts
import { useCallback, useEffect, useState } from "react";
import { fetchInbox, type FetchLike, type InboxRun } from "@reactive-agents/ui-core";

// InboxRun now lives in ui-core; re-export to preserve this module's API.
export type { InboxRun } from "@reactive-agents/ui-core";

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
        setRuns(await fetchInbox({ endpoint: opts.endpoint, fetchImpl }));
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

- [ ] **Step 2: Rewire `use-interactions.ts` to call `respondToInteraction`**

```ts
// packages/react/src/hooks/use-interactions.ts
import { useCallback, useState } from "react";
import { respondToInteraction, type FetchLike } from "@reactive-agents/ui-core";

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
      const result = await respondToInteraction({
        endpoint: opts.interactionEndpoint,
        runId,
        interactionId,
        value,
        fetchImpl,
      });
      if (result.error) setError(result.error);
      setPending(false);
      return { success: result.success, output: result.output };
    },
    [fetchImpl, opts.interactionEndpoint],
  );

  return { respond, pending, error };
}
```

- [ ] **Step 3: Run the affected React suites + typecheck**

Run: `bun test packages/react/tests/inbox.test.tsx packages/react/tests/interactions.test.tsx --timeout 15000 && cd packages/react && bun run typecheck && cd ../..`
Expected: both suites PASS unchanged; `tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
rtk git add packages/react/src/hooks/use-task-inbox.ts packages/react/src/hooks/use-interactions.ts
rtk git commit -m "refactor(react): inbox + interactions delegate to ui-core controllers"
```

---

### Task 6: Cross-package verification — full suites, no-duplication grep, gap log

**Files:**
- Verify only (no source edit unless a check fails).
- Modify (if friction hit): `wiki/Research/2026-07-agentic-ui-gap-log.md`

**Interfaces:**
- Consumes: everything above.
- Produces: proof the lift is behavior-neutral and duplication is gone — the gate Plans 2–3 build on.

- [ ] **Step 1: Run the full ui-core + React suites**

Run: `bun test packages/ui-core packages/react --timeout 15000`
Expected: all green (3 new ui-core suites + all pre-existing react suites: back-compat, devtools, inbox, interactions, observe, render, resume, smoke, use-run).

- [ ] **Step 2: Typecheck both packages**

Run: `cd packages/ui-core && bun run typecheck && cd ../react && bun run typecheck && cd ../..`
Expected: both clean.

- [ ] **Step 3: Verify ui-core stayed dependency-free**

Run: `rtk grep -rn "from \"react\"\|from 'react'\|@reactive-agents/" packages/ui-core/src`
Expected: **zero matches** — ui-core imports nothing from react or any workspace package (only relative `./`/`../` and browser globals).

- [ ] **Step 4: Verify the duplicated logic is gone from React**

Run: `rtk grep -n "Content-Type\": \"application/json" packages/react/src/hooks/use-interactions.ts; rtk grep -n "res.json() as InboxRun" packages/react/src/hooks/use-task-inbox.ts; rtk grep -n "Object.keys(registry)" packages/react/src/components/render/registry.ts`
Expected: **zero matches** for all three — the POST body construction, inbox JSON cast, and schema-key logic now live only in ui-core. (React holds reactive state + re-exports.)

- [ ] **Step 5: Build ui-core to confirm dist/DTS still emit**

Run: `cd packages/ui-core && bun run build && cd ../..`
Expected: tsup emits `dist/index.js` + `dist/index.d.ts` bundling the new modules; no DTS errors. (Validates the additive exports for npm consumers.)

- [ ] **Step 6: Log any friction, then commit the verification close-out**

If any framework friction was hit during Tasks 1–5, append a `## GAP-N` entry to `wiki/Research/2026-07-agentic-ui-gap-log.md` (format at file top). If none, add nothing.

```bash
rtk git add -A wiki/Research/2026-07-agentic-ui-gap-log.md
rtk git commit -m "docs(gap-log): Plan 1 ui-core lift friction notes" --allow-empty
```

(Use `--allow-empty` only if the gap log was untouched, so the task still records a clean close-out; otherwise drop the flag.)

---

## Self-Review

**Spec coverage** (against completion design §4 + §7):
- §4 lift `registry/` → Task 1 (`render/tree.ts`, incl. `reconcileUiTree` for progressive render). ✅
- §4 lift `inbox/` → Task 2 (`fetchInbox`). ✅
- §4 lift `interaction/` (respond + **approval decision**) → Task 3 (`respondToInteraction`, `decideApproval` — the latter closes the verified missing-helper gap). ✅
- §4 "bindings become thin glue, fix logic once" → Tasks 4–5 rewire React; Task 6 Step 4 grep-proves duplication removed. ✅
- §7 keyless, `test`-provider/mocked-fetch only → all tests use mocked `FetchLike`, no runtime spawned. ✅
- Additive-only / no signature change → Tasks 4–5 keep every public type/return via re-export; Task 6 runs the full pre-existing React suite as the regression gate. ✅
- ui-core dependency-free → Task 6 Step 3 grep-gate. ✅

**Placeholder scan:** none — every code step shows complete source; every run step shows exact command + expected result.

**Type consistency:** `FetchLike` sourced from `../stream/connect.js` in ui-core modules and from `@reactive-agents/ui-core` in React (same type, re-exported). `InboxRun` defined once (Task 2), re-exported by React (Task 5). `UiNode` defined once (Task 1), re-exported by React registry (Task 4). `InteractionResult` defined Task 3, consumed by React interactions (Task 5) via its `.success`/`.output`/`.error` fields — matches. `respondToInteraction`/`fetchInbox`/`decideApproval`/`uiTreeSchema`/`reconcileUiTree`/`isUiNode` names identical across definition, index export, and consumer.

**Note for Plan 2 (Svelte):** `decideApproval` (Task 3) is available for the Svelte `ApprovalGate` to wire a real POST rather than a bare callback — the React `ApprovalGate` still uses `onDecide` and can be migrated to `decideApproval` in a later polish pass (out of scope here; no behavior change this plan).
