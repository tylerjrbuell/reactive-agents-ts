<script lang="ts">
  /**
   * Lab · Channels: the channel hub. Channels (accounts such as a Telegram bot) with live state, the
   * routes that send their messages to saved agents, and a test panel. Compose-only: the channel
   * card, route list, route editor and test panel are their own components next to this one; the
   * rules are in `lib/channel-hub*.ts`. Routes are the only place access is decided, and widening it
   * (owner, open, full agent tools) goes through the audited confirm in the route editor.
   */
  import { onMount, tick } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import { takeNewRouteRequest } from "$lib/stores/channels-intent.js";
  import { CHANNEL_KINDS, channelKindInfo, type ChannelKind } from "$lib/channels.js";
  import InboxStatus from "./InboxStatus.svelte";
  import QueueStatus from "./QueueStatus.svelte";
  import { createHubChannel, deleteHubChannel, fetchAgentChoices, fetchHub, fetchHubLive, type AgentChoice, type HubChannelRow, type HubLive, type HubSnapshot } from "$lib/channel-hub-api.js";
  import type { HubRouteWire } from "$lib/channel-hub.js";
  import { duplicateAccounts } from "$lib/channel-hub-view.js";
  import HubChannelCard from "./HubChannelCard.svelte";
  import HubRoutes from "./HubRoutes.svelte";
  import RouteEditor from "./RouteEditor.svelte";
  import RouteTestPanel from "./RouteTestPanel.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";

  const REFRESH_MS = 5_000;
  let snapshot = $state<HubSnapshot | null>(null);
  let live = $state<HubLive | null>(null);
  let agents = $state<readonly AgentChoice[]>([]);
  let error = $state<string | null>(null);
  let editor = $state<{ saved?: HubRouteWire; initial?: { channelId?: string; agentId?: string } } | null>(null);

  const channels = $derived(snapshot?.channels ?? []);
  const routes = $derived(snapshot?.routes ?? []);
  const leases = $derived(live?.leases ?? []);
  const duplicates = $derived(duplicateAccounts(live?.error ?? null, leases));

  async function loadSaved() {
    const [h, a] = await Promise.all([fetchHub(CORTEX_SERVER_URL, fetch), fetchAgentChoices(CORTEX_SERVER_URL, fetch)]);
    if (h.ok) {
      snapshot = h.value;
      error = null;
    } else error = h.error;
    if (a.ok) agents = a.value;
  }
  async function loadLive() {
    const l = await fetchHubLive(CORTEX_SERVER_URL, fetch);
    if (l.ok) live = l.value;
  }
  const reload = async () => {
    await Promise.all([loadSaved(), loadLive()]);
  };

  onMount(() => {
    void reload().then(() => {
      const want = takeNewRouteRequest();
      if (want) editor = { initial: { agentId: want.agentId } };
    });
    const timer = setInterval(() => void loadLive(), REFRESH_MS);
    return () => clearInterval(timer);
  });

  async function addChannel(kind: ChannelKind) {
    const r = await createHubChannel(CORTEX_SERVER_URL, fetch, { kind });
    if (!r.ok) {
      toast.error("Channel not added", r.error);
      return;
    }
    await reload();
    await tick();
    jumpTo(r.value.id);
  }

  async function removeChannel(row: HubChannelRow) {
    const mine = routes.filter((r) => r.match.channelId === row.id);
    if (mine.length > 0) {
      const ok = await confirmAction({
        title: `Delete ${row.label ?? channelKindInfo(row.platform).label} and ${mine.length} route${mine.length === 1 ? "" : "s"}?`,
        message: `Routes on it: ${mine.map((r) => r.id).join(", ")}. Its saved credential is deleted too.`,
        confirmLabel: "Delete both",
      });
      if (!ok) return;
    }
    const r = await deleteHubChannel(CORTEX_SERVER_URL, fetch, row.id, mine.length > 0);
    if (!r.ok) toast.error("Channel not deleted", r.error);
    await reload();
  }

  function jumpTo(channelId: string) {
    document.getElementById(`hub-channel-${channelId}`)?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  const nameOf = (id: string | null): string | null => {
    const c = channels.find((x) => x.id === id);
    return c ? (c.label ?? channelKindInfo(c.platform).label) : null;
  };
</script>

<div class="ch" role="region" aria-label="Channels and routes">
<div class="ch-in">
  <header class="ch-h">
    <div>
      <h2>Channels</h2>
      <p>Accounts your agents answer on (Telegram, Signal, signed webhooks) and the routes that decide which agent answers whom. Nothing in a message can change a route or add an owner.</p>
    </div>
    <div class="ch-sum">
      {#if live}
        <Badge tone={live.phase === "running" ? "ok" : live.phase === "failed" ? "bad" : "neutral"}>Hub {live.phase}</Badge>
        {#if !live.durableStore}<Badge tone="warn">Caps reset on restart</Badge>{/if}
        <InboxStatus inbox={live.inbox} />
        <QueueStatus outbox={live.outbox} timers={live.timers} />
      {/if}
    </div>
  </header>

  {#if error}
    <p class="ch-bad" role="alert">Could not read channels: {error}</p>
  {:else if !snapshot}
    <p class="ch-muted" role="status">Loading channels…</p>
  {:else}
    {#if !snapshot.hubEnabled}
      <p class="ch-warn" role="status">The channel hub is switched off (CORTEX_CHANNEL_HUB=off). Routes are saved but not served; agents use their own channel settings.</p>
    {/if}
    {#if live?.error}<p class="ch-bad" role="alert">{live.error}</p>{/if}
    {#if snapshot.rejected.length > 0}
      <p class="ch-bad" role="alert">{snapshot.rejected.length} saved route{snapshot.rejected.length === 1 ? " was" : "s were"} refused and not served: {snapshot.rejected.map((r) => `${r.id} (${r.reason})`).join("; ")}</p>
    {/if}

    <div class="ch-grid">
    <div class="ch-main">
    <section class="ch-sec" aria-labelledby="ch-ch">
      <header class="ch-sh">
        <h3 id="ch-ch">Channels</h3>
        <div class="ch-add" role="group" aria-label="Add a channel">
          {#each CHANNEL_KINDS as k (k.kind)}<Button size="sm" icon="plus" onclick={() => void addChannel(k.kind)}>{k.label}</Button>{/each}
        </div>
      </header>
      {#if channels.length === 0}
        <EmptyState title="No channels yet" description="Add the account an agent should answer on. Its credential is saved encrypted and never shown again." />
      {:else}
        {#each channels as c (c.id)}
          {@const dup = duplicates.get(c.id)}
          <HubChannelCard
            row={c}
            live={live?.channels.find((l) => l.id === c.id)}
            {leases}
            routeCount={routes.filter((r) => r.match.channelId === c.id || r.match.channelId === "*").length}
            duplicate={dup}
            ownerName={nameOf(dup?.ownerChannelId ?? null)}
            onJumpToOwner={jumpTo}
            onRemove={(row) => void removeChannel(row)}
            onChanged={() => void reload()}
          />
        {/each}
      {/if}
    </section>

    <HubRoutes {routes} {channels} {agents} {live} onEdit={(r) => (editor = { saved: r })} onNew={() => (editor = {})} onChanged={() => void reload()} />
    </div>
    <aside class="ch-side" aria-label="Test a message"><RouteTestPanel {channels} /></aside>
    </div>
  {/if}
</div>
</div>

{#if editor}
  {#key editor.saved?.id ?? "new"}
    <RouteEditor
      saved={editor.saved}
      initial={editor.initial}
      {channels}
      {agents}
      onclose={() => (editor = null)}
      onsaved={() => {
        editor = null;
        void reload();
      }}
    />
  {/key}
{/if}

<style>
  /* Scroll container with the same 32px gutter as the Lab header and sibling tabs (GatewayOverview `.gw`).
     `.lab-panel` is overflow:hidden and adds no padding for this tab, so without this the hub sat flush
     at x=0 and could not scroll. */
  .ch { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 32px 48px; }
  .ch-in { display: grid; gap: 22px; width: 100%; max-width: 1480px; }
  /* One column below 1280px; from 1280px the test panel sits beside channels + routes. */
  .ch-grid { display: grid; gap: 22px; grid-template-columns: minmax(0, 1fr); align-items: start; }
  .ch-main { display: grid; gap: 22px; min-width: 0; }
  .ch-side { min-width: 0; }
  @media (min-width: 1280px) {
    .ch-grid { grid-template-columns: minmax(0, 1fr) minmax(340px, 420px); }  }
  .ch-h { display: flex; justify-content: space-between; gap: 12px 24px; align-items: flex-start; flex-wrap: wrap; }
  .ch-h h2 { margin: 0; font-size: var(--cortex-t-lg); font-weight: 600; color: var(--cortex-text); }
  .ch-h p { margin: 4px 0 0; max-width: 62ch; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .ch-sum { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .ch-sec { display: grid; gap: 12px; }
  .ch-sh { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .ch-sh h3 { margin: 0; font-size: var(--cortex-t-md); font-weight: 600; color: var(--cortex-text); }
  .ch-add { display: flex; flex-wrap: wrap; gap: 8px; }
  .ch-muted { margin: 0; color: var(--cortex-text-2); font-size: var(--cortex-t-sm); }
  .ch-bad { margin: 0; color: var(--cortex-bad); font-size: var(--cortex-t-sm); }
  .ch-warn { margin: 0; color: var(--cortex-text); font-size: var(--cortex-t-sm); padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--cortex-warn) 35%, transparent); border-radius: var(--cortex-r-ctl); background: var(--cortex-warn-tint); }
</style>
