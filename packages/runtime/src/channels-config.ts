import type {
  AccountLeases,
  ChannelAdapter,
  ChannelsConfig as BaseChannelsConfig,
  MessageChannel,
  RouteMeterOptions,
  RouterStore,
  RouteSpecInput,
} from "@reactive-agents/channels";
import type { ChannelAgentFactory } from "./agent/channel-router-resolver.js";

/**
 * Configuration for `.withChannels()`.
 *
 * Same as the channels package config, but `adapters` accepts the canonical
 * {@link ChannelAdapter} (typed receipts, backpressured inbound stream, no
 * connect/disconnect required) as well as the legacy {@link MessageChannel}.
 * Adapters are live code objects, so channels are wired through the builder and
 * are not part of the JSON-serializable `AgentConfig`.
 */
export interface ChannelsConfig extends Omit<BaseChannelsConfig, "adapters"> {
  readonly adapters: readonly (ChannelAdapter | MessageChannel)[];
  /**
   * Route-based access: each route matches inbound conversations, names a target agent, and says
   * who may talk and what a stranger may do (non-owner senders default to read-only tools).
   * When set, `adapters` must be canonical {@link ChannelAdapter}s and the channel router replaces
   * the legacy `triggers` path. Start it with `agent.start()` (needs `.withGateway()`).
   */
  readonly routes?: readonly RouteSpecInput[];
  /**
   * Target agents by `route.target.agentId`. Each factory returns a fresh builder; the router builds
   * one agent per (route, role) with the role's tool surface applied before `build()`.
   */
  readonly agents?: Readonly<Record<string, ChannelAgentFactory>>;
  /** Persist per-conversation history so a rebuilt agent resumes. Default `true`. */
  readonly persistSessions?: boolean;
  /** Router state. Default in-memory (dedupe and caps reset on restart; startup warns). */
  readonly store?: RouterStore;
  /** Account leases. Default lock files in the OS temp dir. */
  readonly leases?: AccountLeases;
  /** Per-route cost and message-per-day meter; omit for no metering. */
  readonly meter?: RouteMeterOptions;
}
