<script lang="ts">
  /**
   * Channels (Lab builder): the messaging a saved gateway agent answers on (Telegram,
   * Signal, signed webhook), who may message it, its schedules and its inbound queue.
   * Compose-only: each concern is its own component (`components/channels/`) and its own
   * rules module (`lib/channels.ts`, `lib/channel-access.ts`, `lib/gateway-schedules.ts`).
   * Channels run only for a saved Gateway process agent; on-demand and desk runs ignore them.
   */
  import ConfigSection from "../ConfigSection.svelte";
  import AccessControlEditor from "$lib/components/channels/AccessControlEditor.svelte";
  import ChannelCard from "$lib/components/channels/ChannelCard.svelte";
  import GatewayLoopEditor from "$lib/components/channels/GatewayLoopEditor.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { addChannel, channelsOf, CHANNEL_KINDS, newChannel, removeChannel, updateChannel } from "$lib/channels.js";
  import { deleteChannelCredentials } from "$lib/gateway-api.js";
  import type { GatewayBlock } from "$lib/channel-access.js";
  import { accessModeOf } from "$lib/channel-access.js";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();

  const channels = $derived(channelsOf(config));
  const mode = $derived(accessModeOf(config.gateway));

  /** Store a channels list; an empty one is dropped from the config. */
  function setChannels(next: ReturnType<typeof channelsOf>) {
    const { channels: _old, ...rest } = config;
    config = next.length > 0 ? { ...rest, channels: next } : (rest as PanelAgentConfig);
  }

  function setGateway(next: GatewayBlock | undefined) {
    const { gateway: _old, ...rest } = config;
    config = next ? { ...rest, gateway: next } : (rest as PanelAgentConfig);
  }

  async function dropChannel(id: string) {
    const r = await deleteChannelCredentials(CORTEX_SERVER_URL, fetch, id);
    if (!r.ok) toast.warning("Credential not deleted", r.error);
    setChannels(removeChannel(channels, id));
  }
</script>

<ConfigSection id="channels" icon="chat" title="Channels" {open} {onToggle}>
  {#snippet head()}
    <span class="truncate">{channels.length === 0 ? "none" : `${channels.length} channel${channels.length === 1 ? "" : "s"}`}{channels.length > 0 && mode === "deny-all" ? " · nobody allowed" : ""}</span>
  {/snippet}

  <div class="acp-stack">
    <p class="acp-hint">
      Channels connect a <strong>saved Gateway process</strong> agent to messaging. They start when the agent is saved and active, and keep running without a browser. On-demand runs ignore them. Save the agent, then watch it in the Gateway tab.
    </p>

    {#if channels.length === 0}
      <div class="ch-empty">
        <p>No channels yet. Add the one this agent should answer on.</p>
      </div>
    {:else}
      {#each channels as c (c.id)}
        <ChannelCard
          channel={c}
          onChange={(patch) => setChannels(updateChannel(channels, c.id, patch))}
          onRemove={() => dropChannel(c.id)}
        />
      {/each}
    {/if}

    <div class="ch-add" role="group" aria-label="Add a channel">
      {#each CHANNEL_KINDS as k (k.kind)}
        <Button size="sm" icon="plus" onclick={() => setChannels(addChannel(channels, newChannel(k.kind)))}>{k.label}</Button>
      {/each}
    </div>

    <AccessControlEditor gateway={config.gateway} onChange={setGateway} />
    <GatewayLoopEditor gateway={config.gateway} onChange={setGateway} />
  </div>
</ConfigSection>

<style>
  .ch-empty { padding: 14px 16px; border: 1px dashed var(--cortex-line-strong); border-radius: var(--cortex-r-ctl); }
  .ch-empty p { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .ch-add { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
