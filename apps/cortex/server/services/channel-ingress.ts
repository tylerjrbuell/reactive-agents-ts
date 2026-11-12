/**
 * Loopback ingress for webhook channels, shared by the legacy per-agent host
 * (`gateway-channel-host.ts`) and the channel hub (`channel-hub.ts`).
 *
 * One listener per port; each webhook adapter is mounted through its own `handleWebhook`
 * (signature check, enqueue, typed `ChannelError`), so a bad signature is refused before anything
 * is routed.
 */
import { Effect, Exit, Scope } from "effect";
import { startGatewayIngress } from "@reactive-agents/gateway";
import type { WebhookMount } from "./channel-adapters.js";

/** Start the listeners for `mounts`. Close the returned scope to stop them. */
export async function mountWebhookIngress(mounts: readonly WebhookMount[]): Promise<Scope.CloseableScope> {
  const scope = await Effect.runPromise(Scope.make());
  try {
    const ports = [...new Set(mounts.map((m) => m.port))];
    for (const port of ports) {
      const routes = mounts.filter((m) => m.port === port).map((m) => ({
        path: m.route,
        id: m.adapter.id,
        // The adapter's own ingress handler: verification, enqueue and a typed ChannelError.
        handle: (req: { readonly body: string; readonly headers: Readonly<Record<string, string>> }) => m.adapter.handleWebhook(req),
      }));
      await Effect.runPromise(
        startGatewayIngress({ port }, { channelRoutes: routes, onEvent: () => Effect.void }).pipe(Effect.provideService(Scope.Scope, scope)),
      );
    }
    return scope;
  } catch (e) {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    throw e;
  }
}
