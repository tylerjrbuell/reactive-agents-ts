<script lang="ts">
  /**
   * Execution: how a run is carried out. Limits (timeout, token and cost caps),
   * retries, durable runs, the structured-output schema and lifecycle webhooks.
   */
  import ConfigSection from "../ConfigSection.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
  import OutputSchemaParseFailField from "$lib/components/OutputSchemaParseFailField.svelte";
  import { hasApprovalGate } from "$lib/approval-policy.js";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();

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

  /** A pause-for-approval gate (Tools) keeps durable runs on whatever this switch says. */
  const durableForcedByApprovals = $derived(
    !config.durableRuns.enabled && config.approvalPolicy.mode === "detach" && hasApprovalGate(config.approvalPolicy),
  );

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

<ConfigSection id="execution" icon="steps" title="Execution" {open} {onToggle}>
  {#snippet head()}
      <span class="truncate">
        {[
          config.timeout > 0 ? `${Math.round(config.timeout/1000)}s timeout` : null,
          config.retryPolicy.enabled ? `${config.retryPolicy.maxRetries} retries` : null,
          config.durableRuns.enabled ? "durable" : null,
        ].filter(Boolean).join(" · ") || "defaults"}
      </span>
  {/snippet}
        <!-- Timeout -->
        <div>
          <label for="execution-timeout" class="config-label">Timeout <span class="text-text-3/70 normal-case font-normal">(seconds, 0 = none)</span></label>
          <input id="execution-timeout" type="number" min="0" max="3600" step="5"
            value={Math.round(config.timeout / 1000)}
            oninput={(e) => (config = { ...config, timeout: parseInt((e.target as HTMLInputElement).value || "0") * 1000 })}
            class="config-input" />
        </div>
        <!-- Budget -->
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
        <!-- Retry policy -->
        <div class="space-y-2">
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" bind:checked={config.retryPolicy.enabled} class="accent-accent-fill w-3.5 h-3.5" />
            <span class="acp-check-t">Enable retry policy</span>
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
                <label for="retry-backoff-ms" class="config-label">Backoff <span class="text-text-3/70 normal-case font-normal">(ms)</span></label>
                <input id="retry-backoff-ms" type="number" min="100" max="30000" step="100"
                  bind:value={config.retryPolicy.backoffMs}
                  class="config-input" />
              </div>
            </div>
          {/if}
        </div>
        <!-- Durable runs -->
        <Switch id="acp-durable-runs" label="Durable execution"
          hint="Resumes after a crash, and keeps a run that waits for your approval across a restart. Turns reasoning on."
          checked={config.durableRuns.enabled}
          onchange={(on) => (config = { ...config, durableRuns: { ...config.durableRuns, enabled: on } })} />
        {#if durableForcedByApprovals}
          <p class="acp-hint">Approvals (under Tools) pause runs for your answer, so runs of this agent use durable execution anyway.</p>
        {/if}
        <!-- Structured output -->
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
