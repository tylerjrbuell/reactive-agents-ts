<script lang="ts">
  /**
   * Settings (Bench spec section 8): a section nav, then rows of label, help
   * text and control. Defaults, Providers, Notifications, Storage and
   * Developer are a form written by Save; Appearance (theme, motion) applies
   * at once. Rules: `lib/settings-page.ts`, `lib/theme.ts`, `lib/motion.ts`.
   */
  import { onMount } from "svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { showDesktopNotice, TEST_NOTICE } from "$lib/desktop-notify.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { loadProviders, PROVIDER_FALLBACK, type ProviderOption } from "$lib/providers.js";
  import { fetchModelsForProvider, type UiModelOption } from "$lib/framework-models.js";
  import { settings as settingsStore, DEFAULTS, type CortexSettings } from "$lib/stores/settings.js";
  import { MOTION_OPTIONS, parseMotion } from "$lib/motion.js";
  import { THEME_OPTIONS, parseTheme } from "$lib/theme.js";
  import { keyRowLabelOf } from "$lib/provider-keys.js";
  import { aboutVersionsOf, keyEnvOf, savePatchOf, SETTINGS_SECTIONS, type AboutVersions } from "$lib/settings-page.js";
  import OllamaEndpointRow from "$lib/components/settings/OllamaEndpointRow.svelte";
  import ProviderKeysPanel from "$lib/components/settings/ProviderKeysPanel.svelte";
  import VoiceSettingsPanel from "$lib/components/settings/VoiceSettingsPanel.svelte";
  import { modelHref } from "$lib/model-link.js";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
  import PageHeader from "$lib/components/kit/PageHeader.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import NeuralMark from "$lib/components/kit/NeuralMark.svelte";
  import SettingsGroup from "$lib/components/settings/SettingsGroup.svelte";
  import SettingsRow from "$lib/components/settings/SettingsRow.svelte";

  // Local copy bound to the form; Save writes it (without Appearance) to the shared store.
  let localSettings = $state<CortexSettings>({ ...DEFAULTS });
  let saved = $state(false);
  let notifPermission = $state<NotificationPermission | "unsupported">("default");
  let serverHealth = $state<"checking" | "online" | "offline">("checking");
  let versions = $state<AboutVersions>({ cortex: null, commit: null, framework: null });
  let providerHealth = $state<Record<string, string>>({});
  let activeSection = $state(SETTINGS_SECTIONS[0]?.id ?? "defaults");

  /** From `/api/models/:provider` (same source as the Lab builder). */
  let providerModelOptions = $state<UiModelOption[]>([]);
  let modelsLoading = $state(false);
  let modelsError = $state<string | null>(null);
  let modelsNote = $state<string | null>(null);

  let providerList = $state<readonly ProviderOption[]>(PROVIDER_FALLBACK);
  $effect(() => {
    void loadProviders().then((list) => { providerList = list; });
  });

  $effect(() => {
    const p = localSettings.defaultProvider;
    const ep = localSettings.ollamaEndpoint;
    let cancelled = false;
    void (async () => {
      modelsLoading = true;
      modelsError = null;
      modelsNote = null;
      const { options, default: def, error, note } = await fetchModelsForProvider(
        p,
        p === "ollama" ? ep : undefined,
      );
      if (cancelled) return;
      providerModelOptions = options;
      modelsError = error ?? null;
      modelsNote = note ?? null;
      modelsLoading = false;
      // Show the framework's current default when the user hasn't pinned one.
      if (!localSettings.defaultModel.trim()) {
        const seed = def && options.some((o) => o.value === def) ? def : options[0]?.value;
        if (seed) localSettings = { ...localSettings, defaultModel: seed };
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const providerLabelOf = (id: string): string => keyRowLabelOf(id) ?? providerList.find((p) => p.id === id)?.label ?? id;
  const providerOptions = $derived(
    providerList.map((p) => ({
      value: p.id,
      label: providerHealth[p.id] === "missing" ? `${p.label} (key missing)` : p.label,
    })),
  );
  const modelOptions = $derived.by(() => {
    const opts = providerModelOptions.map((m) => ({ value: m.value, label: m.label }));
    const pinned = localSettings.defaultModel.trim();
    if (pinned && !opts.some((o) => o.value === pinned)) opts.push({ value: pinned, label: `${pinned} (saved)` });
    return opts;
  });
  const providerKeyEnv = $derived(keyEnvOf(localSettings.defaultProvider));

  /** Key presence per provider (env or saved), for the "(key missing)" provider labels. */
  async function checkProviderHealth() {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/health/providers`);
      if (res.ok) {
        const data: unknown = await res.json();
        if (data && typeof data === "object" && !Array.isArray(data)) {
          providerHealth = Object.fromEntries(
            Object.entries(data as Record<string, unknown>).filter(
              (entry): entry is [string, string] => entry[1] === "ok" || entry[1] === "missing",
            ),
          );
        }
      }
    } catch {
      // The server may be unreachable; the Cortex server row says so.
    }
  }

  onMount(() => {
    settingsStore.init();
    localSettings = { ...settingsStore.get() };
    notifPermission = "Notification" in window ? Notification.permission : "unsupported";

    fetch(`${CORTEX_SERVER_URL}/api/health`)
      .then(async (res) => {
        if (!res.ok) {
          serverHealth = "offline";
          return;
        }
        const data: unknown = await res.json();
        serverHealth = "online";
        versions = aboutVersionsOf(data);
      })
      .catch(() => { serverHealth = "offline"; });

    void checkProviderHealth();
  });

  let scroller: HTMLDivElement | undefined = $state();

  /** Section nav: the last section whose top has passed the top of the scroll area (the last one at the bottom). */
  function trackSection() {
    if (!scroller) return;
    const top = scroller.getBoundingClientRect().top + 96;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
    let current = SETTINGS_SECTIONS[0]?.id ?? "defaults";
    for (const s of SETTINGS_SECTIONS) {
      const el = document.getElementById(s.id);
      if (el && el.getBoundingClientRect().top <= top) current = s.id;
    }
    activeSection = atBottom ? (SETTINGS_SECTIONS.at(-1)?.id ?? current) : current;
  }

  function saveSettings() {
    // Shared store: the Beacon prompt, new chats and the Lab builder read it live.
    settingsStore.save(savePatchOf(localSettings));
    saved = true;
    toast.success("Settings saved", "New chats and runs use these defaults.");
    setTimeout(() => (saved = false), 2000);
  }

  function resetSettings() {
    localSettings = { ...DEFAULTS };
    settingsStore.reset();
    toast.info("Settings reset to defaults");
  }

  async function onProviderChange() {
    localSettings = { ...localSettings, defaultModel: "" };
    const p = localSettings.defaultProvider;
    const { options, default: def } = await fetchModelsForProvider(p, p === "ollama" ? localSettings.ollamaEndpoint : undefined);
    const seed = def && options.some((o) => o.value === def) ? def : options[0]?.value;
    if (seed) localSettings = { ...localSettings, defaultModel: seed };
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) {
      toast.warning("Notifications not supported", "This browser has no desktop notifications.");
      return;
    }
    const result = await Notification.requestPermission();
    notifPermission = result;
    if (result === "granted") {
      localSettings = { ...localSettings, notificationsEnabled: true };
      toast.success("Notifications enabled", "Cortex will notify you when agents finish or fail.");
      showDesktopNotice(TEST_NOTICE);
    } else if (result === "denied") {
      localSettings = { ...localSettings, notificationsEnabled: false };
      toast.error("Notifications blocked", "Allow them in your browser's site settings.");
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
      const { pruned } = (await res.json()) as { pruned: number };
      toast.success(`Pruned ${pruned} old runs`);
    } catch (e) {
      toast.error("Prune failed", String(e));
    }
  }

  const NOTIFY_OPTIONS = [
    { value: "all", label: "Everything: finished and failed runs, approvals and questions waiting on you" },
    { value: "completions", label: "Finished and failed runs, and anything waiting on you (recommended)" },
    { value: "failures", label: "Failed runs only" },
    { value: "none", label: "Never" },
  ] as const;
  const parseNotify = (v: string): CortexSettings["notificationLevel"] =>
    v === "all" || v === "failures" || v === "none" ? v : "completions";
</script>

<svelte:head>
  <title>Settings · Cortex</title>
</svelte:head>

<!-- Opaque canvas: the engineering grid shows only on the header band (spec 5.2). -->
<CortexDeskShell class="bg-canvas">
  <div class="st-page" bind:this={scroller} onscroll={trackSection}>
    <div class="st-head">
      <PageHeader title="Settings" description="Defaults for new chats and runs, provider access, and notifications.">
        {#snippet actions()}
          <Button variant="ghost" onclick={resetSettings}>Reset to defaults</Button>
          <Button variant="primary" icon={saved ? "check" : undefined} onclick={saveSettings}>{saved ? "Saved" : "Save settings"}</Button>
        {/snippet}
      </PageHeader>
    </div>

    <div class="st-wrap">
      <nav class="st-nav" aria-label="Settings sections">
        {#each SETTINGS_SECTIONS as s (s.id)}
          <a href="#{s.id}" aria-current={activeSection === s.id ? "true" : undefined}>{s.label}</a>
        {/each}
      </nav>

      <div class="st-col">
        <SettingsGroup id="defaults" title="Defaults" description="Used by Beacon, new chats and the Lab builder until you pick something else.">
          <SettingsRow label="Provider" for="settings-default-provider">
            {#snippet help()}
              {#if providerKeyEnv}
                {providerLabelOf(localSettings.defaultProvider)} needs a key: <code>{providerKeyEnv}</code> in the server's environment, or one saved under Providers.
              {:else}
                Local and self-hosted providers need no key.
              {/if}
            {/snippet}
            {#snippet control()}
              <Select
                id="settings-default-provider"
                options={providerOptions}
                describedBy="settings-default-provider-hint"
                bind:value={localSettings.defaultProvider}
                onchange={onProviderChange}
              />
            {/snippet}
          </SettingsRow>
          <SettingsRow label="Model" for="settings-default-model">
            {#snippet help()}
              {#if modelsError}
                <span class="st-bad">{modelsError}</span>
              {:else if modelsNote}
                {modelsNote}
              {:else}
                Listed from the provider.
              {/if}
              {#if localSettings.defaultModel.trim()}
                <a class="st-link" href={modelHref(localSettings.defaultProvider, localSettings.defaultModel)}>Model details</a>
              {/if}
            {/snippet}
            {#snippet control()}
              {#if modelsLoading}
                <Select id="settings-default-model" options={[{ value: "", label: "Loading models…" }]} value="" disabled />
              {:else if modelOptions.length > 0}
                <Select
                  id="settings-default-model"
                  options={modelOptions}
                  describedBy="settings-default-model-hint"
                  bind:value={localSettings.defaultModel}
                />
              {:else}
                <Input
                  id="settings-default-model"
                  mono
                  placeholder="Model id"
                  describedBy="settings-default-model-hint"
                  bind:value={localSettings.defaultModel}
                />
              {/if}
            {/snippet}
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup id="providers" title="Providers" description="API keys for cloud providers: from the server's environment, or saved here.">
          <ProviderKeysPanel labelOf={providerLabelOf} onchange={checkProviderHealth} />
          <OllamaEndpointRow bind:value={localSettings.ollamaEndpoint} onapplied={checkProviderHealth} />
          <SettingsRow label="Cortex server">
            {#snippet help()}<span class="st-data">{CORTEX_SERVER_URL}</span>. To use another server, start with <code>CORTEX_URL=http://host:port bun cortex</code>.{/snippet}
            {#snippet control()}
              {#if serverHealth === "online"}
                <Status tone="done" label={versions.cortex ? `Connected · ${versions.cortex}` : "Connected"} />
              {:else if serverHealth === "offline"}
                <Status tone="failed" label="Offline" />
              {:else}
                <Status tone="idle" label="Checking…" />
              {/if}
            {/snippet}
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup id="web-search" title="Web search" description="API keys for the web-search tool's providers (Tavily, Brave, Serper, Keenable). DuckDuckGo instant answers need none.">
          <ProviderKeysPanel scope="web-search" labelOf={providerLabelOf} />
        </SettingsGroup>

        <SettingsGroup id="voice" title="Voice" description="Talk to the agent and have it read aloud. Browser engines need nothing installed; a server engine uses any OpenAI-compatible speech endpoint, local or cloud.">
          <VoiceSettingsPanel />
        </SettingsGroup>

        <SettingsGroup id="notifications" title="Notifications" description="Desktop notifications when agents finish or fail while Cortex is in the background.">
          <SettingsRow label="Desktop notifications">
            {#snippet help()}
              {#if notifPermission === "granted"}
                <span class="st-ok">Allowed in this browser.</span>
              {:else if notifPermission === "denied"}
                <span class="st-bad">Blocked: allow them in your browser's site settings.</span>
              {:else if notifPermission === "unsupported"}
                This browser has no desktop notifications.
              {:else}
                Not allowed yet. The browser asks once.
              {/if}
            {/snippet}
            {#snippet control()}
              {#if notifPermission === "granted"}
                <Button
                  size="sm"
                  onclick={() => showDesktopNotice(TEST_NOTICE)}
                >Send a test</Button>
              {:else}
                <Button size="sm" disabled={notifPermission === "unsupported"} onclick={requestNotificationPermission}>Allow notifications</Button>
              {/if}
            {/snippet}
          </SettingsRow>
          <SettingsRow label="Notify me about" for="settings-notify-level" description="Applies at once. Cortex stays quiet while its tab is in front and focused: the toasts and panels already show it.">
            {#snippet control()}
              <Select
                id="settings-notify-level"
                options={NOTIFY_OPTIONS}
                bind:value={() => localSettings.notificationLevel, (v) => {
                  const notificationLevel = parseNotify(v);
                  localSettings = { ...localSettings, notificationLevel };
                  // Applies at once: the notifier reads the saved level when an event fires.
                  settingsStore.save({ notificationLevel });
                }}
              />            {/snippet}
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup id="appearance" title="Appearance" description="These apply at once.">
          <SettingsRow label="Theme" for="settings-theme" description="Dark is the graphite bench; light is cool lab paper.">
            {#snippet control()}
              <Select
                id="settings-theme"
                options={THEME_OPTIONS}
                describedBy="settings-theme-hint"
                bind:value={() => $settingsStore.theme, (v) => settingsStore.save({ theme: parseTheme(v) })}
              />
            {/snippet}
          </SettingsRow>
          <SettingsRow
            label="Motion"
            for="settings-motion"
            description="Reduce stops the orb drift, the mark twinkle, the sonar ring and the flowing rail. Running work still shows by its status, the static rail and the glow."
          >
            {#snippet control()}
              <Select
                id="settings-motion"
                options={MOTION_OPTIONS}
                describedBy="settings-motion-hint"
                bind:value={() => $settingsStore.motion, (v) => settingsStore.save({ motion: parseMotion(v) })}
              />
            {/snippet}
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup id="storage" title="Storage">
          {#snippet body()}Run events are stored in <code>.cortex/cortex.db</code> (SQLite) under the server's working directory.{/snippet}
          <SettingsRow label="Keep runs for" for="settings-run-retention" description="Prune deletes runs older than this." wide>
            {#snippet control()}
              <div class="st-range">
                <input
                  id="settings-run-retention"
                  type="range"
                  min="1"
                  max="90"
                  aria-describedby="settings-run-retention-hint"
                  bind:value={localSettings.runRetentionDays}
                />
                <span class="st-data st-days">{localSettings.runRetentionDays} days</span>
                <Button size="sm" variant="danger" onclick={pruneOldRuns}>Prune now</Button>
              </div>
            {/snippet}
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup id="developer" title="Developer">
          <div class="st-switch"><Switch id="settings-debug" label="Debug mode" hint="Show extra event detail and verbose logging in the run view's Events tab." bind:checked={localSettings.debugMode} /></div>
          <div class="st-switch"><Switch id="settings-tooltips" label="Hover tooltips" hint="Help text on controls in the Lab, Runs and the command palette." bind:checked={localSettings.tooltipsEnabled} /></div>
          <SettingsRow label="Connect an app">
            {#snippet help()}Add <code>.withCortex()</code> to an agent, or set <code>CORTEX_URL={CORTEX_SERVER_URL}</code>, and its runs show up here.{/snippet}
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup id="about" title="About">
          <div class="st-about">
            <NeuralMark size={64} hero />
            <div>
              <div class="st-word"><span class="brand-grad">Cortex</span></div>
              <p class="st-about-line">The local desk for Reactive Agents</p>
              {#if versions.cortex}
                <dl class="st-versions">
                  <dt>Cortex</dt>
                  <dd>{versions.cortex}{#if versions.commit}{" "}<span class="st-commit">({versions.commit})</span>{/if}</dd>
                  {#if versions.framework}
                    <dt>Framework</dt>
                    <dd>{versions.framework}</dd>
                  {/if}
                </dl>
              {/if}
            </div>
          </div>
        </SettingsGroup>
      </div>
    </div>
  </div>
</CortexDeskShell>

<style>
  .st-page { position: relative; z-index: 1; height: 100%; min-height: 0; overflow-y: auto; scroll-behavior: smooth; }
  .st-head { max-width: 1044px; margin: 0 auto; }
  .st-wrap {
    max-width: 1044px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 32px;
    padding: 8px 32px 48px;
  }
  .st-nav { position: sticky; top: 16px; align-self: start; display: grid; gap: 2px; }
  .st-nav a {
    padding: 6px 10px;
    border-radius: var(--cortex-r-ctl);
    font-size: var(--cortex-t-sm);
    color: var(--cortex-text-2);
    text-decoration: none;
  }
  .st-nav a:hover { color: var(--cortex-text); background: var(--cortex-surface-1); }
  .st-nav a[aria-current="true"] { background: var(--cortex-surface-2); color: var(--cortex-text); font-weight: 500; }
  .st-col { display: grid; gap: 32px; min-width: 0; }
  .st-ok { color: var(--cortex-ok); }
  .st-bad { color: var(--cortex-bad); }
  .st-data { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }
  .st-link { margin-left: 6px; color: var(--cortex-accent); }
  .st-range { display: flex; align-items: center; gap: 10px; width: 100%; }
  .st-range input { flex: 1; min-width: 0; accent-color: var(--cortex-accent-fill); }
  .st-range input:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .st-days { width: 58px; text-align: right; color: var(--cortex-text); }
  .st-switch { padding: 12px 16px; }
  .st-about { display: flex; align-items: center; gap: 16px; padding: 16px; }
  .st-word { font-size: var(--cortex-t-xl); font-weight: 600; letter-spacing: -0.015em; line-height: var(--cortex-lh-tight); }
  .st-about-line { margin: 2px 0 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .st-versions { display: grid; grid-template-columns: auto auto; justify-content: start; gap: 2px 12px; margin: 8px 0 0; font-size: var(--cortex-t-xs); }
  .st-versions dt { color: var(--cortex-text-2); }
  .st-versions dd { margin: 0; font-family: var(--cortex-font-data); color: var(--cortex-text); }
  .st-commit { color: var(--cortex-text-2); }
  @media (max-width: 860px) {
    .st-wrap { grid-template-columns: minmax(0, 1fr); gap: 16px; padding: 8px 16px 40px; }
    .st-nav { position: static; display: flex; flex-wrap: wrap; }
  }
  @media (prefers-reduced-motion: reduce) { .st-page { scroll-behavior: auto; } }
</style>
