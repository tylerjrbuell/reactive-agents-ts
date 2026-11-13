<script lang="ts">
  /**
   * One hub channel: live state, counters, last error and the account lease on top of the shared
   * `ChannelCard` (name, on/off, non-secret settings, write-only credential, connection test). Edits
   * keep a local copy and reach `PATCH /api/channels/:id` after a short pause (a label is typed key
   * by key); the on/off switch saves at once. A credential never passes through here: `ChannelCard`
   * saves it straight to the key store and only a mask comes back.
   */
  import { onDestroy, untrack } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { updateChannel, type ChannelEntry, type ChannelSettings } from "$lib/channels.js";
  import { patchHubChannel, type HubChannelLive, type HubChannelRow, type HubLease } from "$lib/channel-hub-api.js";
  import { duplicateSentence, liveChannelView, type DuplicateInfo } from "$lib/channel-hub-view.js";
  import ChannelCard from "$lib/components/channels/ChannelCard.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Status from "$lib/components/kit/Status.svelte";

  interface Props {
    row: HubChannelRow;
    live?: HubChannelLive;
    leases: readonly HubLease[];
    /** Routes on this channel. */
    routeCount: number;
    /** Set when another channel or process already holds this channel's account. */
    duplicate?: DuplicateInfo;
    /** Display name of the channel that holds the account, when it is one of ours. */
    ownerName?: string | null;
    /** Scroll to the owner channel's card. */
    onJumpToOwner?: (channelId: string) => void;
    onRemove: (row: HubChannelRow) => void;
    onChanged: () => void;
  }
  let { row, live, leases, routeCount, duplicate, ownerName = null, onJumpToOwner, onRemove, onChanged }: Props = $props();

  const toEntry = (r: HubChannelRow): ChannelEntry => ({ id: r.id, kind: r.platform, ...(r.label ? { label: r.label } : {}), enabled: r.enabled, settings: { ...r.settings } });
  // A local copy edited here; the card is keyed by channel id, so `row` is read once as its start.
  let entry = $state<ChannelEntry>(untrack(() => toEntry(row)));
  let timer: ReturnType<typeof setTimeout> | undefined;

  const view = $derived(liveChannelView(row.id, live, entry.enabled, routeCount, leases));

  async function flush() {
    const r = await patchHubChannel(CORTEX_SERVER_URL, fetch, entry.id, { label: entry.label ?? "", enabled: entry.enabled, settings: entry.settings });
    if (r.ok) onChanged();
    else toast.error("Channel not saved", r.error);
  }

  function change(patch: { label?: string; enabled?: boolean; settings?: Partial<Record<keyof ChannelSettings, ChannelSettings[keyof ChannelSettings] | undefined>> }) {
    entry = updateChannel([entry], entry.id, patch)[0] ?? entry;
    clearTimeout(timer);
    if (patch.enabled !== undefined) void flush();
    else timer = setTimeout(() => void flush(), 600);
  }

  onDestroy(() => clearTimeout(timer));
</script>

<div class="hc" id="hub-channel-{row.id}">
  <div class="hc-live" role="status" aria-label="Live state of {entry.label ?? row.id}">
    <Status tone={view.tone} label={view.label} />
    <Badge data tone="neutral">{live?.received ?? 0} in</Badge>
    <Badge data tone="neutral">{live?.sent ?? 0} out</Badge>
    {#if (live?.failed ?? 0) > 0}<Badge data tone="bad">{live?.failed} failed</Badge>{/if}
    <Badge tone={view.lease.tone}>{view.lease.label}</Badge>
    <Badge data tone="neutral">{routeCount} route{routeCount === 1 ? "" : "s"}</Badge>
    {#if row.migratedFrom}<Badge tone="warn">Imported from an agent</Badge>{/if}
  </div>
  {#if duplicate}
    <p class="hc-bad" role="alert">
      {duplicateSentence(duplicate, ownerName)}
      {#if duplicate.ownerChannelId && onJumpToOwner}<Button size="sm" variant="ghost" onclick={() => onJumpToOwner?.(duplicate.ownerChannelId ?? "")}>Show that channel</Button>{/if}
    </p>
  {:else if view.problem}
    <p class="hc-bad" role="alert">{view.problem}</p>
  {/if}
  <ChannelCard channel={entry} onChange={change} onRemove={() => onRemove(row)} />
</div>

<style>
  .hc { display: grid; gap: 6px; }
  .hc-live { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .hc-bad { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-bad); }
</style>
