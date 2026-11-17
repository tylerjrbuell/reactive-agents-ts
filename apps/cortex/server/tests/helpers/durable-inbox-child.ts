/**
 * A child process for `channel-hub-durable-inbox.test.ts`: the hub's real store composition (Cortex route
 * table, leases and meter + the framework's durable inbox, outbox and timers from `openHubStore`) under a
 * framework router with a scripted channel and a scripted agent. No network, no model.
 *
 *   bun durable-inbox-child.ts crash   <db>   a turn starts and never ends; one reply is left `pending`; prints READY, then waits to be killed
 *   bun durable-inbox-child.ts restart <db>   the same file reopened: answers; a redelivery is pushed; prints one JSON summary line and exits
 */
import { Database } from "bun:sqlite";
import { Effect, Schema } from "effect";
import { RouteSpec, createChannelRouter, type AgentResolver, type RoutedTurn, type RouteSpecInput } from "@reactive-agents/channels";
import { applySchema } from "../../db/schema.js";
import { insertChannel, insertRoute } from "../../db/channel-hub-queries.js";
import { makeDbLeases, loadValidRoutes, makeDurableRouterStore } from "../../services/channel-hub-store.js";
import { openHubStore } from "../../services/channel-hub-durable-inbox.js";
import { scriptedChannel } from "./scripted-channel.js";

const [mode, dbPath] = process.argv.slice(2);
if ((mode !== "crash" && mode !== "restart") || !dbPath) {
  process.stderr.write("usage: durable-inbox-child.ts crash|restart <db>\n");
  process.exit(2);
}

const CH = "ch-crash0001";
const db = new Database(dbPath);
applySchema(db);
insertChannel(db, { id: CH, platform: "telegram", settings: {} });
insertRoute(db, { id: "r1", match: { channelId: CH }, target: { agentId: "agent" }, owners: ["telegram:1"] });

const channel = scriptedChannel(CH);
const turns: string[] = [];
const resolver: AgentResolver = {
  open: () =>
    Effect.succeed({
      send: (turn: RoutedTurn) =>
        Effect.zipRight(Effect.sync(() => void turns.push(turn.text)), mode === "crash" ? Effect.never : Effect.succeed({ text: `re:${turn.text}` })),
      close: Effect.void,
    }),
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const main = async (): Promise<void> => {
  const hubStore = await openHubStore(db, makeDurableRouterStore(db), true);
  const encode = Schema.encodeSync(RouteSpec);
  const routes = loadValidRoutes(db).routes.map((r): RouteSpecInput => encode(r));
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const router = yield* createChannelRouter({
          channels: [channel.adapter],
          routes,
          agents: resolver,
          store: hubStore.store,
          leases: makeDbLeases(db),
          followUp: true,
        });
        yield* Effect.promise(async () => {
          if (mode === "crash") {
            // The channel is a PubSub: a push before the router subscribed would be lost.
            await wait(500);
            channel.push("1", "hang", "m1");
            while (turns.length === 0) await wait(20);
            // A reply the process never got to send: a `pending` outbox row, as a crash mid-send leaves it.
            await Effect.runPromise(
              hubStore.store.outbox!.enqueue({
                adapterId: CH,
                conversationKey: `${CH}:2`,
                message: { conversation: { channelId: "2" }, text: "queued reply" },
                resume: true,
                sourceKey: `${CH}:gone`,
              }),
            );
            process.stdout.write("READY\n");
            await new Promise<void>(() => undefined);
          } else {
            await wait(500);
            channel.push("1", "hang", "m1");
            await wait(400);
            const status = await Effect.runPromise(router.status);
            process.stdout.write(
              `${JSON.stringify({ turns, sent: channel.sent.map((s) => s.text), inbox: status.inbox, outbox: status.outbox, timers: status.timers })}\n`,
            );
          }
        });
      }),
    ),
  );
  await hubStore.close();
  process.exit(0);
};

void main();
