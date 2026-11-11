<script lang="ts">
  /** Skills the run activated, promoted, refined or rolled back, as a row of badges under the vitals. */
  import Badge from "$lib/components/kit/Badge.svelte";
  import type { CortexLiveMsg } from "$lib/stores/run-store.js";

  interface Props {
    events: readonly CortexLiveMsg[];
  }
  const { events }: Props = $props();

  type Tone = "io" | "accent" | "warn" | "bad" | "neutral";
  const SKILL: Record<string, { readonly verb: string; readonly tone: Tone }> = {
    SkillActivated: { verb: "activated", tone: "io" },
    SkillPromoted: { verb: "promoted", tone: "accent" },
    SkillRefined: { verb: "refined", tone: "warn" },
    SkillRolledBack: { verb: "rolled back", tone: "bad" },
    SkillConflictDetected: { verb: "conflict", tone: "bad" },
    SkillExpired: { verb: "expired", tone: "neutral" },
  };

  const skillEvents = $derived((events ?? []).filter((e) => e.type in SKILL));

  function skillName(e: CortexLiveMsg): string {
    const p = e.payload as { skill?: string; name?: string; skillName?: string } | undefined;
    return p?.skill ?? p?.skillName ?? p?.name ?? "skill";
  }
</script>

{#if skillEvents.length > 0}
  <div class="skills" aria-label="Skills">
    <span class="k">Skills</span>
    {#each skillEvents as ev (ev.ts + ev.type + skillName(ev))}
      <Badge tone={SKILL[ev.type]?.tone ?? "neutral"}><span title={ev.type}>{skillName(ev)} {SKILL[ev.type]?.verb ?? ""}</span></Badge>
    {/each}
  </div>
{/if}

<style>
  .skills { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 24px; border-bottom: 1px solid var(--cortex-line); }
  .k { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); margin-right: 4px; }
</style>
