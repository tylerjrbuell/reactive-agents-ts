<script lang="ts">
  /**
   * Read-only "Reachable via" line under a saved agent: the channels whose routes point at it, with
   * a shortcut to add one. Routes are edited on the Channels tab; this only summarises them.
   */
  import { channelKindInfo } from "$lib/channels.js";
  import { routesToAgent, type HubRouteWire } from "$lib/channel-hub.js";
  import type { HubChannelRow } from "$lib/channel-hub-api.js";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";

  interface Props {
    agentId: string;
    routes: readonly HubRouteWire[];
    channels: readonly HubChannelRow[];
    onAddRoute: (agentId: string) => void;
  }
  let { agentId, routes, channels, onAddRoute }: Props = $props();

  const mine = $derived(routesToAgent(agentId, routes));
  const name = (id: string): string => {
    if (id === "*") return "Every channel";
    const c = channels.find((x) => x.id === id);
    return c ? (c.label ?? channelKindInfo(c.platform).label) : id;
  };
</script>

<div class="rv" aria-label="Reachable via">
  <span class="rv-l">Reachable via</span>
  {#if mine.length === 0}
    <span class="rv-none">no channel</span>
  {:else}
    {#each mine as r (r.id)}
      <Badge tone={r.enabled === false ? "neutral" : r.open ? "warn" : "io"}>{name(r.match.channelId)}{r.enabled === false ? " (off)" : r.open ? " (open)" : ""}</Badge>
    {/each}
  {/if}
  <Button size="sm" variant="ghost" icon="plus" onclick={() => onAddRoute(agentId)}>Add route</Button>
</div>

<style>
  .rv { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; }
  .rv-l { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .rv-none { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
</style>
