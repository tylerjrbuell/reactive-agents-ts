<script lang="ts">
  /**
   * Lab Skills · Agent skills: the skills an agent has learned or loaded (its
   * framework SkillStore), with confidence, usage and version history, and the
   * actions on them: Refine now, Lock / Unlock, Roll back, Export to the
   * workspace. The timeline lists the skill events the agent's runs reported,
   * each linked to its run, and the ones Refine now / Roll back published here
   * ("in Cortex"). Rules and API calls live in `lib/agent-skills.ts`.
   */
  import { formatRelativeTime } from "@reactive-agents/ui-core";
  import { skillDiffStats } from "@reactive-agents/ui-core";
  import MarkdownRich from "$lib/components/MarkdownRich.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import Meter from "$lib/components/kit/Meter.svelte";
  import Combobox from "$lib/components/kit/Combobox.svelte";
  import { agentComboItems } from "$lib/combobox.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { fetchMemoryAgents, runHref, type MemoryAgent } from "$lib/memory-studio.js";
  import {
    canRollBack,
    confidenceLabel,
    confidenceTone,
    evolutionModeLabel,
    exportAgentSkill,
    exportPathOf,
    fetchAgentSkills,
    fetchSkillEvents,
    lockActionOf,
    previousVersion,
    refineAgentSkills,
    refineModelText,
    refineSummary,
    rollbackAgentSkill,
    setAgentSkillMode,
    skillTimeline,
    timelineOriginOf,
    successRateText,
    versionDiff,
    versionRows,
    type AgentSkillsListing,
    type TimelineItem,
  } from "$lib/agent-skills.js";

  interface Props {
    /** The inspected agent (bindable: the Cortex library's Move uses it). */
    agentId: string;
    /** The Builder's workspace: Export writes there. Empty = no export. */
    workspaceRoot?: string;
    /** Bumped by the parent after a library row moves in, to reload. */
    reloadKey?: number;
  }
  let { agentId = $bindable(""), workspaceRoot = "", reloadKey = 0 }: Props = $props();

  let agents = $state<MemoryAgent[]>([]);
  let listing = $state<AgentSkillsListing | null>(null);
  let timeline = $state<TimelineItem[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let selectedName = $state<string | null>(null);
  let busy = $state<"refine" | "rollback" | "export" | "mode" | null>(null);
  let refineResult = $state<string | null>(null);
  /** Version shown; with `diffFrom` set the body shows the diff from it. */
  let viewVersion = $state<number | null>(null);
  let diffFrom = $state<number | null>(null);

  const now = Date.now();
  const skills = $derived(listing?.skills ?? []);
  const selected = $derived(skills.find((s) => s.name === selectedName) ?? null);
  const rows = $derived(selected ? versionRows(selected) : []);
  const shown = $derived(rows.find((r) => r.version === viewVersion) ?? rows[0] ?? null);
  const diff = $derived(shown && diffFrom !== null ? versionDiff(rows, diffFrom, shown.version) : []);
  const diffStats = $derived(skillDiffStats(diff));
  const skillTimelineItems = $derived(selected ? timeline.filter((t) => t.skillName === selected.name) : timeline);
  // Named agents first, recent first; at most a screenful rendered (kit Combobox).
  const agentItems = $derived(agentComboItems(agents));
  // The latest load; a newer one cancels the one in flight.
  let loadCtl: AbortController | undefined;
  const refineModel = $derived(refineModelText(listing?.refineWith ?? null));
  const lock = $derived(selected ? lockActionOf(selected) : null);

  $effect(() => {
    void fetchMemoryAgents()
      .then((a) => {
        agents = a;
        // Load an agent's skills only once chosen (each load builds that agent); a lone agent is the obvious pick.
        if (agentId === "" && a.length === 1) agentId = a[0]!.agentId;
      })
      .catch((e) => (loadError = String(e)));
  });

  $effect(() => {
    void reloadKey;
    const id = agentId;
    if (id === "") {
      listing = null;
      timeline = [];
      return;
    }
    void load(id);
  });

  async function load(id: string) {
    loadCtl?.abort();
    const ctl = new AbortController();
    loadCtl = ctl;
    loading = true;
    loadError = null;
    refineResult = null;
    try {
      const [l, events] = await Promise.all([fetchAgentSkills(id, fetch, ctl.signal), fetchSkillEvents(id, undefined, fetch, ctl.signal)]);
      if (id !== agentId || ctl.signal.aborted) return;
      listing = l;
      timeline = skillTimeline(events);
      // A reload can follow a refine or rollback: show the current version again.
      pick(l.skills.some((s) => s.name === selectedName) ? selectedName : (l.skills[0]?.name ?? null));
    } catch (e) {
      if (ctl.signal.aborted) return;
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      if (loadCtl === ctl) loading = false;
    }
  }

  function pick(name: string | null) {
    selectedName = name;
    viewVersion = null;
    diffFrom = null;
  }

  function showVersion(v: number) {
    viewVersion = v;
    diffFrom = null;
  }

  function compareWithPrevious() {
    if (!shown) return;
    diffFrom = diffFrom === null ? previousVersion(rows, shown.version) : null;
  }

  async function refine() {
    busy = "refine";
    try {
      const r = await refineAgentSkills(agentId);
      refineResult = refineSummary(r);
      toast.success("Refinement finished", refineResult);
      await load(agentId);
      refineResult = refineSummary(r);
    } catch (e) {
      toast.error("Refine failed", e instanceof Error ? e.message : String(e));
    } finally {
      busy = null;
    }
  }

  async function rollback() {
    if (!selected) return;
    busy = "rollback";
    try {
      const after = await rollbackAgentSkill(agentId, selected.name);
      toast.success("Rolled back", `${after.name} is on v${after.version} again`);
      await load(agentId);
    } catch (e) {
      toast.error("Roll back failed", e instanceof Error ? e.message : String(e));
    } finally {
      busy = null;
    }
  }

  async function toggleLock() {
    if (!selected) return;
    const action = lockActionOf(selected);
    busy = "mode";
    try {
      const after = await setAgentSkillMode(agentId, selected.name, action.mode);
      toast.success(action.mode === "locked" ? "Locked" : "Unlocked", `${after.name}: ${evolutionModeLabel(after.evolutionMode)}`);
      await load(agentId);
    } catch (e) {
      toast.error(`${action.label} failed`, e instanceof Error ? e.message : String(e));
    } finally {
      busy = null;
    }
  }

  async function exportSkill() {
    if (!selected || workspaceRoot === "") return;
    busy = "export";
    try {
      const path = await exportAgentSkill(agentId, selected.name, workspaceRoot);
      toast.success("Exported", path);
    } catch (e) {
      toast.error("Export failed", e instanceof Error ? e.message : String(e));
    } finally {
      busy = null;
    }
  }
</script>

<div class="living">
  <div class="bar">
    <div class="agent">
      <label for="agent-skills-agent">Agent</label>
      <Combobox
        id="agent-skills-agent"
        label="Agent"
        bind:value={agentId}
        items={agentItems}
        placeholder={agents.length === 0 ? "No agent has memory yet" : "Pick an agent"}
        emptyText="No agent matches"
      />
    </div>
    <div class="refine">
      {#if refineResult}<span class="refine-result" role="status">{refineResult}</span>{/if}
      <Button
        icon="retry"
        disabled={!listing?.available || skills.length === 0 || busy !== null}
        title={refineModel
          ? `Refines every skill that is not locked with ${refineModel}, from what its runs logged since the last refinement`
          : "No recorded run for this agent, so no model to refine with"}
        onclick={refine}
      >
        {busy === "refine" ? "Refining…" : "Refine now"}
      </Button>
    </div>
  </div>

  {#if loadError}
    <p class="err" role="alert">{loadError}</p>
  {:else if agentId === ""}
    <div class="center"><EmptyState icon="book" title="No agent picked" description="Agents that keep memory store the skills they learn. Pick one to see them." /></div>
  {:else if loading && !listing}
    <p class="center dim" role="status">Loading the agent's skills…</p>
  {:else if listing && !listing.available}
    <div class="center"><EmptyState icon="book" title="No memory for this agent" description="Skills are stored with an agent's memory. Run it with memory on, then come back." /></div>
  {:else if listing && skills.length === 0 && !loading}
    <div class="center">
      <EmptyState icon="book" title="No stored skills yet" description="This agent has not learned or loaded a skill. Move one in from the Cortex library, or let it run tasks with memory on." />
    </div>
  {:else}
    <div class="cols">
      <aside class="list" aria-label="Stored skills">
        {#each skills as s (s.id)}
          <button type="button" class="item" aria-current={s.name === selectedName ? "true" : undefined} onclick={() => pick(s.name)}>
            <span class="item-name">{s.name} <Badge tone={confidenceTone(s.confidence)}>{confidenceLabel(s.confidence)}</Badge></span>
            <Meter value={s.useCount === 0 ? 0 : s.successRate} label={`${s.name} success rate`} />
            <span class="item-meta"><span class="mono">v{s.version}</span>, used {s.useCount} {s.useCount === 1 ? "time" : "times"}, {successRateText(s)} success</span>
          </button>
        {/each}
      </aside>

      <section class="doc" aria-label="Skill">
        {#if selected && shown}
          <div class="doc-h">
            <div class="title">
              <h2>{selected.name}</h2>
              <Badge tone={confidenceTone(selected.confidence)}>{confidenceLabel(selected.confidence)}</Badge>
              <Badge>{selected.source}</Badge>
            </div>
            {#if selected.description}<p class="when">{selected.description}</p>{/if}
            <dl class="stats">
              <div><dt>Used</dt><dd class="mono">{selected.useCount}</dd></div>
              <div><dt>Success</dt><dd class="mono">{successRateText(selected)}</dd></div>
              <div><dt>Refined</dt><dd class="mono">{selected.refinementCount}×</dd></div>
              <div><dt>Last used</dt><dd>{selected.lastActivatedAt ? formatRelativeTime(Date.parse(selected.lastActivatedAt), now) : "never"}</dd></div>
            </dl>
            <p class="mode">{evolutionModeLabel(selected.evolutionMode)}</p>
            <div class="actions">
              {#if lock}
                <Button size="sm" icon={lock.mode === "locked" ? "lock" : "unlock"} disabled={busy !== null} title={lock.hint} onclick={toggleLock}>
                  {busy === "mode" ? "Saving…" : lock.label}
                </Button>
              {/if}
              <Button size="sm" icon="undo" disabled={!canRollBack(selected) || busy !== null} title={canRollBack(selected) ? `Restore v${selected.version - 1} and drop v${selected.version}` : "No earlier version is stored"} onclick={rollback}>
                {busy === "rollback" ? "Rolling back…" : "Roll back"}
              </Button>
              <Button size="sm" icon="download" disabled={workspaceRoot === "" || busy !== null} title={workspaceRoot === "" ? "Set a workspace in the Builder to export there" : `Writes ${exportPathOf(workspaceRoot, selected.name)}`} onclick={exportSkill}>
                Export to SKILL.md
              </Button>
            </div>
          </div>
          <div class="view-h">
            <span>Version <span class="mono">v{shown.version}</span>{shown.current ? " (current)" : ""}{shown.status === "candidate" ? ", on trial" : ""}</span>
            {#if previousVersion(rows, shown.version) !== null}
              <Button size="sm" variant="ghost" onclick={compareWithPrevious}>
                {diffFrom === null ? `Compare with v${previousVersion(rows, shown.version)}` : "Show the text"}
              </Button>
            {/if}
          </div>
          <div class="body">
            {#if diffFrom !== null}
              <p class="diff-sum mono">v{diffFrom} → v{shown.version}: +{diffStats.added} −{diffStats.removed}</p>
              <pre class="diff" aria-label={`Changes from v${diffFrom} to v${shown.version}`}>{#each diff as l, i (i)}<span class={l.kind}><span class="sign" aria-hidden="true">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>{l.text}
</span>{/each}</pre>
            {:else}
              <MarkdownRich markdown={shown.instructions} class="max-w-none" showCopy={true} />
            {/if}
          </div>
        {:else}
          <div class="center"><EmptyState icon="book" title="Pick a skill" description="Its instructions, versions and history show here." /></div>
        {/if}
      </section>

      <aside class="side" aria-label="Versions and history">
        {#if selected}
          <div class="block">
            <h3>Versions</h3>
            <ol class="versions">
              {#each rows as r (r.version)}
                <li>
                  <button type="button" class="ver" aria-current={shown?.version === r.version ? "true" : undefined} onclick={() => showVersion(r.version)}>
                    <span class="mono">v{r.version}</span>
                    {#if r.current}<Badge tone="accent">current</Badge>{/if}
                    {#if r.status === "candidate"}<Badge tone="warn">on trial</Badge>{/if}
                    <span class="ver-at">{r.at ? formatRelativeTime(Date.parse(r.at), now) : "not refined yet"}</span>
                  </button>
                </li>
              {/each}
            </ol>
          </div>
        {/if}
        <div class="block">
          <h3>History</h3>
          {#if skillTimelineItems.length === 0}
            <p class="dim">No skill events recorded in Cortex runs{selected ? " for this skill" : ""} yet.</p>
          {:else}
            <ol class="timeline">
              {#each skillTimelineItems as t (t.id)}
                {@const origin = timelineOriginOf(t)}
                <li class={t.kind}>
                  <span class="t-label">{selected ? "" : `${t.skillName}: `}{t.label}</span>
                  <span class="t-meta">{formatRelativeTime(t.ts, now)} · {#if origin.kind === "run"}<a href={runHref(origin.runId)}>run</a>{:else}in Cortex{/if}</span>
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      </aside>
    </div>
  {/if}
</div>

<style>
  .living { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
  .bar { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; }
  .agent { display: grid; gap: 4px; min-width: 280px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .refine { display: flex; align-items: center; gap: 10px; }
  .refine-result { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); max-width: 60ch; }
  .mono { font-family: var(--cortex-font-data); }
  .dim { color: var(--cortex-text-3); margin: 0; }
  .err { margin: 0; padding: 12px; border-radius: var(--cortex-r-ctl); background: var(--cortex-bad-tint); color: var(--cortex-bad); font-size: var(--cortex-t-sm); }
  .center { flex: 1; display: grid; place-items: center; padding: 24px; }
  .cols {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(240px, 280px) minmax(0, 1fr) minmax(240px, 300px);
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    overflow: hidden;
  }
  .list { min-height: 0; overflow-y: auto; padding: 8px; display: grid; align-content: start; gap: 4px; border-right: 1px solid var(--cortex-line); }
  .item { display: grid; gap: 6px; padding: 10px; border: 0; border-radius: var(--cortex-r-ctl); background: transparent; text-align: left; cursor: pointer; font-family: var(--cortex-font-ui); }
  .item:hover { background: var(--cortex-surface-2); }
  .item[aria-current="true"] { background: var(--cortex-surface-3); }
  .item:focus-visible, .ver:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  .item-name { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: var(--cortex-t-sm); font-weight: 500; color: var(--cortex-text); }
  .item-meta { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .doc { display: flex; flex-direction: column; min-height: 0; min-width: 0; border-right: 1px solid var(--cortex-line); }
  .doc-h { padding: 16px 20px; border-bottom: 1px solid var(--cortex-line); display: grid; gap: 10px; }
  .title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .title h2 { margin: 0; font-size: var(--cortex-t-lg); font-weight: 600; color: var(--cortex-text); }
  .when, .mode { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); max-width: 68ch; }
  .mode { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .stats { margin: 0; display: flex; flex-wrap: wrap; gap: 20px; }
  .stats div { display: grid; gap: 2px; }
  .stats dt { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .stats dd { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .view-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 20px; border-bottom: 1px solid var(--cortex-line); font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px; }
  .diff-sum { margin: 0 0 8px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .diff { margin: 0; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: var(--cortex-text-2); }
  .diff span.add { display: block; background: var(--cortex-ok-tint); color: var(--cortex-text); }
  .diff span.del { display: block; background: var(--cortex-bad-tint); color: var(--cortex-text); text-decoration: line-through; text-decoration-color: rgb(var(--cortex-bad-rgb) / 0.6); }
  .diff span.same { display: block; }
  .sign { display: inline-block; width: 1.5ch; color: var(--cortex-text-3); }
  .side { min-height: 0; overflow-y: auto; }
  .block { display: grid; gap: 8px; padding: 14px; border-bottom: 1px solid var(--cortex-line); font-size: var(--cortex-t-xs); }
  .block h3 { margin: 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text); }
  .versions, .timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .ver { width: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 8px; border: 0; border-radius: var(--cortex-r-ctl); background: transparent; cursor: pointer; color: var(--cortex-text); font-size: var(--cortex-t-xs); text-align: left; }
  .ver:hover { background: var(--cortex-surface-2); }
  .ver[aria-current="true"] { background: var(--cortex-surface-3); }
  .ver-at { margin-left: auto; color: var(--cortex-text-3); }
  .timeline li { display: grid; gap: 2px; padding: 6px 8px; border-left: 2px solid var(--cortex-line); }
  .timeline li.promoted { border-left-color: var(--cortex-ok); }
  .timeline li.rolled-back { border-left-color: var(--cortex-warn); }
  .timeline li.refined { border-left-color: var(--cortex-accent); }
  .timeline li.activated { border-left-color: var(--cortex-io); }
  .t-label { color: var(--cortex-text); }
  .t-meta { color: var(--cortex-text-3); }
  .t-meta a { color: var(--cortex-accent); }
  @media (max-width: 1280px) {
    .cols { grid-template-columns: minmax(220px, 260px) minmax(0, 1fr); }
    .side { grid-column: 1 / -1; max-height: 40vh; border-top: 1px solid var(--cortex-line); }
    .doc { border-right: 0; }
  }
</style>
