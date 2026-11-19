<script lang="ts">
  /**
   * Model page (Bench spec section 8): the Settings rows and a capability stat
   * grid, a note saying whether the values are measured and what runs on this
   * model used, then recent runs by name. Rules: `lib/model-page.ts`.
   * Without a model it lists the provider's models.
   */
  import { goto } from "$app/navigation";
  import { tooltip } from "$lib/actions/tooltip.js";
  import { page } from "$app/state";
  import { formatModelPrice, formatRelativeTime, modelPriceDetail, formatTokens, statusOfRun } from "@reactive-agents/ui-core";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
  import PageHeader from "$lib/components/kit/PageHeader.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import SettingsGroup from "$lib/components/settings/SettingsGroup.svelte";
  import SettingsRow from "$lib/components/settings/SettingsRow.svelte";
  import StatGrid from "$lib/components/settings/StatGrid.svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { chatStore } from "$lib/stores/chat-store.js";
  import { settings } from "$lib/stores/settings.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { freshChatPayload } from "$lib/chat-defaults.js";
  import { fetchModelsForProvider, type UiModelOption } from "$lib/framework-models.js";
  import { modelHref } from "$lib/model-link.js";
  import { loadProviders } from "$lib/providers.js";
  import { runNameOf, type RunRow } from "$lib/runs-table.js";
  import { keyEnvOf } from "$lib/settings-page.js";
  import {
    capabilityNote,
    capabilityRows,
    capabilityStats,
    runsOnModel,
    sortModelList,
    speedStats,
    type ModelCapability,
    type ModelListSort,
    type ModelThroughput,
  } from "$lib/model-page.js";
  import ModelCalibration from "$lib/components/models/ModelCalibration.svelte";
  import ModelSpend from "$lib/components/models/ModelSpend.svelte";
  import ModelPriceCard from "$lib/components/models/ModelPriceCard.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import { fetchModelCalibration, fetchModelCost, type ModelCalibrationView, type ModelCost } from "$lib/model-insights.js";

  const provider = $derived(page.params.provider ?? "");
  const model = $derived((page.params.model ?? "").trim());

  let providerLabel = $state("");
  let cap = $state<ModelCapability | null>(null);
  let capError = $state<string | null>(null);
  let models = $state<UiModelOption[]>([]);
  const MODEL_SORTS: { value: ModelListSort; label: string }[] = [
    { value: "default", label: "Provider order" },
    { value: "price", label: "Lowest price" },
  ];
  let modelSort = $state<ModelListSort>("default");
  const sortedModels = $derived(sortModelList(models, modelSort));
  let modelRuns = $state<RunRow[]>([]);
  /** Median speed and TTFT over recent runs (`GET /api/model-throughput`). */
  let speed = $state<ModelThroughput | null>(null);
  const speedItems = $derived(speedStats(speed));
  /** Calibration (`undefined` while loading) and spend (`lib/model-insights.ts`). */
  let calibration = $state<ModelCalibrationView | null | undefined>(undefined);
  let spend = $state<ModelCost | null>(null);
  let starting = $state(false);
  const now = Date.now();

  $effect(() => {
    const p = provider;
    const m = model;
    cap = null;
    capError = null;
    models = [];
    modelRuns = [];
    speed = null;
    calibration = undefined;
    spend = null;
    let cancelled = false;
    void loadProviders().then((list) => {
      if (!cancelled) providerLabel = list.find((x) => x.id === p)?.label ?? p;
    });
    if (m) {
      void fetch(`${CORTEX_SERVER_URL}/api/models/capability?provider=${encodeURIComponent(p)}&model=${encodeURIComponent(m)}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`Server returned ${r.status}`);
          return (await r.json()) as ModelCapability;
        })
        .then((c) => { if (!cancelled) cap = c; })
        .catch((e) => { if (!cancelled) capError = e instanceof Error ? e.message : String(e); });
      void fetch(`${CORTEX_SERVER_URL}/api/model-throughput?provider=${encodeURIComponent(p)}&model=${encodeURIComponent(m)}`)
        .then((r) => (r.ok ? (r.json() as Promise<ModelThroughput>) : null))
        .then((t) => { if (!cancelled) speed = t; })
        .catch(() => {});
      void fetchModelCalibration(m).then((c) => { if (!cancelled) calibration = c; });
      void fetchModelCost(p, m).then((c) => { if (!cancelled) spend = c; });
      void fetch(`${CORTEX_SERVER_URL}/api/runs?limit=200`)
        .then((r) => (r.ok ? (r.json() as Promise<RunRow[]>) : []))
        .then((rows) => { if (!cancelled) modelRuns = runsOnModel(rows, p, m); })
        .catch(() => {});
    } else {
      void fetchModelsForProvider(p).then((r) => { if (!cancelled) models = r.options; });
    }
    return () => { cancelled = true; };
  });

  const note = $derived(cap ? capabilityNote(cap, modelRuns) : null);
  const recent = $derived(modelRuns.slice(0, 6));
  const keyEnv = $derived(keyEnvOf(provider));

  async function startChat() {
    starting = true;
    try {
      settings.init();
      const s = settings.get();
      const payload = await freshChatPayload({ defaultProvider: provider, defaultModel: model, ollamaEndpoint: s.ollamaEndpoint });
      await chatStore.createSession(payload);
      await goto("/chat");
    } catch (e) {
      toast.error("Couldn't start a chat", e instanceof Error ? e.message : String(e));
    } finally {
      starting = false;
    }
  }
</script>

<svelte:head>
  <title>{model || providerLabel || provider} · Cortex</title>
</svelte:head>

<CortexDeskShell class="bg-canvas">
  <div class="mp-page">
    <div class="mp-head">
      <PageHeader title={model || providerLabel || provider}>
        {#snippet lead()}
          <nav class="mp-crumbs" aria-label="Breadcrumb">
            <a href="/settings#defaults">Settings</a>
            <span aria-hidden="true">›</span>
            {#if model}
              <a href="/models/{encodeURIComponent(provider)}">{providerLabel || provider}</a>
            {:else}
              <span aria-current="page">{providerLabel || provider}</span>
            {/if}
          </nav>
        {/snippet}
        {#snippet meta()}
          {#if cap && cap.keyConfigured === false}
            <Badge tone="bad">Key missing</Badge>
          {/if}
        {/snippet}
        {#snippet actions()}
          {#if model}
            <Button variant="primary" icon="chat" onclick={startChat} disabled={starting}>Start a chat with this model</Button>
          {/if}
        {/snippet}
      </PageHeader>
      {#if model}<p class="mp-id">{provider}/{model}</p>{/if}
    </div>

    <div class="mp-wrap">
      {#if model}
        <SettingsGroup id="capabilities" title="Capabilities" bare>
          <div class="mp-cap">
            {#if capError}
              <p class="mp-warn" role="alert">Couldn't load capabilities: {capError}</p>
            {:else if !cap}
              <p class="mp-muted" role="status">Loading capabilities…</p>
            {:else}
              <StatGrid items={capabilityStats(cap)} />
              {#if note}<p class="mp-note">{note}</p>{/if}
            {/if}
          </div>
          {#if cap}
            <div class="mp-rows">
              {#each capabilityRows(cap) as row (row.label)}
                <SettingsRow label={row.label}>
                  {#snippet control()}<span class="mp-data">{row.value}</span>{/snippet}
                </SettingsRow>
              {/each}
              <SettingsRow label="API key">
                {#snippet help()}
                  {#if cap?.keyConfigured === false && keyEnv}
                    Save a key in <a href="/settings#providers">Settings · Providers</a>, or set <code>{keyEnv}</code> in the server's environment and restart Cortex.
                  {:else if cap?.keyConfigured === null}
                    This provider needs no key.
                  {:else}
                    A saved key or the server's environment. <a href="/settings#providers">Manage keys</a>
                  {/if}
                {/snippet}
                {#snippet control()}
                  {#if cap?.keyConfigured === true}
                    <Badge tone="ok">Found</Badge>
                  {:else if cap?.keyConfigured === false}
                    <Badge tone="bad">Missing</Badge>
                  {:else}
                    <Badge>Not needed</Badge>
                  {/if}
                {/snippet}
              </SettingsRow>
            </div>
          {/if}
        </SettingsGroup>

        <SettingsGroup id="speed" title="Speed" description="Measured on this model's recent runs in Cortex.">
          {#if speedItems.length === 0}
            <p class="mp-empty">No timed model calls recorded yet.</p>
          {:else}
            <div class="mp-speed"><StatGrid items={speedItems} /></div>
          {/if}
        </SettingsGroup>

        <ModelPriceCard price={cap?.price} loading={cap === null && capError === null} />

        <ModelSpend cost={spend} />

        <ModelCalibration view={calibration} />

        <SettingsGroup id="recent-runs" title="Recent runs" description="Runs Cortex recorded with this provider and model.">
          {#if recent.length === 0}
            <p class="mp-empty">No runs with this model yet. Start a chat to try it.</p>
          {:else}
            {#each recent as r (r.runId)}
              {@const st = statusOfRun(r.status)}
              <a class="mp-run" href="/run/{encodeURIComponent(r.runId)}">
                <span class="mp-run-name">{runNameOf(r)}</span>
                <Status tone={st.tone} label={st.label} />
                <span class="mp-data mp-run-meta">{formatTokens(r.tokensUsed)} tok</span>
                <span class="mp-run-meta" use:tooltip={new Date(r.startedAt).toLocaleString()}>{formatRelativeTime(r.startedAt, now)}</span>
              </a>
            {/each}
          {/if}
        </SettingsGroup>
      {:else}
        <SettingsGroup id="models" title="Models" description="Pick a model to see its capabilities. Prices are per million input / output tokens.">
          {#if models.length === 0}
            <p class="mp-empty" role="status">No models listed for this provider.</p>
          {:else}
            <div class="mp-sort">
              <Select id="models-sort" bind:value={modelSort} options={MODEL_SORTS} aria-label="Sort models" />
            </div>
            {#each sortedModels as m (m.value)}
              <a class="mp-run mp-model" href={modelHref(provider, m.value)}>
                <span class="mp-run-name mp-data">{m.label || m.value}</span>
                <span class="mp-data mp-run-meta" use:tooltip={modelPriceDetail(m.price)}>{formatModelPrice(m.price)}</span>
              </a>
            {/each}
          {/if}
        </SettingsGroup>
      {/if}
    </div>
  </div>
</CortexDeskShell>

<style>
  .mp-page { position: relative; z-index: 1; height: 100%; min-height: 0; overflow-y: auto; }
  .mp-head, .mp-wrap { max-width: 860px; margin: 0 auto; }
  .mp-head :global(h1) { overflow-wrap: anywhere; }
  .mp-id { margin: -8px 0 0; padding: 0 32px 8px; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .mp-crumbs { display: flex; gap: 6px; align-items: center; }
  .mp-crumbs a { color: var(--cortex-text-2); text-decoration: none; }
  .mp-crumbs a:hover { color: var(--cortex-text); text-decoration: underline; }
  .mp-wrap { display: grid; gap: 32px; padding: 8px 32px 48px; }
  .mp-cap {
    display: grid;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-panel) var(--cortex-r-panel) 0 0;
    background: var(--cortex-surface-1);
  }
  .mp-rows {
    border: 1px solid var(--cortex-line);
    border-top: 0;
    border-radius: 0 0 var(--cortex-r-panel) var(--cortex-r-panel);
    background: var(--cortex-surface-1);
  }
  .mp-rows > :global(*:not(:last-child)) { border-bottom: 1px solid var(--cortex-line); }
  .mp-note {
    margin: 0;
    padding: 8px 12px;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-warn-tint);
    font-size: var(--cortex-t-xs);
    line-height: var(--cortex-lh-ui);
    color: var(--cortex-text-2);
  }
  .mp-speed { padding: 16px; }
  .mp-warn { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-warn); }
  .mp-muted, .mp-empty { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-3); }
  .mp-empty { padding: 16px; }
  .mp-data { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); font-variant-numeric: tabular-nums; color: var(--cortex-text); }
  .mp-run {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    gap: 16px;
    align-items: center;
    padding: 10px 16px;
    color: var(--cortex-text);
    text-decoration: none;
  }
  .mp-model { grid-template-columns: minmax(0, 1fr) auto; }
  .mp-sort { display: flex; justify-content: flex-end; padding: 0 0 8px; }
  .mp-run:hover { background: var(--cortex-surface-2); }
  .mp-run:first-child { border-radius: var(--cortex-r-panel) var(--cortex-r-panel) 0 0; }
  .mp-run:last-child { border-radius: 0 0 var(--cortex-r-panel) var(--cortex-r-panel); }
  .mp-run-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--cortex-t-sm); }
  .mp-run-meta { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); white-space: nowrap; }
  @media (max-width: 720px) {
    .mp-wrap { padding: 8px 16px 40px; }
    .mp-id { padding: 0 16px 8px; }
    .mp-run { grid-template-columns: minmax(0, 1fr) auto; }
    .mp-run-meta { display: none; }
  }
</style>
