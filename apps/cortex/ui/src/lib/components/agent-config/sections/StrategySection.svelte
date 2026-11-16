<script lang="ts">
  /**
   * Reasoning: the strategy, how many loops it may take, and how it checks its
   * work (verification, grounding, fabrication guard, harness). Run lifecycle
   * (durable runs, budget, output schema, webhooks) is in Execution, approvals in
   * Tools, documents in Memory, model routing in Model.
   */
  import ConfigSection from "../ConfigSection.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
  import HarnessPlanToggles from "../HarnessPlanToggles.svelte";
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
        <HarnessPlanToggles harness={config.harness} onchange={(next) => (config = { ...config, harness: next })} />
        <div>
          <div class="config-label">Harness config (JSON)</div>
          <textarea bind:value={config.harness} rows="6" spellcheck="false"
            placeholder={'{\n  "lazyDisclosure": false,\n  "verboseRules": true,\n  "toolIndex": true\n}'}
            class="config-input acp-mono"></textarea>
          <p class="mt-1 acp-hint">Optional — typed harness control surface (<code>.withHarness</code>): tool disclosure, discovery, index, verbose rules, context budgets.</p>
        </div>
        <div>
          <label for="grounding-mode" class="config-label">Evidence grounding</label>
          <Select
            id="grounding-mode"
            class="config-input"
            bind:value={() => config.grounding.mode, (v) => (config.grounding.mode = v as AgentConfig["grounding"]["mode"])}
            options={[
              { value: "off", label: "Off" },
              { value: "warn", label: "Warn", description: "Flag ungrounded figures" },
              { value: "block", label: "Block", description: "One corrective retry, then degrade" },
            ]} />
          <p class="mt-1 acp-hint">Checks numbers in the answer against tool data (<code>.withGrounding</code>); never hard-fails.</p>
        </div>
        <div>
          <label for="fabrication-guard-mode" class="config-label">Fabrication guard</label>
          <Select
            id="fabrication-guard-mode"
            class="config-input"
            bind:value={() => config.fabricationGuard.mode, (v) => (config.fabricationGuard.mode = v as AgentConfig["fabricationGuard"]["mode"])}
            options={[
              { value: "default", label: "Default", description: "Always on, block" },
              { value: "off", label: "Off" },
              { value: "warn", label: "Warn", description: "Flag invented entities and measurements" },
              { value: "block", label: "Block", description: "One corrective retry, then degrade" },
            ]} />
          <p class="mt-1 acp-hint">Distinct from evidence grounding above — catches invented named entities and measurements not backed by tool evidence. Always-on at Block even if left at Default (<code>.withFabricationGuard</code>).</p>
        </div>
        <div>
          <label for="verification-step" class="config-label">Verification step</label>
          <Select
            id="verification-step"
            class="config-input"
            bind:value={() => config.verificationStep, (v) => (config.verificationStep = v as AgentConfig["verificationStep"])}
            options={[
              { value: "none", label: "None", description: "Trust the first answer" },
              { value: "reflect", label: "Reflect", description: "LLM self-review pass" },
            ]} />
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
