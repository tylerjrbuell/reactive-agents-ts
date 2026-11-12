---
type: audit
status: active
created: 2026-11-12
tags: [audit, gateway, channels, a2a, deploy, signal, telegram]
---

# Gateway, channels, a2a and deploy audit (2026-11-12)

Read-only audit by the gateway-warden role (first pass). Pristine tests: gateway 137, channels 21, a2a 30, deploy 27, all green; green mostly means templates render and units pass in isolation, the wiring gaps below are untested. Claims marked *verify* were not confirmed beyond grep.

## Key finding: two channel paths, the production one is not `@reactive-agents/channels`
- **Path A (Signal, Telegram today):** MCP push. The Signal MCP server writes `notifications/message` to stdout; `packages/tools` tool-service turns it into `ChannelMessageReceived`; runtime `agent/gateway-driver.ts:subscribeChannelHandler` dedupes (30 s on sender:message) and calls `gw.processEvent`. **Outbound is the LLM calling an MCP tool** (`channelOutboundToolGuidance`): no deterministic delivery, no receipt, no typed failure. Telegram has no inbound push (agent polls `telegram/get_chats` on a heartbeat) and uses a Telethon user session (phone + OTP), not a bot token, contradicting the channels `types.ts` header.
- **Path B (`@reactive-agents/channels`):** `MessageChannel` -> `ChannelService.handleInbound` -> policy -> `TriggerRegistry` -> `SessionBridge.runChatTurn` -> `adapter.sendMessage`. Only `WebhookChannelAdapter` ships; Signal and Telegram do not use it. Two session stores, two dedupe schemes.

## Gateway correctness bugs
- **G1 High:** rate-limit and token-budget windows never reset (`hourWindowStart`/`dayWindowStart` set, never read). After `maxActionsPerHour` (30) the policy queues forever until restart.
- **G2 High:** `queue` decisions go nowhere (`pendingEvents`, `SchedulerService.queueRef` never written); a queued channel message is dropped.
- **G3 High:** `executeEvent` drops overlapping events (`isExecuting`): a cron during a chat reply, or a message during a cron, is lost.
- **G4 High:** schedules not durable (`lastCheckedMinute` in memory; no lastRun/lastResult store; missed fires not replayed).
- **G5 Med:** cron work runs inline inside the tick; one long run delays heartbeat, pruning and compaction.
- **G6 Med:** webhooks are not served: `WebhookService` and adapters exist, nothing mounts an HTTP listener; `GatewayConfig.port` and `webhooks` are consumed by no server (*verify*).
- **G7/G9/G10:** dead exports (`routeEvent`, `routeEventWithBus`), `critical` priority has no producer.
- **G8 Med:** access control: sender key not platform-namespaced (Signal number vs Telegram id can collide); group chats key on the individual; empty sender skips the policy (fail-open); `replyToUnknown` accepted but never acted on.
- **G11 Low:** 30 s dedupe drops a legitimate repeat ("yes").

## Channels findings
- `handleInbound` swallows turn and send errors (empty reply, `emitErrorSwallowed`); `ChannelMessageSent` carries a fabricated id (`local-${Date.now()}`) even on failed sends; `status()` is a stub.
- `TriggerRegistry`: `mention` is a hardcoded `/(@bot|@agent)/`; `reaction` and `webhook` always false; `response`, `lifecycle`, `allowedRoles` never read; sessions are never ended or TTL'd.
- `SessionBridge`: in-memory map; a rejected chat promise wedges that user's key until `release()` (no caller).
- `WebhookChannelAdapter`: never mounted; a secretless config silently disables auth (fail-open); no replay window; attachments and replyTo ignored; `Attachment.binary` uses Node `Buffer` (use `Uint8Array`).
- Signal MCP server: echo suppression by message text (60 s); single global `lastSender` cross-wires concurrent senders; group sender lost; no receipts; attachments ignored; `(n.params as any)` casts; `signal-cli-bridge.ts` reconnect behaviour not audited.
- Error taxonomy: `ChannelSendError.reason` is effectively always `"unknown"`.

## Deploy findings (`apps/cli/src/commands/deploy/**`)
Structure is sound (`DeployProvider` interface, registry, `--dry-run` preflight report). Issues:
- **D1 High:** `agentName` is interpolated unquoted into `sh -c` strings and never validated (shell injection). Validate `/^[a-z0-9][a-z0-9-]{0,40}$/`, use argument arrays.
- **D2 High:** the always-on gateway daemon cannot run on most targets as scaffolded: Fly `auto_stop_machines="stop"` kills cron and heartbeat (plus three overlapping health-check definitions); Cloud Run scales to zero and throttles CPU (needs `--no-cpu-throttling --min-instances=1`, or SDK mode only); Render free plan sleeps.
- **D3 High:** Cloud Run deploys `--allow-unauthenticated` and the agent API has no auth.
- **D4 Med:** secrets are placeholder-only (DO spec ships `REPLACE_ME` and deploys it); nothing is pushed to the provider.
- **D5 Med:** stale hardcoded model `claude-sonnet-4-20250514` in defaults and render/DO templates.
- **D6 Med:** no post-deploy health verification (`waitForHealth` unused), no rollback.
- **D7 Low:** `process.exit` inside providers; `down()` destroys without prompting.
- Render: `render blueprint launch` is not a documented CLI command (`blueprints validate` is); empty `dockerCommand`/`startCommand` strings; Cloud Run uses legacy `gcr.io` paths (use Artifact Registry); Railway `down` removes the latest deployment, not the project; DO `down()` only prints instructions.
- Not verified against live docs: Fly, gcloud and doctl flags (recalled).

## a2a
30/30 tests; opt-in bearer token (`RA_A2A_TOKEN`); runtime wiring exists; `GatewayEventSource` includes `"a2a"` but no producer emits it (unwired); declared `protocolVersion` not checked against the current A2A spec.

## Ranked fixes
| # | Fix | Effort | Risk | Owner |
|---|---|---|---|---|
| 1 | G1 reset windows, clock-advancing test | S | Low | gateway |
| 2 | D1 validate name, argument arrays | S | Low | gateway |
| 3 | D3 + D2 authenticated by default, per-target daemon settings | S-M | Low | gateway |
| 4 | Render CLI fix, drop empty strings | S | Low | gateway |
| 5 | Typed delivery receipts, stop swallowing, honest status | M | Med | gateway (+ core event fields) |
| 6 | Canonical `ChannelAdapter` + conformance suite | L | Med | gateway |
| 7 | G3/G2 durable bounded inbound queue instead of drop | M-L | Med | runtime (`execute-event.ts`, `gateway-tick.ts`) |
| 8 | G4 durable `ScheduleRegistry` (ids, lastRun, pause, runNow, lastResult) + Cortex API | L | Med | gateway + runtime |
| 9 | G6 mount webhook ingress or delete | M | Med | gateway |
| 10 | D4/D6 secrets-from-env push, health check, rollback | M | Low | gateway |
| 11 | Native Signal adapter (signal-cli jsonRpc in TS), Telegram Bot API adapter | M each | Med | gateway |
| 12 | Self-host compose target, `deploy plan --json` | M | Low | gateway |
| 13 | G8 namespaced sender keys, act on `replyToUnknown`, fail-closed on empty sender | S | Low | gateway |
| 14 | Wire-or-delete sweep | S-M | Low | gateway |

## Proposed `ChannelAdapter` contract (summary; full draft goes in the design spec)
Native adapter owns the platform (inbound, outbound, identity, receipts, reconnect); the gateway sees `InboundEnvelope` / `OutboundMessage` only.
- `ChannelIdentity {platform, userId}`: access control keys on `platform:userId`.
- `InboundEnvelope`: platform message `id` (idempotency), conversation `{channelId, threadId?, isGroup}`, `sender`, `text`, `attachments` (`Uint8Array` or url), `replyTo`, `mentionsSelf` (adapter resolves), `isEcho`, `receivedAt`.
- `send(OutboundMessage) -> DeliveryReceipt {messageId (real), status}`; typed `ChannelError {kind: auth | rate_limited | not_found | forbidden | too_large | unsupported | network | unknown, retryAfterMs?, retryable}`.
- `capabilities` (threads, attachments, markdown, receipts, groups, max sizes), `state: Stream<ConnectionState>`, scoped `start` with internal backoff reconnect, backpressured `inbound` stream, credentials as `Redacted`.
- `ChannelService` consumes `inbound`, applies namespaced access, gateway policy, `TriggerRegistry`, session, and calls `adapter.send` itself, so replies stop depending on the LLM calling an MCP tool.

## Proposed conformance suite (`packages/channels/tests/conformance/`)
`runAdapterConformance(name, makeHarness)` over a fake platform (no network, no tokens): inbound normalization, idempotency, echo suppression, group vs DM and identity, send receipts and threads, attachments, typed errors (401 -> auth, 429 -> rate_limited + retryAfterMs, 404, socket drop -> network), reconnect without loss or duplication, backpressure, outbound rate limit (TestClock), secrets never in logs/events, access control and namespaced ids, receipt monotonicity. Every shipped adapter (webhook, signal, telegram) must pass it.

## Recommended order
1. Quick safe fixes (#1, #2, #3/#4, #13), one concern per commit.
2. Approve the adapter contract; build Signal (native) then Telegram Bot API against the conformance suite.
3. core-warden: additive event fields (`ChannelMessageReceived` adapterId/conversation, `ChannelDeliveryFailed`); runtime-warden: queue instead of drop.
4. `ScheduleRegistry` + Cortex management API, then deploy hardening and the self-host target.
