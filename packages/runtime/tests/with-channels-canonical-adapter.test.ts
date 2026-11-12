import { describe, expect, test } from "bun:test";
import { Effect, Queue, Stream } from "effect";
import type {
  ChannelAdapter,
  ConnectionState,
  DeliveryReceipt,
  InboundEnvelope,
  OutboundMessage,
} from "@reactive-agents/channels";
import { ReactiveAgents } from "../src/builder.js";

/** Canonical adapter with no connect/disconnect, driven by an in-memory queue. */
const makeFakeAdapter = () => {
  const sent: OutboundMessage[] = [];
  const log = { registered: 0, scopeClosed: 0 };
  const queue = Effect.runSync(Queue.unbounded<InboundEnvelope>());
  const connected: ConnectionState = { status: "connected" };
  const adapter: ChannelAdapter = {
    id: "fake-signal",
    platform: "signal",
    capabilities: {
      threads: false,
      attachments: false,
      markdown: false,
      receipts: false,
      groups: false,
    },
    inbound: Stream.fromQueue(queue),
    state: Stream.make(connected),
    currentState: Effect.succeed(connected),
    start: () =>
      Effect.acquireRelease(
        Effect.sync(() => void log.registered++),
        () => Effect.sync(() => void log.scopeClosed++),
      ),
    send: (message) =>
      Effect.sync((): DeliveryReceipt => {
        sent.push(message);
        return {
          messageId: `r-${sent.length}`,
          adapterId: "fake-signal",
          platform: "signal",
          status: "sent",
          sentAt: Date.now(),
        };
      }),
  };
  const push = (text: string) =>
    Effect.runPromise(
      Queue.offer(queue, {
        id: "m-1",
        conversation: { channelId: "dm-1", isGroup: false },
        sender: { platform: "signal", userId: "user-1" },
        text,
        attachments: [],
        mentionsSelf: true,
        isEcho: false,
        receivedAt: Date.now(),
      }),
    );
  return { adapter, sent, log, push };
};

const waitFor = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
};

describe(".withChannels() accepts a canonical ChannelAdapter", () => {
  test("inbound reaches the agent, reply goes through send(), shutdown closes the adapter scope", async () => {
    const fake = makeFakeAdapter();
    const agent = await ReactiveAgents.create()
      .withName("ch-canonical")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: pong" }])
      .withGateway({
        heartbeat: { intervalMs: 999_999, policy: "adaptive" },
        accessControl: { accessPolicy: "open" },
      })
      .withChannels({
        adapters: [fake.adapter],
        triggers: [
          { id: "t-all", name: "catch", match: { type: "keyword", patterns: ["hi"] }, agent: {} },
        ],
        defaultAgent: {},
      })
      .build();

    const handle = agent.start();
    await waitFor(() => fake.log.registered > 0);
    expect(fake.log.registered).toBe(1);

    await fake.push("hi");
    await waitFor(() => fake.sent.length > 0);
    expect(fake.sent.length).toBe(1);
    expect(fake.sent[0]?.text).toContain("pong");
    expect(fake.sent[0]?.conversation.channelId).toBe("dm-1");

    expect(fake.log.scopeClosed).toBe(0);
    await handle.stop();
    expect(fake.log.scopeClosed).toBe(1);
  }, 20000);
});
