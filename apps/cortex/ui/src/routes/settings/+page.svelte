<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { fetchModelsForProvider, type UiModelOption } from "$lib/framework-models.js";
  import { settings as settingsStore, DEFAULTS } from "$lib/stores/settings.js";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";

  /**
   * Explicit shape for this form state. Matches `CortexSettings` in `$lib/stores/settings.ts`
   * (Svelte’s TS analysis in `.svelte` files can lose `ollamaEndpoint` when using imported `CortexSettings` alone).
   */
  type LocalSettings = {
    defaultProvider: string;
    defaultModel: string;
    notificationLevel: "all" | "completions" | "failures" | "none";
    notificationsEnabled: boolean;
    runRetentionDays: number;
    debugMode: boolean;
    theme: "dark" | "light";
    ollamaEndpoint: string;
    tooltipsEnabled: boolean;
  };

  // Local reactive copy — bound to form inputs, written to shared store on Save
  let localSettings = $state<LocalSettings>({ ...DEFAULTS } as LocalSettings);
  let saved = $state(false);
  let notifPermission = $state<NotificationPermission>("default");
  let serverHealth = $state<"checking" | "online" | "offline">("checking");
  let serverVersion = $state<string | null>(null);

  /** From `/api/models/framework/*` or live Ollama tags (same source as Lab builder). */
  let providerModelOptions = $state<UiModelOption[]>([]);
  let modelsLoading = $state(false);
  let modelsError = $state<string | null>(null);

  const PROVIDERS = [
    { value: "anthropic", label: "Anthropic" },
    { value: "openai",    label: "OpenAI" },
    { value: "gemini",    label: "Google Gemini" },
    { value: "ollama",    label: "Ollama (local)" },
    { value: "litellm",  label: "LiteLLM" },
  ];

  $effect(() => {
    const p = localSettings.defaultProvider;
    const ep = localSettings.ollamaEndpoint;
    let cancelled = false;
    void (async () => {
      modelsLoading = true;
      modelsError = null;
      const { options, error } = await fetchModelsForProvider(
        p,
        p === "ollama" ? ep : undefined,
      );
      if (cancelled) return;
      providerModelOptions = options;
      modelsError = error ?? null;
      modelsLoading = false;
    })();
    return () => {
      cancelled = true;
    };
  });

  onMount(() => {
    settingsStore.init();
    // Populate local form from persisted settings
    localSettings = { ...settingsStore.get() } as LocalSettings;

    if ("Notification" in window) {
      notifPermission = Notification.permission;
    }

    fetch(`${CORTEX_SERVER_URL}/api/health`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json() as { ok: boolean; version: string; uptime: number };
          serverHealth = "online";
          serverVersion = data.version;
        } else {
          serverHealth = "offline";
        }
      })
      .catch(() => { serverHealth = "offline"; });
  });

  function saveSettings() {
    // Write to shared store — propagates live to stage prompt + builder form
    settingsStore.save(localSettings);
    saved = true;
    toast.success("Settings saved", "Provider and model defaults updated.");
    setTimeout(() => (saved = false), 2000);
  }

  function resetSettings() {
    localSettings = { ...DEFAULTS } as LocalSettings;
    settingsStore.reset();
    toast.info("Settings reset to defaults");
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) {
      toast.warning("Notifications not supported", "Your browser does not support desktop notifications.");
      return;
    }
    const result = await Notification.requestPermission();
    notifPermission = result;
    if (result === "granted") {
      localSettings = { ...localSettings, notificationsEnabled: true };
      toast.success("Notifications enabled", "You'll be notified when agents complete or fail.");
      new Notification("Cortex", {
        body: "Notifications are now enabled for Reactive Agents.",
        icon: "/favicon.svg",
      });
    } else if (result === "denied") {
      localSettings = { ...localSettings, notificationsEnabled: false };
      toast.error("Notifications blocked", "Enable them in your browser settings.");
    }
  }

  async function pruneOldRuns() {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ olderThanDays: localSettings.runRetentionDays }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const { pruned } = await res.json() as { pruned: number };
      toast.success(`Pruned ${pruned} old runs`);
    } catch (e) {
      toast.error("Prune failed", String(e));
    }
  }
</script>

<svelte:head>
  <title>CORTEX — Settings</title>
</svelte:head>

<CortexDeskShell>
<div class="relative z-10 h-full min-h-0 overflow-y-auto p-4 sm:p-6">
  <div class="mx-auto max-w-2xl space-y-8">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="font-display text-2xl font-light tracking-tight text-on-surface">
          <span class="font-semibold text-primary">Settings</span>
        </h1>
        <p class="font-mono text-[10px] text-outline mt-1">Cortex companion studio preferences</p>
      </div>
      <a href="/" class="flex items-center gap-1 font-mono text-[11px] text-cyan-700 no-underline transition-colors hover:text-primary dark:text-secondary">
        <span class="material-symbols-outlined text-sm">arrow_back</span>
        Beacon
      </a>
    </div>

    <!-- Connection -->
    <section class="gradient-border rounded-lg p-5 space-y-3">
      <h2 class="font-mono text-xs uppercase tracking-widest text-primary font-semibold flex items-center gap-2">
        <span class="material-symbols-outlined text-sm">cable</span>
        Connection
      </h2>
      <div class="flex items-center justify-between">
        <div>
          <div class="font-mono text-[11px] text-on-surface/70">Cortex Server</div>
          <div class="font-mono text-[10px] text-outline mt-0.5">{CORTEX_SERVER_URL}</div>
          {#if serverVersion}
            <div class="font-mono text-[10px] text-outline/60 mt-1">v{serverVersion}</div>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full {serverHealth === 'online' ? 'bg-secondary' : serverHealth === 'offline' ? 'bg-error' : 'bg-outline/40'} {serverHealth === 'online' ? '' : ''}"></span>
          <span class="font-mono text-[10px] {serverHealth === 'online' ? 'text-secondary' : serverHealth === 'offline' ? 'text-error' : 'text-outline'}">
            {serverHealth === "online" ? "Connected" : serverHealth === "offline" ? "Offline" : "Checking…"}
          </span>
        </div>
      </div>
      <p class="font-mono text-[10px] text-outline/60">
        To use a different server, set <code class="text-primary">CORTEX_URL</code> before starting: <code class="text-primary">CORTEX_URL=http://host:port rax cortex</code>
      </p>
      <div>
        <label for="settings-ollama-endpoint" class="font-mono text-[10px] text-outline uppercase tracking-widest block mb-1.5">
          Ollama Endpoint
        </label>
        <input
          id="settings-ollama-endpoint"
          bind:value={localSettings.ollamaEndpoint}
          placeholder="http://localhost:11434  (leave blank for default)"
          class="w-full bg-surface-container-lowest border border-outline-variant/20 rounded px-3 py-2
                 text-sm font-mono text-on-surface placeholder:text-outline/40
                 focus:border-primary/50 focus:outline-none"
        />
        <p class="font-mono text-[10px] text-outline/50 mt-1">
          Override the Ollama server used when selecting the Ollama provider in agent config.
          Can also be set server-side via <code class="text-primary/70">OLLAMA_HOST</code>.
        </p>
      </div>
    </section>

    <!-- Default Agent Config -->
    <section class="gradient-border rounded-lg p-5 space-y-4">
      <h2 class="font-mono text-xs uppercase tracking-widest text-primary font-semibold flex items-center gap-2">
        <span class="material-symbols-outlined text-sm">smart_toy</span>
        Default Agent Config
      </h2>
      <p class="font-mono text-[10px] text-outline/60">
        Used when launching agents from the Beacon input bar or the Lab Builder without explicit configuration.
      </p>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="settings-default-provider" class="font-mono text-[10px] text-outline uppercase tracking-widest block mb-1.5">Provider</label>
          <select
            id="settings-default-provider"
            bind:value={localSettings.defaultProvider}
            onchange={async () => {
              localSettings = { ...localSettings, defaultModel: "" };
              const p = localSettings.defaultProvider;
              const { options } = await fetchModelsForProvider(
                p,
                p === "ollama" ? localSettings.ollamaEndpoint : undefined,
              );
              if (options[0]) {
                localSettings = { ...localSettings, defaultModel: options[0].value };
              }
            }}
            class="w-full bg-surface-container-lowest border border-outline-variant/20 rounded px-3 py-2
                   text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none"
          >
            {#each PROVIDERS as p}
              <option value={p.value}>{p.label}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="settings-default-model" class="font-mono text-[10px] text-outline uppercase tracking-widest block mb-1.5">Model</label>
          {#if modelsError}
            <p class="font-mono text-[10px] text-error/80 mb-1.5">{modelsError}</p>
          {/if}
          {#if modelsLoading}
            <div
              class="w-full bg-surface-container-lowest border border-outline-variant/20 rounded px-3 py-2
                     text-sm font-mono text-outline/50"
            >
              Loading models…
            </div>
          {:else if providerModelOptions.length > 0}
            <select
              id="settings-default-model"
              bind:value={localSettings.defaultModel}
              class="w-full bg-surface-container-lowest border border-outline-variant/20 rounded px-3 py-2
                     text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none"
            >
              {#each providerModelOptions as m}
                <option value={m.value}>{m.label}</option>
              {/each}
              {#if localSettings.defaultModel.trim() && !providerModelOptions.some((o) => o.value === localSettings.defaultModel)}
                <option value={localSettings.defaultModel}>{localSettings.defaultModel} (saved)</option>
              {/if}
            </select>
          {:else}
            <input
              id="settings-default-model"
              bind:value={localSettings.defaultModel}
              placeholder="Model id"
              class="w-full bg-surface-container-lowest border border-outline-variant/20 rounded px-3 py-2
                     text-sm font-mono text-on-surface placeholder:text-outline/40
                     focus:border-primary/50 focus:outline-none"
            />
          {/if}
        </div>
      </div>
      <p class="font-mono text-[10px] text-outline/50">
        API keys are read from environment variables: <code class="text-primary/70">ANTHROPIC_API_KEY</code>, <code class="text-primary/70">OPENAI_API_KEY</code>, etc.
      </p>
    </section>

    <!-- Notifications -->
    <section class="gradient-border rounded-lg p-5 space-y-4">
      <h2 class="font-mono text-xs uppercase tracking-widest text-primary font-semibold flex items-center gap-2">
        <span class="material-symbols-outlined text-sm">notifications</span>
        Notifications
      </h2>

      <div class="flex items-center justify-between">
        <div>
          <div class="font-mono text-[11px] text-on-surface/80">Desktop Notifications</div>
          <div class="font-mono text-[10px] text-outline mt-0.5">
            {#if notifPermission === "granted"}
              <span class="text-secondary">Enabled</span>
            {:else if notifPermission === "denied"}
              <span class="text-error">Blocked in browser settings</span>
            {:else}
              Not yet requested
            {/if}
          </div>
        </div>
        {#if notifPermission !== "granted"}
          <button
            type="button"
            onclick={requestNotificationPermission}
            class="px-4 py-1.5 bg-primary/10 border border-primary/30 text-primary font-mono text-[10px]
                   uppercase rounded hover:bg-primary/20 transition-colors cursor-pointer"
          >
            Enable
          </button>
        {:else}
          <button
            type="button"
            onclick={() => {
              new Notification("Cortex test", { body: "Notifications are working!", icon: "/favicon.svg" });
            }}
            class="px-4 py-1.5 border border-outline-variant/20 text-outline font-mono text-[10px]
                   uppercase rounded hover:text-primary hover:border-primary/30 transition-colors cursor-pointer"
          >
            Test
          </button>
        {/if}
      </div>

      <fieldset class="border-0 p-0 m-0 min-w-0">
        <legend class="font-mono text-[10px] text-outline uppercase tracking-widest block mb-1.5 px-0">
          Notify me when
        </legend>
        <div class="space-y-2">
          {#each [
            { value: "all",         label: "All events (completions, failures, errors, decisions)" },
            { value: "completions", label: "Agent completions and failures only (recommended)" },
            { value: "failures",    label: "Failures only" },
            { value: "none",        label: "Never" },
          ] as option}
            <label class="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="notifLevel"
                value={option.value}
                bind:group={localSettings.notificationLevel}
                class="accent-primary"
              />
              <span class="font-mono text-[11px] text-on-surface/70">{option.label}</span>
            </label>
          {/each}
        </div>
      </fieldset>
    </section>

    <!-- Data & Storage -->
    <section class="gradient-border rounded-lg p-5 space-y-4">
      <h2 class="font-mono text-xs uppercase tracking-widest text-primary font-semibold flex items-center gap-2">
        <span class="material-symbols-outlined text-sm">storage</span>
        Data & Storage
      </h2>

      <div class="flex items-center gap-4">
        <div class="flex-1">
          <label for="settings-run-retention" class="font-mono text-[10px] text-outline uppercase tracking-widest block mb-1.5">
            Keep runs for
          </label>
          <div class="flex items-center gap-3">
            <input
              id="settings-run-retention"
              type="range"
              min="1"
              max="90"
              bind:value={localSettings.runRetentionDays}
              class="flex-1 accent-primary"
            />
            <span class="font-mono text-sm text-primary w-16 text-right tabular-nums">
              {localSettings.runRetentionDays}d
            </span>
          </div>
        </div>
        <button
          type="button"
          onclick={pruneOldRuns}
          class="px-4 py-1.5 border border-outline-variant/20 text-outline font-mono text-[10px]
                 uppercase rounded hover:text-error hover:border-error/30 transition-colors cursor-pointer flex-shrink-0"
        >
          Prune now
        </button>
      </div>

      <p class="font-mono text-[10px] text-outline/50">
        Run events are stored in <code class="text-primary/70">.cortex/cortex.db</code> (SQLite, WAL mode).
        Each run retains up to 50 most recent executions per agent automatically.
      </p>
    </section>

    <!-- Debug -->
    <section class="gradient-border rounded-lg p-5 space-y-4">
      <h2 class="font-mono text-xs uppercase tracking-widest text-primary font-semibold flex items-center gap-2">
        <span class="material-symbols-outlined text-sm">bug_report</span>
        Developer
      </h2>
      <label class="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" bind:checked={localSettings.debugMode} class="accent-primary w-4 h-4" />
        <div>
          <div class="font-mono text-[11px] text-on-surface/80">Debug mode</div>
          <div class="font-mono text-[10px] text-outline/60 mt-0.5">
            Show additional event details and verbose logging in the Raw Events tab
          </div>
        </div>
      </label>
      <label class="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" bind:checked={localSettings.tooltipsEnabled} class="accent-primary w-4 h-4" />
        <div>
          <div class="font-mono text-[11px] text-on-surface/80">Show hover tooltips</div>
          <div class="font-mono text-[10px] text-outline/60 mt-0.5">
            Help text on controls (Lab, runs, command palette). Turn off if you find them distracting.
          </div>
        </div>
      </label>
      <div class="flex gap-2 flex-wrap text-[10px] font-mono text-outline/50">
        <span>Connect snippet:</span>
        <code class="text-primary/70 bg-primary/8 px-1.5 py-0.5 rounded">.withCortex()</code>
        <span>or</span>
        <code class="text-primary/70 bg-primary/8 px-1.5 py-0.5 rounded">CORTEX_URL={CORTEX_SERVER_URL}</code>
      </div>
    </section>

    <!-- Save / Reset -->
    <div class="flex items-center justify-between pb-8">
      <button
        type="button"
        onclick={resetSettings}
        class="px-4 py-2 border border-outline-variant/20 text-outline font-mono text-xs uppercase
               rounded hover:text-error hover:border-error/30 transition-colors cursor-pointer"
      >
        Reset to defaults
      </button>
      <button
        type="button"
        onclick={saveSettings}
        class="px-6 py-2 bg-primary text-on-primary font-mono text-xs uppercase
               rounded shadow-glow-violet hover:brightness-110 active:scale-95 transition-all cursor-pointer"
      >
        {saved ? "✓ Saved" : "Save Settings"}
      </button>
    </div>

  </div>
</div>
</CortexDeskShell>
