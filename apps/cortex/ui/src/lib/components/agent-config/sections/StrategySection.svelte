<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
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
    /** All framework options render as their own section (Lab builder nav): leave them out here. */
    splitFramework?: boolean;
  }
  let { config = $bindable(), open, onToggle, strategies: STRATEGIES, strategyLabel: acpStrategyLabel, manifest: capManifest, splitFramework = false }: Props = $props();

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

<ConfigSection id="strategy" icon="strategy" title="Reasoning" {open} {onToggle}>
  {#snippet head()}
      <span class="truncate">{acpStrategyLabel}</span>
  {/snippet}
        <div class="acp-choices" role="radiogroup" aria-label="Strategy">
          {#each STRATEGIES as s (s.value)}
            <label class="acp-choice" class:on={config.strategy === s.value}>
              <input type="radio" name="strategy" value={s.value}
                checked={config.strategy === s.value}
                onchange={() => (config = { ...config, strategy: s.value as AgentConfig["strategy"] })} />
              <span>
                <span class="acp-check-t">{s.label}</span>
                <span class="acp-hint">{s.desc}</span>
              </span>
            </label>
          {/each}
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="acp-field">
            <label for="max-iterations" class="config-label">Max iterations</label>
            <input id="max-iterations" type="number" min="1" max="100" bind:value={config.maxIterations}
              class="config-input acp-mono" />
          </div>
          <div class="acp-field">
            <label for="min-iterations" class="config-label">Min iterations</label>
            <input id="min-iterations" type="number" min="0" max="20" bind:value={config.minIterations}
              class="config-input acp-mono" />
          </div>
        </div>
        <Switch id="acp-durable-runs" label="Durable execution"
          hint="Resumes after a crash and can pause for your approval (survives a restart). Turns reasoning on."
          checked={config.durableRuns.enabled}
          onchange={(on) => (config = { ...config, durableRuns: { ...config.durableRuns, enabled: on } })} />
        {#if config.durableRuns.enabled}
          <div class="acp-card">
            <span class="config-label mb-0">Approval-gated tools</span>
            {#if config.tools.length === 0}
              <p class="acp-hint">Add tools first; a gated tool pauses the run until you approve it.</p>
            {:else}
              <div class="acp-chips" role="group" aria-label="Approval-gated tools">
                {#each config.tools as toolName (toolName)}
                  {@const gated = config.durableRuns.approvalTools.includes(toolName)}
                  <button type="button" class="acp-toolchip" aria-pressed={gated}
                    onclick={() => (config = { ...config, durableRuns: { ...config.durableRuns, approvalTools: gated ? config.durableRuns.approvalTools.filter((t) => t !== toolName) : [...config.durableRuns.approvalTools, toolName] } })}>
                    {#if gated}<Icon name="check" size="sm" />{/if}{toolName}
                  </button>
                {/each}
              </div>
              <label for="acp-approval-mode" class="config-label mt-2">When a gated tool is called</label>
              <select id="acp-approval-mode" class="config-input" value={config.durableRuns.approvalMode ?? "detach"}
                onchange={(e) => (config = { ...config, durableRuns: { ...config.durableRuns, approvalMode: (e.currentTarget as HTMLSelectElement).value === "block" ? "block" : "detach" } })}>
                <option value="detach">Pause the run; it resumes after approval</option>
                <option value="block">Wait in place until approved</option>
              </select>
            {/if}
          </div>
        {/if}
        <Switch id="acp-strategy-switching" label="Switch strategy when stuck"
          hint="The framework may move to another strategy when the agent stops making progress."
          checked={config.strategySwitching}
          onchange={(on) => (config = { ...config, strategySwitching: on })} />
        <div>
          <div class="config-label">Structured output (JSON Schema)</div>
          <textarea bind:value={config.outputSchema} rows="6" spellcheck="false"
            placeholder={'{\n  "type": "object",\n  "properties": { "name": { "type": "string" } },\n  "required": ["name"]\n}'}
            class="config-input acp-mono"></textarea>
          {#if outputSchemaText !== ''}
            <p class="mt-1 acp-hint" class:acp-ok={outputSchemaValid} class:acp-bad={!outputSchemaValid}>
              {outputSchemaValid ? 'Valid: the answer is extracted into result.object.' : 'Not valid JSON: the schema is ignored until it is fixed.'}
            </p>
            <OutputSchemaParseFailField bind:value={config.outputSchemaOnParseFail} />
          {:else}
            <p class="mt-1 acp-hint">Optional — extract the agent's answer into a typed object (<code>.withOutputSchema</code>). Result shows in the run's Structured Output view.</p>
          {/if}
        </div>
        <div>
          <div class="config-label">Harness config (JSON)</div>
          <textarea bind:value={config.harness} rows="6" spellcheck="false"
            placeholder={'{\n  "lazyDisclosure": false,\n  "verboseRules": true,\n  "toolIndex": true\n}'}
            class="config-input acp-mono"></textarea>
          <p class="mt-1 acp-hint">Optional — typed harness control surface (<code>.withHarness</code>): tool disclosure, discovery, index, verbose rules, context budgets.</p>
        </div>
        <div>
          <div class="config-label">Documents (JSON array, RAG)</div>
          <textarea bind:value={config.documents} rows="6" spellcheck="false"
            placeholder={'[\n  { "source": "./docs/README.md", "format": "markdown" }\n]'}
            class="config-input acp-mono"></textarea>
          <p class="mt-1 acp-hint">Optional — ingest documents for retrieval (.withDocuments). Each entry needs source (path) or content.</p>
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
        <p class="-mt-1 acp-hint">Run terminates when a cap is crossed (<code>.withBudget</code>).</p>
        <div>
          <label for="grounding-mode" class="config-label">Evidence grounding</label>
          <select id="grounding-mode" bind:value={config.grounding.mode} class="config-input">
            <option value="off">Off</option>
            <option value="warn">Warn — flag ungrounded figures</option>
            <option value="block">Block — one corrective retry, then degrade</option>
          </select>
          <p class="mt-1 acp-hint">Checks numbers in the answer against tool data (<code>.withGrounding</code>); never hard-fails.</p>
        </div>
        <div>
          <label for="fabrication-guard-mode" class="config-label">Fabrication guard</label>
          <select id="fabrication-guard-mode" bind:value={config.fabricationGuard.mode} class="config-input">
            <option value="default">Default — always on, block</option>
            <option value="off">Off</option>
            <option value="warn">Warn — flag invented entities/measurements</option>
            <option value="block">Block — one corrective retry, then degrade</option>
          </select>
          <p class="mt-1 acp-hint">Distinct from evidence grounding above — catches invented named entities and measurements not backed by tool evidence. Always-on at Block even if left at Default (<code>.withFabricationGuard</code>).</p>
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
          <p class="mt-1 acp-hint">Routes each turn to the cheapest capable model for the provider (<code>.withModelRouting</code>); degrades to the configured model on any routing error.</p>
        </div>
        <div>
          <label for="verification-step" class="config-label">Verification step</label>
          <select id="verification-step" bind:value={config.verificationStep} class="config-input">
            <option value="none">None — trust first answer</option>
            <option value="reflect">Reflect — LLM self-review pass</option>
          </select>
          <p class="mt-1 acp-hint leading-relaxed">
            Reflect runs one extra LLM pass on the draft answer. It is not the same as the framework verification layer below.
          </p>
        </div>
        <label class="acp-check acp-check-box">
          <input type="checkbox" bind:checked={config.runtimeVerification} />
          <span>
            <span class="acp-check-t">Runtime verification layer</span>
            <span class="acp-hint">Turns on <code>@reactive-agents/verification</code> (semantic entropy and related checks). Adds latency and provider calls; use it when you want automated confidence signals, not only a reflect pass.</span>
          </span>
        </label>
        <label class="acp-check acp-check-box">
          <input type="checkbox" bind:checked={config.auditRationale} />
          <span>
            <span class="acp-check-t">Decision rationale in the debrief</span>
            <span class="acp-hint">Records the model's reason for each tool call, for audit. A cross-tier ablation found it adds latency and output tokens with no measured quality gain, and it can lower answer quality on small local models. Leave it off unless you need the audit trail.</span>
          </span>
        </label>

        <!-- Generic framework-config renderer — auto-synced from the manifest -->
        {#if !splitFramework}<AdvancedFrameworkConfig manifest={capManifest} bind:rawConfig={config.rawConfig} />{/if}

        <!-- Lifecycle webhooks -->
        <div class="acp-card">
          <div class="flex items-center justify-between gap-2">
            <span class="config-label mb-0">Lifecycle webhooks</span>
            <Button size="sm" icon="plus" onclick={addWebhook}>Add URL</Button>
          </div>
          <p class="acp-hint">
            The server posts a JSON payload to each URL when a run starts, finishes or fails. Fire and forget; saved agents only.
          </p>
          {#each config.lifecycleWebhooks ?? [] as wh, i (i)}
            <div class="acp-stack" style="gap: 8px">
              <div class="flex items-center gap-1">
                <input
                  type="url"
                  placeholder="https://example.com/hook"
                  aria-label="Webhook URL {i + 1}"
                  value={wh.url}
                  oninput={(e) => updateWebhookUrl(i, (e.target as HTMLInputElement).value)}
                  class="config-input acp-mono flex-1 min-w-0"
                />
                <IconButton icon="trash" label="Remove webhook" onclick={() => removeWebhook(i)} />
              </div>
              <div class="acp-chips" role="group" aria-label="Events for webhook {i + 1}">
                {#each LIFECYCLE_EVENTS as ev (ev)}
                  <button type="button" class="acp-toolchip" aria-pressed={webhookHasEvent(wh, ev)} onclick={() => toggleWebhookEvent(i, ev)}>{ev}</button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
</ConfigSection>
