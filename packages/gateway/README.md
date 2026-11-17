# @reactive-agents/gateway

> Persistent-agent host for Reactive Agents: cron and heartbeat scheduling, webhook ingestion and a policy engine that decides what an inbound event may trigger.

> **Stability:** unstable. The schedule registry and inbound-queue surfaces are still growing; the builder entry point `.withGateway()` is the supported way in.

## Install

```bash
bun add @reactive-agents/gateway
# or: npm install @reactive-agents/gateway
```

Most apps do not import this package directly: `reactive-agents` and `@reactive-agents/runtime` wire it through `.withGateway()`.

## Usage

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("ops-agent")
  .withProvider("anthropic")
  .withGateway({
    heartbeat: { intervalMs: 1_800_000, policy: "adaptive" },
    accessControl: { accessPolicy: "allowlist", allowedSenders: ["signal:+15550100"] },
    policies: { dailyTokenBudget: 50_000 },
  })
  .build();

await agent.start();
```

Crons and webhooks are further `.withGateway()` options; see the gateway docs.

## API

| Export | Use it when |
|---|---|
| `GatewayService`, `GatewayServiceLive` | You host the gateway loop yourself (state, status, inbound queue via `withInboundQueue`). |
| `PolicyEngine`, `evaluatePolicies` | You evaluate `SchedulingPolicy[]` against a `GatewayEvent`. |
| `createAdaptiveHeartbeatPolicy`, `createCostBudgetPolicy`, `createRateLimitPolicy`, `createEventMergingPolicy`, `createAccessControlPolicy` | You need a built-in policy outside the builder. |
| `SchedulerService`, `ScheduleRegistry`, `makeSqliteScheduleStore` | You manage durable schedules (list, pause, run now). |
| `parseCron`, `shouldFireAt` | You need cron matching on its own. |
| `WebhookService`, `createGitHubAdapter`, `createGenericAdapter` | You ingest webhooks (GitHub HMAC verification or any JSON payload). |
| `startIngress`, `startGatewayIngress` | You run the HTTP ingress server directly. |
| `routeEvent`, `routeEventWithBus` | You route a `GatewayEvent` into the agent loop (the bus variant also publishes to the EventBus). |

Inbound messaging from Signal, Telegram and other platforms lives in [`@reactive-agents/channels`](https://www.npmjs.com/package/@reactive-agents/channels).

## Documentation

- [Gateway](https://docs.reactiveagents.dev/features/gateway/): heartbeats, crons, webhooks, policies, chat mode and status.
- [Messaging channels](https://docs.reactiveagents.dev/guides/messaging-channels/): connect the gateway to Signal, Telegram and webhooks.

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.
## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
