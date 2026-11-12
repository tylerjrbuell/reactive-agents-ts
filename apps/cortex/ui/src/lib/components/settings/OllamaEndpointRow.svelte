<script lang="ts">
  /**
   * Settings · Providers · Ollama endpoint. Local by default; the "Ollama Cloud" preset fills
   * https://ollama.com. Apply saves it on the Cortex server (`/api/settings/ollama`), which
   * uses it for every run, chat, utility agent, model list and capability probe, and mirrors
   * it into the browser setting the model pickers read. The Ollama API key is the `ollama`
   * row of the provider keys above. Rules and calls: `lib/ollama-endpoint.ts`.
   */
  import { onMount } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { settings as settingsStore } from "$lib/stores/settings.js";
  import {
    OLLAMA_CLOUD_ENDPOINT,
    OLLAMA_LOCAL_ENDPOINT,
    endpointNote,
    isCloudEndpoint,
    ollamaSettingsApi,
    type OllamaSettingsView,
  } from "$lib/ollama-endpoint.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import SettingsRow from "./SettingsRow.svelte";

  interface Props {
    /** The endpoint field (bound to the Settings form's `ollamaEndpoint`). */
    value: string;
    /** Called after the server accepted a new endpoint (e.g. to reload the model list). */
    onapplied?: () => void;
  }
  let { value = $bindable(), onapplied }: Props = $props();

  const api = ollamaSettingsApi(CORTEX_SERVER_URL);
  let view = $state<OllamaSettingsView | null>(null);
  let busy = $state(false);

  onMount(() => {
    void api.get().then((v) => {
      view = v;
      // The server's saved endpoint is the truth; an empty one leaves the browser value alone.
      if (v?.endpoint) value = v.endpoint;
    });
  });

  const dirty = $derived(value.trim().replace(/\/+$/, "") !== (view?.endpoint ?? ""));

  async function apply() {
    busy = true;
    const r = await api.save(value);
    busy = false;
    if (!r.ok) {
      toast.error("Ollama endpoint not saved", r.error);
      return;
    }
    view = r.value;
    value = r.value.endpoint ?? "";
    settingsStore.save({ ollamaEndpoint: value });
    toast.success("Ollama endpoint saved", r.value.cloud ? "Agents now use Ollama Cloud." : "Agents use this endpoint.");
    onapplied?.();
  }
</script>

<SettingsRow label="Ollama endpoint" for="settings-ollama-endpoint">
  {#snippet help()}
    Blank uses <code>OLLAMA_HOST</code> or {OLLAMA_LOCAL_ENDPOINT}. {endpointNote(view)}
  {/snippet}
  {#snippet control()}
    <div class="ep">
      <Input
        id="settings-ollama-endpoint"
        mono
        placeholder={OLLAMA_LOCAL_ENDPOINT}
        describedBy="settings-ollama-endpoint-hint"
        bind:value
      />
      <div class="acts">
        <Button size="sm" variant={isCloudEndpoint(value) ? "primary" : "ghost"} onclick={() => (value = OLLAMA_CLOUD_ENDPOINT)}>Ollama Cloud</Button>
        <Button size="sm" variant="ghost" onclick={() => (value = "")}>Local</Button>
        <Button size="sm" variant="primary" disabled={busy || !dirty} onclick={() => void apply()}>{busy ? "Saving" : "Apply"}</Button>
      </div>
    </div>
  {/snippet}
</SettingsRow>

<style>
  .ep { display: grid; gap: 8px; }
  .acts { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
