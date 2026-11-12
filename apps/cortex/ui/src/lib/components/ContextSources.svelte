<script lang="ts">
  /**
   * The Context view's knowledge sources for one run: the skills it had active and why,
   * and the memories it wrote (same API as the Memory studio, filtered to the run). What
   * the agent recalled is not reported by the framework, and this says so
   * (`lib/context-sources.ts`). Used by the run inspector's Context tab and the chat
   * inspector's Context tab.
   */
  import type { RunSkillsView } from "@reactive-agents/ui-core";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import { contextSourcesOf, RECALL_NOT_REPORTED, SKILLS_HREF } from "$lib/context-sources.js";
  import { fetchMemory, memoryStudioHref, type MemoryListing } from "$lib/memory-studio.js";

  interface Props {
    skills: RunSkillsView | undefined;
    /** The agent whose memory the run wrote to (a chat's stable agent id, a run's agent id). */
    agentId?: string | undefined;
    runId?: string | undefined;
    /** Changes when the run ends: memory is written at the end of a run, so reload then. */
    settledKey?: string;
  }
  const { skills, agentId, runId, settledKey = "" }: Props = $props();

  let listing = $state<MemoryListing | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    void settledKey;
    const agent = agentId;
    const run = runId;
    listing = null;
    error = null;
    if (!agent || !run) return;
    loading = true;
    fetchMemory(agent, run)
      .then((d) => { if (agent === agentId && run === runId) listing = d; })
      .catch((e) => { error = e instanceof Error ? e.message : String(e); })
      .finally(() => { loading = false; });
  });

  const view = $derived(contextSourcesOf(skills, listing));
  const KIND = { fact: "fact", workflow: "workflow", log: "log" } as const;
</script>

<section class="ctx" aria-label="Skills and memories for this run" data-testid="context-sources">
  <p class="summary">{view.summary}</p>

  <h3>Skills</h3>
  {#if view.skills.length === 0}
    <p class="hint">No skill was active in this run.</p>
  {:else}
    <ul>
      {#each view.skills as s (s.name)}
        <li>
          <span use:tooltip={s.tooltip}><Badge tone={s.via === "agent" ? "accent" : s.via === "relevant" ? "io" : "neutral"}><span class="mono">{s.name}</span></Badge></span>
          <span class="why">{s.why}</span>
        </li>
      {/each}
    </ul>
    {#if view.skillsMore}<p class="hint">{view.skillsMore}</p>{/if}
  {/if}
  <div class="links"><Button size="sm" variant="ghost" icon="bolt" href={SKILLS_HREF}>Skills in the Lab</Button></div>

  <h3>Memories</h3>
  {#if loading && listing === null}
    <p class="hint" role="status">Loading memory…</p>
  {:else if error}
    <p class="hint bad" role="alert">Could not load memory: {error}</p>
  {:else if !agentId || !runId}
    <p class="hint">No run to read memory for yet.</p>
  {:else if listing && !listing.available}
    <p class="hint">This agent has no memory database. Turn memory on in its Memory settings.</p>
  {:else if view.memories.length === 0}
    <p class="hint">This run wrote no memories{settledKey === "" ? "" : " (memory is written as a run ends)"}.</p>
  {:else}
    <ul>
      {#each view.memories as m (m.id)}
        <li class="mem">
          <span class="kind">{KIND[m.kind]}</span>
          <span class="title">{m.title}</span>
          <span class="meta">{m.detail}</span>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="hint note">{RECALL_NOT_REPORTED}</p>
  {#if agentId && runId && listing?.available}
    <div class="links"><Button size="sm" variant="ghost" icon="book" href={memoryStudioHref(agentId, runId)}>Open in the Memory studio</Button></div>
  {/if}
</section>

<style>
  .ctx { display: grid; gap: 8px; }
  .summary { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  h3 { margin: 6px 0 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .mono, .kind, .meta { font-family: var(--cortex-font-data); }
  .why, .meta { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .mem { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; padding: 6px 8px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); }
  .kind { font-size: var(--cortex-t-xs); color: var(--cortex-io); }
  .title { min-width: 0; overflow-wrap: anywhere; }
  .hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); line-height: var(--cortex-lh-ui); }
  .bad { color: var(--cortex-bad); }
  .note { padding-top: 2px; }
  .links { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
