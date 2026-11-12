/**
 * A channel adapter driven by the test: no network. `push` injects an inbound message, `sent` records
 * every reply, `starts` counts how many times a host opened it (the single-poller pin reads this).
 */
import { Effect, PubSub, Ref, Stream } from "effect";
import type { ChannelAdapter, ConnectionState, DeliveryReceipt, InboundEnvelope, OutboundMessage } from "@reactive-agents/channels";

export interface ScriptedChannel {
  readonly adapter: ChannelAdapter;
  readonly sent: OutboundMessage[];
  /** How many times `start` ran (one per host that opened this account). */
  readonly starts: () => number;
  readonly push: (userId: string, text: string, id?: string) => void;
}

export const scriptedChannel = (id: string, fingerprint = `telegram:${id}`, counter?: { n: number }): ScriptedChannel => {
  const state = Effect.runSync(Ref.make<ConnectionState>({ status: "connected" }));
  const states = Effect.runSync(PubSub.unbounded<ConnectionState>());
  const inbound = Effect.runSync(PubSub.unbounded<InboundEnvelope>());
  const sent: OutboundMessage[] = [];
  let starts = 0;
  let n = 0;
  const adapter: ChannelAdapter = {
    id,
    platform: "telegram",
    accountFingerprint: fingerprint,
    capabilities: { threads: false, attachments: false, markdown: false, receipts: false, groups: true },
    inbound: Stream.fromPubSub(inbound),
    state: Stream.fromPubSub(states),
    currentState: Ref.get(state),
    start: () =>
      Effect.sync(() => {
        starts += 1;
        if (counter) counter.n += 1;
      }),
    send: (m): Effect.Effect<DeliveryReceipt> =>
      Effect.sync(() => {
        sent.push(m);
        return { messageId: `out${sent.length}`, adapterId: id, platform: "telegram", status: "sent", sentAt: Date.now() };
      }),
  };
  return {
    adapter,
    sent,
    starts: () => starts,
    push: (userId, text, mid) =>
      Effect.runSync(
        PubSub.publish(inbound, {
          id: mid ?? `m${++n}`,
          conversation: { channelId: userId, isGroup: false },
          sender: { platform: "telegram", userId },
          text,
          attachments: [],
          mentionsSelf: true,
          isEcho: false,
          receivedAt: Date.now(),
        }),
      ),
  };
};

/** Polls `read` until `ok` holds (the router folds inbound traffic on its own fibers). */
export async function until<T>(read: () => Promise<T> | T, ok: (v: T) => boolean, tries = 120): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  return read();
}
