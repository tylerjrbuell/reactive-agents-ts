# Task S2 report — createResumableRun + createStructuredStream rewire

Plan: `wiki/Planning/Implementation-Plans/2026-07-03-agentic-ui-kit-svelte-cortex.md` §"Task S2"

## Files changed

- Created `packages/svelte/src/resumable.ts` — `createResumableRun(opts)`: thin wrapper, calls `createRun({endpoint, fetchImpl, objectMode})` then `.reattach(runId, cursor)`, returns the resulting `RunStore`. Matches the plan's literal Step 3 code verbatim.
- Created `packages/svelte/tests/resumable.test.ts` — drives the `RunAttached`-head fixture from the plan (S2 Step 1) verbatim; asserts `status:"completed"`, `runId:"r7"`, `output:"resumed answer"`.
- Modified `packages/svelte/src/structured-stream.ts` — rewired `createStructuredStream` onto `createRun({endpoint, objectMode: true})`, deleting all hand-coded SSE parsing (`getReader()`/`buffer.split`/manual `_tag` switch) and the `parsePartialObject` import (now handled inside `reduceRunState({objectMode:true})`). Signature and `StructuredStreamState` shape unchanged.
- Modified `packages/svelte/src/index.ts` — added `export { createResumableRun, type CreateResumableRunOptions } from "./resumable.js";`.
- Modified `.superpowers/sdd/progress.md` — marked S2 DONE, logged the deviation below.

## Deviation from the plan's literal code (and why)

The plan's Step 4 snippet has `run()` return `Promise.resolve()` immediately after calling `inner.run(...)` (fire-and-forget, consistent with `createRun.run()`'s own contract). This **broke** the existing (must-stay-green) `packages/svelte/tests/structured-stream.test.ts`: several behavioral tests do

```ts
await stream.run("generate");
const final = states[states.length - 1]!;
expect(final.status).toBe("completed"); // or "error"
```

with **no** `settle()`/sleep afterward. The pre-rewire `createStructuredStream` implementation's `run()` was an `async function` that itself drove the `reader.read()` loop to completion before returning — so `await run()` genuinely waited for the terminal state. The plan's fire-and-forget rewire made `run()` resolve on the microtask after kickoff, long before `connectRunStream`'s fetch/SSE-read loop reaches a terminal event, so `states.at(-1)` was still `idle` when the test asserted.

Fix: mirror the resolver pattern already used by `agent.ts`'s `createAgent`. `run()` returns `new Promise<void>((resolve) => { resolveRun = resolve; inner.run(prompt, body); })`; the `inner.subscribe` callback resolves `resolveRun` the first time `rs.status` transitions into a terminal state (`completed`/`error`/`cancelled`) — never rejects, matching the old contract where all errors funnel into `error`/`status` state rather than a thrown/rejected promise from `run()`.

## Was a compatFetch shim needed for structured-stream? No — and why

`agent.ts`'s pre-existing `smoke.test.ts` (from Task S1) mocked a **plain single-shot JSON** endpoint (non-SSE), which is incompatible with `createRun`'s SSE-only wire protocol — hence S1's `compatFetch` adapter.

`structured-stream.test.ts` is different: every mock response is constructed as `new Response(sseBody, { headers: { "content-type": "text/event-stream" } })` where `sseBody` is real `data: ${JSON.stringify(event)}\n\n` lines (`TextDelta`/`StreamCompleted`/`StreamError`). This is exactly what `connectRunStream`/`readSse` parse natively — no shim required. Verified by reading the test file in full before writing any code (per the task brief's instruction), confirming the plan's assumption held.

One correctness point double-checked: the non-OK-HTTP test (`new Response("err", {status:500})`, no attach) — `connectRunStream` throws `HTTP 500: Internal Server Error` and (since `opts.attach` is undefined, `canReconnect` is false) yields a single `StreamError` with that cause immediately, no retries — `reduceRunState` sets `status:"error"`, `error` containing `"HTTP 500"`. Matches the test's `toContain("HTTP 500")`.

## Test output

```
$ bun test packages/svelte/tests/resumable.test.ts packages/svelte/tests/structured-stream.test.ts --timeout 15000
 8 pass
 0 fail
 18 expect() calls
Ran 8 tests across 2 files. [76.00ms]

$ bun test packages/svelte --timeout 20000
 35 pass
 0 fail
 68 expect() calls
Ran 35 tests across 6 files. [232.00ms]
```

(34 prior + 1 new `resumable.test.ts` test = 35; no regressions.)

## tsc / build

```
$ cd packages/svelte && bunx tsc --noEmit
(clean, no output)

$ bun run build
ESM dist/index.js   5.86 KB
ESM dist/testing.js 0 B
DTS dist/index.d.ts   5.07 KB
DTS dist/testing.d.ts 13.00 B
Build success
```

No `any` casts introduced (verified via grep over `src/*.ts`).

## Commit

`feat(svelte): createResumableRun + rewire createStructuredStream onto ui-core objectMode`
(SHA recorded after commit — see below)

## Deviations summary

1. `structured-stream.ts`'s `run()` awaits terminal state via a resolver instead of the plan's fire-and-forget `Promise.resolve()` — required to keep the existing behavioral test suite green (see above). This is the only functional deviation from the plan's literal S2 code; `resumable.ts`, the resumable test, and the index export match the plan verbatim.
2. `_requestInit` param on `createStructuredStream` remains accepted (for back-compat signature) but is now inert — like the S1 rewire of `agent-stream.ts`, per-call header/init customization is no longer threaded through to the underlying transport since `createRun` doesn't expose a `requestInit` passthrough. This matches the plan's own Step 4 snippet (which also drops it) and existing `structured-stream.test.ts` doesn't exercise custom `requestInit`, so no test regression.
