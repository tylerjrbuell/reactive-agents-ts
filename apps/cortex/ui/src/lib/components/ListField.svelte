<script lang="ts">
  /**
   * One reusable editor for the two collection shapes builder options take:
   * a string list (`builtins`, `customBlocklist`, `requiredTools.tools`, …) and
   * a name → value record (`maxCallsPerTool`, `riskLevels`). Empty = unset:
   * `onChange(undefined)` so the key drops out of the config instead of
   * sending `[]` / `{}`.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  type RecordValue = string | number;
  interface Props {
    id: string;
    mode: "list" | "record";
    /** list: string[]; record: Record<string, string | number>. */
    value: unknown;
    onChange: (next: string[] | Record<string, RecordValue> | undefined) => void;
    /** record only: "number" for counts, or the allowed string values. */
    valueKind?: "number" | readonly string[];
    placeholder?: string;
    /** Suggestions offered while typing a list entry or a record key. */
    suggestions?: readonly string[];
  }
  let { id, mode, value, onChange, valueKind = "number", placeholder = "", suggestions = [] }: Props = $props();

  const items = $derived(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  const entries = $derived(
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>).filter((e): e is [string, RecordValue] => typeof e[1] === "string" || typeof e[1] === "number")
      : [],
  );

  let draftKey = $state("");
  let draftValue = $state<string | number | null>("");

  const emitList = (next: string[]) => onChange(next.length > 0 ? next : undefined);
  const emitRecord = (next: [string, RecordValue][]) => onChange(next.length > 0 ? Object.fromEntries(next) : undefined);

  function parseValue(raw: string): RecordValue | undefined {
    if (valueKind === "number") {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 1 ? n : undefined;
    }
    return valueKind.includes(raw) ? raw : undefined;
  }

  function add() {
    const key = draftKey.trim();
    if (key === "") return;
    if (mode === "list") {
      const parts = key.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      emitList([...new Set([...items, ...parts])]);
      draftKey = "";
      return;
    }
    // `bind:value` on a number input yields a number (or null when empty), so normalise to text.
    const typed = draftValue == null ? "" : String(draftValue).trim();
    const v = parseValue(typed || (valueKind === "number" ? "" : (valueKind[0] ?? "")));
    if (v === undefined) return;
    emitRecord([...entries.filter(([k]) => k !== key), [key, v]]);
    draftKey = "";
    draftValue = "";
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };
</script>

<div class="space-y-1.5">
  {#if mode === "list" && items.length > 0}
    <div class="acp-chips">
      {#each items as item (item)}
        <span class="acp-cmd">
          {item}
          <button type="button" aria-label={`Remove ${item}`} onclick={() => emitList(items.filter((x) => x !== item))}>
            <Icon name="x" size="sm" />
          </button>
        </span>
      {/each}
    </div>
  {/if}
  {#if mode === "record" && entries.length > 0}
    <div class="space-y-1">
      {#each entries as [k, v] (k)}
        <div class="flex items-center gap-1.5">
          <span class="acp-data min-w-0 flex-1 truncate">{k}</span>
          {#if valueKind === "number"}
            <input type="number" min="1" class="ci-frame ci-text w-16" aria-label={`${k} value`} value={v}
              onchange={(e) => { const n = parseValue((e.currentTarget as HTMLInputElement).value); if (n !== undefined) emitRecord(entries.map(([ek, ev]) => [ek, ek === k ? n : ev])); }} />
          {:else}
            <Select id={`${id}-value-${k}`} class="ci-frame ci-text w-24" aria-label={`${k} value`} value={String(v)}
              options={valueKind.map((opt) => ({ value: opt, label: opt }))}
              onchange={(next) => emitRecord(entries.map(([ek, ev]) => [ek, ek === k ? next : ev]))} />
          {/if}
          <IconButton icon="x" size="sm" label={`Remove ${k}`} onclick={() => emitRecord(entries.filter(([ek]) => ek !== k))} />
        </div>
      {/each}
    </div>
  {/if}
  <div class="flex items-center gap-1.5">
    <input {id} type="text" class="ci-frame ci-text min-w-0 flex-1" placeholder={placeholder || (mode === "list" ? "Add, then Enter" : "Tool name")}
      list={suggestions.length > 0 ? `${id}-suggest` : undefined} bind:value={draftKey} onkeydown={onKey} />
    {#if mode === "record"}
      {#if valueKind === "number"}
        <input type="number" min="1" class="ci-frame ci-text w-16" placeholder="cap" aria-label="Value" bind:value={draftValue} onkeydown={onKey} />
      {:else}
        <Select id={`${id}-draft-value`} class="ci-frame ci-text w-24" aria-label="Value"
          value={String(draftValue ?? "") || (valueKind[0] ?? "")}
          options={valueKind.map((opt) => ({ value: opt, label: opt }))}
          onchange={(next) => (draftValue = next)} />
      {/if}
    {/if}
    <Button size="sm" onclick={add}>Add</Button>
  </div>
  {#if suggestions.length > 0}
    <datalist id={`${id}-suggest`}>{#each suggestions as s (s)}<option value={s}></option>{/each}</datalist>
  {/if}
</div>
