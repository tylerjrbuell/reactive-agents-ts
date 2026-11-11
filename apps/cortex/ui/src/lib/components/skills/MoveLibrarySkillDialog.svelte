<script lang="ts">
  /**
   * Move a Cortex library row into an agent's skills: pick how it may evolve, then
   * Move. When the agent already has a skill with that name the server answers with
   * a clash, and the dialog offers Update existing: the framework reloads the row
   * over that skill, keeping its history and stats (changed text is a new version).
   * Calls live in `lib/agent-skills.ts`.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import Overlay from "$lib/components/kit/Overlay.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import { MOVE_MODE_OPTIONS, moveLibrarySkill, type AgentSkill, type SkillMode } from "$lib/agent-skills.js";

  interface Props {
    /** The library row to move; `null` closes the dialog. */
    row: { readonly id: string; readonly name: string } | null;
    agentId: string;
    onclose: () => void;
    /** Called with the loaded skill once the move went through. */
    onmoved: (skill: AgentSkill, updated: boolean) => void;
    onerror: (message: string) => void;
  }
  let { row, agentId, onclose, onmoved, onerror }: Props = $props();

  let mode = $state<SkillMode>("auto");
  let conflict = $state<string | null>(null);
  let busy = $state(false);

  // A new row starts fresh.
  $effect(() => {
    void row?.id;
    mode = "auto";
    conflict = null;
  });

  async function move(update: boolean) {
    if (!row) return;
    busy = true;
    try {
      const r = await moveLibrarySkill(agentId, row.id, { evolutionMode: mode, ...(update ? { update: true } : {}) });
      if (r.ok) onmoved(r.skill, update);
      else conflict = r.conflict;
    } catch (e) {
      onerror(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }
</script>

<Overlay open={row !== null} title={row ? `Move "${row.name}" into ${agentId}` : "Move skill"} onclose={onclose}>
  <div class="body">
    <Field id="move-skill-mode" label="How it may change" hint="Runs can refine, promote and roll back a skill that evolves. A locked skill stays as written.">
      <Select id="move-skill-mode" bind:value={mode} options={MOVE_MODE_OPTIONS} describedBy="move-skill-mode-hint" />
    </Field>
    {#if conflict}
      <p class="conflict" role="alert">{conflict}</p>
    {/if}
  </div>
  {#snippet actions()}
    <Button variant="ghost" onclick={onclose}>Cancel</Button>
    {#if conflict}
      <Button variant="primary" icon="check" disabled={busy} onclick={() => void move(true)}>{busy ? "Updating…" : "Update existing"}</Button>
    {:else}
      <Button variant="primary" icon="agents" disabled={busy} onclick={() => void move(false)}>{busy ? "Moving…" : "Move"}</Button>
    {/if}
  {/snippet}
</Overlay>

<style>
  .body { display: grid; gap: 12px; }
  .conflict { margin: 0; padding: 10px 12px; border-radius: var(--cortex-r-ctl); background: var(--cortex-warn-tint); color: var(--cortex-text); font-size: var(--cortex-t-sm); }
</style>
