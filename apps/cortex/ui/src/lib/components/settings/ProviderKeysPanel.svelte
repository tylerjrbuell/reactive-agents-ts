<script lang="ts">
  /**
   * Settings · Providers API keys: one row per cloud provider with where its key
   * comes from, the saved key's mask, and Add / Replace, Test, Remove. The typed
   * key goes to the server once (PUT) and is never shown again; the server keeps it
   * encrypted. Rules and calls: `lib/provider-keys.ts`. Render inside a
   * `SettingsGroup` (each row is one of its rows).
   */
  import { onMount } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import {
    keyRowHintOf,
    keyRowOf,
    providerKeysApi,
    testResultLine,
    withStatus,
    type ProviderKeyStatus,
  } from "$lib/provider-keys.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";

  interface Props {
    /** Display name for a provider id. */
    labelOf: (provider: string) => string;
    /** Called after a key is saved or removed (e.g. to refresh key badges). */
    onchange?: () => void;
  }

  let { labelOf, onchange }: Props = $props();

  const api = providerKeysApi(CORTEX_SERVER_URL);
  let statuses = $state<ProviderKeyStatus[]>([]);
  let dir = $state("");
  let loadError = $state<string | null>(null);
  let loading = $state(true);
  /** Provider whose key form is open. */
  let editing = $state<string | null>(null);
  let draft = $state("");
  let busy = $state<string | null>(null);
  let results = $state<Record<string, { tone: "ok" | "bad"; text: string }>>({});

  async function load() {
    loading = true;
    const r = await api.list();
    loading = false;
    if (r.ok) {
      statuses = [...r.value.providers];
      dir = r.value.dir;
      loadError = null;
    } else {
      loadError = r.error;
    }
  }

  onMount(() => {
    void load();
  });

  function setResult(provider: string, line: { tone: "ok" | "bad"; text: string } | null) {
    const { [provider]: _old, ...rest } = results;
    results = line ? { ...rest, [provider]: line } : rest;
  }

  function openForm(provider: string) {
    editing = provider;
    draft = "";
    setResult(provider, null);
  }

  function closeForm() {
    editing = null;
    draft = "";
  }

  function apply(s: ProviderKeyStatus | null) {
    if (s) statuses = withStatus(statuses, s);
  }

  async function save(provider: string) {
    const key = draft.trim();
    if (!key) return;
    busy = provider;
    const r = await api.save(provider, key);
    busy = null;
    if (!r.ok) {
      toast.error("Key not saved", r.error);
      return;
    }
    apply(r.value);
    closeForm();
    toast.success(`${labelOf(provider)} key saved`, "Stored encrypted on the Cortex server.");
    onchange?.();
  }

  async function test(provider: string) {
    const typed = editing === provider ? draft.trim() : "";
    busy = provider;
    const r = await api.test(provider, typed || undefined);
    busy = null;
    setResult(provider, r.ok ? testResultLine(r.value) : { tone: "bad", text: r.error });
  }

  async function remove(provider: string) {
    const ok = await confirmAction({
      title: `Remove the saved ${labelOf(provider)} key?`,
      message: "Agents then use the key from the server's environment, if there is one.",
      confirmLabel: "Remove key",
    });
    if (!ok) return;
    busy = provider;
    const r = await api.remove(provider);
    busy = null;
    if (!r.ok) {
      toast.error("Key not removed", r.error);
      return;
    }
    apply(r.value);
    setResult(provider, null);
    toast.success(`${labelOf(provider)} key removed`);
    onchange?.();
  }

  async function prefer(provider: string, value: boolean) {
    const r = await api.preferStored(provider, value);
    if (!r.ok) {
      toast.error("Not changed", r.error);
      void load();
      return;
    }
    apply(r.value);
    onchange?.();
  }
</script>

{#if loading}
  <div class="pk-row"><span class="pk-muted" role="status">Checking keys…</span></div>
{:else if loadError}
  <div class="pk-row"><span class="pk-bad">Keys unavailable: {loadError}</span></div>
{:else}
  {#each statuses as s (s.provider)}
    {@const row = keyRowOf(s)}
    {@const result = results[s.provider]}
    {@const formId = `pk-input-${s.provider}`}
    <div class="pk-row">
      <div class="pk-head">
        <div class="pk-text">
          <span class="pk-label">{labelOf(s.provider)}</span>
          <p class="pk-help">{row.summary}</p>
          {#if keyRowHintOf(s.provider)}<p class="pk-help">{keyRowHintOf(s.provider)}</p>{/if}
          {#if row.note}<p class="pk-help pk-warn">{row.note}</p>{/if}
        </div>
        <div class="pk-controls">
          <Badge tone={row.badge.tone}>{row.badge.text}</Badge>
          {#if s.stored}<span class="pk-mask">{s.stored.masked}</span>{/if}
          {#if editing !== s.provider}
            <Button size="sm" onclick={() => openForm(s.provider)}>{s.stored ? "Replace" : "Add key"}</Button>
            <Button size="sm" variant="ghost" disabled={busy === s.provider || s.source === "none"} onclick={() => test(s.provider)}>Test</Button>
            {#if s.stored || s.unreadable}
              <Button size="sm" variant="ghost" disabled={busy === s.provider} onclick={() => remove(s.provider)}>Remove</Button>
            {/if}
          {/if}
        </div>
      </div>

      {#if editing === s.provider}
        <form
          class="pk-form"
          onsubmit={(e) => {
            e.preventDefault();
            void save(s.provider);
          }}
        >
          <label class="pk-sr" for={formId}>{labelOf(s.provider)} API key</label>
          <Input
            id={formId}
            type="password"
            mono
            autocomplete="off"
            spellcheck={false}
            placeholder="Paste the API key"
            bind:value={draft}
          />
          <Button size="sm" variant="primary" type="submit" disabled={!draft.trim() || busy === s.provider}>Save key</Button>
          <Button size="sm" variant="ghost" disabled={!draft.trim() || busy === s.provider} onclick={() => test(s.provider)}>Test</Button>
          <Button size="sm" variant="ghost" onclick={closeForm}>Cancel</Button>
        </form>
      {/if}

      {#if row.showPrefer && s.stored}
        <Switch
          id="pk-prefer-{s.provider}"
          label="Use the saved key instead of {row.envName}"
          checked={s.stored.preferStored}
          onchange={(v) => prefer(s.provider, v)}
        />
      {/if}

      {#if result}
        <p class="pk-result" class:pk-ok={result.tone === "ok"} class:pk-bad={result.tone === "bad"} role="status">{result.text}</p>
      {/if}
    </div>
  {/each}
  <div class="pk-row">
    <p class="pk-help">
      Saved keys stay on the Cortex server, encrypted (AES-256-GCM) in <code>{dir || ".cortex"}</code> with owner-only file permissions.
      The browser never gets a key back. A key in the server's environment wins unless you switch to the saved one.
    </p>
  </div>
{/if}

<style>
  .pk-row { display: grid; gap: 8px; padding: 12px 16px; }
  .pk-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; }
  .pk-text { min-width: 0; }
  .pk-label { display: block; font-size: var(--cortex-t-sm); font-weight: 500; color: var(--cortex-text); }
  .pk-help { margin: 2px 0 0; font-size: var(--cortex-t-xs); line-height: var(--cortex-lh-ui); color: var(--cortex-text-2); }
  .pk-help :global(code) { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); word-break: break-all; }
  .pk-warn { color: var(--cortex-warn); }
  .pk-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; }
  .pk-mask { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-2); }
  .pk-form { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .pk-form :global(input) { flex: 1; min-width: 220px; }
  .pk-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .pk-result { margin: 0; font-size: var(--cortex-t-xs); }
  .pk-muted { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .pk-ok { color: var(--cortex-ok); }
  .pk-bad { color: var(--cortex-bad); }
  @media (max-width: 720px) {
    .pk-head { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .pk-controls { justify-content: flex-start; }
  }
</style>
