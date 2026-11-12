<script lang="ts">
  /**
   * AgentConfigPanel — comprehensive agent configuration form.
   *
   * Used by: BottomInputBar accordion, Lab Builder, Gateway creation form.
   * Binds bidirectionally to `config` prop. Owns the config, the section open/filter
   * state and the catalogs; each section renders from `agent-config/sections/`.
   */
  import { onMount, setContext, untrack } from "svelte";
  import "$lib/components/agent-config/agent-config.css";
  import { ACP_FLAT_CONTEXT, type AcpFlatContext } from "$lib/components/agent-config/flat-context.js";
  import ShellWorkspaceSection from "$lib/components/agent-config/sections/ShellWorkspaceSection.svelte";
  import FrameworkOptionsSection from "$lib/components/agent-config/sections/FrameworkOptionsSection.svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { settings } from "$lib/stores/settings.js";
  import type { AgentConfig } from "$lib/types/agent-config.js";
  import { defaultConfig } from "$lib/types/agent-config.js";
  import { syncVariables, sameVariableNames } from "$lib/template/sync-variables.js";
  import { loadProviders, PROVIDER_FALLBACK, type ProviderOption } from "$lib/providers.js";
  import { fetchModelsForProvider, type UiModelOption } from "$lib/framework-models.js";
  import { loadCapabilities, type CapabilityManifest } from "$lib/capabilities.js";
  import { builderToolPicks, shellPresetPicks, type CatalogToolRow, type ToolPick } from "$lib/builder-tool-picks.js";
  import { activeSectionIds, builderNavEntry, navEntryOfSection, sectionCopy, sectionVisible } from "$lib/agent-config-sections.js";
  import type { McpCatalogRow, PanelAgentConfig } from "$lib/components/agent-config/types.js";
  import AgentConfigHeader from "$lib/components/agent-config/AgentConfigHeader.svelte";
  import InferenceSection from "$lib/components/agent-config/sections/InferenceSection.svelte";
  import PersonaSection from "$lib/components/agent-config/sections/PersonaSection.svelte";
  import StrategySection from "$lib/components/agent-config/sections/StrategySection.svelte";
  import VariablesSection from "$lib/components/agent-config/sections/VariablesSection.svelte";
  import ToolsSection from "$lib/components/agent-config/sections/ToolsSection.svelte";
  import SubAgentsSection from "$lib/components/agent-config/sections/SubAgentsSection.svelte";
  import SkillsSection from "$lib/components/agent-config/sections/SkillsSection.svelte";
  import MemorySection from "$lib/components/agent-config/sections/MemorySection.svelte";
  import GuardrailsSection from "$lib/components/agent-config/sections/GuardrailsSection.svelte";
  import ExecutionSection from "$lib/components/agent-config/sections/ExecutionSection.svelte";
  import OutputSchemaSection from "$lib/components/agent-config/sections/OutputSchemaSection.svelte";
  import MetaToolsSection from "$lib/components/agent-config/sections/MetaToolsSection.svelte";
  import ReliabilitySection from "$lib/components/agent-config/sections/ReliabilitySection.svelte";
  import ObservabilitySection from "$lib/components/agent-config/sections/ObservabilitySection.svelte";

  export { type AgentConfig, defaultConfig };

  interface Props {
    config?: PanelAgentConfig;
    /** Whether to show all sections or just inference+strategy */
    compact?: boolean;
    /**
     * Master tools switch (chat sessions). Omit for builders where tools are always on.
     * `auto` = no explicit choice: tools are on exactly when something is selected.
     */
    toolsToggle?: { enabled: boolean; auto: boolean; onChange: (enabled: boolean) => void };
    /**
     * Lab builder: show only this section-nav entry (`BUILDER_NAV` id), its
     * sections flat and open, without the panel header (the Lab page carries
     * import / export and its own nav). Omit for the collapsible panel.
     */
    navSection?: string;
    /** Lab builder: open another section-nav entry (a cross-section link, e.g. approvals → Execution). */
    onNavigate?: (navEntryId: string) => void;
  }
  let { config = $bindable(defaultConfig() as PanelAgentConfig), compact = false, toolsToggle, navSection, onNavigate }: Props = $props();

  // Flat sections inside the Lab builder (read once by ConfigSection; the prop never changes for a mounted panel).
  const navMembers = $derived(navSection !== undefined ? builderNavEntry(navSection).sections : null);
  if (untrack(() => navSection !== undefined)) {
    setContext<AcpFlatContext>(ACP_FLAT_CONTEXT, { get single() { return (navMembers?.length ?? 0) <= 1; } });
  }
  /** Whether a section renders: the nav entry's members in the Lab builder, else the filter. */
  function shows(id: string): boolean {
    return navMembers ? navMembers.includes(id) : acpSectionVisible(id);
  }
  /** Open state: always open in the Lab builder. */
  function isOpen(id: string): boolean {
    return navMembers !== null || openSections.has(id);
  }

  // Section expand state
  let openSections = $state(new Set(["inference", "tools"]));
  function toggle(s: string) {
    const n = new Set(openSections);
    if (n.has(s)) n.delete(s); else n.add(s);
    openSections = n;
  }

  /** Filter + nav: reduce scroll-hunt in long builder forms (registry: agent-config-sections.ts). */
  let sectionFilter = $state("");

  function acpActiveSectionIds(): string[] {
    return activeSectionIds(compact);
  }

  function acpSectionVisible(id: string): boolean {
    return sectionVisible(id, sectionFilter, compact);
  }

  function acpExpandAll() {
    openSections = new Set(acpActiveSectionIds());
  }

  function acpCollapseAll() {
    openSections = new Set();
  }

  function acpScrollTo(id: string) {
    if (!acpSectionVisible(id)) return;
    const next = new Set(openSections);
    next.add(id);
    openSections = next;
    requestAnimationFrame(() => {
      document.getElementById(`acp-section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  /** Show a panel section from a link in another one: its nav entry in the Lab builder, else open and scroll. */
  function showSection(id: string) {
    const entry = navEntryOfSection(id);
    if (navMembers !== null) { if (entry) onNavigate?.(entry); } else acpScrollTo(id);
  }

  /** Model dropdown: `/api/models/:provider` + live Ollama tags when applicable. */
  let providerModels = $state<UiModelOption[]>([]);
  let modelsLoading = $state(false);
  let modelsError = $state<string | null>(null);
  let modelsNote = $state<string | null>(null);
  /** Ignores stale responses when the user switches provider before the prior fetch finishes. */
  let modelsLoadSeq = 0;

  async function loadModelsForProvider(p: string) {
    const seq = ++modelsLoadSeq;
    const snapshotModel = untrack(() => config.model);
    modelsLoading = true;
    modelsError = null;
    modelsNote = null;
    settings.init();
    const { options, default: def, error, note } = await fetchModelsForProvider(
      p,
      p === "ollama" ? (settings.get().ollamaEndpoint ?? undefined) : undefined,
    );
    if (seq !== modelsLoadSeq) return;
    providerModels = options;
    modelsError = error ?? null;
    modelsNote = note ?? null;
    modelsLoading = false;
    if (options.length > 0 && !snapshotModel.trim()) {
      // Seed the framework's current default (not just options[0] — the default
      // is not always first in the preset list).
      const seed = def && options.some((o) => o.value === def) ? def : options[0]!.value;
      config = { ...config, model: seed };
    }
  }

  $effect(() => {
    const p = config.provider;
    void loadModelsForProvider(p);
  });

  let providerList = $state<readonly ProviderOption[]>(PROVIDER_FALLBACK);
  $effect(() => {
    void loadProviders().then((list) => { providerList = list; });
  });

  // Capability tools from the cortex catalog API, then the shell toolsets (git, workspace);
  // meta-tools live in the Meta tools section.
  let AVAILABLE_TOOLS = $state<ToolPick[]>([]);
  let shellPresets = $state<Record<string, string[]>>({});
  onMount(async () => {
    try {
      const [res, presets] = await Promise.all([
        fetch(`${CORTEX_SERVER_URL}/api/tools/catalog`),
        fetch(`${CORTEX_SERVER_URL}/api/tools/shell-presets`)
          .then(async (r): Promise<Record<string, string[]>> => (r.ok ? ((await r.json()) as Record<string, string[]>) : {}))
          .catch((): Record<string, string[]> => ({})),
      ]);
      shellPresets = presets;
      if (res.ok) AVAILABLE_TOOLS = [...builderToolPicks((await res.json()) as CatalogToolRow[]), ...shellPresetPicks(presets)];
    } catch (err) {
      console.warn("Failed to load tools catalog:", err);
      // Fallback to empty (users can still manually enter tool names)
    }
  });

  // Fallback list (used only until the capability manifest loads / if it fails).
  // The live option set comes from GET /api/capabilities so new framework
  // strategies (blueprint/code-action/direct/…) appear here automatically.
  const STRATEGY_FALLBACK = [
    { value: "reactive",             label: "ReAct",                desc: "Think→Act→Observe loop. Best for most tasks." },
    { value: "plan-execute-reflect", label: "Plan–Execute–Reflect", desc: "Creates a structured plan first. Good for multi-step tasks." },
    { value: "tree-of-thought",      label: "Tree of Thought",      desc: "Explores multiple paths. Good for creative/analytical problems." },
    { value: "reflexion",            label: "Reflexion",            desc: "Self-critiques and improves across attempts." },
    { value: "adaptive",             label: "Adaptive",             desc: "Selects strategy automatically based on task type." },
  ];

  let capManifest = $state<CapabilityManifest | null>(null);
  onMount(() => {
    loadCapabilities()
      .then((m) => (capManifest = m))
      .catch((err) => console.warn("Failed to load capability manifest:", err));
  });

  // Saved/loaded configs may predate the rawConfig field; ensure it exists so
  // the generic renderer can bind to it.
  $effect(() => {
    if (config && !config.rawConfig) config.rawConfig = {};
  });

  const STRATEGIES = $derived(
    capManifest
      ? capManifest.strategies.map((s) => ({ value: s.name, label: s.label, desc: s.description }))
      : STRATEGY_FALLBACK,
  );

  const acpStrategyLabel = $derived(STRATEGIES.find((s) => s.value === config.strategy)?.label ?? config.strategy);

  const acpFilterEmpty = $derived(
    !compact &&
      sectionFilter.trim() !== "" &&
      acpActiveSectionIds().every((id) => !acpSectionVisible(id)),
  );
  // ── JSON import / export ───────────────────────────────────────────────
  let fileInput = $state<HTMLInputElement | null>(null);

  function exportConfig() {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cortex-agent-config-${config.agentName || "untitled"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadExample() {
    const example = defaultConfig();
    example.agentName = "my-research-agent";
    example.systemPrompt = "You are a thorough research assistant. Always cite sources.";
    example.strategy = "plan-execute-reflect";
    example.tools = ["web-search", "file-write"];
    example.memory = { working: true, episodic: true, semantic: false };
    const blob = new Blob([JSON.stringify(example, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cortex-agent-example.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileImport(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as Partial<PanelAgentConfig>;
        config = { ...(defaultConfig() as PanelAgentConfig), ...parsed };
        toast.success("Config imported", file.name);
      } catch {
        toast.error("Invalid config JSON", file.name);
      }
    };
    reader.readAsText(file);
    if (fileInput) fileInput.value = "";
  }

  let mcpCatalog = $state<McpCatalogRow[]>([]);

  async function loadMcpCatalog() {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/mcp-servers`);
      if (!res.ok) return;
      mcpCatalog = (await res.json()) as McpCatalogRow[];
    } catch {
      mcpCatalog = [];
    }
  }

  // Reload the MCP catalog whenever the "tools" accordion section is opened.
  // This ensures that servers imported (or tools refreshed) in the Tools tab are
  // immediately visible without requiring a manual "↻ Refresh list" click.
  $effect(() => {
    if (shows("tools") && isOpen("tools")) {
      void loadMcpCatalog();
    }
  });

  // ── Template variables ───────────────────────────────────────────────────
  // Keep `config.variables` in sync with the `{{tokens}}` present across the
  // config automatically — no manual "Rescan". New tokens are added, removed
  // tokens drop, and existing enrichment is preserved by name. Guarded on the
  // name-set so editing a variable's type/default (same names) never re-syncs.
  $effect(() => {
    const next = syncVariables(config);
    if (!sameVariableNames(config.variables ?? [], next)) {
      config = { ...config, variables: next };
    }
  });
</script>


<!-- Hidden file input for JSON import -->
<input
  bind:this={fileInput}
  type="file"
  accept=".json,application/json"
  class="hidden"
  onchange={handleFileImport}
/>

<div class="agent-config-panel">

  {#if navMembers === null}
    <!-- ── Header: import / export, section filter and jump nav ─────────── -->
    <AgentConfigHeader
      {fileInput}
      {compact}
      bind:sectionFilter
      {openSections}
      {acpFilterEmpty}
      {acpActiveSectionIds}
      {acpSectionVisible}
      acpSectionCopy={sectionCopy}
      {acpScrollTo}
      {acpExpandAll}
      {acpCollapseAll}
      {exportConfig}
      {downloadExample}
    />
  {/if}

  {#if shows("inference")}
    <InferenceSection bind:config open={isOpen("inference")} onToggle={() => toggle("inference")}
      {providerList} {providerModels} {modelsLoading} {modelsError} {modelsNote} {loadModelsForProvider} />
  {/if}

  {#if shows("persona")}
    <PersonaSection bind:config open={isOpen("persona")} onToggle={() => toggle("persona")} />
  {/if}

  {#if shows("strategy")}
    <StrategySection bind:config open={isOpen("strategy")} onToggle={() => toggle("strategy")}
      strategies={STRATEGIES} strategyLabel={acpStrategyLabel} manifest={capManifest} splitFramework={navMembers !== null} />
  {/if}

  {#if shows("variables")}
    <VariablesSection bind:config open={isOpen("variables")} onToggle={() => toggle("variables")} />
  {/if}

  {#if !compact && shows("tools")}
    <ToolsSection bind:config open={isOpen("tools")} onToggle={() => toggle("tools")}
      {toolsToggle} tools={AVAILABLE_TOOLS} {shellPresets} {mcpCatalog} {loadMcpCatalog} splitShell={navMembers !== null} onShowSection={showSection} />
  {/if}

  {#if navMembers?.includes("shell")}
    <ShellWorkspaceSection bind:config open onToggle={() => {}} {shellPresets} />
  {/if}

  {#if navMembers === null && !compact && (["subagents","skills","memory","guardrails","execution","metatools","reliability","observability"].some(acpSectionVisible))}
    <div class="acp-divider" role="separator"><span>More options</span></div>
  {/if}

  {#if !compact && shows("subagents")}
    <SubAgentsSection bind:config open={isOpen("subagents")} onToggle={() => toggle("subagents")} />
  {/if}

  {#if !compact && shows("skills")}
    <SkillsSection bind:config open={isOpen("skills")} onToggle={() => toggle("skills")} />
  {/if}

  {#if shows("memory")}
    <MemorySection bind:config open={isOpen("memory")} onToggle={() => toggle("memory")} />
  {/if}

  {#if shows("guardrails")}
    <GuardrailsSection bind:config open={isOpen("guardrails")} onToggle={() => toggle("guardrails")} />
  {/if}

  {#if shows("execution")}
    <ExecutionSection bind:config open={isOpen("execution")} onToggle={() => toggle("execution")} />
  {/if}

  {#if shows("outputschema")}
    <OutputSchemaSection bind:config open={isOpen("outputschema")} onToggle={() => toggle("outputschema")} />
  {/if}

  {#if shows("metatools")}
    <MetaToolsSection bind:config open={isOpen("metatools")} onToggle={() => toggle("metatools")} />
  {/if}

  {#if shows("reliability")}
    <ReliabilitySection bind:config open={isOpen("reliability")} onToggle={() => toggle("reliability")} />
  {/if}

  {#if shows("observability")}
    <ObservabilitySection bind:config open={isOpen("observability")} onToggle={() => toggle("observability")} />
  {/if}

  {#if navMembers?.includes("framework")}
    <FrameworkOptionsSection bind:config open onToggle={() => {}} manifest={capManifest} />
  {/if}

</div>
