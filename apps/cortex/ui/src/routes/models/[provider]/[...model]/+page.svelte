<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
  import ModelLink from "$lib/components/ModelLink.svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { chatStore } from "$lib/stores/chat-store.js";
  import { settings } from "$lib/stores/settings.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { freshChatPayload } from "$lib/chat-defaults.js";
  import { fetchModelsForProvider, type UiModelOption } from "$lib/framework-models.js";
  import { modelHref } from "$lib/model-link.js";
  import { loadProviders } from "$lib/providers.js";

  type Capability = {
    maxContextTokens: number;
    recommendedNumCtx: number;
    maxOutputTokens: number;
    supportsThinking: boolean;
    supportsVision: boolean;
    supportsPromptCaching: boolean;
    toolCallDialect: string;
    tier: string;
    source: string;
    keyConfigured: boolean | null;
  };
  type RunRow = { runId: string; startedAt: number; status: string; provider?: string; model?: string; tokensUsed: number; displayName?: string };

  const provider = $derived(page.params.provider ?? "");
  const model = $derived((page.params.model ?? "").trim());

  let providerLabel = $state("");
  let cap = $state<Capability | null>(null);
  let capError = $state<string | null>(null);
  let models = $state<UiModelOption[]>([]);
  let recent = $state<RunRow[]>([]);
  let starting = $state(false);

  $effect(() => {
    const p = provider;
    const m = model;
    cap = null;
    capError = null;
    models = [];
    recent = [];
    let cancelled = false;
    void loadProviders().then((list) => {
      if (!cancelled) providerLabel = list.find((x) => x.id === p)?.label ?? p;
    });
    if (m) {
      void fetch(`${CORTEX_SERVER_URL}/api/models/capability?provider=${encodeURIComponent(p)}&model=${encodeURIComponent(m)}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`Server returned ${r.status}`);
          return (await r.json()) as Capability;
        })
        .then((c) => { if (!cancelled) cap = c; })
        .catch((e) => { if (!cancelled) capError = e instanceof Error ? e.message : String(e); });
      void fetch(`${CORTEX_SERVER_URL}/api/runs?limit=200`)
        .then((r) => (r.ok ? (r.json() as Promise<RunRow[]>) : []))
        .then((rows) => {
          if (!cancelled) recent = rows.filter((x) => x.provider === p && x.model === m).slice(0, 6);
        })
        .catch(() => {});
    } else {
      void fetchModelsForProvider(p).then((r) => { if (!cancelled) models = r.options; });
    }
    return () => { cancelled = true; };
  });

  const fmt = (n: number) => n.toLocaleString();
  const yesNo = (b: boolean) => (b ? "Yes" : "No");
  const when = (ts: number) => new Date(ts).toLocaleString();

  const rows = $derived(
    cap
      ? ([
          ["Context window", `${fmt(cap.maxContextTokens)} tokens`],
          ["Working context", `${fmt(cap.recommendedNumCtx)} tokens`],
          ["Max output", `${fmt(cap.maxOutputTokens)} tokens`],
          ["Thinking mode", yesNo(cap.supportsThinking)],
          ["Vision", yesNo(cap.supportsVision)],
          ["Prompt caching", yesNo(cap.supportsPromptCaching)],
          ["Tool-call dialect", cap.toolCallDialect],
          ["Tier", cap.tier],
        ] as [string, string][])
      : [],
  );

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
  <title>CORTEX — {model ? `${provider}/${model}` : provider}</title>
</svelte:head>

<CortexDeskShell>
  <div class="relative z-10 h-full min-h-0 overflow-y-auto p-4 sm:p-6">
    <div class="mx-auto max-w-2xl space-y-6">
      <nav class="flex items-center gap-1 font-mono text-[11px] text-[var(--cortex-text-muted)]" aria-label="Breadcrumb">
        <a href="/models/{encodeURIComponent(provider)}" class="no-underline text-inherit hover:underline">{providerLabel || provider}</a>
        {#if model}<span aria-hidden="true">/</span><span class="text-[var(--cortex-text)]">{model}</span>{/if}
      </nav>

      <header class="space-y-1">
        <h1 class="m-0 break-all font-display text-2xl font-semibold text-[var(--cortex-text)]">{model || providerLabel || provider}</h1>
        <p class="m-0 font-mono text-[11px] text-[var(--cortex-text-muted)]">
          {provider}{model ? `/${model}` : ""}
        </p>
      </header>

      {#if model}
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onclick={startChat}
            disabled={starting}
            class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-mid)] px-3 py-1.5 text-[12px] text-[var(--cortex-text)] transition-colors hover:bg-[var(--cortex-surface-low)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ra-cyan,#22d3ee)] disabled:cursor-wait disabled:opacity-60"
          >
            <span class="material-symbols-outlined text-[16px] leading-none">chat</span>
            Start chat with this model
          </button>
          {#if cap && cap.keyConfigured !== null}
            <span class="font-mono text-[11px] {cap.keyConfigured ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}">
              {cap.keyConfigured ? "API key configured" : "API key missing"}
            </span>
          {:else if cap}
            <span class="font-mono text-[11px] text-[var(--cortex-text-muted)]">No API key needed</span>
          {/if}
        </div>

        <section class="rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] p-4" aria-labelledby="cap-h">
          <h2 id="cap-h" class="m-0 mb-3 font-mono text-[11px] uppercase tracking-widest text-[var(--cortex-text-muted)]">Capabilities</h2>
          {#if capError}
            <p class="m-0 text-[12px] text-amber-600 dark:text-amber-400">Couldn't load capabilities: {capError}</p>
          {:else if !cap}
            <p class="m-0 text-[12px] text-[var(--cortex-text-muted)]" role="status">Loading…</p>
          {:else}
            <dl class="m-0 space-y-1.5 text-[12px]">
              {#each rows as [label, value] (label)}
                <div class="flex items-baseline justify-between gap-3">
                  <dt class="text-[var(--cortex-text-muted)]">{label}</dt>
                  <dd class="m-0 text-right tabular-nums text-[var(--cortex-text)]">{value}</dd>
                </div>
              {/each}
            </dl>
            {#if cap.source === "fallback"}
              <p class="m-0 mt-3 text-[11px] text-[var(--cortex-text-muted)]">Not in the shipped capability table: these are conservative defaults, not measured values.</p>
            {/if}
          {/if}
        </section>

        <section class="rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] p-4" aria-labelledby="runs-h">
          <h2 id="runs-h" class="m-0 mb-3 font-mono text-[11px] uppercase tracking-widest text-[var(--cortex-text-muted)]">Recent runs</h2>
          {#if recent.length === 0}
            <p class="m-0 text-[12px] text-[var(--cortex-text-muted)]">No recent runs with this model.</p>
          {:else}
            <ul class="m-0 list-none space-y-1.5 p-0 text-[12px]">
              {#each recent as r (r.runId)}
                <li class="flex items-baseline justify-between gap-3">
                  <a href="/run/{r.runId}" class="min-w-0 truncate font-mono text-[var(--cortex-text)] no-underline hover:underline">{r.displayName ?? `${r.runId.slice(0, 12)}…`}</a>
                  <span class="shrink-0 tabular-nums text-[var(--cortex-text-muted)]">{r.status} · {when(r.startedAt)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {:else}
        <section class="rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] p-4">
          <h2 class="m-0 mb-3 font-mono text-[11px] uppercase tracking-widest text-[var(--cortex-text-muted)]">Models</h2>
          {#if models.length === 0}
            <p class="m-0 text-[12px] text-[var(--cortex-text-muted)]" role="status">No models listed.</p>
          {:else}
            <ul class="m-0 list-none space-y-1 p-0 text-[12px]">
              {#each models as m (m.value)}
                <li><a href={modelHref(provider, m.value)} class="font-mono text-[var(--cortex-text)] no-underline hover:underline">{m.label || m.value}</a></li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}
    </div>
  </div>
</CortexDeskShell>
