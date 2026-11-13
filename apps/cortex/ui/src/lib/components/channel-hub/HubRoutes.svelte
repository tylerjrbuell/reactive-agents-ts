<script lang="ts">
  /**
   * The routes, in the order the router tries them (priority, then creation): "Channel, match,
   * Agent" with who can talk, what non-owners can do, whether the route is live and why not. Edit
   * opens the drawer; the switch turns a route on or off without the full editor (a plain
   * on/off never widens access, so it needs no confirm).
   */
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import { channelKindInfo } from "$lib/channels.js";
  import { accessClause, routeLine, type HubRouteWire } from "$lib/channel-hub.js";
  import { deleteHubRoute, saveHubRoute, type AgentChoice, type HubChannelRow, type HubLive } from "$lib/channel-hub-api.js";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";

  interface Props {
    routes: readonly HubRouteWire[];
    channels: readonly HubChannelRow[];
    agents: readonly AgentChoice[];
    live: HubLive | null;
    onEdit: (route: HubRouteWire) => void;
    onNew: () => void;
    onChanged: () => void;
  }
  let { routes, channels, agents, live, onEdit, onNew, onChanged }: Props = $props();

  const channelName = (id: string): string => {
    if (id === "*") return "Every channel";
    const c = channels.find((x) => x.id === id);
    return c ? (c.label ?? channelKindInfo(c.platform).label) : id;
  };
  const agentName = (id: string): string => agents.find((a) => a.agentId === id)?.name ?? id;
  const sorted = $derived([...routes].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100)));
  const liveOf = (id: string) => live?.routes.find((r) => r.id === id);

  async function toggle(route: HubRouteWire, enabled: boolean) {
    const r = await saveHubRoute(CORTEX_SERVER_URL, fetch, { ...route, enabled }, route, []);
    if (!r.ok) toast.error("Route not changed", r.error);
    onChanged();
  }

  async function remove(route: HubRouteWire) {
    const ok = await confirmAction({ title: `Delete route ${route.id}?`, message: "Messages that matched it fall through to the next route, or go unanswered.", confirmLabel: "Delete route" });
    if (!ok) return;
    const r = await deleteHubRoute(CORTEX_SERVER_URL, fetch, route.id);
    if (!r.ok) toast.error("Route not deleted", r.error);
    onChanged();
  }
</script>

<section class="hr" aria-labelledby="hr-h">
  <header class="hr-h">
    <h3 id="hr-h">Routes</h3>
    <Button size="sm" variant="primary" icon="plus" onclick={onNew} disabled={channels.length === 0 || agents.length === 0}>New route</Button>
  </header>
  {#if sorted.length === 0}
    <EmptyState title="No routes yet" description={channels.length === 0 ? "Add a channel first, then route it to an agent." : agents.length === 0 ? "Save an agent in the Builder, then route a channel to it." : "A channel with no route answers nobody. Route it to an agent."} />
  {:else}
    <ol class="hr-list">
      {#each sorted as r (r.id)}
        {@const l = liveOf(r.id)}
        <li class="hr-row" class:hr-off={r.enabled === false}>
          <div class="hr-main">
            <div class="hr-flow">
              <strong>{channelName(r.match.channelId)}</strong>
              <span class="hr-arrow" aria-hidden="true">→</span>
              <span class="hr-match">{routeLine(r)}</span>
              <span class="hr-arrow" aria-hidden="true">→</span>
              <strong>{agentName(r.target.agentId)}</strong>
            </div>
            <div class="hr-badges">
              <Badge data tone="neutral">{r.id}</Badge>
              <Badge tone={r.open ? "warn" : "neutral"}>Talk: {accessClause(r)}</Badge>
              <Badge tone="neutral">{r.senderTools?._tag === "AgentDefault" ? "Full tools" : r.senderTools?._tag === "Allowlist" ? "Some tools" : "Read-only"}</Badge>
              {#if (r.owners ?? []).length > 0}<Badge tone="io" data>{(r.owners ?? []).length} owner{(r.owners ?? []).length === 1 ? "" : "s"}</Badge>{/if}
              {#if r.ack}<Badge tone="accent">Acknowledges</Badge>{/if}
              {#if r.migratedFrom}<Badge tone="warn">Imported</Badge>{/if}
              {#if r.enabled !== false && l && !l.active}<Badge tone="bad">Not live</Badge>{/if}
            </div>
            {#if l?.reason && (r.enabled === false || !l.active)}<p class="hr-why">{l.reason}</p>{:else if l?.roleNote}<p class="hr-why">{l.roleNote}</p>{/if}
          </div>
          <div class="hr-act">
            <Switch id="hr-on-{r.id}" label="On" checked={r.enabled !== false} onchange={(v) => void toggle(r, v)} />
            <IconButton icon="edit" size="sm" label={`Edit route ${r.id}`} onclick={() => onEdit(r)} />
            <IconButton icon="trash" size="sm" label={`Delete route ${r.id}`} onclick={() => void remove(r)} />
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .hr { display: grid; gap: 12px; }
  .hr-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .hr-h h3 { margin: 0; font-size: var(--cortex-t-md); font-weight: 600; color: var(--cortex-text); }
  .hr-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
  .hr-row { display: flex; justify-content: space-between; gap: 16px; padding: 12px 14px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1); }
  .hr-off { opacity: 0.7; }
  .hr-main { display: grid; gap: 6px; min-width: 0; }
  .hr-flow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .hr-match { color: var(--cortex-text-2); }
  .hr-arrow { color: var(--cortex-text-3); }
  .hr-badges { display: flex; flex-wrap: wrap; gap: 6px; }
  .hr-why { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .hr-act { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
</style>
