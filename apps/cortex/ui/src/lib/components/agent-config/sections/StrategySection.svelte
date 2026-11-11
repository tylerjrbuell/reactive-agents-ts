<script lang="ts">
  /**
   * Reasoning: the strategy, how many loops it may take, and how it checks its
   * work (verification, grounding, fabrication guard, harness). Run lifecycle
   * (durable runs, budget, output schema, webhooks) is in Execution, approvals in
   * Tools, documents in Memory, model routing in Model.
   */
  import ConfigSection from "../ConfigSection.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
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
        <Switch id="acp-strategy-switching" label="Switch strategy when stuck"
          hint="The framework may move to another strategy when the agent stops making progress."
          checked={config.strategySwitching}
          onchange={(on) => (config = { ...config, strategySwitching: on })} />
        <div>
          <div class="config-label">Harness config (JSON)</div>
          <textarea bind:value={config.harness} rows="6" spellcheck="false"
            placeholder={'{\n  "lazyDisclosure": false,\n  "verboseRules": true,\n  "toolIndex": true\n}'}
            class="config-input acp-mono"></textarea>
          <p class="mt-1 acp-hint">Optional — typed harness control surface (<code>.withHarness</code>): tool disclosure, discovery, index, verbose rules, context budgets.</p>
        </div>
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
</ConfigSection>
