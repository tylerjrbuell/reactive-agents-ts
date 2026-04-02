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
  import type { AgentConfig } from "$lib/types/agent-config.js";
  import { defaultConfig } from "$lib/types/agent-config.js";

  export { type AgentConfig, defaultConfig };

  interface Props {
    config?: AgentConfig;
    /** Whether to show all sections or just inference+strategy */
    compact?: boolean;
  }
  let { config = $bindable(defaultConfig()), compact = false }: Props = $props();

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
      const res = await fetch(`${CORTEX_SERVER_URL}/api/models/ollama`);
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
    { value: "react",                label: "ReAct",                desc: "Think→Act→Observe loop. Best for most tasks." },
    { value: "plan-execute-reflect", label: "Plan–Execute–Reflect", desc: "Creates a structured plan first. Good for multi-step tasks." },
    { value: "tree-of-thought",      label: "Tree of Thought",      desc: "Explores multiple paths. Good for creative/analytical problems." },
    { value: "reflexion",            label: "Reflexion",            desc: "Self-critiques and improves across attempts." },
    { value: "adaptive",             label: "Adaptive",             desc: "Selects strategy automatically based on task type." },
  ];

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
        const parsed = JSON.parse(ev.target?.result as string) as Partial<AgentConfig>;
        config = { ...defaultConfig(), ...parsed };
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
          <label class="config-label">Agent Name <span class="text-outline/30 normal-case font-normal">(optional)</span></label>
          <input bind:value={config.agentName} placeholder="e.g. research-assistant"
            class="config-input" />
        </div>
        <!-- Provider + Model -->
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="config-label">Provider</label>
            <select value={config.provider} onchange={(e) => setProvider((e.target as HTMLSelectElement).value)}
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
            <label class="config-label">Custom model override <span class="text-outline/30 normal-case font-normal">(optional — overrides dropdown)</span></label>
            <input bind:value={config.model} placeholder="e.g. claude-opus-4-6"
              class="config-input" />
          </div>
        {/if}
        <!-- Temperature -->
        <div>
          <label class="config-label flex items-center justify-between">
            Temperature
            <span class="font-mono text-primary tabular-nums">{config.temperature.toFixed(2)}</span>
          </label>
          <input type="range" min="0" max="1" step="0.05"
            bind:value={config.temperature}
            class="w-full accent-primary mt-1" />
          <div class="flex justify-between text-[8px] font-mono text-outline/30 mt-0.5">
            <span>0 — deterministic</span><span>1 — creative</span>
          </div>
        </div>
        <!-- System prompt -->
        <div>
          <label class="config-label">System Prompt <span class="text-outline/30 normal-case font-normal">(optional)</span></label>
          <textarea bind:value={config.systemPrompt}
            placeholder="Custom instructions prepended to every run…"
            rows="3"
            class="config-input resize-none leading-relaxed"></textarea>
        </div>
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
            <label class="config-label">Max Iterations</label>
            <input type="number" min="1" max="100" bind:value={config.maxIterations}
              class="config-input" />
          </div>
          <div>
            <label class="config-label">Min Iterations</label>
            <input type="number" min="0" max="20" bind:value={config.minIterations}
              class="config-input" />
          </div>
        </div>
        <div class="flex items-center justify-between">
          <div>
            <div class="font-mono text-[10px] text-on-surface/70">Auto-switch strategy</div>
            <div class="font-mono text-[9px] text-outline/40">Switch strategy if agent gets stuck</div>
          </div>
          <button type="button" onclick={() => (config = { ...config, strategySwitching: !config.strategySwitching })}
            class="flex-shrink-0 w-10 h-5 rounded-full border-0 cursor-pointer relative transition-colors
                   {config.strategySwitching ? 'bg-primary' : 'bg-surface-container-highest'}">
            <span class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
                         {config.strategySwitching ? 'left-5.5' : 'left-0.5'}"></span>
          </button>
        </div>
        <div>
          <label class="config-label">Verification Step</label>
          <select bind:value={config.verificationStep} class="config-input">
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
      </div>
    {/if}
  </div>

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
          <label class="config-label">Context Synthesis</label>
          <select bind:value={config.contextSynthesis} class="config-input">
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
          {#each [
            { key: "injectionThreshold", label: "Injection Detection" },
            { key: "piiThreshold",       label: "PII Detection" },
            { key: "toxicityThreshold",  label: "Toxicity Filter" },
          ] as g}
            <div>
              <label class="config-label flex items-center justify-between">
                {g.label}
                <span class="font-mono text-primary tabular-nums">
                  {config.guardrails[g.key as keyof typeof config.guardrails].toFixed(2)}
                </span>
              </label>
              <input type="range" min="0.1" max="1.0" step="0.05"
                value={config.guardrails[g.key as keyof typeof config.guardrails]}
                oninput={(e) => (config = { ...config, guardrails: { ...config.guardrails, [g.key]: parseFloat((e.target as HTMLInputElement).value) } })}
                class="w-full accent-primary" />
            </div>
          {/each}
        {/if}
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
