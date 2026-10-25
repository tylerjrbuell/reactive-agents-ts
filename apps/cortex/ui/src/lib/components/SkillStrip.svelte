<script lang="ts">
  import type { CortexLiveMsg } from "$lib/stores/run-store.js";

  interface Props {
    events: readonly CortexLiveMsg[];
  }
  const { events }: Props = $props();

  const SKILL_TAGS = new Set([
    "SkillActivated",
    "SkillPromoted",
    "SkillRefined",
    "SkillRolledBack",
    "SkillConflictDetected",
    "SkillExpired",
  ]);

  const COLOR: Record<string, string> = {
    SkillActivated: "bg-secondary/15 text-secondary",
    SkillPromoted: "bg-primary/15 text-primary",
    SkillRefined: "bg-amber-500/15 text-amber-500",
    SkillRolledBack: "bg-error/15 text-error",
    SkillConflictDetected: "bg-error/15 text-error",
    SkillExpired: "bg-[var(--cortex-text-muted)]/15 text-[var(--cortex-text-muted)]",
  };

  const skillEvents = $derived(
    (events ?? []).filter((e) => SKILL_TAGS.has(e.type)),
  );

  function skillName(e: CortexLiveMsg): string {
    const p = e.payload as { skill?: string; name?: string; skillName?: string } | undefined;
    return p?.skill ?? p?.skillName ?? p?.name ?? "skill";
  }
</script>

{#if skillEvents.length > 0}
  <div class="flex flex-wrap gap-1.5 px-4 py-2 border-b border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)]">
    {#each skillEvents as ev (ev.ts + ev.type + skillName(ev))}
      <span
        class="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide {COLOR[ev.type] ?? 'bg-[var(--cortex-surface-mid)] text-[var(--cortex-text)]'}"
        title={ev.type}
      >
        {ev.type.replace("Skill", "")} · {skillName(ev)}
      </span>
    {/each}
  </div>
{/if}