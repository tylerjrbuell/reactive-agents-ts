<script lang="ts">
  /**
   * Read-only display of a run's stored launch config snapshot
   * (`launch_params_json`, D1). Rendered as a definition list; enables the user
   * to see exactly what config produced this run before Rerun / Edit & Rerun.
   */
  interface Props {
    launchParams: Record<string, unknown> | null;
  }
  let { launchParams }: Props = $props();

  // Fields that are noise in a read-only snapshot or shown elsewhere.
  const HIDDEN = new Set(["prompt", "variableValues"]);

  // camelCase → "Title Case" label; a raw-key fallback that never drifts.
  function humanize(key: string): string {
    return key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase());
  }

  function render(value: unknown): string {
    if (value == null) return "—";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map(render).join(", ");
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v != null && v !== false && v !== "");
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
  <details class="mt-2 rounded-md border border-[var(--cortex-border)] bg-surface-container-lowest/40">
    <summary class="cursor-pointer select-none px-3 py-1.5 font-mono text-[10px] uppercase text-[var(--cortex-text-muted)]">
      Launch config
    </summary>
    <dl class="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-1 px-3 pb-2 pt-1 font-mono text-[10px]">
      {#each rows as row (row.key)}
        <dt class="truncate text-[var(--cortex-text-muted)]" title={row.key}>{row.label}</dt>
        <dd class="min-w-0 break-words text-on-surface">{row.value}</dd>
      {/each}
    </dl>
  </details>
{/if}
