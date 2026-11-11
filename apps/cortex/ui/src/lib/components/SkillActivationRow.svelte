<script lang="ts">
  /**
   * Which skills a run had active and why: one chip per skill (`release-notes · pinned`),
   * then how many more it could have loaded. Shared by the chat turn and the run view;
   * the data is ui-core's `RunSkillsView`, the wording `lib/skill-row.ts`.
   */
  import type { RunSkillsView } from "@reactive-agents/ui-core";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import { skillChips, skillsAvailableNote } from "$lib/skill-row.js";

  interface Props {
    skills: RunSkillsView | undefined;
    /** Run view: padded strip under the vitals. Chat: inline row in the turn. */
    variant?: "turn" | "strip";
  }
  const { skills, variant = "turn" }: Props = $props();

  const chips = $derived(skillChips(skills));
  const more = $derived(skillsAvailableNote(skills));
  // Agent-loaded skills are the agent's own act (violet); pins and task matches are data the run was given.
  const TONE = { pinned: "neutral", relevant: "io", agent: "accent", user: "neutral" } as const;
</script>

{#if chips.length > 0}
  <div class="skills {variant}" aria-label="Skills used" data-testid="skill-activations">
    <span class="k"><Icon name="bolt" size="sm" /> Skills</span>
    {#each chips as chip (chip.name)}
      <span use:tooltip={chip.tooltip}>
        <Badge tone={TONE[chip.via]}><span class="name">{chip.name}</span><span class="why">· {chip.why}</span></Badge>
      </span>
    {/each}
    {#if more}<span class="more">{more}</span>{/if}
  </div>
{/if}

<style>
  .skills { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .skills.strip { padding: 8px 24px; border-bottom: 1px solid var(--cortex-line); }
  .k { display: inline-flex; align-items: center; gap: 4px; color: var(--cortex-text-3); }
  .name { font-family: var(--cortex-font-data); }
  .why { opacity: 0.85; }
  .more { color: var(--cortex-text-3); }
</style>
