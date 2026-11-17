<script lang="ts">
  /**
   * "Generate" for a webhook's signing secret, placed in the secret row beside Replace and
   * Remove (`lib/webhook-card.ts` `secretActions`). The server creates and seals the secret
   * and returns it once; it is shown here until dismissed so it can be copied to the caller,
   * and never again. Replacing a saved secret asks first. Calls: `lib/webhook-api.ts`.
   */
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import { WEBHOOK_COPY } from "$lib/channel-kind-copy.js";
  import { generateWebhookSecret, type GeneratedSecret } from "$lib/webhook-api.js";
  import Button from "$lib/components/kit/Button.svelte";

  interface Props {
    channelId: string;
    /** Whether a signing secret is saved (generating then replaces it). */
    secretSaved: boolean;
    disabled?: boolean;
    /** The saved secret changed; the card re-reads its mask. */
    onSecretChanged: () => void;
  }
  const { channelId, secretSaved, disabled = false, onSecretChanged }: Props = $props();

  let generated = $state<GeneratedSecret | null>(null);
  let busy = $state(false);
  let copied = $state(false);

  async function generate(): Promise<void> {
    if (secretSaved) {
      const ok = await confirmAction({ title: WEBHOOK_COPY.generate, message: WEBHOOK_COPY.generateReplaces, confirmLabel: WEBHOOK_COPY.generate });
      if (!ok) return;
    }
    busy = true;
    const r = await generateWebhookSecret(CORTEX_SERVER_URL, fetch, channelId);
    busy = false;
    if (!r.ok) {
      toast.error("Secret not generated", r.error);
      return;
    }
    generated = r.value;
    onSecretChanged();
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(generated?.secret ?? "");
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // clipboard refused: the text is selectable
    }
  }
</script>

<Button size="field" disabled={busy || disabled} onclick={() => void generate()}>{WEBHOOK_COPY.generateShort}</Button>
{#if generated}
  <div class="once" role="status" data-testid="webhook-generated-secret">
    <p><strong>{WEBHOOK_COPY.generatedOnce}</strong></p>
    <div class="row">
      <input class="in" readonly value={generated.secret} aria-label={WEBHOOK_COPY.generatedOnce} onfocus={(e) => e.currentTarget.select()} />
      <Button size="sm" onclick={() => void copy()}>{copied ? WEBHOOK_COPY.copied : WEBHOOK_COPY.copy}</Button>
      <Button size="sm" variant="ghost" onclick={() => (generated = null)}>{WEBHOOK_COPY.dismiss}</Button>
    </div>
  </div>
{/if}

<style>
  .once { flex: 1 0 100%; display: grid; gap: 6px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--cortex-warn) 35%, transparent); border-radius: var(--cortex-r-ctl); background: var(--cortex-warn-tint); font-size: var(--cortex-t-xs); color: var(--cortex-text); }
  .once p { margin: 0; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .in { flex: 1; min-width: 220px; padding: 6px 8px; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text); background: var(--cortex-canvas); border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); }
</style>
