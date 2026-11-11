<script lang="ts">
  /**
   * Read-only display of a run's stored launch config snapshot
   * (`launch_params_json`, D1), collapsed under the Summary. It shows exactly
   * what config produced this run before Rerun / Edit and rerun.
   */
  import { tooltip } from "$lib/actions/tooltip.js";

  interface Props {
    launchParams: Record<string, unknown> | null;
  }
  let { launchParams }: Props = $props();

  // Fields that are noise in a read-only snapshot or shown elsewhere.
  const HIDDEN = new Set(["prompt", "variableValues"]);

  // camelCase → "Sentence case" label; a raw-key fallback that never drifts.
  function humanize(key: string): string {
    const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function render(value: unknown): string {
    if (value == null) return "—";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map(render).join(", ");
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v != null && v !== false && v !== "");
      return entries.map(([k, v]) => `${k}: ${render(v)}`).join(", ") || "—";
    }
    return String(value);
  }

  const rows = $derived(
    launchParams
      ? Object.entries(launchParams)
          .filter(([k, v]) => !HIDDEN.has(k) && v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
          .map(([k, v]) => ({ key: k, label: humanize(k), value: render(v) }))
      : [],
  );
</script>

{#if rows.length > 0}
  <details class="snap">
    <summary>Launch config <span class="n">{rows.length}</span></summary>
    <dl>
      {#each rows as row (row.key)}
        <dt use:tooltip={row.key}>{row.label}</dt>
        <dd>{row.value}</dd>
      {/each}
    </dl>
  </details>
{/if}

<style>
  .snap { border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-canvas); }
  summary { cursor: pointer; padding: 8px 12px; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  summary:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; border-radius: 6px; }
  .n { font-family: var(--cortex-font-data); font-weight: 400; color: var(--cortex-text-3); }
  dl { margin: 0; display: grid; grid-template-columns: minmax(0, 8rem) 1fr; gap: 4px 12px; padding: 0 12px 10px; font-size: var(--cortex-t-xs); }
  dt { color: var(--cortex-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  dd { margin: 0; min-width: 0; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text); overflow-wrap: anywhere; }
</style>
