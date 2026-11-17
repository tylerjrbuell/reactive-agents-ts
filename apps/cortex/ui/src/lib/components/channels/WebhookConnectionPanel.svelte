<script lang="ts">
  /**
   * How a caller connects to a webhook channel: the framework's own connection facts (method, URL,
   * signature header, what is signed, replay rule, curl / node / openssl examples with a placeholder
   * secret), a loopback note, "Generate secret" (stored sealed, shown once here so it can be copied to
   * the caller) and "Send test request". The real secret is never rendered except in that one
   * generate answer. Copy: `lib/channel-kind-copy.ts`; calls: `lib/webhook-api.ts`.
   */
  import { untrack } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import { WEBHOOK_COPY } from "$lib/channel-kind-copy.js";
  import type { ChannelEntry } from "$lib/channels.js";
  import { fetchWebhookInfo, generateWebhookSecret, type GeneratedSecret, type WebhookInfoView } from "$lib/webhook-api.js";
  import Button from "$lib/components/kit/Button.svelte";
  import WebhookTestRequest from "./WebhookTestRequest.svelte";

  interface Props {
    channel: ChannelEntry;
    /** Whether a signing secret is saved. */
    secretSaved: boolean;
    /** The saved secret changed (generated); the card re-reads its mask. */
    onSecretChanged: () => void;
  }
  let { channel, secretSaved, onSecretChanged }: Props = $props();

  let view = $state<WebhookInfoView | null>(null);
  let error = $state<string | null>(null);
  let generated = $state<GeneratedSecret | null>(null);
  let busy = $state(false);
  let copiedKey = $state<string | null>(null);

  const settings = $derived({ ingressPort: channel.settings.ingressPort, route: channel.settings.route?.trim() || undefined });

  // Re-read when the listen port or path changes (a short pause: they are typed key by key).
  $effect(() => {
    const s = { ...settings };
    const timer = setTimeout(() => {
      void untrack(async () => {
        const r = await fetchWebhookInfo(CORTEX_SERVER_URL, fetch, channel.id, s);
        if (r.ok) {
          view = r.value;
          error = null;
        } else error = r.error;
      });
    }, 300);
    return () => clearTimeout(timer);
  });

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey = key;
      setTimeout(() => (copiedKey = copiedKey === key ? null : copiedKey), 1500);
    } catch {
      // clipboard refused: the text is selectable
    }
  }

  async function generate() {
    if (secretSaved) {
      const ok = await confirmAction({ title: WEBHOOK_COPY.generate, message: WEBHOOK_COPY.generateReplaces, confirmLabel: WEBHOOK_COPY.generate });
      if (!ok) return;
    }
    busy = true;
    const r = await generateWebhookSecret(CORTEX_SERVER_URL, fetch, channel.id);
    busy = false;
    if (!r.ok) {
      toast.error("Secret not generated", r.error);
      return;
    }
    generated = r.value;
    onSecretChanged();
  }

  const facts = $derived(
    view
      ? [
          [WEBHOOK_COPY.factMethod, view.info.method],
          ...(view.info.url ? [[WEBHOOK_COPY.factUrl, view.info.url] as const] : [[WEBHOOK_COPY.factPath, view.info.path] as const]),
          [WEBHOOK_COPY.factContentType, view.info.contentType],
          [WEBHOOK_COPY.factSignatureHeader, view.info.signature.header],
          [WEBHOOK_COPY.factAlgorithm, `${view.info.signature.algorithm}, ${view.info.signature.encoding}`],
          [WEBHOOK_COPY.factSignedPayload, view.info.signature.signedPayload],
          [WEBHOOK_COPY.factTimestampHeader, view.info.signature.timestampHeader],
          [WEBHOOK_COPY.factTimestamp, view.info.signature.timestamp],
          [WEBHOOK_COPY.factReplay, view.info.signature.replay],
        ]
      : [],
  );
  const examples = $derived(view ? ([["curl", view.info.examples.curl], ["node", view.info.examples.node], ["openssl", view.info.examples.openssl]] as const) : []);
</script>

<section class="wc" aria-label={WEBHOOK_COPY.connectTitle} data-testid="webhook-connection">
  <h5>{WEBHOOK_COPY.connectTitle}</h5>
  {#if error}
    <p class="wc-bad" role="status">{error}</p>
  {:else if !view}
    <p class="wc-muted">{WEBHOOK_COPY.loading}</p>
  {:else}
    <dl class="wc-facts">
      {#each facts as [label, value] (label)}
        <div class="wc-fact">
          <dt>{label}</dt>
          <dd><code>{value}</code>{#if label === WEBHOOK_COPY.factUrl}<Button size="sm" variant="ghost" onclick={() => void copy("url", value)}>{copiedKey === "url" ? WEBHOOK_COPY.copied : WEBHOOK_COPY.copy}</Button>{/if}</dd>
        </div>
      {/each}
    </dl>
    {#if view.port === null}<p class="wc-muted">{WEBHOOK_COPY.noPort}</p>{/if}
    {#if view.loopbackOnly}<p class="wc-muted">{WEBHOOK_COPY.loopbackOnly}</p>{/if}
    <p class="wc-muted">{WEBHOOK_COPY.secretPlaceholder}</p>
    <div class="wc-examples">
      <h6>{WEBHOOK_COPY.examplesTitle}</h6>
      {#each examples as [name, code] (name)}
        <details class="wc-ex">
          <summary>{name}</summary>
          <pre><code>{code}</code></pre>
          <Button size="sm" variant="ghost" onclick={() => void copy(name, code)}>{copiedKey === name ? WEBHOOK_COPY.copied : WEBHOOK_COPY.copy}</Button>
        </details>
      {/each}
    </div>
  {/if}

  <div class="wc-secret">
    <div class="wc-row">
      <Button size="field" disabled={busy} onclick={() => void generate()}>{WEBHOOK_COPY.generate}</Button>
      <span class="wc-muted">{WEBHOOK_COPY.generateHint}</span>
    </div>
    {#if generated}
      <div class="wc-once" role="status">
        <p><strong>{WEBHOOK_COPY.generatedOnce}</strong></p>
        <div class="wc-row">
          <input class="wc-secret-in" readonly value={generated.secret} aria-label={WEBHOOK_COPY.generatedOnce} onfocus={(e) => e.currentTarget.select()} />
          <Button size="sm" onclick={() => void copy("secret", generated?.secret ?? "")}>{copiedKey === "secret" ? WEBHOOK_COPY.copied : WEBHOOK_COPY.copy}</Button>
          <Button size="sm" variant="ghost" onclick={() => (generated = null)}>{WEBHOOK_COPY.dismiss}</Button>
        </div>
      </div>
    {/if}
  </div>

  <WebhookTestRequest channelId={channel.id} {settings} />
</section>

<style>
  .wc { display: grid; gap: 10px; padding-top: 12px; border-top: 1px solid var(--cortex-line); }
  .wc h5 { margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .wc h6 { margin: 0; font-size: var(--cortex-t-xs); font-weight: 500; color: var(--cortex-text-2); }
  .wc-facts { display: grid; gap: 4px; margin: 0; }
  .wc-fact { display: grid; grid-template-columns: minmax(120px, 160px) 1fr; gap: 8px; font-size: var(--cortex-t-xs); }
  .wc-fact dt { color: var(--cortex-text-3); }
  .wc-fact dd { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; color: var(--cortex-text); }
  .wc code { font-family: var(--cortex-font-data); overflow-wrap: anywhere; }
  .wc-muted { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .wc-bad { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-bad); }
  .wc-examples { display: grid; gap: 6px; }
  .wc-ex summary { cursor: pointer; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .wc-ex pre { margin: 6px 0; padding: 8px 10px; overflow-x: auto; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1); font-size: var(--cortex-t-xs); }
  .wc-secret { display: grid; gap: 8px; }
  .wc-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .wc-once { display: grid; gap: 6px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--cortex-warn) 35%, transparent); border-radius: var(--cortex-r-ctl); background: var(--cortex-warn-tint); font-size: var(--cortex-t-xs); color: var(--cortex-text); }
  .wc-once p { margin: 0; }
  .wc-secret-in { flex: 1; min-width: 220px; padding: 6px 8px; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text); background: var(--cortex-canvas); border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); }
</style>
