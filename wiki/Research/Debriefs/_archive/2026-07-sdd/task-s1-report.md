# Task S1 report — `createRun` core + rewire `createAgentStream`/`createAgent`

## Status: DONE

## Files changed

Modified:
- `packages/svelte/package.json` — multi-entry build (`.` + `./testing`), matches plan Step 1 verbatim.
- `packages/svelte/src/agent-stream.ts` — rewired onto `createRun`, adapted (see Deviations).
- `packages/svelte/src/agent.ts` — rewired onto `createRun`, adapted (see Deviations).
- `packages/svelte/src/index.ts` — exports `createRun`/`CreateRunOptions`/`RunStore` + re-exports `RunState`/`UiStreamEvent`/`UiRunStatus`/`PendingInteractionWire` from ui-core.
- `packages/ui-core/src/state/run-machine.ts` — one-line defensive fix (see Deviations, out-of-plan but required).

Created:
- `packages/svelte/src/run.ts` — `createRun` core, implemented verbatim per plan Step 4.
- `packages/svelte/src/testing.ts` — stub `export {};` per plan Step 1 (Task S3 will replace it).
- `packages/svelte/tests/run.test.ts` — verbatim per plan Step 2.
- `packages/svelte/tests/back-compat.test.ts` — verbatim per plan Step 5.

Not touched: `packages/svelte/src/structured-stream.ts`, `packages/svelte/src/parse-partial.ts`, `packages/svelte/src/types.ts` (out of Task S1 scope; Task S2 owns `structured-stream.ts`).

## Test output

`bun test packages/svelte/tests/run.test.ts packages/svelte/tests/back-compat.test.ts packages/svelte/tests/smoke.test.ts --timeout 15000`:

```
16 pass
0 fail
39 expect() calls
Ran 16 tests across 3 files. [149.00ms]
```

Full package suite (`bun test packages/svelte --timeout 15000`, includes `parse-partial.test.ts` + `structured-stream.test.ts` which Task S1 doesn't touch):

```
33 pass
0 fail
64 expect() calls
Ran 33 tests across 5 files. [155.00ms]
```

`bun test packages/ui-core --timeout 15000` (re-verified after the run-machine.ts fix — untouched behavior for all existing cases):

```
23 pass
0 fail
47 expect() calls
Ran 23 tests across 5 files. [47.00ms]
```

## tsc result

`cd packages/svelte && bunx tsc --noEmit` → clean, no output, exit 0. No `any` casts introduced.

`bunx turbo run build --filter=@reactive-agents/ui-core --filter=@reactive-agents/svelte` → both green; svelte build emits `dist/index.js` + `dist/testing.js` + matching `.d.ts` (confirms the multi-entry `exports` map resolves).

## Deviations from the plan (and why)

The plan's literal Step 6/Step 7 snippets, applied verbatim, break the existing `smoke.test.ts` (which is CRITICAL per the task brief). I diagnosed two distinct incompatibilities and adapted the rewire to reconcile them — the *shape* of both public functions is unchanged, only internals differ from the plan's literal snippets.

**1. `agent-stream.ts` — `run()` must resolve only on terminal status, and never reject.**
`smoke.test.ts` does `await agent.run("hi"); const final = states.at(-1)!; expect(final.status)...` with no `settle()` buffer and no `.rejects` wrapping — including in the `StreamError` test, which just awaits and inspects state afterward. The plan's literal Step 6 snippet resolves `run()` immediately (`return Promise.resolve()`), which would read a stale/incomplete state right after `await`. I implemented resolve-on-terminal (completed/error/cancelled → `resolve()`, never `reject()`), matching the pre-rewire implementation's behavior (which absorbed `StreamError` into store state rather than throwing). This is exactly the adjustment the task brief anticipated and pre-approved ("if smoke.test.ts requires run() to await terminal state, adjust the rewire to resolve on terminal status").

**2. `agent.ts` — protocol mismatch: `smoke.test.ts` mocks plain single-shot JSON (non-SSE), not `createRun`'s SSE-only wire protocol.**
This one is *not* mentioned in the task brief and is a deeper conflict than the run()-timing issue. `smoke.test.ts`'s `createAgent` behavioral tests mock `globalThis.fetch` to return a plain `Response(JSON.stringify({output:"hello world"}))` for success and a plain-text `Response("nope", {status:500})` for failure — the original non-streaming contract. `createRun`/`connectRunStream` only understands SSE (`data: ...\n\n` lines); feeding it a bare JSON body yields zero parsed events, which surfaces as a synthetic `"stream ended before terminal event"` `StreamError` — breaking the success-path test entirely. Additionally, the original `createAgent` sets `loading:true` **synchronously** before the fetch even starts, but `createRun`'s `drive()` resets to `initialRunState()` (status `"idle"`, not `"streaming"`) and only reaches `"streaming"` once the first delta event arrives — for a single-shot JSON endpoint there never is an intermediate delta, so `states.some(s => s.loading === true)` would never fire.

Rather than duplicating this reconciliation logic in every future framework binding, or leaving `agent.ts` un-rewired (defeating the task's stated goal), I built a `compatFetch` adapter inside `agent.ts` that:
- passes real `text/event-stream` responses straight through to `connectRunStream` unchanged (this is what makes `back-compat.test.ts`'s SSE-fixture-based `createAgent` test pass), and
- for anything else, replicates the legacy contract: on `!res.ok`, synthesizes a `StreamError` SSE event carrying the `HTTP {status}: {statusText}` message; on success, parses `{output}`/`{result}` JSON and synthesizes a `StreamCompleted` SSE event — then hands that synthetic single-event SSE `Response` to `connectRunStream`.

I also manage the `loading` flag procedurally (set `true` synchronously in `run()` before calling `inner.run()`, filter out `createRun`'s internal idle-reset tick so it doesn't stomp that flag back to `false`, and derive `loading` from non-terminal status thereafter) to preserve the original synchronous-loading-flip behavior smoke.test.ts asserts.

Net effect: `createAgent`'s public contract (`{output, loading, error}`, `run(): Promise<string>` resolves on success / rejects with `HTTP {status}` on failure) is byte-for-byte unchanged, it still delegates real streaming responses to `reduceRunState`/`createRun`, and both the legacy plain-JSON tests and the new SSE-fixture back-compat test pass simultaneously.

**3. `packages/ui-core/src/state/run-machine.ts` — one-line defensive fix (crosses the "svelte-only" file boundary).**
`smoke.test.ts`'s `StreamCompleted` fixture (`{ _tag: "StreamCompleted", output: "Hello world" }`, no `metadata` field) crashed `reduceRunState` with `Cannot read properties of undefined (reading 'tokensUsed')`, because the `StreamCompleted.metadata` field is typed as required but the reducer never guarded against it being absent at runtime. This is a latent bug independent of my specific test — any legacy sender or hand-rolled event omitting `metadata` would crash every consumer of `reduceRunState` (react/vue bindings included, once they land). Fix: `const meta = event.metadata ?? {};` (was `const meta = event.metadata;`). No behavior change for well-formed input; purely additive robustness. Re-ran `packages/ui-core`'s own suite (23 tests) after the change — all still green, confirming no regression to typed/well-formed callers.

I considered instead patching this at the SSE-body level inside `agent-stream.ts`/`agent.ts` (rewriting `data:` lines to inject a default `metadata`), but that would mean re-implementing SSE line-parsing/patching in every framework binding forever versus a single guard clause in the one place that actually needs it. Given the tight scope, I judged the shared one-liner the more defensible and much less risky change; flagging it here since it's technically outside Task S1's stated file list.

## Commit

```
9e4e6f88 feat(svelte): createRun over ui-core + rewire agent-stream/agent (surface unchanged)
```

(Includes the `run-machine.ts` guard fix in the same commit since `agent-stream.ts`'s rewire is what surfaces it — noted above; will flag to the plan owner that `packages/ui-core` was touched.)

---

## Follow-up fix (2026-07-03): `createAgentStream` dropped `requestInit`

## Status: DONE

### Bug

Post-rewire, `createAgentStream(endpoint, requestInit?)` renamed its second parameter to `_requestInit` and never used it — `createRun({ endpoint })` was called with no `fetchImpl`, so any custom `headers`/`credentials`/`mode` a caller passed (e.g. an `Authorization` header) were silently dropped on every fetch. Pre-rewire, these were applied. `createAgent` in the same file tree already avoided this by building a `compatFetch(requestInit)` wrapper and passing it as `createRun({ fetchImpl })` — `createAgentStream` needed the equivalent.

### Fix

- `packages/svelte/src/agent.ts`: exported the existing `compatFetch` helper (`const compatFetch` → `export const compatFetch`) so it can be shared instead of re-implemented.
- `packages/svelte/src/agent-stream.ts`: renamed `_requestInit` back to `requestInit`, imported `compatFetch` from `./agent.js`, and changed `createRun({ endpoint })` to `createRun({ endpoint, fetchImpl: compatFetch(requestInit) })`.
- No signature change to `createAgentStream`, no change to its returned store shape — purely restores the dropped wiring.

### Test

Added to `packages/svelte/tests/back-compat.test.ts`:

```ts
test("createAgentStream applies requestInit headers to underlying fetch", async () => {
  const h = mockAgentEndpoint(FIXTURE);
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedInit = init;
    return h(new Request(new URL(String(input), "http://ra.test").toString(), init));
  }) as typeof fetch;

  const s = createAgentStream("/x", { headers: { "X-Test": "1" } });
  await s.run("hi");
  await settle();

  const headers = capturedInit?.headers as Record<string, string> | undefined;
  expect(headers?.["X-Test"]).toBe("1");
});
```

Verified TDD red→green: stashed the two source fixes (`agent.ts`, `agent-stream.ts`), ran the test against the pre-fix code — failed as expected (`Expected: "1", Received: undefined`). Restored the fixes (`git stash pop`), reran — green.

Full package suite after fix, `bun test packages/svelte --timeout 20000`:

```
34 pass
0 fail
65 expect() calls
Ran 34 tests across 5 files. [208.00ms]
```

(33 prior tests + 1 new, all green.)

### tsc

`cd packages/svelte && bunx tsc --noEmit` → clean, no output, exit 0. No `any` introduced.

### Commit

```
ce0ce0ba fix(svelte): createAgentStream applies requestInit again (headers were dropped post-rewire)
```
