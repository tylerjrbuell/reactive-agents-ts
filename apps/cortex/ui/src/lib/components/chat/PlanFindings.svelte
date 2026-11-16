<script lang="ts">
  /**
   * What the plan's recon learned: one row per finding, a tool chip and the summary the framework
   * recorded (`Plan.findings`, the `planRecon` harness mechanism). Collapsed under a count; an
   * editable plan card lets the user remove a finding so a wrong or stale fact does not seed the
   * execute run. Calm and static: no motion, the live glow is not used here.
   */
  import { tooltip } from "$lib/actions/tooltip.js";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import { findingToolChip, findingsLabel, withoutFinding, type PlanFindingView } from "$lib/plan-findings.js";

  interface Props {
    findings: readonly PlanFindingView[];
    /** Offer Remove on each row. */
    editable?: boolean;
    /** Called with the list after a removal. */
    onchange?: (next: readonly PlanFindingView[]) => void;
  }
  const { findings, editable = false, onchange }: Props = $props();
</script>

{#if findings.length > 0}
  <details class="findings" data-testid="plan-findings">
    <summary>{findingsLabel(findings.length)}</summary>
    <ul class="rows">
      {#each findings as f (f.id)}
        {@const chip = findingToolChip(f.tool)}
        <li class="row" data-testid="plan-finding">
          <span class="tool" use:tooltip={chip.title}>{chip.label}</span>
          <span class="summary">{f.summary}</span>
          {#if editable}
            <IconButton icon="trash" size="sm" label="Remove finding from {chip.label}" onclick={() => onchange?.(withoutFinding(findings, f.id))} />
          {/if}
        </li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .findings summary { cursor: pointer; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .rows { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 4px; }
  .row { display: flex; align-items: flex-start; gap: 8px; min-width: 0; font-size: var(--cortex-t-xs); line-height: var(--cortex-lh-ui); }
  .tool {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 6px;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
    font-family: var(--cortex-font-data);
  }
  .summary { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--cortex-text); }
</style>
