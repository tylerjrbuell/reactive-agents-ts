<script lang="ts">
  /**
   * A list of sender keys (`platform:userId`) as chips with an add box: the owners, allow and deny
   * lists of a route. Typed or pasted text is normalised and deduped (`addSenderChips`); the
   * entries that cannot be a key are listed under the box. `list` is bindable.
   */
  import { addSenderChips } from "$lib/channel-hub.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Input from "$lib/components/kit/Input.svelte";

  interface Props {
    id: string;
    label: string;
    hint: string;
    list: string[];
    placeholder?: string;
  }
  let { id, label, hint, list = $bindable(), placeholder = "telegram:123456789" }: Props = $props();

  let text = $state("");
  let problems = $state<string[]>([]);

  function add() {
    if (text.trim() === "") return;
    const r = addSenderChips(list, text);
    list = r.list;
    problems = r.problems;
    text = r.problems.length > 0 ? text : "";
  }
</script>

<Field {id} {label} {hint}>
  <div class="sc-add">
    <Input {id} mono bind:value={text} {placeholder} describedBy="{id}-hint" onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
    <Button size="field" onclick={add} disabled={text.trim() === ""}>Add</Button>
  </div>
  {#if problems.length > 0}
    <ul class="sc-problems" role="alert">{#each problems as p (p)}<li>{p}</li>{/each}</ul>
  {/if}
  {#if list.length > 0}
    <ul class="sc-list" aria-label={label}>
      {#each list as entry (entry)}
        <li><code>{entry}</code><IconButton icon="x" size="sm" label={`Remove ${entry}`} onclick={() => (list = list.filter((e) => e !== entry))} /></li>
      {/each}
    </ul>
  {/if}
</Field>

<style>
  .sc-add { display: flex; gap: 6px; align-items: center; }
  .sc-add :global(input) { flex: 1; min-width: 0; }
  .sc-problems { margin: 4px 0 0; padding-left: 18px; font-size: var(--cortex-t-xs); color: var(--cortex-bad); }
  .sc-list { margin: 6px 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px; }
  .sc-list li { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 10px; border-radius: var(--cortex-r-chip); background: var(--cortex-surface-2); }
  .sc-list code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text); }
</style>
