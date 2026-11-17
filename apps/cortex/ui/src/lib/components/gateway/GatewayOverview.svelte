<script lang="ts">
  /**
   * Lab · Gateway: every saved gateway agent with its live channel connections, access
   * rule, schedules (next fire and recent runs), inbound queue activity and recent
   * deliveries and refusals. Read-only; refreshes every few seconds while open. Counts and
   * queue depth are the framework's own (`agent.channelStatus()`, `gatewayStatus().inboundQueue`);
   * the activity list is folded from events (`server/services/gateway-status.ts`); the words come
   * from `lib/gateway-overview.ts`.
   */
  import { onMount } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import {
    accessLine,
    activityLabel,
    connectionView,
    fetchGatewayStatus,
    hostView,
    nextFireLabel,
    overviewTotals,
    queueLimit,
    queueSentence,
    runView,
    when,
    type GatewayAgentStatus,
  } from "$lib/gateway-overview.js";
  import { channelKindInfo } from "$lib/channels.js";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import Status from "$lib/components/kit/Status.svelte";

  interface Props {
    onOpenAgents: () => void;
    onOpenBuilder: () => void;
  }
  let { onOpenAgents, onOpenBuilder }: Props = $props();

  const REFRESH_MS = 5_000;
  let agents = $state<readonly GatewayAgentStatus[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let now = $state(Date.now());

  async function load() {
    const r = await fetchGatewayStatus(CORTEX_SERVER_URL, fetch);
    loading = false;
    now = Date.now();
    if (r.ok) {
      agents = r.value;
      error = null;
    } else {
      error = r.error;
    }
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  });

  const totals = $derived(overviewTotals(agents));
</script>

<div class="gw" role="region" aria-label="Gateway overview">
  <header class="gw-h">
    <div>
      <h2>Gateway</h2>
      <p>Your saved gateway process agents, the channels they answer on, and what they have done lately.</p>
    </div>
    <div class="gw-sum" aria-label="Totals">
      <Badge data tone={totals.listening > 0 ? "ok" : "neutral"}>{totals.listening} of {totals.agents} listening</Badge>
      <Badge data tone="neutral">{totals.connected} connected</Badge>
      {#if totals.problems > 0}<Badge data tone="bad">{totals.problems} need attention</Badge>{/if}
      <Button size="sm" variant="ghost" onclick={() => void load()}>Refresh</Button>
    </div>
  </header>

  {#if loading}
    <p class="gw-muted" role="status">Loading gateway status…</p>
  {:else if error}
    <p class="gw-bad" role="alert">Could not read gateway status: {error}</p>
  {:else if agents.length === 0}
    <EmptyState
      title="No gateway agents yet"
      description="Build an agent, add a Telegram, Signal or webhook channel under Channels, and save it as a Gateway process. It shows up here once saved."
    >
      {#snippet actions()}
        <Button variant="primary" onclick={onOpenBuilder}>Open the Builder</Button>
        <Button variant="ghost" onclick={onOpenAgents}>Saved agents</Button>
      {/snippet}
    </EmptyState>
  {:else}
    {#each agents as a (a.agentId)}
      {@const host = hostView(a.gateway.phase)}
      <!-- The inbound queue belongs to the agent's own gateway loop (stats exist only then); a hub-hosted agent has none, so no "0 waiting". -->
      {@const queue = queueSentence(a.gateway.queue, a.gateway.phase === "running" && a.gateway.stats !== null)}
      {@const limit = queueLimit(a.gateway.queue)}
      <section class="gw-card" aria-labelledby="gw-{a.agentId}">
        <div class="gw-card-h">
          <h3 id="gw-{a.agentId}">{a.name}</h3>
          <Status tone={host.tone} label={host.label} />
          {#if a.status !== "active"}<Badge tone="warn">Paused</Badge>{/if}
          <span class="gw-id">{a.agentId}</span>
        </div>

        {#if a.gateway.error}<p class="gw-bad" role="alert">{a.gateway.error}</p>{/if}
        <p class="gw-access" class:gw-warn={a.access.mode === "deny-all" || a.access.mode === "open"}>{accessLine(a.access)}</p>

        {#if a.gateway.channels.length === 0}
          <p class="gw-muted">No channels configured. Add one in the Builder under Channels.</p>
        {:else}
          <table class="gw-table">
            <caption class="gw-sr">Channels of {a.name}</caption>
            <thead><tr><th scope="col">Channel</th><th scope="col">Connection</th><th scope="col">Messages in</th><th scope="col">Replies sent</th><th scope="col">Send failures</th><th scope="col">Last message in</th><th scope="col">Last reply</th></tr></thead>
            <tbody>
              {#each a.gateway.channels as c (c.id)}
                {@const v = connectionView(c)}
                <tr>
                  <th scope="row">
                    <span class="gw-name">{c.label ?? channelKindInfo(c.kind).label}</span>
                    <span class="gw-kind">{channelKindInfo(c.kind).label}</span>
                  </th>
                  <td>
                    <Status tone={v.tone} label={v.label} />
                    {#if c.error}<span class="gw-why gw-bad">{c.error.kind}: {c.error.message}</span>{/if}
                    {#if c.reason}<span class="gw-why">{c.reason}</span>{/if}
                  </td>
                  <td class="gw-num">{c.received}</td>
                  <td class="gw-num">{c.sent}</td>
                  <td class="gw-num" class:gw-bad={c.failed > 0}>{c.failed}{c.lastFailure ? ` (${c.lastFailure})` : ""}</td>
                  <td>{when(c.lastInboundAt, now)}</td>
                  <td>{when(c.lastSentAt, now)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

        <div class="gw-cols">
          <div>
            <h4>Schedules</h4>
            {#if a.gateway.schedules.length === 0 && !a.schedule}
              <p class="gw-muted">{a.gateway.phase === "running" ? "No schedules set." : "Schedules appear here once the agent is listening."}</p>
            {/if}
            {#if a.schedule}
              <p class="gw-line"><code>{a.schedule}</code> <span class="gw-muted">one-shot trigger · last fired {when(a.lastFiredAt ?? a.lastRunAt, now)}</span></p>
            {/if}
            {#each a.gateway.schedules as s (s.id)}
              <div class="gw-sched">
                <p class="gw-line"><code>{s.cron ?? "once"}</code> <span>{s.instruction}</span></p>
                <p class="gw-muted">{nextFireLabel(s, now)} · {s.runCount} run{s.runCount === 1 ? "" : "s"}</p>
                {#if s.runs.length > 0}
                  <ul class="gw-runs" aria-label="Recent runs of {s.name ?? s.cron ?? s.id}">
                    {#each s.runs as r (r.firedAt)}
                      {@const rv = runView(r.status)}
                      <li>
                        <Status tone={rv.tone} label={rv.label} />
                        <span class="gw-muted">{when(r.firedAt, now)}{r.deliveryStatus ? ` · delivery ${r.deliveryStatus}` : ""}</span>
                        {#if r.error}<span class="gw-bad">{r.error}</span>{/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/each}
          </div>

          <div>
            <h4>Inbound queue</h4>
            <p class="gw-line">{queue ?? "Shown once the agent is listening."}</p>
            <p class="gw-muted">{limit ?? "Framework default bounds."} {#if a.gateway.denied > 0}· {a.gateway.denied} refused sender{a.gateway.denied === 1 ? "" : "s"}{/if}</p>
            {#if a.gateway.queue.dropped > 0}<p class="gw-bad">Messages were dropped because the queue was full.</p>{/if}
          </div>
        </div>

        <div>
          <h4>Recent activity</h4>
          {#if a.gateway.activity.length === 0}
            <p class="gw-muted">Nothing yet. Messages, replies, refusals and queue events appear here.</p>
          {:else}
            <ul class="gw-act" aria-label="Recent activity of {a.name}">
              {#each a.gateway.activity.slice(0, 8) as e, i (`${e.at}-${i}`)}
                {@const l = activityLabel(e.kind)}
                <li><Badge tone={l.tone}>{l.label}</Badge><span>{e.detail}</span><span class="gw-muted">{when(e.at, now)}</span></li>
              {/each}
            </ul>
          {/if}
        </div>
      </section>
    {/each}
  {/if}
</div>

<style>
  .gw { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 32px 48px; display: flex; flex-direction: column; gap: 16px; }
  .gw > :global(*) { width: 100%; max-width: 1080px; }
  .gw-h { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px 24px; }
  .gw-h h2 { margin: 0; font-size: var(--cortex-t-lg); font-weight: 600; color: var(--cortex-text); }
  .gw-h p { margin: 4px 0 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .gw-sum { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .gw-card { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-panel); background: var(--cortex-surface-1); }
  .gw-card-h { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .gw-card-h h3 { margin: 0; font-size: var(--cortex-t-md); font-weight: 600; color: var(--cortex-text); }
  .gw-id { margin-left: auto; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .gw h4 { margin: 0 0 6px; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .gw-access { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .gw-warn { color: var(--cortex-warn); }
  .gw-muted { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .gw-bad { color: var(--cortex-bad); font-size: var(--cortex-t-xs); }
  p.gw-bad { margin: 0; }
  .gw-table { width: 100%; border-collapse: collapse; font-size: var(--cortex-t-xs); }
  .gw-table th, .gw-table td { text-align: left; padding: 8px 10px; border-top: 1px solid var(--cortex-line); vertical-align: top; color: var(--cortex-text-2); }
  .gw-table thead th { border-top: 0; font-weight: 500; color: var(--cortex-text-3); }
  .gw-table tbody th { font-weight: 500; }
  .gw-name { display: block; color: var(--cortex-text); font-size: var(--cortex-t-sm); }
  .gw-kind { display: block; color: var(--cortex-text-3); }
  .gw-num { font-family: var(--cortex-font-data); font-variant-numeric: tabular-nums; }
  .gw-why { display: block; margin-top: 2px; overflow-wrap: anywhere; }
  .gw-cols { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 20px; }
  .gw-line { margin: 0 0 2px; font-size: var(--cortex-t-sm); color: var(--cortex-text); overflow-wrap: anywhere; }
  .gw-line code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); }
  .gw-sched { padding: 6px 0; border-top: 1px solid var(--cortex-line); }
  .gw-runs { margin: 4px 0 0; padding: 0; list-style: none; display: grid; gap: 2px; }
  .gw-runs li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .gw-act { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
  .gw-act li { display: grid; grid-template-columns: 104px minmax(0, 1fr) auto; align-items: center; gap: 10px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .gw-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (max-width: 800px) { .gw { padding: 16px; } .gw-cols { grid-template-columns: minmax(0, 1fr); } }
</style>
