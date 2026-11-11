<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import OutputSchemaParseFailField from "$lib/components/OutputSchemaParseFailField.svelte";
  import AdvancedFrameworkConfig from "$lib/components/AdvancedFrameworkConfig.svelte";
  import type { AgentConfig } from "$lib/types/agent-config.js";
  import type { CapabilityManifest } from "$lib/capabilities.js";
  import type { PanelAgentConfig, StrategyOption } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
    /** Strategy options (capability manifest, or the fallback list). */
    strategies: StrategyOption[];
    /** Display name of the selected strategy. */
    strategyLabel: string;
    /** Capability manifest (drives the generic framework-config renderer); null until loaded. */
    manifest: CapabilityManifest | null;
  }
  let { config = $bindable(), open, onToggle, strategies: STRATEGIES, strategyLabel: acpStrategyLabel, manifest: capManifest }: Props = $props();

  // Structured-output schema validity (for the editor hint).
  const outputSchemaText = $derived((config.outputSchema ?? "").trim());
  const outputSchemaValid = $derived.by(() => {
    if (outputSchemaText === "") return false;
    try {
      const p = JSON.parse(outputSchemaText) as unknown;
      return p != null && typeof p === "object" && !Array.isArray(p);
    } catch {
      return false;
    }
  });

  // ── Lifecycle webhooks ────────────────────────────────────────────────
  const LIFECYCLE_EVENTS = ["AgentStarted", "AgentCompleted", "TaskFailed", "DebriefCompleted"] as const;

  function addWebhook() {
    config = { ...config, lifecycleWebhooks: [...(config.lifecycleWebhooks ?? []), { url: "", events: [] }] };
  }
  function removeWebhook(i: number) {
    config = { ...config, lifecycleWebhooks: (config.lifecycleWebhooks ?? []).filter((_, j) => j !== i) };
  }
  function updateWebhookUrl(i: number, url: string) {
    config = {
      ...config,
      lifecycleWebhooks: (config.lifecycleWebhooks ?? []).map((w, j) => (j === i ? { ...w, url } : w)),
    };
  }
  function webhookHasEvent(wh: { events: string[] }, ev: string): boolean {
    return wh.events.length === 0 || wh.events.includes(ev);
  }
  function toggleWebhookEvent(i: number, ev: string) {
    config = {
      ...config,
      lifecycleWebhooks: (config.lifecycleWebhooks ?? []).map((w, j) => {
        if (j !== i) return w;
        // Empty = all; first click narrows to the full set minus the toggled one.
        const base = w.events.length === 0 ? [...LIFECYCLE_EVENTS] : w.events;
        const next = base.includes(ev) ? base.filter((e) => e !== ev) : [...base, ev];
        return { ...w, events: next };
      }),
    };
  }
</script>

<ConfigSection id="strategy" {open} {onToggle}>
  {#snippet head()}
      <span class="material-symbols-outlined text-[15px] text-secondary/85 shrink-0" aria-hidden="true">psychology</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Reasoning</span>
      <span class="ml-2 truncate font-mono text-[11px] text-[var(--cortex-text-muted)]">{acpStrategyLabel}</span>
      <span class="ml-2 font-mono text-[11px] text-primary/80">{config.strategy}</span>
  {/snippet}
        <div class="space-y-1.5">
          {#each STRATEGIES as s}
            <label class="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-surface-container-low/40 transition-colors
                          {config.strategy === s.value ? 'bg-primary/10 border border-primary/20' : 'border border-transparent'}">
              <input type="radio" name="strategy" value={s.value}
                checked={config.strategy === s.value}
                onchange={() => (config = { ...config, strategy: s.value as AgentConfig["strategy"] })}
                class="mt-0.5 accent-primary flex-shrink-0" />
              <div>
                <div class="font-mono text-[11px] font-semibold text-on-surface/80">{s.label}</div>
                <div class="font-mono text-[11px] text-outline/70 mt-0.5">{s.desc}</div>
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
            <div class="font-mono text-[11px] text-on-surface/70">Durable execution</div>
            <div class="font-mono text-[11px] text-outline/70">Crash-resume + human approval gate (survives restart). Forces reasoning on.</div>
          </div>
          <button type="button" onclick={() => (config = { ...config, durableRuns: { ...config.durableRuns, enabled: !config.durableRuns.enabled } })}
            aria-label="Toggle durable execution"
            aria-pressed={config.durableRuns.enabled}
            class="flex-shrink-0 w-10 h-5 rounded-full border-0 cursor-pointer relative transition-colors duration-200
                   {config.durableRuns.enabled ? 'bg-primary' : 'bg-surface-container-highest'}">
            <span class="pointer-events-none absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ease-out
                         {config.durableRuns.enabled ? 'translate-x-5' : 'translate-x-0'}"></span>
          </button>
        </div>
        {#if config.durableRuns.enabled}
          <div class="rounded-lg border border-[var(--cortex-border)] bg-surface-container-low/30 p-2.5">
            <div class="font-mono text-[11px] uppercase tracking-wide text-outline/75 mb-1.5">Approval-gated tools</div>
            {#if config.tools.length === 0}
              <div class="font-mono text-[11px] text-outline/70">Add tools above; gated tools pause the run for approval.</div>
            {:else}
              <div class="flex flex-wrap gap-1.5">
                {#each config.tools as toolName (toolName)}
                  {@const gated = config.durableRuns.approvalTools.includes(toolName)}
                  <button type="button"
                    onclick={() => (config = { ...config, durableRuns: { ...config.durableRuns, approvalTools: gated ? config.durableRuns.approvalTools.filter((t) => t !== toolName) : [...config.durableRuns.approvalTools, toolName] } })}
                    class="rounded-md border px-2 py-1 font-mono text-[11px] transition-colors
                           {gated ? 'border-primary bg-primary/15 text-primary' : 'border-[var(--cortex-border)] text-on-surface/60 hover:text-on-surface'}">
                    {gated ? '✓ ' : ''}{toolName}
                  </button>
                {/each}
              </div>
              <label for="acp-approval-mode" class="config-label mt-2.5">When a gated tool is called</label>
              <select id="acp-approval-mode" class="config-input text-[11px]" value={config.durableRuns.approvalMode ?? "detach"}
                onchange={(e) => (config = { ...config, durableRuns: { ...config.durableRuns, approvalMode: (e.currentTarget as HTMLSelectElement).value === "block" ? "block" : "detach" } })}>
                <option value="detach">Pause the run; it resumes after approval</option>
                <option value="block">Wait in place until approved</option>
              </select>
            {/if}
          </div>
        {/if}
        <div class="flex items-center justify-between">
          <div>
            <div class="font-mono text-[11px] text-on-surface/70">Auto-switch strategy</div>
            <div class="font-mono text-[11px] text-outline/70">Switch strategy if agent gets stuck</div>
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
          <div class="config-label">Structured output (JSON Schema)</div>
          <textarea bind:value={config.outputSchema} rows="6" spellcheck="false"
            placeholder={'{\n  "type": "object",\n  "properties": { "name": { "type": "string" } },\n  "required": ["name"]\n}'}
            class="config-input font-mono text-[11px] leading-snug"></textarea>
          {#if outputSchemaText !== ''}
            <p class="mt-1 font-mono text-[10px] {outputSchemaValid ? 'text-tertiary' : 'text-[var(--cortex-bad)]'}">
              {outputSchemaValid ? '✓ Valid — answer extracted into result.object' : '✗ Invalid JSON — schema ignored until fixed'}
            </p>
            <OutputSchemaParseFailField bind:value={config.outputSchemaOnParseFail} />
          {:else}
            <p class="mt-1 font-mono text-[10px] text-[var(--cortex-text-muted)]">Optional — extract the agent's answer into a typed object (<code class="text-[10px]">.withOutputSchema</code>). Result shows in the run's Structured Output view.</p>
          {/if}
        </div>
        <div>
          <div class="config-label">Harness config (JSON)</div>
          <textarea bind:value={config.harness} rows="6" spellcheck="false"
            placeholder={'{\n  "lazyDisclosure": false,\n  "verboseRules": true,\n  "toolIndex": true\n}'}
            class="config-input font-mono text-[11px] leading-snug"></textarea>
          <p class="mt-1 font-mono text-[10px] text-[var(--cortex-text-muted)]">Optional — typed harness control surface (<code class="text-[10px]">.withHarness</code>): tool disclosure, discovery, index, verbose rules, context budgets.</p>
        </div>
        <div>
          <div class="config-label">Documents (JSON array, RAG)</div>
          <textarea bind:value={config.documents} rows="6" spellcheck="false"
            placeholder={'[\n  { "source": "./docs/README.md", "format": "markdown" }\n]'}
            class="config-input font-mono text-[11px] leading-snug"></textarea>
          <p class="mt-1 font-mono text-[10px] text-[var(--cortex-text-muted)]">Optional — ingest documents for retrieval (.withDocuments). Each entry needs source (path) or content.</p>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label for="budget-tokens" class="config-label">Token budget</label>
            <input id="budget-tokens" type="number" min="0" step="1000" bind:value={config.budget.tokenLimit}
              placeholder="0 = none" class="config-input" />
          </div>
          <div>
            <label for="budget-cost" class="config-label">Cost cap (USD)</label>
            <input id="budget-cost" type="number" min="0" step="0.01" bind:value={config.budget.costLimit}
              placeholder="0 = none" class="config-input" />
          </div>
        </div>
        <p class="-mt-1 font-mono text-[10px] text-[var(--cortex-text-muted)]">Run terminates when a cap is crossed (<code class="text-[10px]">.withBudget</code>).</p>
        <div>
          <label for="grounding-mode" class="config-label">Evidence grounding</label>
          <select id="grounding-mode" bind:value={config.grounding.mode} class="config-input">
            <option value="off">Off</option>
            <option value="warn">Warn — flag ungrounded figures</option>
            <option value="block">Block — one corrective retry, then degrade</option>
          </select>
          <p class="mt-1 font-mono text-[10px] text-[var(--cortex-text-muted)]">Checks numbers in the answer against tool data (<code class="text-[10px]">.withGrounding</code>); never hard-fails.</p>
        </div>
        <div>
          <label for="fabrication-guard-mode" class="config-label">Fabrication guard</label>
          <select id="fabrication-guard-mode" bind:value={config.fabricationGuard.mode} class="config-input">
            <option value="default">Default — always on, block</option>
            <option value="off">Off</option>
            <option value="warn">Warn — flag invented entities/measurements</option>
            <option value="block">Block — one corrective retry, then degrade</option>
          </select>
          <p class="mt-1 font-mono text-[10px] text-[var(--cortex-text-muted)]">Distinct from evidence grounding above — catches invented named entities and measurements not backed by tool evidence. Always-on at Block even if left at Default (<code class="text-[10px]">.withFabricationGuard</code>).</p>
        </div>
        <div>
          <label class="config-label flex items-center gap-2">
            <input type="checkbox" bind:checked={config.modelRouting.enabled} />
            Cost-aware model routing
          </label>
          {#if config.modelRouting.enabled}
            <label for="routing-min-tier" class="config-label mt-1">Minimum tier</label>
            <select id="routing-min-tier" bind:value={config.modelRouting.minTier} class="config-input">
              <option value={undefined}>Auto — cheapest capable</option>
              <option value="haiku">Haiku</option>
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
            </select>
          {/if}
          <p class="mt-1 font-mono text-[10px] text-[var(--cortex-text-muted)]">Routes each turn to the cheapest capable model for the provider (<code class="text-[10px]">.withModelRouting</code>); degrades to the configured model on any routing error.</p>
        </div>
        <div>
          <label for="verification-step" class="config-label">Verification Step</label>
          <select id="verification-step" bind:value={config.verificationStep} class="config-input">
            <option value="none">None — trust first answer</option>
            <option value="reflect">Reflect — LLM self-review pass</option>
          </select>
          <p class="mt-1 font-mono text-[10px] text-[var(--cortex-text-muted)] leading-relaxed">
            Reflect runs one extra LLM pass on the draft answer. It is not the same as the framework verification layer below.
          </p>
        </div>
        <label class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--ra-amber)_35%,var(--cortex-border))] bg-[color-mix(in_srgb,var(--ra-amber)_8%,transparent)] p-2.5">
          <input type="checkbox" bind:checked={config.runtimeVerification} class="accent-primary mt-0.5 shrink-0" />
          <span class="font-mono text-[11px] text-[var(--cortex-text)] leading-snug">
            <span class="font-semibold text-tertiary">Runtime verification layer</span>
            — enables the <code class="text-[10px]">@reactive-agents/verification</code> package (semantic entropy and related checks). Adds latency and provider calls; use when you want automated confidence signals, not only a reflect pass.
          </span>
        </label>
        <label class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--ra-amber)_35%,var(--cortex-border))] bg-[color-mix(in_srgb,var(--ra-amber)_8%,transparent)] p-2.5">
          <input type="checkbox" bind:checked={config.auditRationale} class="accent-primary mt-0.5 shrink-0" />
          <span class="font-mono text-[11px] text-[var(--cortex-text)] leading-snug">
            <span class="font-semibold text-tertiary">Decision rationale in debrief</span>
            — records the model's per-tool-call “why” for audit. <span class="font-semibold text-[var(--cortex-warn)]">Heads-up:</span> a cross-tier ablation found this adds latency and output tokens with no measured quality gain, and it can <em>degrade</em> answer quality on smaller / less-capable local models. Leave off unless you need the audit trail.
          </span>
        </label>

        <!-- Generic framework-config renderer — auto-synced from the manifest -->
        <AdvancedFrameworkConfig manifest={capManifest} bind:rawConfig={config.rawConfig} />

        <!-- Lifecycle webhooks -->
        <div class="acp-card">
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-[11px] uppercase tracking-widest text-[var(--cortex-text-muted)]">Lifecycle webhooks</span>
            <button type="button" onclick={addWebhook}
              class="flex items-center gap-1 rounded border border-[var(--cortex-border)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--cortex-text-muted)] hover:text-primary hover:border-primary/40 transition-colors">
              <span class="material-symbols-outlined text-[12px] leading-none">add</span> Add URL
            </button>
          </div>
          <p class="font-mono text-[10px] text-[var(--cortex-text-muted)] leading-relaxed m-0">
            Server POSTs a JSON payload to each URL on run start / completion / failure. Fire-and-forget; applies to saved agents.
          </p>
          {#each config.lifecycleWebhooks ?? [] as wh, i (i)}
            <div class="space-y-1 rounded border border-[var(--cortex-border)] p-1.5">
              <div class="flex items-center gap-1">
                <input
                  type="url"
                  placeholder="https://example.com/hook"
                  value={wh.url}
                  oninput={(e) => updateWebhookUrl(i, (e.target as HTMLInputElement).value)}
                  class="flex-1 min-w-0 rounded border border-[var(--cortex-border)] bg-[var(--cortex-surface-low)] px-2 py-1 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button type="button" onclick={() => removeWebhook(i)}
                  class="material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] hover:text-error transition-colors p-0.5"
                  aria-label="Remove webhook">delete</button>
              </div>
              <div class="flex flex-wrap gap-1">
                {#each LIFECYCLE_EVENTS as ev (ev)}
                  <button type="button" onclick={() => toggleWebhookEvent(i, ev)}
                    class="rounded-full px-1.5 py-0.5 font-mono text-[10px] border transition-colors
                           {webhookHasEvent(wh, ev) ? 'border-primary/50 text-primary bg-primary/10' : 'border-[var(--cortex-border)] text-[var(--cortex-text-muted)] hover:border-primary/30'}">
                    {ev}
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
</ConfigSection>
