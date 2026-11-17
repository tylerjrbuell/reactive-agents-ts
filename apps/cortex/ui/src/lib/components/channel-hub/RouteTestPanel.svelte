<script lang="ts">
  /**
   * "Send test message": runs a made-up message through the real routing path without sending
   * anything to the platform. `explain` (always, free) says which route takes it, as which role,
   * with which tools, and why a sender is refused. `simulate` (opt-in: it runs the agent, so it can
   * cost tokens) shows the reply. Needs the channel to be running. Rules: `lib/channel-hub.ts`.
   */
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { channelKindInfo } from "$lib/channels.js";
  import { channelKindCopy } from "$lib/channel-kind-copy.js";
  import { routeCapabilities } from "$lib/channel-route-capabilities.js";
  import WebhookTestRequest from "$lib/components/channels/WebhookTestRequest.svelte";
  import { explainView, simulateView, type ProbeView } from "$lib/channel-hub.js";
  import { probeHub, type HubChannelRow } from "$lib/channel-hub-api.js";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";

  interface Props {
    channels: readonly HubChannelRow[];
  }
  let { channels }: Props = $props();

  let channelId = $state("");
  let userId = $state("");
  let text = $state("Hello");
  let isGroup = $state(false);
  let mentionsSelf = $state(false);
  let run = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let explain = $state<ProbeView | null>(null);
  let simulate = $state<ProbeView | null>(null);

  const chosen = $derived(channels.find((c) => c.id === (channelId || channels[0]?.id)));
  const copy = $derived(channelKindCopy(chosen?.platform));
  /** A webhook has no sender or conversation to try: its test is a signed request. */
  const isCall = $derived(!routeCapabilities(chosen?.platform).conversation);
  const example = $derived(chosen ? channelKindInfo(chosen.platform).senderExample : "telegram:123456789");

  async function send() {
    if (!chosen) return;
    busy = true;
    error = null;
    const r = await probeHub(CORTEX_SERVER_URL, fetch, { channelId: chosen.id, userId: userId.trim(), text, isGroup, mentionsSelf }, run);
    busy = false;
    if (!r.ok) {
      explain = null;
      simulate = null;
      error = r.error;
      return;
    }
    explain = explainView(r.value.explain);
    simulate = r.value.simulate === null ? null : simulateView(r.value.simulate);
  }
</script>

<section class="tp" aria-labelledby="tp-h">
  <h3 id="tp-h">{copy.testTitle}</h3>
  <p class="tp-lead">{copy.testLead}</p>
  {#if channels.length === 0}
    <p class="tp-muted">Add a channel first.</p>
  {:else}
    <div class="tp-grid">
      <Field id="tp-channel" label="Channel">
        <Select id="tp-channel" value={chosen?.id ?? ""} options={channels.map((c) => ({ value: c.id, label: c.label ?? channelKindInfo(c.platform).label, description: c.id }))} onchange={(v) => (channelId = v)} />
      </Field>
      {#if !isCall}
        <Field id="tp-user" label="Sender" hint="Like {example}">
          <Input id="tp-user" mono bind:value={userId} placeholder={example} describedBy="tp-user-hint" />
        </Field>
      {/if}
    </div>
    {#if isCall && chosen}
      {#key chosen.id}
        <WebhookTestRequest channelId={chosen.id} />
      {/key}
    {:else}
    <Field id="tp-text" label="Message">
      <Input id="tp-text" bind:value={text} />
    </Field>
    <div class="tp-switches">
      <Switch id="tp-group" label="Sent in a group" bind:checked={isGroup} />
      <Switch id="tp-mention" label="Mentions the agent" bind:checked={mentionsSelf} />
      <Switch id="tp-run" label="Also run the agent" hint="Runs the real turn. May use tokens." bind:checked={run} />
    </div>
    <div><Button variant="primary" icon="send" onclick={() => void send()} disabled={busy || userId.trim() === ""}>{busy ? "Working…" : "Send test"}</Button></div>

    {#if error}<p class="tp-bad" role="alert">{error}</p>{/if}
    <div aria-live="polite">
      {#each [explain, simulate] as view, i (i)}
        {#if view}
          <div class="tp-res">
            <Badge tone={view.tone}>{i === 0 ? "Routing" : "Run"}</Badge>
            <strong>{view.headline}</strong>
            {#if view.lines.length > 0}<ul>{#each view.lines as l (l)}<li>{l}</li>{/each}</ul>{/if}
          </div>
        {/if}
      {/each}
    </div>
    {/if}
  {/if}
</section>

<style>
  .tp { display: grid; gap: 12px; }
  .tp h3 { margin: 0; font-size: var(--cortex-t-md); font-weight: 600; color: var(--cortex-text); }
  .tp-lead, .tp-muted { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .tp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .tp-switches { display: flex; flex-wrap: wrap; gap: 8px 24px; }
  .tp-bad { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-bad); }
  .tp-res { display: grid; gap: 4px; padding: 10px 12px; margin-top: 8px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-canvas); font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .tp-res ul { margin: 0; padding-left: 18px; color: var(--cortex-text-2); }
</style>
