import type {
  ChannelAdapter,
  ChannelsConfig as BaseChannelsConfig,
  MessageChannel,
} from "@reactive-agents/channels";

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
}
