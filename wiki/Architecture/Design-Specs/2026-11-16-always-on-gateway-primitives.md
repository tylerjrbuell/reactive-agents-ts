---
type: design-spec
status: active
created: 2026-11-16
tags: [gateway, channels, durability, inbox, outbox, timers, always-on]
---

# Always-on gateway primitives: durable inbox, event policy, timers, outbox

Source: Anthropic, "Building always-on agents" (2026-11-13): an always-on agent is the normal loop plus a durable event inbox, a timer store, durable memory, deferred tool calls and an outbox. Owner direction 2026-11-16: harden the base primitives for robustness and flexibility so later abilities build on them. Framework-first: every primitive is reachable from the gateway/channels API; Cortex only renders and edits.

## What already matches
One owner per account (`channels/routing/lease.ts`), dedupe and per-conversation queue and turn caps (`router.ts`), schedules with downtime catch-up (`gateway/services/scheduler-service.ts`), deferred approvals, traces and cost/kill controls (ahead of the article).

## Gaps and contracts

### G1. Durable inbox (RouterStore)
Default `RouterStore` is in-memory (`durable: false`): a restart drops queued envelopes and resets dedupe, so a redelivery can run a turn twice.
- Add a SQLite-backed `RouterStore` (via `runtime-shim` Database; Node-safe, no new Bun-only API) holding every accepted envelope with status `received | running | done | failed | dropped`, the dedupe key (platform + source id), timestamps, attempt count and last error.
- Crash recovery: on start, `running` rows older than a lease TTL return to `received` and are retried up to a bounded attempt count, then `failed` (never silent). One active worker per inbox stays guaranteed by the existing lease.
- Router status reports `durable: true` and counts per status. In-memory store stays as the test/single-process default; the choice is explicit config, not magic.
- Dedupe survives restart. Retention is bounded (age + count) and configurable.

### G2. Event policy per conversation (batching + mid-run handling)
- `batchWindowMs` (default 0 = today's behavior): envelopes from one sender in one conversation within the window become ONE turn input (joined, order preserved, each source id recorded).
- `midRun: "queue" | "fold" | "interrupt"` (default `"queue"` = today's behavior). `fold` appends the new message to the running turn's pending input at the next safe boundary; `interrupt` cancels the running turn (typed cancellation, partial work recorded) and starts a new one from the combined input. Both are opt-in per route; defaults byte-identical.
- Types on `RouteSpec` (validated, hub editor + docs follow).

### G3. Timers as their own store
- Agent-callable follow-up tool: `follow-up` `{ at | in, note }` writes a timer (id, conversation/agent, due time, note, status) to the gateway timer store (durable, separate from the inbox and from cron schedules); a due timer enqueues an inbox event for that conversation. Bounded per agent (max pending, max horizon), cancellable, visible in status.
- Reuses scheduler polling; recurrence stays in cron schedules.

### G4. Outbox with bounded retry
- Sends go through a small outbox: row per outgoing message (conversation, text, status `pending | sent | failed`, attempts, last error). A dispatcher retries transient adapter errors with backoff up to a cap, preserves order per conversation, and reports permanent failures as typed events (`ChannelSendFailed`) instead of swallowing them.
- Failed-turn notices and acks keep their current semantics but use the same path. Optional `pacing` (min gap per conversation) for message volume.

### G5/G6 (design notes only, not this wave)
Credential proxy (secrets injected outside the agent process) and "start quiet" outbound-volume evals: write up in the security backlog; no code now.

## Non-goals
No distributed multi-host queue; no exactly-once delivery guarantee (document at-least-once with dedupe); no change to default routing behavior without explicit config.

## Verification
Crash-recovery test (kill mid-turn, restart, turn retried once, dedupe holds); redelivery-after-restart does not double-run; batching and fold/interrupt tests with scripted adapters; outbox retry/order tests; defaults byte-identical (existing router/scheduler suites unchanged); docs + consumer skill (`gateway-persistent-agents`) + hub editor fields; changeset.

## Work split
1. gateway-warden: G1 + G2 together (the inbox is the home for both), then G3, then G4 (sequential, same package).
2. cortex-warden: hub editor fields (`batchWindowMs`, `midRun`, store status), inbox/outbox status panel (render only).
3. harness-warden/ablation only if a default changes (none planned).
