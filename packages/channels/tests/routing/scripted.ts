import { Effect, Queue, Stream, type Scope } from "effect";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ConnectionState,
  DeliveryReceipt,
  InboundEnvelope,
  OutboundMessage,
} from "../../src/adapter.js";
import { makeConnectionState } from "../../src/combinators.js";
import { isChannelError, type ChannelError } from "../../src/errors.js";
import type {
  AgentResolver,
  OpenSessionRequest,
  RoutedTurn,
  ToolExposure,
} from "../../src/routing/types.js";

const CAPS: ChannelCapabilities = { threads: false, attachments: false, markdown: false, receipts: false, groups: true };

/** A network-free adapter: `push` feeds inbound, `sends` records outbound. */
export interface ScriptedAdapter extends ChannelAdapter {
  readonly push: (env: InboundEnvelope) => void;
  readonly sends: OutboundMessage[];
  /** Fail the inbound stream (as a platform drop would). */
  readonly failInbound: (error: ChannelError) => void;
}

export const makeScriptedAdapter = (opts: { id: string; platform?: string; fingerprint?: string }): ScriptedAdapter => {
  const queue = Effect.runSync(Queue.unbounded<InboundEnvelope | ChannelError>());
  const conn = Effect.runSync(makeConnectionState());
  const sends: OutboundMessage[] = [];
  let n = 0;
  const platform = opts.platform ?? "scripted";
  return {
    id: opts.id,
    platform,
    capabilities: CAPS,
    ...(opts.fingerprint !== undefined ? { accountFingerprint: opts.fingerprint } : {}),
    inbound: Stream.fromQueue(queue).pipe(
      Stream.mapEffect((item) => (isChannelError(item) ? Effect.fail(item) : Effect.succeed(item))),
    ),
    state: conn.state,
    currentState: conn.current,
    sends,
    push: (env) => void Effect.runSync(Queue.offer(queue, env)),
    failInbound: (error) => void Effect.runSync(Queue.offer(queue, error)),
    start: (): Effect.Effect<void, ChannelError, Scope.Scope> =>
      Effect.zipRight(
        conn.set({ status: "connected" }),
        Effect.addFinalizer(() => conn.set({ status: "disconnected" })),
      ),
    send: (m): Effect.Effect<DeliveryReceipt, ChannelError> =>
      Effect.sync(() => {
        sends.push(m);
        n += 1;
        return { messageId: `${opts.id}-out-${n}`, adapterId: opts.id, platform, status: "sent", sentAt: Date.now() } as const;
      }),
  };
};

let seq = 0;
/** An inbound envelope with sensible defaults. */
export const env = (over: {
  id?: string;
  platform?: string;
  userId?: string;
  chat?: string;
  text?: string;
  isGroup?: boolean;
  mentionsSelf?: boolean;
} = {}): InboundEnvelope => ({
  id: over.id ?? `m${++seq}`,
  conversation: { channelId: over.chat ?? "chat-1", isGroup: over.isGroup ?? false },
  sender: { platform: over.platform ?? "scripted", userId: over.userId ?? "alice" },
  text: over.text ?? "hello",
  attachments: [],
  mentionsSelf: over.mentionsSelf ?? true,
  isEcho: false,
  receivedAt: 1_700_000_000_000,
});

/** A tool the fake agents know about. `mutates` mirrors the planned `mutatesExternalState` flag. */
export interface FakeTool {
  readonly name: string;
  readonly mutates: boolean;
}

export const TOOLS: ReadonlyArray<FakeTool> = [
  { name: "web-search", mutates: false },
  { name: "file-read", mutates: false },
  { name: "file-write", mutates: true },
];

/** Build-time tool narrowing, as the runtime resolver does with `.withTools({ allowedTools })`. */
export const allowedToolsFor = (exposure: ToolExposure, catalog: ReadonlyArray<FakeTool> = TOOLS): string[] => {
  switch (exposure._tag) {
    case "AgentDefault":
      return catalog.map((t) => t.name);
    case "ReadOnly":
      return catalog.filter((t) => !t.mutates).map((t) => t.name);
    case "Allowlist":
      return catalog.filter((t) => exposure.tools.includes(t.name)).map((t) => t.name);
  }
};

/** What the scripted LLM saw for one turn. */
export interface RecordedCall {
  readonly agentId: string;
  readonly routeId: string;
  readonly role: "owner" | "sender";
  readonly sessionId: string;
  readonly tools: ReadonlyArray<string>;
  readonly messages: ReadonlyArray<{ readonly role: "system" | "user" | "assistant"; readonly content: string }>;
}

/**
 * A test {@link AgentResolver}: one fake agent per (routeId, role) whose tool list is fixed at
 * open time from the exposure, and a scripted LLM stand-in that records every message array.
 * `opens` is the spy for "the resolver was (not) called".
 */
export const makeFakeAgents = (personas: Record<string, string> = {}) => {
  const opens: OpenSessionRequest[] = [];
  const calls: RecordedCall[] = [];
  const histories = new Map<string, Array<{ role: "system" | "user" | "assistant"; content: string }>>();
  const resolver: AgentResolver = {
    open: (req) =>
      Effect.sync(() => {
        opens.push(req);
        const sessionId = `${req.routeId}:${req.role}:${req.conversationKey}`;
        const tools = allowedToolsFor(req.toolExposure);
        const persona = personas[req.target.agentId] ?? `You are ${req.target.agentId}.`;
        return {
          send: (turn: RoutedTurn) =>
            Effect.sync(() => {
              const history = histories.get(sessionId) ?? [{ role: "system" as const, content: persona }];
              histories.set(sessionId, history);
              history.push({ role: "user", content: turn.text });
              calls.push({
                agentId: req.target.agentId,
                routeId: req.routeId,
                role: req.role,
                sessionId,
                tools,
                messages: history.map((m) => ({ ...m })),
              });
              const text = `${req.target.agentId}:${req.role}`;
              history.push({ role: "assistant", content: text });
              return { text };
            }),
          close: Effect.void,
        };
      }),
  };
  return { resolver, opens, calls };
};

/** Poll until `pred` holds (real clock). */
export const waitFor = async (pred: () => boolean, ms = 2000): Promise<void> => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("waitFor timed out");
    await new Promise<void>((r) => setTimeout(r, 5));
  }
};
