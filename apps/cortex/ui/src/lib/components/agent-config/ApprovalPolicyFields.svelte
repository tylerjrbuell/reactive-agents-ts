<script lang="ts">
  /**
   * The approval gate editor (framework `AgentConfig.approvalPolicy`): which tools
   * and which shell commands need approval, and what happens when one is called.
   * Tools the framework gates by itself once any rule is set (`requiresApproval`,
   * from `GET /api/tools/approval-required`) show locked on. Rules in
   * `lib/approval-policy.ts`.
   */
  import { onMount } from "svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import type { AgentConfig } from "$lib/types/agent-config.js";
  import {
    APPROVAL_MODE_LABEL,
    addRule,
    autoGatedTools,
    gateableTools,
    hasFullShell,
    removeRule,
    ruleMatchesNothing,
    toggleGatedTool,
    type ApprovalMode,
    type ApprovalPolicyConfig,
  } from "$lib/approval-policy.js";

  let { config = $bindable() }: { config: AgentConfig } = $props();

  let required = $state<string[]>([]);
  let presets = $state<Record<string, string[]>>({});
  let draft = $state("");

  onMount(() => {
    const get = <T,>(path: string, fallback: T): Promise<T> =>
      fetch(`${CORTEX_SERVER_URL}${path}`).then((r) => (r.ok ? (r.json() as Promise<T>) : fallback)).catch(() => fallback);
    void get<{ tools: string[] }>("/api/tools/approval-required", { tools: [] }).then((r) => (required = r.tools));
    void get<Record<string, string[]>>("/api/tools/shell-presets", {}).then((p) => (presets = p));
  });

  const policy = $derived<ApprovalPolicyConfig>(config.approvalPolicy ?? { mode: "detach", tools: [], commands: [] });
  const tools = $derived(gateableTools(config.tools, config.terminalTools, presets));
  const locked = $derived(autoGatedTools(policy, config.tools, hasFullShell(config.tools, config.terminalTools), required));
  const hasShell = $derived(tools.includes("shell-execute"));

  function set(next: Partial<ApprovalPolicyConfig>) {
    // Approvals never touch durable execution: a run waits live for the answer,
    // and durable execution (Execution) only makes that wait survive a restart.
    config = { ...config, approvalPolicy: { ...policy, ...next } };
  }

  function addDraft() {
    set({ commands: addRule(policy.commands, draft) });
    draft = "";
  }
</script>

<div class="acp-card" data-testid="approval-policy">
  <span class="config-label mb-0">Approvals</span>
  <p class="acp-hint">Choose which tool calls and shell commands wait for you before they run.</p>

  <span id="acp-approval-tools-label" class="config-label mt-2 mb-0">Tools</span>
  {#if tools.length === 0}
    <p class="acp-hint">Add tools first.</p>
  {:else}
    <div class="acp-chips" role="group" aria-labelledby="acp-approval-tools-label">
      {#each tools as toolName (toolName)}
        {@const auto = locked.includes(toolName)}
        <button type="button" class="acp-toolchip" aria-pressed={auto || policy.tools.includes(toolName)} disabled={auto}
          use:tooltip={auto ?`${toolName} always asks once any approval is set (the framework marks it as needing approval)` : undefined}
          onclick={() => set({ tools: toggleGatedTool(policy.tools, toolName) })}>
          {#if auto || policy.tools.includes(toolName)}<Icon name="check" size="sm" />{/if}{toolName}
        </button>
      {/each}
    </div>
    {#if locked.length > 0}
      <p class="acp-hint">{locked.join(", ")} always {locked.length === 1 ? "asks" : "ask"} once anything here is set: the framework marks {locked.length === 1 ? "it" : "them"} as needing approval.</p>
    {/if}
    {#if hasShell}
      <p class="acp-hint">Gating <code>shell-execute</code> asks before every shell command. To ask only for some, add command rules below.</p>
    {/if}
  {/if}

  <label for="acp-approval-rule" class="config-label mt-2 mb-0">Shell commands</label>
  {#if policy.commands.length > 0}
    <ul class="acp-chips" aria-label="Commands that need approval" data-testid="approval-commands">
      {#each policy.commands as rule (rule)}
        <li class="acp-cmd" class:risky={ruleMatchesNothing(rule)} use:tooltip={ruleMatchesNothing(rule) ? "This rule has no words, so it matches nothing" : undefined}>
          {rule}
          <button type="button" aria-label={`Remove ${rule}`} onclick={() => set({ commands: removeRule(policy.commands, rule) })}>
            <Icon name="x" size="sm" />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="flex items-center gap-1.5">
    <input id="acp-approval-rule" type="text" class="config-input acp-mono min-w-0 flex-1" placeholder="git push (Enter)"
      bind:value={draft}
      onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDraft(); } }} />
    <Button size="sm" onclick={addDraft} disabled={draft.trim() === ""}>Add</Button>
  </div>
  {#if draft.trim() !== "" && ruleMatchesNothing(draft)}
    <p class="acp-hint acp-bad" role="alert">A rule needs at least one word: a bare <code>*</code> matches nothing.</p>
  {/if}
  <p class="acp-hint">A rule matches by leading words: <code>git push</code> matches <code>git push origin main</code>, not <code>git pull</code>. Each part of a command joined with <code>&amp;&amp;</code>, <code>;</code> or <code>|</code> is checked.{#if !hasShell}{" "}Rules apply once the agent has a shell.{/if}</p>

  <span id="acp-approval-mode-label" class="config-label mt-2 mb-0">When one is called</span>
  <div class="acp-choices" role="radiogroup" aria-labelledby="acp-approval-mode-label">
    {#each ["detach", "block"] as const as m (m)}
      <label class="acp-choice" class:on={policy.mode === m}>
        <input type="radio" name="acp-approval-mode" value={m} checked={policy.mode === m} onchange={() => set({ mode: m as ApprovalMode })} />
        <span>
          <span class="acp-check-t">{APPROVAL_MODE_LABEL[m].label}</span>
          <span class="acp-hint">{APPROVAL_MODE_LABEL[m].detail}</span>
        </span>
      </label>
    {/each}
  </div>
</div>
