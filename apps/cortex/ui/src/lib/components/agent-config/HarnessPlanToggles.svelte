<script lang="ts">
  /**
   * The planning switches of the harness config (plan recon, plan budget, wrap-up reserve, plan
   * tool catalog) over the harness JSON text. Each switch shows the framework's default until the
   * user flips it; flipping writes that one key and leaves the rest of the JSON alone.
   */
  import Switch from "$lib/components/kit/Switch.svelte";
  import { HARNESS_PLAN_TOGGLES, harnessTextEditable, harnessToggleOn, setHarnessToggle } from "$lib/harness-toggles.js";

  interface Props {
    /** The harness config as JSON text (`config.harness`). */
    harness: string;
    onchange: (next: string) => void;
  }
  const { harness, onchange }: Props = $props();
  const editable = $derived(harnessTextEditable(harness));
</script>

<div class="toggles" data-testid="harness-plan-toggles">
  {#each HARNESS_PLAN_TOGGLES as t (t.key)}
    <Switch
      id="acp-harness-{t.key}"
      label={t.label}
      hint={t.hint}
      disabled={!editable}
      checked={harnessToggleOn(harness, t)}
      onchange={(on) => onchange(setHarnessToggle(harness, t, on))} />
  {/each}
  {#if !editable}<p class="warn">The harness JSON below is not an object, so these switches are off until it is fixed.</p>{/if}
</div>

<style>
  .toggles { display: grid; gap: 10px; }
  .warn { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-warn); }
</style>
