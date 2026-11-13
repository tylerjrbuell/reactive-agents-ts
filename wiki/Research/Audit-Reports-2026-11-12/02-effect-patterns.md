---
type: audit
status: draft
created: 2026-11-12
tags: [audit, effect-ts, channels, gateway, runtime, tools, resource-safety]
---

# 02 - Effect patterns audit (channels routing, gateway, runtime-shim, tools)

Read-only. No source edited. Method: read `.agents/skills/effect-ts-patterns`, `effect-abstraction-audit`, `AGENTS.md`; enumerated today's changes with `git log --since="2026-11-12 00:00" --name-only -- packages`; read the routing, runtime channel-router, gateway ingress/queue/runner, web-search, pinned-fetch and read-only-classification files in full; spot-checked adapters, event-bus, registry, file-exporter with `/usr/bin/grep -a` on named files. Owner from `bun run repo scope`. Size S < half day, M ~1 day, L multi-day.

Not verified by running code: every race below is derived from reading. Findings F1 and F6 are the ones where the failure chain needs a runtime repro before a fix is trusted; each says what to pin.

## Ranked findings

### P1 - correctness / leak / race

**F1. EventBus.publish is fail-fast on a handler defect; the channel inbound fiber does not survive it.**
- `packages/core/src/services/event-bus.ts:128-135` (`publish`): `Effect.all(hs.map(h => h(event)), { concurrency: "unbounded" })`. The JSDoc above it says "Failures in individual handlers do not stop other handlers". `EventHandler` is `Effect<void, never>` (`core/src/types/agent-event.ts:96`), so the only failure mode is a defect, and `Effect.all` interrupts siblings and re-raises the defect to the publisher on the first one.
- `packages/channels/src/routing/adapter-hub.ts:152-167`: the inbound `Stream.runDrain` is wrapped in `Effect.catchAll`, which does not catch defects. A defect forked with `Effect.forkIn(..., scope)` ends the fiber silently; hub state stays `connected`, no `onChannelFailed`.
- Concrete trigger: legacy handler `gateway-driver.ts:~198` does `yield* Effect.promise(runChatTurn)`. If `chatManager.handleMessage` rejects, that becomes a defect in the `ChannelMessageReceived` subscriber; `engine.ts:176` (`handleEnvelope`) publishes that event before `handleInbound`, so the defect propagates out of `mapEffect`, and the adapter stops delivering with no event, no status change.
- Fix: (a) bus: wrap each handler in `Effect.catchAllCause` and report through a non-bus sink (log or `emitErrorSwallowed` guarded against recursion); keep `concurrency: "unbounded"`. (b) hub: `Effect.catchAllCause` then set `state: failed` and call `onChannelFailed`. (c) driver: `Effect.tryPromise` + typed catch instead of `Effect.promise`. Pin with a test that a throwing subscriber does not stop a second subscriber or the adapter stream.
- Exemplar: `session-bridge.ts:111-118` (`closeEntry` converts a rejection to `emitErrorSwallowed`).
- Owner: core-warden (a), gateway-warden (b), runtime-warden (c). Size S + S + S.

**F2. SessionBridge: one failed turn poisons the conversation's serial chain.**
- `packages/channels/src/services/session-bridge.ts:198-200`: `const prev = chainByKey.get(key) ?? Promise.resolve(); const run = prev.then(() => chat(content)); chainByKey.set(key, run)`. If `run` rejects, the next turn for that key does `prev.then(...)` on a rejected promise; `then` skips the callback and rejects with the earlier error, so `chat` is never called. Every later message on that sender/channel fails as `chat_failed` until the entry is evicted, expires, or `single_response` drops it (`persistent` and `conversation` lifecycles never recover).
- `ChannelService.runTurn` (`channel-service.ts:187-190`) then converts each failure to an empty reply plus an `ErrorSwallowed` event, so the user sees silence.
- Fix: serialize with an Effect semaphore per key (or `.then(ok, ok)` as a minimum patch). Exemplar already in repo: `engine.ts:285-307` (`queued`, `Effect.Semaphore`). Better: delete the Promise chain and reuse the engine's queue (see F12).
- Owner: gateway-warden. Size S.

**F3. startGateway: `stop()` during async startup leaks the interval, router host and ingress server.**
- `packages/runtime/src/agent/gateway-runner.ts:188-369` runs startup as an un-scoped async IIFE; `timer = setInterval(tick, ...)` (line 361), `unsubChannel` (327), `channelAdaptersCleanup` (224, 355) are assigned at the end. `buildGatewayHandle.stop` (`gateway-driver.ts:~270-290`) reads those once: if `stop()` runs before they are set, `clearInterval(null)` and a null cleanup are skipped, then startup continues and installs the interval, subscribes, and binds the ingress port. `stopped` only gates `tick` work, so the process stays alive and the port stays bound.
- Same file: module-level `WeakMap`s `routerHosts` (138), `liveGateway` (129), `gatewayOptionsByAgent` (115) are hidden globals (AGENTS Golden Rule 4); `let` counters and four nullable cleanup holders replace `Ref`/`Scope`.
- Fix: make the gateway one `Scope`. Startup is an Effect that registers each resource with `acquireRelease`/`addFinalizer` as it is acquired; `stop` closes the scope (and `Fiber.interrupt`s startup), so partial startup is torn down in reverse. Replace `setInterval` with `Effect.repeat(Schedule.fixed(...))` in `forkScoped`. Exemplars: `channel-router-host.ts:59-88` (scope + close on failure) and `gateway/src/ingress/ingress-server.ts:211-222` (`acquireRelease` + `stop(true)`).
- Owner: runtime-warden. Size M.

**F4. Route-session finalizer cannot swallow a rejection; shutdown then stops early.**
- `packages/runtime/src/agent/channel-router-resolver.ts:86`: `Effect.addFinalizer(() => Effect.promise(() => session?.end() ?? Promise.resolve()).pipe(Effect.ignore))`. `Effect.promise` turns a rejection into a defect; `Effect.ignore` only discards typed failures. A rejecting `session.end()` makes `Scope.close` die.
- `engine.ts:494` (`shutdown`) closes sessions in a sequential `for` with `yield*`, so one dying close aborts the loop and the remaining sessions' agents are never ended. `stop()` in `channel-router-host.ts:60-63` then skips `disposeAll` if `Scope.close` died.
- Fix: `Effect.tryPromise` + `Effect.catchAll` -> `emitErrorSwallowed` (exemplar `session-bridge.ts:111-118`); close sessions with `Effect.forEach(..., { discard: true })` and `Effect.catchAllCause` per session; in `stop`, use `Effect.ensuring`/`Effect.exit` so `disposeAll` always runs.
- Owner: runtime-warden (resolver, host), gateway-warden (`engine.ts`). Size S.

**F5. File-lease takeover is racy; two owners are possible.**
- `packages/channels/src/routing/lease.ts:70-78`: on `EEXIST`, process B reads the lock, decides it is stale, then `unlinkSync(path)`; between B's read and B's unlink, process A (also stale-checking) may have unlinked and re-created a fresh lock, and B's unlink deletes A's live lock. Both then hold the account, which is the exact condition the lease exists to prevent (two pollers on one bot token).
- Related: `Effect.die(e)` at line 72 turns any non-EEXIST fs error (EACCES on a read-only tmpdir, ENOSPC) into a defect instead of a typed lease failure, so `createChannelRouter` startup dies with an untyped cause.
- Fix: take over via atomic `rename` of a uniquely named temp lock onto the stale path, then re-read and confirm own pid/since (compare-and-own); map fs errors to a tagged `ChannelLeaseError`. Keep `makeMemoryLeases` as is.
- Owner: gateway-warden. Size S-M.

**F6. Router teardown order releases account leases before adapters stop.**
- `packages/channels/src/routing/router.ts:102-105`: `addFinalizer(engine.shutdown)` is registered first, then `leases.acquire(...)` (scoped, so its release finalizer is registered later). Scope finalizers run LIFO, so on close the leases are released first and the adapters (still polling/holding the Signal socket) stop afterward. A second process starting during that window passes the lease and starts a second poller on the same account; for Telegram this yields a `conflict` error loop.
- Fix: acquire lease and adapter inside one `acquireRelease` per channel (release = stop adapter, then drop lease), or register `addFinalizer(engine.shutdown)` after the lease loop. Pin with a test recording finalizer order.
- Owner: gateway-warden. Size S.

**F7. AdapterHub scope is created lazily without a guard; failed start leaves a ghost registration.**
- `adapter-hub.ts:131`: `const scope = self.scope ?? (self.scope = yield* Scope.make())`. Two concurrent `register` calls both see `undefined`, each makes a scope, the second assignment wins, and the first scope (with its adapter fibers) is never closed on `shutdown`.
- `adapter-hub.ts:134-145`: the adapter is put in `adapters` before `adapter.start()`. If `start` fails, the entry stays; `hub.has(id)` is true so `engine.reply` tries to send through a never-started adapter, and `info()` reports a stale state.
- `shutdown` (172-184) closes the scope but legacy `MessageChannel`s have no disconnect here (the caller does it in `gateway-bootstrap.ts:~273`); document or unify.
- Fix: make the hub a scoped resource (`AdapterHub.make: Effect<AdapterHub, never, Scope>` with `acquireRelease`, scope created once); register the entry after `start` succeeds, or remove it with `Effect.onError`. Replace the `Map` + `update()` patch pattern with `Ref<ReadonlyMap>` (Pattern Checklist: state uses `Ref`).
- Owner: gateway-warden. Size M.

### P2 - robustness / resource safety

**F8. Webhook ingest blocks on a full bounded queue, holding an ingress slot.**
`telegram.ts:361`, `webhook.ts:244`: `yield* Queue.offer(queue, env)` on `Queue.bounded(256)` suspends the webhook handler when the consumer stalls (hub concurrency 4 of long agent turns). `ingress-server.ts:165-175` counts that request in `inFlight` (max 64); the body timeout does not cover it. 64 stalled webhooks make the whole ingress return 503 to every route, and the platform retries into the backlog. Fix: `Queue.offer` under `Effect.timeoutFail` -> `channelError(.., "rate_limited")` (already mapped to 429 by `channelStatus`, `ingress-server.ts:87`). Owner gateway-warden. Size S.

**F9. Router host failure modes: wrong rejection type; router failure is silent to the gateway.**
- `channel-router-host.ts:39-41` documents "Rejects with `RoutingError` / `ChannelAlreadyOwned`", but `Effect.runPromise` (line 65) rejects with a `FiberFailure` wrapper, so `instanceof RoutingError` fails for any caller that relies on the doc; `gateway-runner.ts:228-230` only does `String(err)`. Fix: `Effect.runPromiseExit` + `Exit.match` and throw/return the typed error, or fix the JSDoc and expose `.cause`.
- `gateway-runner.ts:193,216-231`: when `routes` are configured the legacy channel path is switched off (`channelsConfig: ... ? undefined : channelsCfg`); if `startChannelRouterHost` throws, the gateway logs one `glog("error")` and keeps running with zero inbound channels. Fail-closed is right for the router, but the gateway handle should surface `error` in `GatewaySummary`/status rather than look healthy. Owner runtime-warden. Size S.

**F10. web-search: Promise stack with hand-rolled retry, no abort, no timeout.**
- `packages/tools/src/skills/web-search.ts`: `fetchWithRetry` (~112-125) uses `setTimeout` backoff (1s, 2s) per provider across a chain of up to 5 providers; all `fetch` calls (lines 178, 229, 279, 319, 392) take no `AbortSignal`. The whole chain sits in one `Effect.tryPromise` (577) without the `signal` argument, so agent interruption/tool timeout leaves the fetches and sleeps running (up to ~9 s of backoff plus socket time per provider) and still returns a result nobody reads. Retried responses are not cancelled (`lastResponse` bodies leak sockets).
- Errors: provider failures are `throw new Error(...)` (188, 212, 238, 264, 329, 346, 398), flattened into one string by `toToolError`; the typed `WebSearchProviderError` thrown at 293 is lost in the same `catch`. Provider JSON is read with `as` casts, not `Schema.decodeUnknown`. `args.query as string` / `args.maxResults as number` (577-579) are unchecked casts on untrusted model output.
- Fix: per-provider `Effect.tryPromise({ try: (signal) => fetch(url, { signal }) })`, `Effect.retry({ schedule: Schedule.exponential("1 second").pipe(Schedule.intersect(Schedule.recurs(2))), while: retryable })`, `Effect.timeout`, `Schema.decodeUnknown` for the response rows, `Effect.firstSuccessOf`/ordered `catchAll` chain collecting typed attempts, `Config.redacted` for keys. Exemplar for Schedule: `telegram.ts` `withReconnect(..., reconnectSchedule)`; for secrets already handled: keep `scrubSecrets`. Pin: interrupt test asserts no further `fetch` after interrupt.
- Owner: tools-warden. Size M.

**F11. Gateway driver legacy dedup: timer per message, and it drops legitimate repeats.**
`gateway-driver.ts:~117-132`: a `setTimeout` per message to expire a `Set<string>` keyed `${sender}:${message}` for 30 s. Timers are not cleared on `stop()` (keeps the loop alive up to 30 s), use wall clock, and a user sending the same text twice within 30 s ("yes", "hello") has the second silently dropped. Fix: dedupe by platform message id (engine already does via `store.markSeen`, `engine.ts:209`) or a `Clock`-driven TTL map; if echo suppression is the goal, key on the envelope `isEcho` flag (hub already handles it, `engine.ts:154`). Owner runtime-warden. Size S.

**F12. Duplicated session/queue machinery (one canonical abstraction missing).**
Three independent implementations of "keyed LRU of sessions" and "per-key FIFO":
- `RouterEngine.sessions` + `queued` (Semaphore) - `engine.ts:102,276-308,312-353`.
- `SessionBridge.chatByKey` + Promise chain - `session-bridge.ts:57-85,198-200` (F2 lives here).
- `gateway-inbound-queue.ts`: Promise FIFO, hand-rolled worker, `setTimeout(r, 0)` idle poll (286), jobs deferred past `stop` never settled (settle is `() => {}` at 241), run uninterruptible, `as AgentEvent` cast (144). `idle()` and `submit` returning Promises are the Promise API that should be an Effect `Queue` + `forkScoped` worker (exemplar: `telegram.ts:205-213`).
Plan: extract one `keyedSerial` / `SessionCache` abstraction in `packages/channels/src/routing/` (Semaphore map + LRU with eviction guard), have `SessionBridge` use it, and later port the inbound queue. Eviction guard matters: `engine.ts:343-349` closes the LRU entry's scope even when a turn is mid-flight (only at >500 live sessions; low probability, wrong when hit). Owner gateway-warden (channels), runtime-warden (queue). Size L (staged).

**F13. Wall clock in logic (no Clock injection).**
`Date.now()`/`Math.random()` in non-test code under `channels/src`, `gateway/src`, `runtime/src/agent`: 38 hits (`/usr/bin/grep -a -rn "Date.now()"`). Notable: `adapter-hub.ts:83,209,220`, `router.ts:97` (`route-${Date.now()}-${++counter}` task id with mutable `let counter`), `channel-service.ts:201`, `gateway-service.ts:96,183,255,266,281`, `registry.ts:202`, `gateway-driver.ts:138`, `gateway-inbound-queue.ts:143,210,214,239`. Consequence: these paths cannot be driven by `TestClock`; `uptime` and window logic need real sleeps in tests. Fix: `Clock.currentTimeMillis` in Effect code; for Promise code take `now: () => number` like `SessionBridge` (`session-bridge.ts:19,68`). Exemplars: `meter.ts` (all `Clock`). Owner gateway-warden / runtime-warden. Size S per file, M overall.

### P3 - style / hygiene

**F14. Silent swallows without `emitErrorSwallowed`.**
`telegram.ts:322` (`onOffset(...).pipe(Effect.ignore)`: a failing offset store silently causes redelivery of already-processed updates after restart), `telegram.ts:388` and `signal.ts:264` (`catchAll(() => succeed(undefined))` on attachment download: user sees a dropped attachment with no event), bare `catch {}` at `gateway-runner.ts:96,238`, `gateway-bootstrap.ts:132,153,167,181,266,274`, `gateway-driver.ts:228,230`. `gateway-bootstrap.ts:132` collapses any service-resolution error into "Gateway not configured". Fix: `emitErrorSwallowed({ site, tag })` at each (92 files already use it; exemplars `engine.ts:184`, `session-bridge.ts:116`). Owner gateway-warden / runtime-warden. Size S.

**F15. Mutable state in services where the checklist says `Ref`.**
`RouterEngine` counters/maps (`totalProcessed`, `unrouted`, `dropped`, `sessions`, `pending`, `gates`, `notified`: `engine.ts:92-105`), `AdapterHub.adapters` (`adapter-hub.ts:62`), `RouteMeter` Maps (`meter.ts:57-60`). These are synchronous and single-threaded so there is no data race today (meter's `reserve` is atomic because it is one sync `Effect.map`); the cost is that none of it is introspectable or snapshot-safe for multi-fiber changes, and `queued` creates the semaphore at `engine.ts:290-291` in a gen after incrementing `pending`, which is correct only because there is no yield point between `get` and `set`. Do not churn unless F7/F12 are being done anyway; then fold into `Ref`/`SynchronizedRef`. Size M.

**F16. Unvalidated metadata cast in ingress wiring.**
`gateway-ingress.ts:83` checks `typeof event.metadata['instruction'] === 'string'`; line 89 (the `queue` branch) casts `as string | undefined` without checking, so a non-string `instruction` from a webhook payload flows into `queue.defer` and later `run(..., instruction)`. Fix: share the checked accessor for both branches. Owner runtime-warden. Size S.

**F17. pinned-fetch (intentional Promise API; two caveats).**
`runtime-shim/src/pinned-fetch.ts` is correctly dependency-free and Promise-based; callers are told to wrap in `Effect.tryPromise` (JSDoc 111-114). Caveats: no default connect/response timeout (a remote server that accepts and never replies hangs unless the caller passes a `signal`); the returned `Response` body is the caller's to consume or cancel. Add an optional `timeoutMs` (wrapping `AbortSignal.any`) and require the `signal` from `Effect.tryPromise`'s `try: (signal) =>` at call sites. Owner core-warden. Size S.

**F18. ChatEngine concurrency (unverified).**
`runtime/src/chat/engine.ts` is a plain async class with `#history`/`#loaded` mutable fields; I found no turn lock (`grep` for lock/queue/serial found nothing in the file). Two concurrent `turn()` calls on one engine interleave history reads and appends. Verify whether the session facade serializes before treating as a defect; if not, a single `Semaphore`/promise chain in the engine is the fix. The `swallowError` helper (239-248) is an acceptable async-boundary use of `Effect.runPromise`. Owner runtime-warden. Size S.

**F19. `Effect.runSync(Scope.make())` scaffolding duplicated.**
`channel-router-host.ts:59` and `gateway-ingress.ts:75` each hand-roll "make a scope, `Scope.extend` an effect into it, expose `stop = Scope.close`". Extract one `startScoped(effect): Promise<{value, stop}>` helper in runtime (also gives F9 the typed-error handling once). Owner runtime-warden. Size S.

## What is solid (do not churn)

- **Channel adapters** (`telegram.ts:181-215`, `signal.ts:130-180`, `signal-transport.ts:298-345`): `Scope`-bound `start()`, `addFinalizer`, `forkScoped` pump, `Effect.acquireRelease` around the `signal-cli` process and socket, `Deferred` for first-connect, `Queue.bounded`/`sliding`, `withReconnect` with a `Schedule`, `Clock` + `Duration` in rate limiter, `timingSafeEqual` webhook secret check (`telegram.ts:240`). This is the repo's reference for resource-safe adapters.
- **Route meter** (`meter.ts`): all time via `Clock.currentTimeMillis`, reserve/settle/release idempotent, release in `Effect.ensuring` (`engine.ts:412`) so interrupted turns free their reservation.
- **Ingress server** (`ingress-server.ts`): body cap + slowloris timeout in `readCapped`, `maxInFlight` shed, `acquireRelease` server, generic error bodies, `Runtime.runPromise` bridge with a `.catch` to 500. Only F8 touches it.
- **Router engine pipeline** (`engine.ts`): `handleInbound` ends every failure as `ErrorSwallowed` (`catchAllCause`), semaphore-per-key FIFO with bounded backlog and `ensuring` cleanup, `RoutingError` tagged unions, `Effect.timeoutFail` turn bound, fail-closed `failClosedApproval`.
- **Schedule registry** (`gateway/src/schedule/registry.ts`): state in `Ref<Map>` with immutable copies, `commit` persists then updates, declarative config reconcile.
- **MCP read-only classification** (`tools/src/mcp/read-only-classification.ts`): pure functions, fails closed (`false | undefined`, never `true`), annotations picked field-by-field with a boolean guard (`pickMCPToolAnnotations`), `destructiveHint`/`openWorldHint` win. No Effect issues.
- **SessionBridge** other than F2: injected `now`, no timers, lazy expiry, `inFlight` guard, close failures to `emitErrorSwallowed`.
- **Lease API shape** (`AccountLeases.acquire` returns `Effect<void, ChannelAlreadyOwned, Scope>`): right abstraction; only the takeover step (F5) needs work.
- **Redaction defaults** (`observability/src/redaction/default-patterns.ts`): bounded quantifiers, ordered patterns, single canonical set consumed by logger/OTel/trace. File exporter (`file-exporter.ts`) is plain async `fs/promises` with `0o600`; fine as a leaf.
- **pinned-fetch** design (resolve once, validate all answers, connect to the validated IP, re-pin each hop, strip credentials cross-origin): intentional dependency-free Promise API.

## Fix plan by warden

| Order | Warden | Items | Size | Why first |
| --- | --- | --- | --- | --- |
| 1 | core-warden | F1a (EventBus per-handler `catchAllCause`), F17 (`timeoutMs`) | S + S | F1a protects every publisher; one-line semantic change with a pinned test |
| 2 | gateway-warden | F2 (SessionBridge chain), F1b (hub `catchAllCause`), F6 (finalizer order), F7 (hub scope + ghost registration), F5 (lease takeover), F8 (offer timeout) | S, S, S, M, S-M, S | All are in `packages/channels`; F2/F1b/F6 are small and independently shippable. Then F12 (shared `keyedSerial` / SessionCache) as a follow-up |
| 3 | runtime-warden | F3 (scoped gateway start/stop), F4 (resolver finalizer), F9, F11, F16, F19, F18 (verify first), F1c | M, S, S, S, S, S, S, S | F3 is the largest leak; F4/F19 share the host file; port the inbound queue (F12 part 3) after F3 |
| 4 | tools-warden | F10 (web-search on Effect: signal, Schedule, Schema) | M | Not a regression today; interrupt/timeout correctness for a hot tool |
| 5 | gateway-warden + runtime-warden | F13 (Clock), F14 (swallow events), F15 (Ref) | S per file | Do alongside the touched files in 2-3, not as a separate sweep |

Dispatch notes: all three channels items in order 2 are one MissionBrief for gateway-warden (`packages/channels/src/routing/**`, `services/session-bridge.ts`, `adapters/{telegram,webhook}.ts`). F1a needs core-warden because `event-bus.ts` is core-owned; do not bundle it into the channels brief. Per AGENTS anti-patterns, do not ask a warden to self-review; verify with `bun run repo verify packages/channels`, `.../runtime`, `.../core`, `.../tools`.

## Tests to pin (so fixes are not decorative)

1. Throwing `ChannelMessageReceived` subscriber: second subscriber still runs, adapter keeps delivering (F1).
2. `SessionBridge.runChatTurn` twice on one key where the first `chat` rejects: second `chat` is called (F2).
3. `startGateway` then immediate `stop()` before startup resolves: no timer, no listening port, router host stopped (F3).
4. Session `end()` rejecting: other sessions still closed, `disposeAll` still runs (F4).
5. Router close: finalizer order records adapter stop before lease release (F6).
6. Two concurrent `hub.register`: one scope; `shutdown` stops both adapters (F7).
7. web-search: interrupt cancels in-flight fetch (F10).
