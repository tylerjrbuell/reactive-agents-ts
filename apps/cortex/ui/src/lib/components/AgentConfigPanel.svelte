<script lang="ts">
  /**
   * AgentConfigPanel — comprehensive agent configuration form.
   *
   * Used by: BottomInputBar accordion, Lab Builder, Gateway creation form.
   * Binds bidirectionally to `config` prop.
   */
  import { onMount, untrack } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { settings } from "$lib/stores/settings.js";
  import type { AgentConfig, CortexAgentToolConfig } from "$lib/types/agent-config.js";
  import { defaultConfig } from "$lib/types/agent-config.js";
  import { formatTaskContextLines, parseTaskContextLines } from "$lib/task-context-lines.js";
  import { fetchModelsForProvider, type UiModelOption } from "$lib/framework-models.js";

  export { type AgentConfig, defaultConfig };
  type PanelAgentConfig = AgentConfig & {
    maxTokens: number;
    timeout: number;
    retryPolicy: { enabled: boolean; maxRetries: number; backoffMs: number };
    cacheTimeout: number;
    progressCheckpoint: number;
    metaTools: { enabled: boolean; brief: boolean; find: boolean; pulse: boolean; recall: boolean; harnessSkill: boolean };
    fallbacks: { enabled: boolean; providers: string[]; errorThreshold: number };
    observabilityVerbosity: "off" | "minimal" | "normal" | "verbose";
    mcpServerIds: string[];
    agentTools: CortexAgentToolConfig[];
    dynamicSubAgents: { enabled: boolean; maxIterations: number };
    skills: { paths: string[]; evolution?: { mode?: string; refinementThreshold?: number; rollbackOnRegression?: boolean } };
  };

  interface Props {
    config?: PanelAgentConfig;
    /** Whether to show all sections or just inference+strategy */
    compact?: boolean;
  }
  let { config = $bindable(defaultConfig() as PanelAgentConfig), compact = false }: Props = $props();

  // Section expand state
  let openSections = $state(new Set(["inference", "strategy", "tools"]));
  function toggle(s: string) {
    const n = new Set(openSections);
    if (n.has(s)) n.delete(s); else n.add(s);
    openSections = n;
  }

  /** Filter + nav: reduce scroll-hunt in long builder forms */
  let sectionFilter = $state("");

  const ACP_IDS_FULL = [
    "inference",
    "persona",
    "strategy",
    "tools",
    "subagents",
    "skills",
    "memory",
    "guardrails",
    "execution",
    "metatools",
    "reliability",
    "observability",
  ] as const;

  function acpActiveSectionIds(): string[] {
    if (compact) {
      return ACP_IDS_FULL.filter((id) => id !== "tools" && id !== "subagents" && id !== "skills");
    }
    return [...ACP_IDS_FULL];
  }

  function acpSectionCopy(id: string): { label: string; keywords: string } {
    const m: Record<string, { label: string; keywords: string }> = {
      inference: {
        label: "Inference",
        keywords: "llm provider model temperature tokens system prompt task context health anthropic openai gemini ollama litellm test",
      },
      persona: { label: "Persona", keywords: "role tone traits response style behaviour face" },
      strategy: {
        label: "Reasoning",
        keywords: "strategy react plan execute tot tree reflexion adaptive iterations min max verification reflect runtime semantic entropy quality",
      },
      tools: {
        label: "Tools",
        keywords: "web search file read write code mcp registry spawn dynamic sub agent construction shell terminal host execute risk allowlist",
      },
      subagents: { label: "Sub-agents", keywords: "local remote a2a url hub delegation researcher" },
      skills: { label: "Skills", keywords: "living skill.md evolution path directory agentskills auto awesome" },
      memory: { label: "Memory", keywords: "working episodic semantic context synthesis ics account tree" },
      guardrails: { label: "Guardrails", keywords: "injection pii toxicity security threshold" },
      execution: { label: "Execution", keywords: "timeout retry cache checkpoint progress ttl timer" },
      metatools: { label: "Meta tools", keywords: "conductor brief find pulse recall harness suite wand stars" },
      reliability: { label: "Reliability", keywords: "fallback provider errors shield backup" },
      observability: { label: "Observability", keywords: "metrics dashboard verbosity monitoring logs" },
    };
    return m[id] ?? { label: id, keywords: id };
  }

  function acpSectionVisible(id: string): boolean {
    if (!acpActiveSectionIds().includes(id)) return false;
    const q = sectionFilter.trim().toLowerCase();
    if (!q) return true;
    const { label, keywords } = acpSectionCopy(id);
    return label.toLowerCase().includes(q) || keywords.includes(q) || id.includes(q);
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

  let taskContextLinesDraft = $state("");
  let lastTaskContextSig = $state("");
  $effect(() => {
    const sig = JSON.stringify(config.taskContext ?? {});
    if (sig !== lastTaskContextSig) {
      lastTaskContextSig = sig;
      taskContextLinesDraft = formatTaskContextLines(config.taskContext ?? {});
    }
  });

  function commitTaskContextDraft() {
    const next = parseTaskContextLines(taskContextLinesDraft);
    lastTaskContextSig = JSON.stringify(next);
    config = { ...config, taskContext: next };
  }

  function parseSkillPathsLines(s: string): string[] {
    return s.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  }
  function formatSkillPathsLines(paths: string[]): string {
    return paths.join("\n");
  }

  let skillsPathsDraft = $state("");
  let lastSkillsPathsSig = $state("");
  $effect(() => {
    const sig = JSON.stringify(config.skills?.paths ?? []);
    if (sig !== lastSkillsPathsSig) {
      lastSkillsPathsSig = sig;
      skillsPathsDraft = formatSkillPathsLines(config.skills?.paths ?? []);
    }
  });

  function commitSkillsPathsDraft() {
    const paths = parseSkillPathsLines(skillsPathsDraft);
    lastSkillsPathsSig = JSON.stringify(paths);
    config = { ...config, skills: { ...config.skills, paths } };
  }

  /** Model dropdown: `/api/models/framework/:provider` + live Ollama tags when applicable. */
  let providerModels = $state<UiModelOption[]>([]);
  let modelsLoading = $state(false);
  let modelsError = $state<string | null>(null);
  /** Ignores stale responses when the user switches provider before the prior fetch finishes. */
  let modelsLoadSeq = 0;

  async function loadModelsForProvider(p: string) {
    const seq = ++modelsLoadSeq;
    const snapshotModel = untrack(() => config.model);
    modelsLoading = true;
    modelsError = null;
    settings.init();
    const { options, error } = await fetchModelsForProvider(
      p,
      p === "ollama" ? (settings.get().ollamaEndpoint ?? undefined) : undefined,
    );
    if (seq !== modelsLoadSeq) return;
    providerModels = options;
    modelsError = error ?? null;
    modelsLoading = false;
    if (options.length > 0 && !snapshotModel.trim()) {
      config = { ...config, model: options[0]!.value };
    }
  }

  $effect(() => {
    const p = config.provider;
    void loadModelsForProvider(p);
  });

  const modelOptionsForSelect = $derived.by(() => {
    const cur = config.model.trim();
    const base = providerModels;
    if (cur && !base.some((m) => m.value === cur)) {
      return [{ value: cur, label: `${cur} (custom)` }, ...base];
    }
    return base;
  });

  const PROVIDERS = ["anthropic", "openai", "gemini", "ollama", "litellm", "test"] as const;

  const AVAILABLE_TOOLS = [
    { id: "web-search",   label: "Web Search",   icon: "search" },
    { id: "http-get",     label: "HTTP GET",     icon: "link" },
    { id: "file-read",    label: "File Read",    icon: "folder_open" },
    { id: "file-write",   label: "File Write",   icon: "edit_document" },
    { id: "code-execute", label: "Code Execute", icon: "terminal" },
    { id: "checkpoint",   label: "Checkpoint",   icon: "bookmark_added" },
    { id: "recall",       label: "Recall",       icon: "psychology" },
    { id: "find",         label: "Find",         icon: "manage_search" },
  ];

  const STRATEGIES = [
    { value: "reactive",             label: "ReAct",                desc: "Think→Act→Observe loop. Best for most tasks." },
    { value: "plan-execute-reflect", label: "Plan–Execute–Reflect", desc: "Creates a structured plan first. Good for multi-step tasks." },
    { value: "tree-of-thought",      label: "Tree of Thought",      desc: "Explores multiple paths. Good for creative/analytical problems." },
    { value: "reflexion",            label: "Reflexion",            desc: "Self-critiques and improves across attempts." },
    { value: "adaptive",             label: "Adaptive",             desc: "Selects strategy automatically based on task type." },
  ];

  const acpStrategyLabel = $derived(STRATEGIES.find((s) => s.value === config.strategy)?.label ?? config.strategy);

  const acpFilterEmpty = $derived(
    !compact &&
      sectionFilter.trim() !== "" &&
      acpActiveSectionIds().every((id) => !acpSectionVisible(id)),
  );
  const GUARDRAIL_FIELDS = [
    { key: "injectionThreshold", label: "Injection Detection" },
    { key: "piiThreshold", label: "PII Detection" },
    { key: "toxicityThreshold", label: "Toxicity Filter" },
  ] as const;

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

  // ── Helpers ────────────────────────────────────────────────────────────
  function setProvider(p: string) {
    config = { ...config, provider: p, model: "" };
  }

  function toggleTool(id: string) {
    const tools = config.tools.includes(id)
      ? config.tools.filter((t) => t !== id)
      : [...config.tools, id];
    config = { ...config, tools };
  }

  /** Host shell opt-in adds `shell-execute` at run time even if not in `config.tools`. */
  const toolCountForBadges = $derived.by(() => {
    const names = new Set(config.tools);
    if (config.terminalTools) names.add("shell-execute");
    return names.size;
  });

  type McpCatalogRow = {
    serverId: string;
    name: string;
    tools: { toolName: string; description?: string }[];
  };
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
    if (openSections.has("tools")) {
      void loadMcpCatalog();
    }
  });

  /**
   * Derive the set of MCP server IDs required by the given tool selection.
   * Returns ALL server IDs that have at least one tool in `tools` — does not
   * filter against the existing `config.mcpServerIds` so adding a tool from a
   * new server always wires that server into the run.
   */
  function deriveMcpServerIds(tools: string[], catalog: McpCatalogRow[]): string[] {
    const ids = new Set<string>();
    for (const s of catalog) {
      if (s.tools.some((t) => tools.includes(t.toolName))) ids.add(s.serverId);
    }
    return [...ids];
  }

  function toggleMcpRegistryTool(serverId: string, fullToolName: string) {
    let tools = [...config.tools];
    if (tools.includes(fullToolName)) {
      tools = tools.filter((t) => t !== fullToolName);
    } else {
      tools.push(fullToolName);
    }
    const mcpServerIds = deriveMcpServerIds(tools, mcpCatalog);
    // Safety: if catalog hasn't loaded yet, keep the server that owns this tool
    if (mcpServerIds.length === 0 && tools.includes(fullToolName) && !mcpServerIds.includes(serverId)) {
      mcpServerIds.push(serverId);
    }
    config = { ...config, tools, mcpServerIds };
  }

  function addLocalAgentTool() {
    const base = defaultConfig();
    const n = (config.agentTools ?? base.agentTools).length + 1;
    const entry: CortexAgentToolConfig = {
      kind: "local",
      toolName: `researcher_${n}`,
      agent: { name: `Researcher ${n}`, maxIterations: 8, tools: ["web-search"] },
    };
    config = { ...config, agentTools: [...(config.agentTools ?? base.agentTools), entry] };
  }

  function addRemoteAgentTool() {
    const base = defaultConfig();
    const entry: CortexAgentToolConfig = {
      kind: "remote",
      toolName: `remote_agent_${(config.agentTools ?? base.agentTools).length + 1}`,
      remoteUrl: "http://127.0.0.1:8000",
    };
    config = { ...config, agentTools: [...(config.agentTools ?? base.agentTools), entry] };
  }

  function removeAgentToolAt(index: number) {
    const base = defaultConfig();
    const agentTools = [...(config.agentTools ?? base.agentTools)];
    agentTools.splice(index, 1);
    config = { ...config, agentTools };
  }

  function patchAgentTool(index: number, next: CortexAgentToolConfig) {
    const base = defaultConfig();
    const agentTools = [...(config.agentTools ?? base.agentTools)];
    agentTools[index] = next;
    config = { ...config, agentTools };
  }
</script>

<!-- Hidden file input for JSON import -->
<input
  bind:this={fileInput}
  type="file"
  accept=".json,application/json"
  class="hidden"
  onchange={handleFileImport}
/>

<div class="agent-config-panel space-y-3 text-[11px] font-sans">

  <!-- ── Header: blueprint summary + IO ───────────────────────────────── -->
  <header class="acp-header rounded-xl border border-[var(--cortex-border)] bg-[color-mix(in_srgb,var(--cortex-surface)_92%,transparent)] px-3 py-2.5 shadow-[0_1px_0_color-mix(in_srgb,var(--ra-violet)_12%,transparent)]">
    <div class="flex flex-wrap items-start gap-2 gap-y-2">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="acp-header-mark h-6 w-1 shrink-0 rounded-full bg-gradient-to-b from-primary to-secondary opacity-90" aria-hidden="true"></span>
          <div>
            <h2 class="font-display text-sm font-semibold tracking-tight text-[var(--cortex-text)]">Agent blueprint</h2>
            <p class="text-[10px] text-[var(--cortex-text-muted)] leading-snug max-w-[28rem]">
              Compose how this agent thinks, what it can call, and how it fails safe. Changes bind live to the parent form.
            </p>
          </div>
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5" role="status" aria-live="polite">
          <span class="acp-chip font-mono text-[10px]" title="Display name">{config.agentName?.trim() || "Untitled agent"}</span>
          <span class="acp-chip font-mono text-[10px]" title="Provider">{config.provider}</span>
          <span class="acp-chip acp-chip--cyan font-mono text-[10px] max-w-[200px] truncate" title="Model">{config.model?.trim() || "—"}</span>
          <span class="acp-chip font-mono text-[10px]" title="Reasoning strategy">{acpStrategyLabel}</span>
          <span class="acp-chip font-mono text-[10px]" title="Built-in + MCP tool names (host shell counts as shell-execute)">{toolCountForBadges} tool{toolCountForBadges === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-1 shrink-0">
        <button type="button" onclick={() => fileInput?.click()}
          class="acp-toolbar-btn"
          title="Import config from JSON">
          <span class="material-symbols-outlined text-[14px] opacity-80" aria-hidden="true">upload_file</span>
          <span>Import</span>
        </button>
        <button type="button" onclick={exportConfig}
          class="acp-toolbar-btn"
          title="Export config as JSON">
          <span class="material-symbols-outlined text-[14px] opacity-80" aria-hidden="true">download</span>
          <span>Export</span>
        </button>
        <button type="button" onclick={downloadExample}
          class="acp-toolbar-btn acp-toolbar-btn--muted"
          title="Download example config">
          <span class="material-symbols-outlined text-[14px] opacity-70" aria-hidden="true">help_outline</span>
          <span>Example</span>
        </button>
        <span class="w-px h-5 bg-[var(--cortex-border)] mx-0.5 hidden sm:block" aria-hidden="true"></span>
        <button type="button" onclick={acpExpandAll} class="acp-toolbar-btn acp-toolbar-btn--ghost" title="Open every section">Expand all</button>
        <button type="button" onclick={acpCollapseAll} class="acp-toolbar-btn acp-toolbar-btn--ghost" title="Close every section">Collapse all</button>
      </div>
    </div>
    {#if !compact}
      <div class="mt-3 pt-2 border-t border-[var(--cortex-border)]">
        <label class="sr-only" for="acp-section-filter">Filter configuration sections</label>
        <div class="relative">
          <span class="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-[var(--cortex-text-muted)] opacity-60" aria-hidden="true">filter_alt</span>
          <input
            id="acp-section-filter"
            type="search"
            bind:value={sectionFilter}
            placeholder="Filter sections (e.g. guardrails, mcp, timeout)…"
            autocomplete="off"
            class="config-input acp-filter-input pl-9" />
        </div>
        <nav class="cortex-no-scrollbar mt-2 flex gap-1 overflow-x-auto pb-0.5" aria-label="Jump to section">
          {#each acpActiveSectionIds() as sid (sid)}
            {#if acpSectionVisible(sid)}
              <button
                type="button"
                onclick={() => acpScrollTo(sid)}
                class="acp-nav-pill shrink-0"
                class:acp-nav-pill--active={openSections.has(sid)}>
                {acpSectionCopy(sid).label}
              </button>
            {/if}
          {/each}
        </nav>
        {#if acpFilterEmpty}
          <p class="mt-2 text-center font-mono text-[10px] text-[var(--cortex-text-muted)]" role="status">
            No sections match “{sectionFilter.trim()}”. Clear the filter or try another keyword.
          </p>
        {/if}
      </div>
    {/if}
  </header>

  <!-- ── Section: Inference ────────────────────────────────────────────── -->
  {#if acpSectionVisible("inference")}
  <div id="acp-section-inference" class="acp-section border border-[var(--cortex-border)] rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--cortex-surface-low)_55%,transparent)]">
    <button type="button"
      id="acp-head-inference"
      class="acp-section-trigger w-full flex items-center gap-2 px-3 py-2.5 border-0 cursor-pointer text-left"
      aria-expanded={openSections.has("inference")}
      aria-controls="acp-panel-inference"
      onclick={() => toggle("inference")}>
      <span class="material-symbols-outlined text-[15px] text-primary/80 shrink-0" aria-hidden="true">memory</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Inference</span>
      <span class="ml-auto material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] transition-transform duration-200 {openSections.has('inference') ? '' : '-rotate-90'}" aria-hidden="true">expand_more</span>
    </button>
    {#if openSections.has("inference")}
      <div id="acp-panel-inference" class="acp-section-body px-3 py-3 space-y-3 border-t border-[var(--cortex-border)]" role="region" aria-labelledby="acp-head-inference">
        <!-- Agent name (optional) -->
        <div>
          <label for="agent-name" class="config-label">Agent Name <span class="text-outline/30 normal-case font-normal">(optional)</span></label>
          <input id="agent-name" bind:value={config.agentName} placeholder="e.g. research-assistant"
            class="config-input" />
        </div>
        <!-- Provider + Model -->
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label for="provider-select" class="config-label">Provider</label>
            <select id="provider-select" value={config.provider} onchange={(e) => setProvider((e.target as HTMLSelectElement).value)}
              class="config-input">
              {#each PROVIDERS as p}<option value={p}>{p}</option>{/each}
            </select>
          </div>
          <div>
            <label class="config-label">Model
              <button type="button" onclick={() => loadModelsForProvider(config.provider)}
                class="ml-1 text-secondary/60 hover:text-secondary bg-transparent border-0 cursor-pointer p-0 text-[9px]">
                {modelsLoading ? "…" : "↻"}
              </button>
            </label>
            {#if modelsError}
              <div class="text-[9px] font-mono text-error/60 mb-1">{modelsError}</div>
              <input bind:value={config.model} placeholder="Type model name…" class="config-input" />
            {:else if modelsLoading}
              <div class="config-input text-outline/40">Loading…</div>
            {:else if modelOptionsForSelect.length > 0}
              <select bind:value={config.model} class="config-input">
                {#each modelOptionsForSelect as m}<option value={m.value}>{m.label}</option>{/each}
              </select>
            {:else}
              <input bind:value={config.model} placeholder="Model name…" class="config-input" />
            {/if}
          </div>
        </div>
        <!-- Custom model override -->
        {#if modelOptionsForSelect.length > 0}
          <div>
            <label for="custom-model-override" class="config-label">Custom model override <span class="text-outline/30 normal-case font-normal">(optional — overrides dropdown)</span></label>
            <input id="custom-model-override" bind:value={config.model} placeholder="e.g. claude-opus-4-6"
              class="config-input" />
          </div>
        {/if}
        <!-- Temperature + Max Tokens -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="temperature-range" class="config-label flex items-center justify-between">
              Temperature
              <span class="font-mono text-primary tabular-nums">{config.temperature.toFixed(2)}</span>
            </label>
            <input id="temperature-range" type="range" min="0" max="1" step="0.05"
              bind:value={config.temperature}
              class="w-full accent-primary mt-1" />
            <div class="flex justify-between text-[8px] font-mono text-outline/30 mt-0.5">
              <span>0 — deterministic</span><span>1 — creative</span>
            </div>
          </div>
          <div>
            <label for="max-tokens" class="config-label">Max Tokens <span class="text-outline/30 normal-case font-normal">(0 = default)</span></label>
            <input id="max-tokens" type="number" min="0" max="200000" step="256"
              bind:value={config.maxTokens}
              class="config-input" />
          </div>
        </div>
        <!-- System prompt -->
        <div>
          <label for="system-prompt" class="config-label">System Prompt <span class="text-outline/30 normal-case font-normal">(optional)</span></label>
          <textarea id="system-prompt" bind:value={config.systemPrompt}
            placeholder="Custom instructions prepended to every run…"
            rows="3"
            class="config-input resize-none leading-relaxed"></textarea>
        </div>
        <div>
          <label for="task-context-lines" class="config-label">Task context <span class="text-outline/30 normal-case font-normal">(`withTaskContext` — one key=value per line)</span></label>
          <textarea id="task-context-lines"
            bind:value={taskContextLinesDraft}
            oninput={commitTaskContextDraft}
            onblur={commitTaskContextDraft}
            placeholder={"project=my-app\nenvironment=staging"}
            rows="3"
            class="config-input resize-none leading-relaxed font-mono text-[10px]"></textarea>
        </div>
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={config.healthCheck}
            onchange={() => (config = { ...config, healthCheck: !config.healthCheck })}
            class="accent-primary w-3.5 h-3.5" />
          <div>
            <div class="font-mono text-[10px] text-on-surface/80">Enable health check</div>
            <div class="font-mono text-[9px] text-outline/40">Calls `withHealthCheck()` so `agent.health()` is available after build</div>
          </div>
        </label>
      </div>
    {/if}
  </div>
  {/if}

  <!-- ── Section: Persona ────────────────────────────────────────────── -->
  {#if acpSectionVisible("persona")}
  <div id="acp-section-persona" class="acp-section border border-[var(--cortex-border)] rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--cortex-surface-low)_55%,transparent)]">
    <button type="button"
      id="acp-head-persona"
      class="acp-section-trigger w-full flex items-center gap-2 px-3 py-2.5 border-0 cursor-pointer text-left"
      aria-expanded={openSections.has("persona")}
      aria-controls="acp-panel-persona"
      onclick={() => toggle("persona")}>
      <span class="material-symbols-outlined text-[15px] text-secondary/85 shrink-0" aria-hidden="true">face</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Persona</span>
      <span class="ml-2 rounded-md bg-[color-mix(in_srgb,var(--ra-cyan)_14%,transparent)] px-1.5 py-0.5 text-[9px] font-mono text-secondary">
        {config.persona?.enabled ? (config.persona.role?.trim() || "custom") : "off"}
      </span>
      <span class="ml-auto material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] transition-transform duration-200 {openSections.has('persona') ? '' : '-rotate-90'}" aria-hidden="true">expand_more</span>
    </button>
    {#if openSections.has("persona")}
      <div id="acp-panel-persona" class="acp-section-body px-3 py-3 space-y-3 border-t border-[var(--cortex-border)]" role="region" aria-labelledby="acp-head-persona">
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox"
            checked={config.persona?.enabled ?? false}
            onchange={() => (config = { ...config, persona: { ...(config.persona ?? { role: "", tone: "concise", traits: "", responseStyle: "prose" }), enabled: !(config.persona?.enabled ?? false) } })}
            class="accent-primary w-3.5 h-3.5" />
          <div>
            <div class="font-mono text-[10px] text-on-surface/80">Enable persona</div>
            <div class="font-mono text-[9px] text-outline/40">Shape agent behaviour with a named role and communication style</div>
          </div>
        </label>
        {#if config.persona?.enabled}
          <div>
            <label for="persona-role" class="config-label">Role <span class="text-outline/30 normal-case font-normal">(e.g. research assistant, code reviewer)</span></label>
            <input
              id="persona-role"
              value={config.persona.role}
              oninput={(e) => (config = { ...config, persona: { ...config.persona, role: (e.target as HTMLInputElement).value } })}
              placeholder="e.g. senior research analyst"
              class="config-input" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="persona-tone" class="config-label">Tone</label>
              <select
                id="persona-tone"
                value={config.persona.tone}
                onchange={(e) => (config = { ...config, persona: { ...config.persona, tone: (e.target as HTMLSelectElement).value as AgentConfig["persona"]["tone"] } })}
                class="config-input">
                <option value="concise">Concise — brief, direct</option>
                <option value="formal">Formal — professional</option>
                <option value="casual">Casual — conversational</option>
                <option value="technical">Technical — precise, expert</option>
              </select>
            </div>
            <div>
              <label for="persona-response-style" class="config-label">Response Style</label>
              <select
                id="persona-response-style"
                value={config.persona.responseStyle}
                onchange={(e) => (config = { ...config, persona: { ...config.persona, responseStyle: (e.target as HTMLSelectElement).value as AgentConfig["persona"]["responseStyle"] } })}
                class="config-input">
                <option value="prose">Prose — narrative paragraphs</option>
                <option value="bullet-points">Bullets — scannable lists</option>
                <option value="structured">Structured — headers + sections</option>
              </select>
            </div>
          </div>
          <div>
            <label for="persona-traits" class="config-label">Traits <span class="text-outline/30 normal-case font-normal">(comma-separated, e.g. analytical, thorough, skeptical)</span></label>
            <textarea
              id="persona-traits"
              value={config.persona.traits}
              oninput={(e) => (config = { ...config, persona: { ...config.persona, traits: (e.target as HTMLTextAreaElement).value } })}
              placeholder="e.g. analytical, methodical, skeptical of unverified claims"
              rows="2"
              class="config-input resize-none leading-relaxed"></textarea>
          </div>
        {/if}
      </div>
    {/if}
  </div>
  {/if}

  <!-- ── Section: Strategy ────────────────────────────────────────────── -->
  {#if acpSectionVisible("strategy")}
  <div id="acp-section-strategy" class="acp-section border border-[var(--cortex-border)] rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--cortex-surface-low)_55%,transparent)]">
    <button type="button"
      id="acp-head-strategy"
      class="acp-section-trigger w-full flex items-center gap-2 px-3 py-2.5 border-0 cursor-pointer text-left"
      aria-expanded={openSections.has("strategy")}
      aria-controls="acp-panel-strategy"
      onclick={() => toggle("strategy")}>
      <span class="material-symbols-outlined text-[15px] text-secondary/85 shrink-0" aria-hidden="true">psychology</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Reasoning</span>
      <span class="ml-2 font-mono text-[9px] text-primary/80">{config.strategy}</span>
      <span class="ml-auto material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] transition-transform duration-200 {openSections.has('strategy') ? '' : '-rotate-90'}" aria-hidden="true">expand_more</span>
    </button>
    {#if openSections.has("strategy")}
      <div id="acp-panel-strategy" class="acp-section-body px-3 py-3 space-y-3 border-t border-[var(--cortex-border)]" role="region" aria-labelledby="acp-head-strategy">
        <div class="space-y-1.5">
          {#each STRATEGIES as s}
            <label class="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-surface-container-low/40 transition-colors
                          {config.strategy === s.value ? 'bg-primary/8 border border-primary/20' : 'border border-transparent'}">
              <input type="radio" name="strategy" value={s.value}
                checked={config.strategy === s.value}
                onchange={() => (config = { ...config, strategy: s.value as AgentConfig["strategy"] })}
                class="mt-0.5 accent-primary flex-shrink-0" />
              <div>
                <div class="font-mono text-[10px] font-semibold text-on-surface/80">{s.label}</div>
                <div class="font-mono text-[9px] text-outline/50 mt-0.5">{s.desc}</div>
              </div>
            </label>
          {/each}
        </div>
        <div class="grid grid-cols-2 gap-3 pt-1">
          <div>
            <label for="max-iterations" class="config-label">Max Iterations</label>
            <input id="max-iterations" type="number" min="1" max="100" bind:value={config.maxIterations}
              class="config-input" />
          </div>
          <div>
            <label for="min-iterations" class="config-label">Min Iterations</label>
            <input id="min-iterations" type="number" min="0" max="20" bind:value={config.minIterations}
              class="config-input" />
          </div>
        </div>
        <div class="flex items-center justify-between">
          <div>
            <div class="font-mono text-[10px] text-on-surface/70">Auto-switch strategy</div>
            <div class="font-mono text-[9px] text-outline/40">Switch strategy if agent gets stuck</div>
          </div>
          <button type="button" onclick={() => (config = { ...config, strategySwitching: !config.strategySwitching })}
            aria-label="Toggle auto-switch strategy"
            aria-pressed={config.strategySwitching}
            class="flex-shrink-0 w-10 h-5 rounded-full border-0 cursor-pointer relative transition-colors duration-200
                   {config.strategySwitching ? 'bg-primary' : 'bg-surface-container-highest'}">
            <span class="pointer-events-none absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ease-out
                         {config.strategySwitching ? 'translate-x-5' : 'translate-x-0'}"></span>
          </button>
        </div>
        <div>
          <label for="verification-step" class="config-label">Verification Step</label>
          <select id="verification-step" bind:value={config.verificationStep} class="config-input">
            <option value="none">None — trust first answer</option>
            <option value="reflect">Reflect — LLM self-review pass</option>
          </select>
          <p class="mt-1 font-mono text-[8px] text-[var(--cortex-text-muted)] leading-relaxed">
            Reflect runs one extra LLM pass on the draft answer. It is not the same as the framework verification layer below.
          </p>
        </div>
        <label class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--ra-amber)_35%,var(--cortex-border))] bg-[color-mix(in_srgb,var(--ra-amber)_8%,transparent)] p-2.5">
          <input type="checkbox" bind:checked={config.runtimeVerification} class="accent-primary mt-0.5 shrink-0" />
          <span class="font-mono text-[9px] text-[var(--cortex-text)] leading-snug">
            <span class="font-semibold text-tertiary">Runtime verification layer</span>
            — enables the <code class="text-[8px]">@reactive-agents/verification</code> package (semantic entropy and related checks). Adds latency and provider calls; use when you want automated confidence signals, not only a reflect pass.
          </span>
        </label>
      </div>
    {/if}
  </div>
  {/if}

  <!-- ── Section: Tools ───────────────────────────────────────────────── -->
  {#if !compact && acpSectionVisible("tools")}
  <div id="acp-section-tools" class="acp-section border border-[var(--cortex-border)] rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--cortex-surface-low)_55%,transparent)]">
    <button type="button"
      id="acp-head-tools"
      class="acp-section-trigger w-full flex items-center gap-2 px-3 py-2.5 border-0 cursor-pointer text-left"
      aria-expanded={openSections.has("tools")}
      aria-controls="acp-panel-tools"
      onclick={() => toggle("tools")}>
      <span class="material-symbols-outlined text-[15px] text-tertiary/90 shrink-0" aria-hidden="true">construction</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Tools</span>
      <span class="ml-2 rounded-md bg-[color-mix(in_srgb,var(--ra-amber)_16%,transparent)] px-1.5 py-0.5 text-[9px] font-mono text-tertiary">{toolCountForBadges} active</span>
      <span class="ml-auto material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] transition-transform duration-200 {openSections.has('tools') ? '' : '-rotate-90'}" aria-hidden="true">expand_more</span>
    </button>
    {#if openSections.has("tools")}
      <div id="acp-panel-tools" class="acp-section-body px-3 py-3 border-t border-[var(--cortex-border)]" role="region" aria-labelledby="acp-head-tools">
        <div
          class="mb-3 rounded-lg border border-[color-mix(in_srgb,var(--ra-amber)_40%,var(--cortex-border))] bg-[color-mix(in_srgb,var(--ra-amber)_10%,transparent)] px-2.5 py-2 space-y-2"
        >
          <p class="font-mono text-[8px] font-semibold uppercase tracking-wide text-tertiary">Host shell — use at your own risk</p>
          <p class="font-mono text-[8px] text-[var(--cortex-text-muted)] leading-relaxed">
            The <code class="text-[7px]">shell-execute</code> tool runs allowlisted commands on <strong>this machine</strong> (not an isolated container). Allowed commands are defined by the framework defaults; risky patterns are blocklisted, but no sandbox is perfect.
            Only enable for trusted projects and accounts. For stronger isolation, use code from your app with Docker sandboxing — see
            <a class="text-primary underline decoration-primary/40" href="https://docs.reactiveagents.dev/" target="_blank" rel="noreferrer">docs</a>
            (shell execution / sandbox).
          </p>
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" bind:checked={config.terminalTools} class="accent-primary shrink-0" />
            <span class="font-mono text-[9px] text-[var(--cortex-text)]">Enable host shell (<code class="text-[8px]">shell-execute</code>)</span>
          </label>
          {#if config.terminalTools || config.tools.includes("shell-execute")}
            <div class="mt-2 space-y-2 border-t border-[color-mix(in_srgb,var(--ra-amber)_25%,transparent)] pt-2">
              <div class="space-y-1">
                <label for="acp-shell-additional-commands" class="config-label mb-0 text-[9px]">Extra allowed commands</label>
                <textarea
                  id="acp-shell-additional-commands"
                  rows={2}
                  bind:value={config.terminalShellAdditionalCommands}
                  placeholder="e.g. node, bun, gh, stripe (comma or newline — merged onto framework defaults)"
                  class="config-input font-mono text-[9px] min-h-[2.25rem] resize-y"
                ></textarea>
                <p class="font-mono text-[7px] text-outline/50 leading-relaxed">
                  Opt-in CLIs like <code class="text-[7px]">node</code>/<code class="text-[7px]">curl</code> are not in the base list; add them here only if you accept the risk.
                </p>
              </div>
              <div class="space-y-1">
                <label for="acp-shell-allowed-commands" class="config-label mb-0 text-[9px]">Replace default allowlist <span class="text-outline/40 font-normal">(advanced)</span></label>
                <textarea
                  id="acp-shell-allowed-commands"
                  rows={2}
                  bind:value={config.terminalShellAllowedCommands}
                  placeholder="Leave empty. If set, this list becomes the only allowed executables (plus “Extra” above)."
                  class="config-input font-mono text-[9px] min-h-[2.25rem] resize-y border-[color-mix(in_srgb,var(--ra-amber)_30%,var(--cortex-border))]"
                ></textarea>
              </div>
            </div>
          {/if}
        </div>
        <p class="mb-2 font-mono text-[8px] text-[var(--cortex-text-muted)] leading-relaxed">
          Quick picks toggle framework tool IDs in <code class="text-[7px]">allowedTools</code>. Conductor meta-tools (brief, find, …) are configured separately below in <strong>Meta tools</strong>.
        </p>
        <div class="grid grid-cols-2 gap-1.5">
          {#each AVAILABLE_TOOLS as tool}
            {@const active = config.tools.includes(tool.id)}
            <button type="button" onclick={() => toggleTool(tool.id)}
              class="flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[10px] font-mono text-left cursor-pointer transition-all
                     {active ? 'bg-tertiary/10 border-tertiary/30 text-tertiary/90' : 'border-outline-variant/15 text-outline/60 hover:border-outline-variant/30'}">
              <span class="material-symbols-outlined text-[12px]">{tool.icon}</span>
              {tool.label}
            </button>
          {/each}
        </div>
        <div class="mt-3 space-y-1.5">
          <label for="acp-additional-tool-names" class="config-label mb-0">Additional allowed tools</label>
          <textarea
            id="acp-additional-tool-names"
            rows={2}
            bind:value={config.additionalToolNames}
            placeholder="e.g. my-lab-tool, server/http_get (comma or newline)"
            class="config-input font-mono text-[9px] min-h-[2.5rem] resize-y"
          ></textarea>
          <p class="font-mono text-[8px] text-outline/45 leading-relaxed">
            Merged with the toggles above at run time. Use exact tool registration names (see Lab → Tools for MCP and custom tools).
          </p>
        </div>
        <div class="mt-4 pt-3 border-t border-outline-variant/10 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="config-label mb-0">MCP tools <span class="text-outline/30 normal-case font-normal">(from Tools tab)</span></span>
            <button type="button" onclick={() => loadMcpCatalog()}
              class="text-[9px] font-mono text-secondary hover:text-primary bg-transparent border-0 cursor-pointer">↻ Refresh list</button>
          </div>
          {#if mcpCatalog.length === 0}
            <p class="font-mono text-[9px] text-outline/45">No MCP servers saved. Add one under Lab → Tools.</p>
          {:else}
            {#each mcpCatalog as srv}
              <div class="rounded-lg border border-outline-variant/15 bg-surface-container-low/30 px-2 py-2 space-y-1.5">
                <div class="font-mono text-[10px] text-on-surface/80">{srv.name}</div>
                {#if srv.tools.length === 0}
                  <p class="font-mono text-[9px] text-outline/40">No tools cached — run “Refresh tools” in Tools tab.</p>
                {:else}
                  <div class="flex flex-wrap gap-1">
                    {#each srv.tools as mt}
                      {@const active = config.tools.includes(mt.toolName)}
                      <button type="button" onclick={() => toggleMcpRegistryTool(srv.serverId, mt.toolName)}
                        class="px-2 py-1 rounded border text-[9px] font-mono cursor-pointer transition-colors
                               {active ? 'bg-primary/12 border-primary/35 text-primary' : 'border-outline-variant/20 text-outline/60 hover:border-primary/25'}">
                        {mt.toolName}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
        <div class="mt-4 pt-3 border-t border-outline-variant/10 space-y-2">
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox"
              checked={config.dynamicSubAgents?.enabled ?? false}
              onchange={() => (config = {
                ...config,
                dynamicSubAgents: {
                  enabled: !(config.dynamicSubAgents?.enabled ?? false),
                  maxIterations: config.dynamicSubAgents?.maxIterations ?? 8,
                },
              })}
              class="accent-primary w-3.5 h-3.5" />
            <div>
              <div class="font-mono text-[10px] text-on-surface/80">Dynamic sub-agents</div>
              <div class="font-mono text-[9px] text-outline/40">Expose <code class="text-[8px]">spawn-agent</code> for runtime delegation</div>
            </div>
          </label>
          {#if config.dynamicSubAgents?.enabled}
            <div>
              <label for="dyn-sub-max" class="config-label">Spawn max iterations</label>
              <input id="dyn-sub-max" type="number" min="1" max="50" step="1"
                value={config.dynamicSubAgents?.maxIterations ?? 8}
                oninput={(e) => (config = {
                  ...config,
                  dynamicSubAgents: {
                    enabled: true,
                    maxIterations: Math.max(1, parseInt((e.target as HTMLInputElement).value || "8", 10)),
                  },
                })}
                class="config-input" />
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
  {/if}

  <!-- ── Section: Sub-agents (static / remote) ─────────────────────────── -->
  {#if !compact && acpSectionVisible("subagents")}
  <div id="acp-section-subagents" class="acp-section border border-[var(--cortex-border)] rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--cortex-surface-low)_55%,transparent)]">
    <button type="button"
      id="acp-head-subagents"
      class="acp-section-trigger w-full flex items-center gap-2 px-3 py-2.5 border-0 cursor-pointer text-left"
      aria-expanded={openSections.has("subagents")}
      aria-controls="acp-panel-subagents"
      onclick={() => toggle("subagents")}>
      <span class="material-symbols-outlined text-[15px] text-primary/80 shrink-0" aria-hidden="true">hub</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Sub-agents</span>
      <span class="ml-2 font-mono text-[9px] text-[var(--cortex-text-muted)]">{(config.agentTools ?? []).length} registered</span>
      <span class="ml-auto material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] transition-transform duration-200 {openSections.has('subagents') ? '' : '-rotate-90'}" aria-hidden="true">expand_more</span>
    </button>
    {#if openSections.has("subagents")}
      <div id="acp-panel-subagents" class="acp-section-body px-3 py-3 border-t border-[var(--cortex-border)] space-y-3" role="region" aria-labelledby="acp-head-subagents">
        <div class="flex flex-wrap gap-2">
          <button type="button" onclick={addLocalAgentTool}
            class="text-[9px] font-mono px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10 cursor-pointer bg-transparent">+ Local sub-agent</button>
          <button type="button" onclick={addRemoteAgentTool}
            class="text-[9px] font-mono px-2 py-1 rounded border border-secondary/30 text-secondary hover:bg-secondary/10 cursor-pointer bg-transparent">+ Remote (A2A URL)</button>
        </div>
        {#each config.agentTools ?? [] as at, i (i)}
          <div class="rounded-lg border border-outline-variant/15 p-2.5 space-y-2 bg-surface-container-low/25">
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-[9px] text-outline/50 uppercase">#{i + 1}</span>
              <button type="button" onclick={() => removeAgentToolAt(i)}
                class="text-[9px] font-mono text-error/70 hover:text-error bg-transparent border-0 cursor-pointer">Remove</button>
            </div>
            {#if at.kind === "remote"}
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="config-label" for={`subagent-r-${i}-tool`}>Tool name</label>
                  <input id={`subagent-r-${i}-tool`} class="config-input" value={at.toolName}
                    oninput={(e) => patchAgentTool(i, { ...at, toolName: (e.target as HTMLInputElement).value })} />
                </div>
                <div class="col-span-2">
                  <label class="config-label" for={`subagent-r-${i}-url`}>Remote URL</label>
                  <input id={`subagent-r-${i}-url`} class="config-input font-mono text-[10px]" value={at.remoteUrl}
                    oninput={(e) => patchAgentTool(i, { ...at, remoteUrl: (e.target as HTMLInputElement).value })} />
                </div>
              </div>
            {:else}
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="config-label" for={`subagent-l-${i}-tool`}>Tool name</label>
                  <input id={`subagent-l-${i}-tool`} class="config-input" value={at.toolName}
                    oninput={(e) => patchAgentTool(i, { ...at, toolName: (e.target as HTMLInputElement).value })} />
                </div>
                <div>
                  <label class="config-label" for={`subagent-l-${i}-display`}>Display name</label>
                  <input id={`subagent-l-${i}-display`} class="config-input" value={at.agent.name}
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, name: (e.target as HTMLInputElement).value } })} />
                </div>
                <div class="col-span-2">
                  <label class="config-label" for={`subagent-l-${i}-desc`}>Description</label>
                  <input id={`subagent-l-${i}-desc`} class="config-input" value={at.agent.description ?? ""}
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, description: (e.target as HTMLInputElement).value } })} />
                </div>
                <div>
                  <label class="config-label" for={`subagent-l-${i}-provider`}>Provider <span class="normal-case text-outline/40">(optional)</span></label>
                  <input id={`subagent-l-${i}-provider`} class="config-input" value={at.agent.provider ?? ""} placeholder="inherit"
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, provider: (e.target as HTMLInputElement).value || undefined } })} />
                </div>
                <div>
                  <label class="config-label" for={`subagent-l-${i}-model`}>Model <span class="normal-case text-outline/40">(optional)</span></label>
                  <input id={`subagent-l-${i}-model`} class="config-input" value={at.agent.model ?? ""} placeholder="inherit"
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, model: (e.target as HTMLInputElement).value || undefined } })} />
                </div>
                <div>
                  <label class="config-label" for={`subagent-l-${i}-maxiter`}>Max iterations</label>
                  <input id={`subagent-l-${i}-maxiter`} type="number" min="1" max="50" class="config-input" value={at.agent.maxIterations ?? 8}
                    oninput={(e) => patchAgentTool(i, {
                      ...at,
                      agent: { ...at.agent, maxIterations: Math.max(1, parseInt((e.target as HTMLInputElement).value || "8", 10)) },
                    })} />
                </div>
                <div class="col-span-2">
                  <label class="config-label" for={`subagent-l-${i}-tools`}>Sub-agent tools <span class="normal-case text-outline/40">(comma-separated)</span></label>
                  <input id={`subagent-l-${i}-tools`} class="config-input font-mono text-[10px]"
                    value={(at.agent.tools ?? []).join(", ")}
                    oninput={(e) => {
                      const raw = (e.target as HTMLInputElement).value;
                      const tools = raw.split(",").map((s) => s.trim()).filter(Boolean);
                      patchAgentTool(i, { ...at, agent: { ...at.agent, tools: tools.length ? tools : undefined } });
                    }} />
                </div>
                <div class="col-span-2">
                  <label class="config-label" for={`subagent-l-${i}-sysprompt`}>System prompt</label>
                  <textarea id={`subagent-l-${i}-sysprompt`} rows="2" class="config-input resize-none" value={at.agent.systemPrompt ?? ""}
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, systemPrompt: (e.target as HTMLInputElement).value || undefined } })}></textarea>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
  {/if}

  <!-- ── Section: Living skills ─────────────────────────────────────── -->
  {#if !compact && acpSectionVisible("skills")}
  <div id="acp-section-skills" class="acp-section border border-[var(--cortex-border)] rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--cortex-surface-low)_55%,transparent)]">
    <button type="button"
      id="acp-head-skills"
      class="acp-section-trigger w-full flex items-center gap-2 px-3 py-2.5 border-0 cursor-pointer text-left"
      aria-expanded={openSections.has("skills")}
      aria-controls="acp-panel-skills"
      onclick={() => toggle("skills")}>
      <span class="material-symbols-outlined text-[15px] text-secondary/85 shrink-0" aria-hidden="true">auto_awesome</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Living skills</span>
      <span class="ml-2 font-mono text-[9px] text-[var(--cortex-text-muted)]">{(config.skills?.paths ?? []).length} path{(config.skills?.paths ?? []).length !== 1 ? "s" : ""}</span>
      <span class="ml-auto material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] transition-transform duration-200 {openSections.has('skills') ? '' : '-rotate-90'}" aria-hidden="true">expand_more</span>
    </button>
    {#if openSections.has("skills")}
      <div id="acp-panel-skills" class="acp-section-body px-3 py-3 space-y-3 border-t border-[var(--cortex-border)]" role="region" aria-labelledby="acp-head-skills">
        <div>
          <label for="skills-paths-lines" class="config-label">Skill directories <span class="text-outline/30 normal-case font-normal">(`withSkills` paths — one per line)</span></label>
          <textarea id="skills-paths-lines"
            bind:value={skillsPathsDraft}
            onblur={commitSkillsPathsDraft}
            placeholder={".claude/skills\n./my-skills"}
            rows="3"
            class="config-input resize-none leading-relaxed font-mono text-[10px]"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label for="skills-evolution-mode" class="config-label">Evolution mode</label>
            <select id="skills-evolution-mode" class="config-input"
              value={config.skills.evolution?.mode ?? ""}
              onchange={(e) => {
                const mode = (e.target as HTMLSelectElement).value;
                const ev = { ...config.skills.evolution };
                if (mode) ev.mode = mode;
                else delete ev.mode;
                config = {
                  ...config,
                  skills: { ...config.skills, evolution: Object.keys(ev).length > 0 ? ev : undefined },
                };
              }}>
              <option value="">Default</option>
              <option value="suggest">Suggest</option>
              <option value="auto">Auto</option>
            </select>
          </div>
          <div>
            <label for="skills-refinement-threshold" class="config-label">Refinement threshold <span class="text-outline/30 normal-case font-normal">(0 = omit)</span></label>
            <input id="skills-refinement-threshold" type="number" min="0" class="config-input"
              value={config.skills.evolution?.refinementThreshold ?? 0}
              onchange={(e) => {
                const n = parseInt((e.target as HTMLInputElement).value || "0", 10);
                const ev = { ...config.skills.evolution };
                if (Number.isFinite(n) && n > 0) ev.refinementThreshold = n;
                else delete ev.refinementThreshold;
                config = {
                  ...config,
                  skills: { ...config.skills, evolution: Object.keys(ev).length > 0 ? ev : undefined },
                };
              }} />
          </div>
        </div>
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" class="accent-primary w-3.5 h-3.5"
            checked={config.skills.evolution?.rollbackOnRegression === true}
            onchange={() => {
              const ev = { ...config.skills.evolution };
              if (ev.rollbackOnRegression) delete ev.rollbackOnRegression;
              else ev.rollbackOnRegression = true;
              config = {
                ...config,
                skills: { ...config.skills, evolution: Object.keys(ev).length > 0 ? ev : undefined },
              };
            }} />
          <span class="font-mono text-[10px] text-on-surface/80">Rollback on regression</span>
        </label>
      </div>
    {/if}
  </div>
  {/if}

  <!-- ── Section: Memory ──────────────────────────────────────────────── -->
  {#if acpSectionVisible("memory")}
  <div id="acp-section-memory" class="acp-section border border-[var(--cortex-border)] rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--cortex-surface-low)_55%,transparent)]">
    <button type="button"
      id="acp-head-memory"
      class="acp-section-trigger w-full flex items-center gap-2 px-3 py-2.5 border-0 cursor-pointer text-left"
      aria-expanded={openSections.has("memory")}
      aria-controls="acp-panel-memory"
      onclick={() => toggle("memory")}>
      <span class="material-symbols-outlined text-[15px] text-primary/80 shrink-0" aria-hidden="true">account_tree</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Memory</span>
      <span class="ml-auto material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] transition-transform duration-200 {openSections.has('memory') ? '' : '-rotate-90'}" aria-hidden="true">expand_more</span>
    </button>
    {#if openSections.has("memory")}
      <div id="acp-panel-memory" class="acp-section-body px-3 py-3 space-y-2 border-t border-[var(--cortex-border)]" role="region" aria-labelledby="acp-head-memory">
        {#each [
          { key: "working",  label: "Working Memory",  desc: "Short-term context within the run" },
          { key: "episodic", label: "Episodic Memory",  desc: "Stores run history for future recall" },
          { key: "semantic", label: "Semantic Memory",  desc: "Vector store for similarity search" },
        ] as tier}
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox"
              checked={config.memory[tier.key as keyof typeof config.memory]}
              onchange={() => (config = { ...config, memory: { ...config.memory, [tier.key]: !config.memory[tier.key as keyof typeof config.memory] } })}
              class="accent-primary w-3.5 h-3.5" />
            <div>
              <div class="font-mono text-[10px] text-on-surface/80">{tier.label}</div>
              <div class="font-mono text-[9px] text-outline/40">{tier.desc}</div>
            </div>
          </label>
        {/each}
        <div class="pt-1">
          <label for="context-synthesis" class="config-label">Context Synthesis</label>
          <select id="context-synthesis" bind:value={config.contextSynthesis} class="config-input">
            <option value="auto">Auto — framework decides</option>
            <option value="template">Template — fast, rule-based</option>
            <option value="llm">LLM — deep synthesis call</option>
            <option value="none">None — raw context</option>
          </select>
        </div>
      </div>
    {/if}
  </div>
  {/if}

  <!-- ── Section: Guardrails ──────────────────────────────────────────── -->
  {#if acpSectionVisible("guardrails")}
  <div id="acp-section-guardrails" class="acp-section border border-[var(--cortex-border)] rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--cortex-surface-low)_55%,transparent)]">
    <button type="button"
      id="acp-head-guardrails"
      class="acp-section-trigger w-full flex items-center gap-2 px-3 py-2.5 border-0 cursor-pointer text-left"
      aria-expanded={openSections.has("guardrails")}
      aria-controls="acp-panel-guardrails"
      onclick={() => toggle("guardrails")}>
      <span class="material-symbols-outlined text-[15px] text-error/75 shrink-0" aria-hidden="true">security</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Guardrails</span>
      <span class="ml-2 rounded-md px-1.5 py-0.5 text-[9px] font-mono {config.guardrails.enabled ? 'bg-[color-mix(in_srgb,var(--ra-green)_20%,transparent)] text-[var(--ra-green)]' : 'bg-[var(--cortex-surface-mid)] text-[var(--cortex-text-muted)]'}">
        {config.guardrails.enabled ? "on" : "off"}
      </span>
      <span class="ml-auto material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] transition-transform duration-200 {openSections.has('guardrails') ? '' : '-rotate-90'}" aria-hidden="true">expand_more</span>
    </button>
    {#if openSections.has("guardrails")}
      <div id="acp-panel-guardrails" class="acp-section-body px-3 py-3 space-y-3 border-t border-[var(--cortex-border)]" role="region" aria-labelledby="acp-head-guardrails">
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" bind:checked={config.guardrails.enabled} class="accent-primary w-3.5 h-3.5" />
          <span class="font-mono text-[10px] text-on-surface/80">Enable guardrails</span>
        </label>
        {#if config.guardrails.enabled}
          {#each GUARDRAIL_FIELDS as g}
            <div>
              <label for={`guardrail-${g.key}`} class="config-label flex items-center justify-between">
                {g.label}
                <span class="font-mono text-primary tabular-nums">
                  {config.guardrails[g.key].toFixed(2)}
                </span>
              </label>
              <input id={`guardrail-${g.key}`} type="range" min="0.1" max="1.0" step="0.05"
                value={config.guardrails[g.key]}
                oninput={(e) => (config = { ...config, guardrails: { ...config.guardrails, [g.key]: parseFloat((e.target as HTMLInputElement).value) } })}
                class="w-full accent-primary" />
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
  {/if}
  <!-- ── Section: Execution Controls ──────────────────────────────────── -->
  {#if acpSectionVisible("execution")}
  <div id="acp-section-execution" class="acp-section border border-[var(--cortex-border)] rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--cortex-surface-low)_55%,transparent)]">
    <button type="button"
      id="acp-head-execution"
      class="acp-section-trigger w-full flex items-center gap-2 px-3 py-2.5 border-0 cursor-pointer text-left"
      aria-expanded={openSections.has("execution")}
      aria-controls="acp-panel-execution"
      onclick={() => toggle("execution")}>
      <span class="material-symbols-outlined text-[15px] text-tertiary/90 shrink-0" aria-hidden="true">timer</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Execution</span>
      <span class="ml-2 max-w-[min(12rem,45%)] truncate text-[9px] font-mono text-[var(--cortex-text-muted)]">
        {[
          config.timeout > 0 ? `${Math.round(config.timeout/1000)}s timeout` : null,
          config.retryPolicy.enabled ? `${config.retryPolicy.maxRetries} retries` : null,
          config.progressCheckpoint > 0 ? `ckpt/${config.progressCheckpoint}` : null,
        ].filter(Boolean).join(" · ") || "defaults"}
      </span>
      <span class="ml-auto material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] transition-transform duration-200 {openSections.has('execution') ? '' : '-rotate-90'}" aria-hidden="true">expand_more</span>
    </button>
    {#if openSections.has("execution")}
      <div id="acp-panel-execution" class="acp-section-body px-3 py-3 space-y-3 border-t border-[var(--cortex-border)]" role="region" aria-labelledby="acp-head-execution">
        <!-- Timeout -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="execution-timeout" class="config-label">Timeout <span class="text-outline/30 normal-case font-normal">(seconds, 0 = none)</span></label>
            <input id="execution-timeout" type="number" min="0" max="3600" step="5"
              value={Math.round(config.timeout / 1000)}
              oninput={(e) => (config = { ...config, timeout: parseInt((e.target as HTMLInputElement).value || "0") * 1000 })}
              class="config-input" />
          </div>
          <div>
            <label for="cache-ttl" class="config-label">Cache TTL <span class="text-outline/30 normal-case font-normal">(seconds, 0 = off)</span></label>
            <input id="cache-ttl" type="number" min="0" max="86400" step="60"
              value={Math.round(config.cacheTimeout / 1000)}
              oninput={(e) => (config = { ...config, cacheTimeout: parseInt((e.target as HTMLInputElement).value || "0") * 1000 })}
              class="config-input" />
          </div>
        </div>
        <!-- Progress checkpoint -->
        <div>
          <label for="progress-checkpoint" class="config-label">Progress Checkpoint <span class="text-outline/30 normal-case font-normal">(every N iterations, 0 = off)</span></label>
          <input id="progress-checkpoint" type="number" min="0" max="50" step="1"
            bind:value={config.progressCheckpoint}
            class="config-input" />
        </div>
        <!-- Retry policy -->
        <div class="space-y-2">
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" bind:checked={config.retryPolicy.enabled} class="accent-primary w-3.5 h-3.5" />
            <span class="font-mono text-[10px] text-on-surface/80">Enable retry policy</span>
          </label>
          {#if config.retryPolicy.enabled}
            <div class="grid grid-cols-2 gap-3 pl-5">
              <div>
                <label for="retry-max-retries" class="config-label">Max Retries</label>
                <input id="retry-max-retries" type="number" min="1" max="10"
                  bind:value={config.retryPolicy.maxRetries}
                  class="config-input" />
              </div>
              <div>
                <label for="retry-backoff-ms" class="config-label">Backoff <span class="text-outline/30 normal-case font-normal">(ms)</span></label>
                <input id="retry-backoff-ms" type="number" min="100" max="30000" step="100"
                  bind:value={config.retryPolicy.backoffMs}
                  class="config-input" />
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
  {/if}

  <!-- ── Section: Meta Tools (Conductor's Suite) ───────────────────────── -->
  {#if acpSectionVisible("metatools")}
  <div id="acp-section-metatools" class="acp-section border border-[var(--cortex-border)] rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--cortex-surface-low)_55%,transparent)]">
    <button type="button"
      id="acp-head-metatools"
      class="acp-section-trigger w-full flex items-center gap-2 px-3 py-2.5 border-0 cursor-pointer text-left"
      aria-expanded={openSections.has("metatools")}
      aria-controls="acp-panel-metatools"
      onclick={() => toggle("metatools")}>
      <span class="material-symbols-outlined text-[15px] text-secondary/85 shrink-0" aria-hidden="true">wand_stars</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Meta tools</span>
      <span class="ml-2 max-w-[min(11rem,40%)] truncate text-[9px] font-mono text-[var(--cortex-text-muted)]">
        {config.metaTools.enabled
          ? [config.metaTools.brief && 'brief', config.metaTools.find && 'find', config.metaTools.pulse && 'pulse', config.metaTools.recall && 'recall'].filter(Boolean).join(', ') || 'none active'
          : 'off'}
      </span>
      <span class="ml-auto material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] transition-transform duration-200 {openSections.has('metatools') ? '' : '-rotate-90'}" aria-hidden="true">expand_more</span>
    </button>
    {#if openSections.has("metatools")}
      <div id="acp-panel-metatools" class="acp-section-body px-3 py-3 space-y-2 border-t border-[var(--cortex-border)]" role="region" aria-labelledby="acp-head-metatools">
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" bind:checked={config.metaTools.enabled} class="accent-primary w-3.5 h-3.5" />
          <div>
            <div class="font-mono text-[10px] text-on-surface/80">Enable Conductor's Suite</div>
            <div class="font-mono text-[9px] text-outline/40">Give the agent self-awareness and intelligence tools</div>
          </div>
        </label>
        {#if config.metaTools.enabled}
          <div class="grid grid-cols-2 gap-1.5 pl-1 pt-1">
            {#each [
              { key: "brief",       label: "Brief",        desc: "Situational overview" },
              { key: "find",        label: "Find",         desc: "RAG→memory→web routing" },
              { key: "pulse",       label: "Pulse",        desc: "Entropy introspection" },
              { key: "recall",      label: "Recall",       desc: "Selective working memory" },
              { key: "harnessSkill",label: "Harness Skill",desc: "Built-in conductor workflow" },
            ] as mt}
              <label class="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-surface-container-low/40 transition-colors
                            {config.metaTools[mt.key as keyof typeof config.metaTools] ? 'bg-secondary/8 border border-secondary/20' : 'border border-transparent'}">
                <input type="checkbox"
                  checked={config.metaTools[mt.key as keyof typeof config.metaTools] as boolean}
                  onchange={() => (config = { ...config, metaTools: { ...config.metaTools, [mt.key]: !config.metaTools[mt.key as keyof typeof config.metaTools] } })}
                  class="accent-secondary w-3 h-3 flex-shrink-0" />
                <div>
                  <div class="font-mono text-[10px] text-on-surface/80">{mt.label}</div>
                  <div class="font-mono text-[8px] text-outline/40">{mt.desc}</div>
                </div>
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
  {/if}

  <!-- ── Section: Reliability (Fallbacks) ─────────────────────────────── -->
  {#if acpSectionVisible("reliability")}
  <div id="acp-section-reliability" class="acp-section border border-[var(--cortex-border)] rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--cortex-surface-low)_55%,transparent)]">
    <button type="button"
      id="acp-head-reliability"
      class="acp-section-trigger w-full flex items-center gap-2 px-3 py-2.5 border-0 cursor-pointer text-left"
      aria-expanded={openSections.has("reliability")}
      aria-controls="acp-panel-reliability"
      onclick={() => toggle("reliability")}>
      <span class="material-symbols-outlined text-[15px] text-secondary/85 shrink-0" aria-hidden="true">shield</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Reliability</span>
      <span class="ml-2 font-mono text-[9px] text-[var(--cortex-text-muted)]">
        {config.fallbacks.enabled ? `${config.fallbacks.providers.length} fallback${config.fallbacks.providers.length !== 1 ? 's' : ''}` : 'off'}
      </span>
      <span class="ml-auto material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] transition-transform duration-200 {openSections.has('reliability') ? '' : '-rotate-90'}" aria-hidden="true">expand_more</span>
    </button>
    {#if openSections.has("reliability")}
      <div id="acp-panel-reliability" class="acp-section-body px-3 py-3 space-y-3 border-t border-[var(--cortex-border)]" role="region" aria-labelledby="acp-head-reliability">
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" bind:checked={config.fallbacks.enabled} class="accent-primary w-3.5 h-3.5" />
          <div>
            <div class="font-mono text-[10px] text-on-surface/80">Enable provider fallbacks</div>
            <div class="font-mono text-[9px] text-outline/40">Automatically switch to a backup provider on errors</div>
          </div>
        </label>
        {#if config.fallbacks.enabled}
          <div>
            <label for="fallback-providers" class="config-label">Fallback Providers <span class="text-outline/30 normal-case font-normal">(comma-separated, e.g. openai, gemini)</span></label>
            <input
              id="fallback-providers"
              value={config.fallbacks.providers.join(", ")}
              oninput={(e) => (config = { ...config, fallbacks: { ...config.fallbacks, providers: (e.target as HTMLInputElement).value.split(",").map(s => s.trim()).filter(Boolean) } })}
              placeholder="openai, gemini, ollama"
              class="config-input" />
          </div>
          <div>
            <label for="fallback-error-threshold" class="config-label flex items-center justify-between">
              Error Threshold
              <span class="font-mono text-primary tabular-nums">{config.fallbacks.errorThreshold}</span>
            </label>
            <input id="fallback-error-threshold" type="range" min="1" max="10"
              bind:value={config.fallbacks.errorThreshold}
              class="w-full accent-primary" />
            <div class="flex justify-between text-[8px] font-mono text-outline/30 mt-0.5">
              <span>1 — switch on first error</span><span>10 — very tolerant</span>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
  {/if}

  <!-- ── Section: Observability ─────────────────────────────────────────── -->
  {#if acpSectionVisible("observability")}
  <div id="acp-section-observability" class="acp-section border border-[var(--cortex-border)] rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--cortex-surface-low)_55%,transparent)]">
    <button type="button"
      id="acp-head-observability"
      class="acp-section-trigger w-full flex items-center gap-2 px-3 py-2.5 border-0 cursor-pointer text-left"
      aria-expanded={openSections.has("observability")}
      aria-controls="acp-panel-observability"
      onclick={() => toggle("observability")}>
      <span class="material-symbols-outlined text-[15px] text-[var(--cortex-text-muted)] shrink-0" aria-hidden="true">monitoring</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Observability</span>
      <span class="ml-2 rounded-md bg-[color-mix(in_srgb,var(--ra-cyan)_14%,transparent)] px-1.5 py-0.5 text-[9px] font-mono text-secondary">
        {config.observabilityVerbosity}
      </span>
      <span class="ml-auto material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] transition-transform duration-200 {openSections.has('observability') ? '' : '-rotate-90'}" aria-hidden="true">expand_more</span>
    </button>
    {#if openSections.has("observability")}
      <div id="acp-panel-observability" class="acp-section-body px-3 py-3 space-y-2 border-t border-[var(--cortex-border)]" role="region" aria-labelledby="acp-head-observability">
        <label for="observability-off" class="config-label">Metrics Dashboard Verbosity</label>
        <div class="space-y-1">
          {#each [
            { value: "off",     label: "Off",     desc: "No dashboard output" },
            { value: "minimal", label: "Minimal", desc: "Header card only" },
            { value: "normal",  label: "Normal",  desc: "Dashboard + timeline + tools" },
            { value: "verbose", label: "Verbose", desc: "Dashboard + detailed phase logs" },
          ] as opt}
            <label class="flex items-start gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-surface-container-low/40 transition-colors
                          {config.observabilityVerbosity === opt.value ? 'bg-primary/8 border border-primary/20' : 'border border-transparent'}">
              <input type="radio" name="observability" value={opt.value}
                checked={config.observabilityVerbosity === opt.value}
                onchange={() => (config = { ...config, observabilityVerbosity: opt.value as PanelAgentConfig["observabilityVerbosity"] })}
                class="mt-0.5 accent-primary flex-shrink-0" />
              <div>
                <div class="font-mono text-[10px] font-semibold text-on-surface/80">{opt.label}</div>
                <div class="font-mono text-[9px] text-outline/50">{opt.desc}</div>
              </div>
            </label>
          {/each}
        </div>
      </div>
    {/if}
  </div>
  {/if}

</div>

<style>
  .agent-config-panel {
    --acp-radius: 10px;
  }

  .acp-header-mark {
    box-shadow: 0 0 14px color-mix(in srgb, var(--ra-violet) 35%, transparent);
  }

  .acp-toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.35rem 0.55rem;
    border-radius: 0.45rem;
    border: 1px solid color-mix(in srgb, var(--cortex-border) 80%, var(--ra-violet) 20%);
    background: color-mix(in srgb, var(--cortex-surface-low) 70%, transparent);
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--cortex-text) 88%, var(--ra-violet) 12%);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      color 0.15s ease;
  }

  .acp-toolbar-btn:hover {
    border-color: color-mix(in srgb, var(--ra-violet) 45%, var(--cortex-border));
    color: var(--ra-violet);
    background: color-mix(in srgb, var(--ra-violet) 10%, var(--cortex-surface-low));
  }

  .acp-toolbar-btn--muted {
    opacity: 0.72;
    border-color: var(--cortex-border);
  }

  .acp-toolbar-btn--muted:hover {
    opacity: 1;
    color: var(--ra-cyan);
  }

  .acp-toolbar-btn--ghost {
    border-color: transparent;
    background: transparent;
    text-transform: none;
    letter-spacing: 0.02em;
    font-weight: 500;
    color: var(--cortex-text-muted);
  }

  .acp-toolbar-btn--ghost:hover {
    color: var(--cortex-text);
    background: color-mix(in srgb, var(--cortex-surface-mid) 55%, transparent);
  }

  .acp-chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    padding: 0.2rem 0.45rem;
    border-radius: 0.35rem;
    border: 1px solid var(--cortex-border);
    background: color-mix(in srgb, var(--cortex-surface) 65%, transparent);
    color: var(--cortex-text-muted);
  }

  .acp-chip--cyan {
    border-color: color-mix(in srgb, var(--ra-cyan) 35%, var(--cortex-border));
    color: color-mix(in srgb, var(--ra-cyan) 85%, var(--cortex-text));
    background: color-mix(in srgb, var(--ra-cyan) 8%, var(--cortex-surface-low));
  }

  .acp-nav-pill {
    padding: 0.25rem 0.6rem;
    border-radius: 9999px;
    border: 1px solid var(--cortex-border);
    background: color-mix(in srgb, var(--cortex-surface-low) 80%, transparent);
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--cortex-text-muted);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      color 0.15s ease,
      box-shadow 0.2s ease;
  }

  .acp-nav-pill:hover {
    border-color: color-mix(in srgb, var(--ra-violet) 40%, var(--cortex-border));
    color: var(--cortex-text);
  }

  .acp-nav-pill--active {
    border-color: color-mix(in srgb, var(--ra-violet) 55%, transparent);
    color: var(--ra-violet);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--ra-cyan) 25%, transparent);
    background: color-mix(in srgb, var(--ra-violet) 9%, var(--cortex-surface));
  }

  .acp-section {
    scroll-margin-top: 0.75rem;
  }

  .acp-section-trigger {
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--cortex-surface) 40%, transparent) 0%,
      color-mix(in srgb, var(--cortex-surface-low) 55%, transparent) 100%
    );
    transition: background 0.15s ease;
  }

  .acp-section-trigger:hover {
    background: color-mix(in srgb, var(--ra-violet) 6%, var(--cortex-surface-low));
  }

  .acp-section-body {
    background: color-mix(in srgb, var(--cortex-surface) 35%, transparent);
  }

  .acp-filter-input {
    font-family: "Geist Variable", "Geist", ui-sans-serif, sans-serif;
    font-size: 11px;
  }

  .config-label {
    display: block;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: color-mix(in srgb, var(--cortex-text-muted) 92%, var(--cortex-text) 8%);
    margin-bottom: 4px;
  }

  .config-input {
    width: 100%;
    box-sizing: border-box;
    background: color-mix(in srgb, var(--cortex-surface-mid) 55%, var(--cortex-surface) 45%);
    border: 1px solid var(--cortex-border);
    border-radius: var(--acp-radius);
    padding: 6px 10px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    color: var(--cortex-text);
    outline: none;
    transition:
      border-color 0.15s ease,
      box-shadow 0.2s ease;
  }

  .config-input:focus {
    border-color: color-mix(in srgb, var(--ra-violet) 55%, var(--cortex-border));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ra-violet) 18%, transparent);
  }

  .config-input::placeholder {
    color: color-mix(in srgb, var(--cortex-text-muted) 55%, transparent);
  }
</style>
