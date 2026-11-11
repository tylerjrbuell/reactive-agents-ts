<script lang="ts">
  /**
   * Tinted label for a count or a short state word. Tone carries meaning
   * (spec principle 2): `accent` agent, `io` tools and data, `ok` / `warn` /
   * `bad` outcomes, `neutral` everything else. Each tone is text on its own
   * tint, AA in both themes.
   */
  import type { Snippet } from "svelte";

  /** Badge colour role. */
  type BadgeTone = "neutral" | "accent" | "io" | "ok" | "warn" | "bad";

  interface Props {
    tone?: BadgeTone;
    /** Machine value (count, id): JetBrains Mono. */
    data?: boolean;
    class?: string;
    children: Snippet;
  }

  let { tone = "neutral", data = false, class: className = "", children }: Props = $props();
</script>

<span class="cx-badge cx-badge-{tone} {className}" class:cx-badge-data={data} data-tone={tone}>{@render children()}</span>

<style>
  .cx-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 7px;
    border-radius: var(--cortex-r-chip);
    font-size: var(--cortex-t-2xs);
    font-weight: 500;
    white-space: nowrap;
  }
  .cx-badge-data { font-family: var(--cortex-font-data); font-variant-numeric: tabular-nums; }
  .cx-badge-neutral { color: var(--cortex-text-2); background: var(--cortex-surface-2); }
  .cx-badge-accent { color: var(--cortex-accent); background: var(--cortex-accent-tint); }
  .cx-badge-io { color: var(--cortex-io); background: var(--cortex-io-tint); }
  .cx-badge-ok { color: var(--cortex-ok); background: var(--cortex-ok-tint); }
  .cx-badge-warn { color: var(--cortex-warn); background: var(--cortex-warn-tint); }
  .cx-badge-bad { color: var(--cortex-bad); background: var(--cortex-bad-tint); }
</style>
