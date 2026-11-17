<script lang="ts">
  /**
   * One credential record (environment variables or headers) as write-only rows. A stored key shows
   * a "Set" chip and a Replace field, never its value; a new key has a name and a value field.
   * Removing a row drops the stored key when the page saves. Edit rules: `credentialEdit` in
   * `lib/tool-workshop.ts`.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import type { CredentialRow } from "$lib/tool-workshop.js";

  interface Props {
    /** Heading, e.g. "Environment variables". */
    label: string;
    /** Prefix for the field ids. */
    idBase: string;
    rows: CredentialRow[];
    /** One line under the heading. */
    hint: string;
  }
  let { label, idBase, rows = $bindable(), hint }: Props = $props();

  function addRow() {
    rows = [...rows, { key: "", value: "", stored: false }];
  }
  function removeRow(index: number) {
    rows = rows.filter((_, i) => i !== index);
  }
</script>

<section class="cl" aria-labelledby="{idBase}-h">
  <div class="cl-h">
    <h4 id="{idBase}-h">{label}</h4>
    <Button size="sm" variant="ghost" icon="plus" onclick={addRow}>Add key</Button>
  </div>
  <p class="cl-hint">{hint}</p>
  {#if rows.length === 0}
    <p class="cl-empty">None set.</p>
  {:else}
    <ul class="cl-rows">
      {#each rows as row, i (i)}
        <li class="cl-row">
          {#if row.stored}
            <span class="cl-key">{row.key}</span>
            <Chip icon="lock" title="A value is stored. It is never shown again.">Set</Chip>
          {:else}
            <Input id="{idBase}-key-{i}" bind:value={row.key} mono placeholder="KEY" aria-label="Key name" />
          {/if}
          <Input
            id="{idBase}-value-{i}"
            type="password"
            autocomplete="off"
            bind:value={row.value}
            mono
            placeholder={row.stored ? "Replace value" : "Value"}
            aria-label={row.stored ? `Replace the value of ${row.key}` : "Value"}
          />
          <IconButton icon="trash" size="sm" label={row.stored ? `Remove ${row.key}` : "Remove this row"} onclick={() => removeRow(i)} />
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .cl { display: grid; gap: 8px; }
  .cl-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h4 { margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .cl-hint, .cl-empty { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); line-height: var(--cortex-lh-ui); }
  .cl-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .cl-row { display: grid; grid-template-columns: minmax(120px, 200px) minmax(0, 1fr) auto; align-items: center; gap: 8px; }
  .cl-row:has(.cl-key) { grid-template-columns: auto auto minmax(0, 1fr) auto; }
  .cl-key { font-family: var(--cortex-font-data); font-size: var(--cortex-t-sm); color: var(--cortex-text); }
</style>
