<script lang="ts">
  /**
   * "Send test request": the Cortex server posts a body signed with the channel's saved signing
   * secret to the local listener and reports accepted or refused, with the reason. The browser never
   * sees the secret. The request is real: if a route on the webhook is on, the agent runs.
   * Copy: `lib/channel-kind-copy.ts`; call: `lib/webhook-api.ts`.
   */
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { WEBHOOK_COPY } from "$lib/channel-kind-copy.js";
  import { sendWebhookTestRequest, type WebhookTestOutcome } from "$lib/webhook-api.js";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";

  interface Props {
    channelId: string;
    /** Non-secret settings, used only when the channel is not saved in the hub yet. */
    settings?: { ingressPort?: number | undefined; route?: string | undefined };
  }
  let { channelId, settings = {} }: Props = $props();

  let busy = $state(false);
  let outcome = $state<WebhookTestOutcome | null>(null);
  let error = $state<string | null>(null);

  async function send() {
    busy = true;
    error = null;
    const r = await sendWebhookTestRequest(CORTEX_SERVER_URL, fetch, channelId, settings);
    busy = false;
    if (r.ok) outcome = r.value;
    else {
      outcome = null;
      error = r.error;
    }
  }
</script>

<div class="wt">
  <p class="wt-warn">{WEBHOOK_COPY.sendTestWarn}</p>
  <div class="wt-row">
    <Button size="field" disabled={busy} onclick={() => void send()}>{WEBHOOK_COPY.sendTest}</Button>
    {#if outcome}
      <Badge tone={outcome.ok ? "ok" : "bad"}>{outcome.ok ? WEBHOOK_COPY.accepted : WEBHOOK_COPY.refused}</Badge>
      <span class="wt-detail" role="status">{outcome.detail}</span>
    {:else if error}
      <span class="wt-detail wt-bad" role="status">{error}</span>
    {/if}
  </div>
</div>

<style>
  .wt { display: grid; gap: 8px; }
  .wt-warn { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .wt-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .wt-detail { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .wt-bad { color: var(--cortex-bad); }
</style>
