<script lang="ts">
  /**
   * AgentConfigPanel — comprehensive agent configuration form.
   *
   * Used by: BottomInputBar accordion, Lab Builder, Gateway creation form.
   * Binds bidirectionally to `config` prop.
   */
  import { onMount } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { settings } from "$lib/stores/settings.js";
  import type { AgentConfig, CortexAgentToolConfig } from "$lib/types/agent-config.js";
  import { defaultConfig } from "$lib/types/agent-config.js";

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
  };

  interface Props {
    config?: PanelAgentConfig;
    /** Whether to show all sections or just inference+strategy */
    compact?: boolean;
  }
  let { config = $bindable(defaultConfig() as PanelAgentConfig), compact = false }: Props = $props();

  // Section expand state
  let openSections = $state(new Set(["inference", "strategy"]));
  function toggle(s: string) {
    const n = new Set(openSections);
    if (n.has(s)) n.delete(s); else n.add(s);
    openSections = n;
  }

  // ── Ollama dynamic models ─────────────────────────────────────────────
  let ollamaModels = $state<{ name: string; label: string }[]>([]);
  let ollamaError = $state<string | null>(null);
  let ollamaLoading = $state(false);

  async function fetchOllamaModels() {
    if (config.provider !== "ollama") return;
    ollamaLoading = true;
    ollamaError = null;
    try {
      const { ollamaEndpoint } = settings.get() as { ollamaEndpoint?: string };
      const endpoint = ollamaEndpoint?.trim();
      const url = endpoint
        ? `${CORTEX_SERVER_URL}/api/models/ollama?endpoint=${encodeURIComponent(endpoint)}`
        : `${CORTEX_SERVER_URL}/api/models/ollama`;
      const res = await fetch(url);
      const data = await res.json() as { models: { name: string; label: string }[]; error?: string };
      if (data.error) { ollamaError = data.error; ollamaModels = []; }
      else { ollamaModels = data.models; if (data.models[0] && !config.model) config = { ...config, model: data.models[0].name }; }
    } catch { ollamaError = "Could not reach Ollama"; ollamaModels = []; }
    finally { ollamaLoading = false; }
  }

  $effect(() => {
    if (config.provider === "ollama") fetchOllamaModels();
  });

  const PROVIDERS = ["anthropic", "openai", "gemini", "ollama", "litellm", "test"] as const;
  const STATIC_MODELS: Record<string, { value: string; label: string }[]> = {
    anthropic: [
      { value: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6" },
      { value: "claude-opus-4-6",           label: "Claude Opus 4.6" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
    openai: [
      { value: "gpt-4o",      label: "GPT-4o" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini" },
      { value: "o1",          label: "o1" },
    ],
    gemini: [
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { value: "gemini-2.0-pro",   label: "Gemini 2.0 Pro" },
    ],
  };

  const modelOptions = $derived(
    config.provider === "ollama" ? ollamaModels.map((m) => ({ value: m.name, label: m.label }))
    : STATIC_MODELS[config.provider] ?? [],
  );

  const AVAILABLE_TOOLS = [
    { id: "web-search",   label: "Web Search",  icon: "search" },
    { id: "file-read",    label: "File Read",   icon: "folder_open" },
    { id: "file-write",   label: "File Write",  icon: "edit_document" },
    { id: "code-execute", label: "Code Execute",icon: "terminal" },
    { id: "recall",       label: "Recall",      icon: "psychology" },
    { id: "find",         label: "Find",        icon: "manage_search" },
  ];

  const STRATEGIES = [
    { value: "reactive",             label: "ReAct",                desc: "Think→Act→Observe loop. Best for most tasks." },
    { value: "plan-execute-reflect", label: "Plan–Execute–Reflect", desc: "Creates a structured plan first. Good for multi-step tasks." },
    { value: "tree-of-thought",      label: "Tree of Thought",      desc: "Explores multiple paths. Good for creative/analytical problems." },
    { value: "reflexion",            label: "Reflexion",            desc: "Self-critiques and improves across attempts." },
    { value: "adaptive",             label: "Adaptive",             desc: "Selects strategy automatically based on task type." },
  ];
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
    const opts = STATIC_MODELS[p];
    config = { ...config, provider: p, model: opts?.[0]?.value ?? "" };
    if (p === "ollama") fetchOllamaModels();
  }

  function toggleTool(id: string) {
    const tools = config.tools.includes(id)
      ? config.tools.filter((t) => t !== id)
      : [...config.tools, id];
    config = { ...config, tools };
  }

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

  onMount(() => {
    void loadMcpCatalog();
  });

  function pruneMcpServerIds(tools: string[], catalog: McpCatalogRow[]): string[] {
    const keep = new Set<string>();
    for (const s of catalog) {
      const fromServer = s.tools.some((t) => tools.includes(t.toolName));
      if (fromServer) keep.add(s.serverId);
    }
    return (config.mcpServerIds ?? []).filter((id) => keep.has(id));
  }

  function toggleMcpRegistryTool(_serverId: string, fullToolName: string) {
    let tools = [...config.tools];
    if (tools.includes(fullToolName)) {
      tools = tools.filter((t) => t !== fullToolName);
    } else {
      tools.push(fullToolName);
    }
    const mcpServerIds = pruneMcpServerIds(tools, mcpCatalog);
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

<div class="space-y-2 text-[11px]">

  <!-- ── Import / Export toolbar ──────────────────────────────────────── -->
  <div class="flex items-center gap-2 pb-1 border-b border-outline-variant/15">
    <span class="text-[9px] font-mono text-outline/50 uppercase tracking-widest flex-1">Agent Config</span>
    <button type="button" onclick={() => fileInput?.click()}
      class="flex items-center gap-1 text-[9px] font-mono text-outline/60 hover:text-primary bg-transparent border-0 cursor-pointer transition-colors"
      title="Import config from JSON">
      <span class="material-symbols-outlined text-[12px]">upload_file</span> Import
    </button>
    <button type="button" onclick={exportConfig}
      class="flex items-center gap-1 text-[9px] font-mono text-outline/60 hover:text-primary bg-transparent border-0 cursor-pointer transition-colors"
      title="Export config as JSON">
      <span class="material-symbols-outlined text-[12px]">download</span> Export
    </button>
    <button type="button" onclick={downloadExample}
      class="flex items-center gap-1 text-[9px] font-mono text-outline/40 hover:text-secondary bg-transparent border-0 cursor-pointer transition-colors"
      title="Download example config">
      <span class="material-symbols-outlined text-[12px]">help_outline</span> Example
    </button>
  </div>

  <!-- ── Section: Inference ────────────────────────────────────────────── -->
  <div class="border border-outline-variant/15 rounded-lg overflow-hidden">
    <button type="button"
      class="w-full flex items-center gap-2 px-3 py-2 bg-surface-container-lowest/40 border-0 cursor-pointer hover:bg-surface-container-low/50 transition-colors text-left"
      onclick={() => toggle("inference")}>
      <span class="material-symbols-outlined text-[13px] text-primary/70">memory</span>
      <span class="font-mono font-semibold text-on-surface/80">Inference</span>
      <span class="ml-auto material-symbols-outlined text-[13px] text-outline/40 transition-transform {openSections.has('inference') ? '' : '-rotate-90'}">expand_more</span>
    </button>
    {#if openSections.has("inference")}
      <div class="px-3 py-3 space-y-3 border-t border-outline-variant/10">
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
              {#if config.provider === "ollama"}
                <button type="button" onclick={fetchOllamaModels}
                  class="ml-1 text-secondary/60 hover:text-secondary bg-transparent border-0 cursor-pointer p-0 text-[9px]">
                  {ollamaLoading ? "…" : "↻"}
                </button>
              {/if}
            </label>
            {#if config.provider === "ollama"}
              {#if ollamaError}
                <div class="text-[9px] font-mono text-error/60 mb-1">{ollamaError}</div>
                <input bind:value={config.model} placeholder="Type model name…" class="config-input" />
              {:else if ollamaLoading}
                <div class="config-input text-outline/40">Loading…</div>
              {:else if ollamaModels.length > 0}
                <select bind:value={config.model} class="config-input">
                  {#each ollamaModels as m}<option value={m.name}>{m.label}</option>{/each}
                </select>
              {:else}
                <input bind:value={config.model} placeholder="No models found — type name" class="config-input" />
              {/if}
            {:else if modelOptions.length > 0}
              <select bind:value={config.model} class="config-input">
                {#each modelOptions as m}<option value={m.value}>{m.label}</option>{/each}
              </select>
            {:else}
              <input bind:value={config.model} placeholder="Model name…" class="config-input" />
            {/if}
          </div>
        </div>
        <!-- Custom model override -->
        {#if modelOptions.length > 0 && config.provider !== "ollama"}
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
      </div>
    {/if}
  </div>

  <!-- ── Section: Persona ────────────────────────────────────────────── -->
  <div class="border border-outline-variant/15 rounded-lg overflow-hidden">
    <button type="button"
      class="w-full flex items-center gap-2 px-3 py-2 bg-surface-container-lowest/40 border-0 cursor-pointer hover:bg-surface-container-low/50 transition-colors text-left"
      onclick={() => toggle("persona")}>
      <span class="material-symbols-outlined text-[13px] text-secondary/70">face</span>
      <span class="font-mono font-semibold text-on-surface/80">Persona</span>
      <span class="ml-2 text-[9px] font-mono {config.persona?.enabled ? 'text-secondary/60' : 'text-outline/40'}">
        {config.persona?.enabled ? (config.persona.role || "custom") : "off"}
      </span>
      <span class="ml-auto material-symbols-outlined text-[13px] text-outline/40 transition-transform {openSections.has('persona') ? '' : '-rotate-90'}">expand_more</span>
    </button>
    {#if openSections.has("persona")}
      <div class="px-3 py-3 space-y-3 border-t border-outline-variant/10">
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

  <!-- ── Section: Strategy ────────────────────────────────────────────── -->
  <div class="border border-outline-variant/15 rounded-lg overflow-hidden">
    <button type="button"
      class="w-full flex items-center gap-2 px-3 py-2 bg-surface-container-lowest/40 border-0 cursor-pointer hover:bg-surface-container-low/50 transition-colors text-left"
      onclick={() => toggle("strategy")}>
      <span class="material-symbols-outlined text-[13px] text-secondary/70">psychology</span>
      <span class="font-mono font-semibold text-on-surface/80">Reasoning Strategy</span>
      <span class="ml-2 text-[9px] font-mono text-secondary/50">{config.strategy}</span>
      <span class="ml-auto material-symbols-outlined text-[13px] text-outline/40 transition-transform {openSections.has('strategy') ? '' : '-rotate-90'}">expand_more</span>
    </button>
    {#if openSections.has("strategy")}
      <div class="px-3 py-3 space-y-3 border-t border-outline-variant/10">
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
            class="flex-shrink-0 w-10 h-5 rounded-full border-0 cursor-pointer relative transition-colors
                   {config.strategySwitching ? 'bg-primary' : 'bg-surface-container-highest'}">
            <span class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
                         {config.strategySwitching ? 'left-5.5' : 'left-0.5'}"></span>
          </button>
        </div>
        <div>
          <label for="verification-step" class="config-label">Verification Step</label>
          <select id="verification-step" bind:value={config.verificationStep} class="config-input">
            <option value="none">None — trust first answer</option>
            <option value="reflect">Reflect — LLM self-review pass</option>
          </select>
        </div>
      </div>
    {/if}
  </div>

  <!-- ── Section: Tools ───────────────────────────────────────────────── -->
  {#if !compact}
  <div class="border border-outline-variant/15 rounded-lg overflow-hidden">
    <button type="button"
      class="w-full flex items-center gap-2 px-3 py-2 bg-surface-container-lowest/40 border-0 cursor-pointer hover:bg-surface-container-low/50 transition-colors text-left"
      onclick={() => toggle("tools")}>
      <span class="material-symbols-outlined text-[13px] text-tertiary/70">construction</span>
      <span class="font-mono font-semibold text-on-surface/80">Tools</span>
      <span class="ml-2 text-[9px] font-mono text-tertiary/50">{config.tools.length} active</span>
      <span class="ml-auto material-symbols-outlined text-[13px] text-outline/40 transition-transform {openSections.has('tools') ? '' : '-rotate-90'}">expand_more</span>
    </button>
    {#if openSections.has("tools")}
      <div class="px-3 py-3 border-t border-outline-variant/10">
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

  <!-- ── Section: Sub-agents (static / remote) ─────────────────────────── -->
  {#if !compact}
  <div class="border border-outline-variant/15 rounded-lg overflow-hidden">
    <button type="button"
      class="w-full flex items-center gap-2 px-3 py-2 bg-surface-container-lowest/40 border-0 cursor-pointer hover:bg-surface-container-low/50 transition-colors text-left"
      onclick={() => toggle("subagents")}>
      <span class="material-symbols-outlined text-[13px] text-primary/70">hub</span>
      <span class="font-mono font-semibold text-on-surface/80">Sub-agents</span>
      <span class="ml-2 text-[9px] font-mono text-outline/50">{(config.agentTools ?? []).length} registered</span>
      <span class="ml-auto material-symbols-outlined text-[13px] text-outline/40 transition-transform {openSections.has('subagents') ? '' : '-rotate-90'}">expand_more</span>
    </button>
    {#if openSections.has("subagents")}
      <div class="px-3 py-3 border-t border-outline-variant/10 space-y-3">
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
                  <label class="config-label">Tool name</label>
                  <input class="config-input" value={at.toolName}
                    oninput={(e) => patchAgentTool(i, { ...at, toolName: (e.target as HTMLInputElement).value })} />
                </div>
                <div class="col-span-2">
                  <label class="config-label">Remote URL</label>
                  <input class="config-input font-mono text-[10px]" value={at.remoteUrl}
                    oninput={(e) => patchAgentTool(i, { ...at, remoteUrl: (e.target as HTMLInputElement).value })} />
                </div>
              </div>
            {:else}
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="config-label">Tool name</label>
                  <input class="config-input" value={at.toolName}
                    oninput={(e) => patchAgentTool(i, { ...at, toolName: (e.target as HTMLInputElement).value })} />
                </div>
                <div>
                  <label class="config-label">Display name</label>
                  <input class="config-input" value={at.agent.name}
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, name: (e.target as HTMLInputElement).value } })} />
                </div>
                <div class="col-span-2">
                  <label class="config-label">Description</label>
                  <input class="config-input" value={at.agent.description ?? ""}
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, description: (e.target as HTMLInputElement).value } })} />
                </div>
                <div>
                  <label class="config-label">Provider <span class="normal-case text-outline/40">(optional)</span></label>
                  <input class="config-input" value={at.agent.provider ?? ""} placeholder="inherit"
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, provider: (e.target as HTMLInputElement).value || undefined } })} />
                </div>
                <div>
                  <label class="config-label">Model <span class="normal-case text-outline/40">(optional)</span></label>
                  <input class="config-input" value={at.agent.model ?? ""} placeholder="inherit"
                    oninput={(e) => patchAgentTool(i, { ...at, agent: { ...at.agent, model: (e.target as HTMLInputElement).value || undefined } })} />
                </div>
                <div>
                  <label class="config-label">Max iterations</label>
                  <input type="number" min="1" max="50" class="config-input" value={at.agent.maxIterations ?? 8}
                    oninput={(e) => patchAgentTool(i, {
                      ...at,
                      agent: { ...at.agent, maxIterations: Math.max(1, parseInt((e.target as HTMLInputElement).value || "8", 10)) },
                    })} />
                </div>
                <div class="col-span-2">
                  <label class="config-label">Sub-agent tools <span class="normal-case text-outline/40">(comma-separated)</span></label>
                  <input class="config-input font-mono text-[10px]"
                    value={(at.agent.tools ?? []).join(", ")}
                    oninput={(e) => {
                      const raw = (e.target as HTMLInputElement).value;
                      const tools = raw.split(",").map((s) => s.trim()).filter(Boolean);
                      patchAgentTool(i, { ...at, agent: { ...at.agent, tools: tools.length ? tools : undefined } });
                    }} />
                </div>
                <div class="col-span-2">
                  <label class="config-label">System prompt</label>
                  <textarea rows="2" class="config-input resize-none" value={at.agent.systemPrompt ?? ""}
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

  <!-- ── Section: Memory ──────────────────────────────────────────────── -->
  <div class="border border-outline-variant/15 rounded-lg overflow-hidden">
    <button type="button"
      class="w-full flex items-center gap-2 px-3 py-2 bg-surface-container-lowest/40 border-0 cursor-pointer hover:bg-surface-container-low/50 transition-colors text-left"
      onclick={() => toggle("memory")}>
      <span class="material-symbols-outlined text-[13px] text-primary/70">account_tree</span>
      <span class="font-mono font-semibold text-on-surface/80">Memory</span>
      <span class="ml-auto material-symbols-outlined text-[13px] text-outline/40 transition-transform {openSections.has('memory') ? '' : '-rotate-90'}">expand_more</span>
    </button>
    {#if openSections.has("memory")}
      <div class="px-3 py-3 space-y-2 border-t border-outline-variant/10">
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

  <!-- ── Section: Guardrails ──────────────────────────────────────────── -->
  <div class="border border-outline-variant/15 rounded-lg overflow-hidden">
    <button type="button"
      class="w-full flex items-center gap-2 px-3 py-2 bg-surface-container-lowest/40 border-0 cursor-pointer hover:bg-surface-container-low/50 transition-colors text-left"
      onclick={() => toggle("guardrails")}>
      <span class="material-symbols-outlined text-[13px] text-error/60">security</span>
      <span class="font-mono font-semibold text-on-surface/80">Guardrails</span>
      <span class="ml-2 text-[9px] font-mono {config.guardrails.enabled ? 'text-secondary/60' : 'text-outline/40'}">
        {config.guardrails.enabled ? "enabled" : "disabled"}
      </span>
      <span class="ml-auto material-symbols-outlined text-[13px] text-outline/40 transition-transform {openSections.has('guardrails') ? '' : '-rotate-90'}">expand_more</span>
    </button>
    {#if openSections.has("guardrails")}
      <div class="px-3 py-3 space-y-3 border-t border-outline-variant/10">
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
  <!-- ── Section: Execution Controls ──────────────────────────────────── -->
  <div class="border border-outline-variant/15 rounded-lg overflow-hidden">
    <button type="button"
      class="w-full flex items-center gap-2 px-3 py-2 bg-surface-container-lowest/40 border-0 cursor-pointer hover:bg-surface-container-low/50 transition-colors text-left"
      onclick={() => toggle("execution")}>
      <span class="material-symbols-outlined text-[13px] text-tertiary/70">timer</span>
      <span class="font-mono font-semibold text-on-surface/80">Execution Controls</span>
      <span class="ml-2 text-[9px] font-mono text-outline/40">
        {[
          config.timeout > 0 ? `${Math.round(config.timeout/1000)}s timeout` : null,
          config.retryPolicy.enabled ? `${config.retryPolicy.maxRetries} retries` : null,
          config.progressCheckpoint > 0 ? `ckpt/${config.progressCheckpoint}` : null,
        ].filter(Boolean).join(" · ") || "defaults"}
      </span>
      <span class="ml-auto material-symbols-outlined text-[13px] text-outline/40 transition-transform {openSections.has('execution') ? '' : '-rotate-90'}">expand_more</span>
    </button>
    {#if openSections.has("execution")}
      <div class="px-3 py-3 space-y-3 border-t border-outline-variant/10">
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

  <!-- ── Section: Meta Tools (Conductor's Suite) ───────────────────────── -->
  <div class="border border-outline-variant/15 rounded-lg overflow-hidden">
    <button type="button"
      class="w-full flex items-center gap-2 px-3 py-2 bg-surface-container-lowest/40 border-0 cursor-pointer hover:bg-surface-container-low/50 transition-colors text-left"
      onclick={() => toggle("metatools")}>
      <span class="material-symbols-outlined text-[13px] text-secondary/70">wand_stars</span>
      <span class="font-mono font-semibold text-on-surface/80">Meta Tools</span>
      <span class="ml-2 text-[9px] font-mono {config.metaTools.enabled ? 'text-secondary/60' : 'text-outline/40'}">
        {config.metaTools.enabled
          ? [config.metaTools.brief && 'brief', config.metaTools.find && 'find', config.metaTools.pulse && 'pulse', config.metaTools.recall && 'recall'].filter(Boolean).join(', ') || 'none active'
          : 'off'}
      </span>
      <span class="ml-auto material-symbols-outlined text-[13px] text-outline/40 transition-transform {openSections.has('metatools') ? '' : '-rotate-90'}">expand_more</span>
    </button>
    {#if openSections.has("metatools")}
      <div class="px-3 py-3 space-y-2 border-t border-outline-variant/10">
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

  <!-- ── Section: Reliability (Fallbacks) ─────────────────────────────── -->
  <div class="border border-outline-variant/15 rounded-lg overflow-hidden">
    <button type="button"
      class="w-full flex items-center gap-2 px-3 py-2 bg-surface-container-lowest/40 border-0 cursor-pointer hover:bg-surface-container-low/50 transition-colors text-left"
      onclick={() => toggle("reliability")}>
      <span class="material-symbols-outlined text-[13px] text-secondary/70">shield</span>
      <span class="font-mono font-semibold text-on-surface/80">Reliability</span>
      <span class="ml-2 text-[9px] font-mono {config.fallbacks.enabled ? 'text-secondary/60' : 'text-outline/40'}">
        {config.fallbacks.enabled ? `${config.fallbacks.providers.length} fallback${config.fallbacks.providers.length !== 1 ? 's' : ''}` : 'off'}
      </span>
      <span class="ml-auto material-symbols-outlined text-[13px] text-outline/40 transition-transform {openSections.has('reliability') ? '' : '-rotate-90'}">expand_more</span>
    </button>
    {#if openSections.has("reliability")}
      <div class="px-3 py-3 space-y-3 border-t border-outline-variant/10">
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

  <!-- ── Section: Observability ─────────────────────────────────────────── -->
  <div class="border border-outline-variant/15 rounded-lg overflow-hidden">
    <button type="button"
      class="w-full flex items-center gap-2 px-3 py-2 bg-surface-container-lowest/40 border-0 cursor-pointer hover:bg-surface-container-low/50 transition-colors text-left"
      onclick={() => toggle("observability")}>
      <span class="material-symbols-outlined text-[13px] text-outline/60">monitoring</span>
      <span class="font-mono font-semibold text-on-surface/80">Observability</span>
      <span class="ml-2 text-[9px] font-mono {config.observabilityVerbosity !== 'off' ? 'text-secondary/60' : 'text-outline/40'}">
        {config.observabilityVerbosity}
      </span>
      <span class="ml-auto material-symbols-outlined text-[13px] text-outline/40 transition-transform {openSections.has('observability') ? '' : '-rotate-90'}">expand_more</span>
    </button>
    {#if openSections.has("observability")}
      <div class="px-3 py-3 space-y-2 border-t border-outline-variant/10">
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

  {/if}<!-- end !compact -->
</div>

<style>
  .config-label {
    display: block;
    font-family: ui-monospace, monospace;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgb(136 139 150 / 0.8);
    margin-bottom: 4px;
  }
  .config-input {
    width: 100%;
    background: rgb(15 17 21 / 0.6);
    border: 1px solid rgb(53 56 65 / 0.4);
    border-radius: 6px;
    padding: 5px 10px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: rgb(236 238 242);
    outline: none;
  }
  .config-input:focus {
    border-color: rgb(139 92 246 / 0.5);
  }
  .config-input::placeholder { color: rgb(136 139 150 / 0.4); }
</style>
