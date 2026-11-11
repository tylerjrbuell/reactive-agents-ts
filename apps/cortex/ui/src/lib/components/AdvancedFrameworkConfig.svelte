<script lang="ts">
  /**
   * Type-introspected generic config renderer (anti-drift core).
   *
   * Renders leaf config fields straight from the framework CapabilityManifest
   * (`configFields`, derived from AgentConfigSchema via JSONSchema.make — i.e.
   * TYPE INTROSPECTION). Each field's widget is chosen from its introspected
   * `type`; values write into a nested `rawConfig` object keyed by the same
   * schema paths the framework decodes. A NEW framework config field therefore
   * appears here automatically, with zero per-field UI code — Cortex config no
   * longer drifts behind the framework as it grows.
   *
   * Curated paths (`AGENT_CONFIG_SECTIONS[].configPaths`: fields the hand-built
   * panel already sets) are excluded so they aren't shown twice; everything else
   * framework-settable shows up here.
   */
  import { onMount } from "svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import { hintFor } from "$lib/config-presentation.js";
  import { builtinsSuggestions } from "$lib/chat-quickbar.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import ListField from "$lib/components/ListField.svelte";
  import type { CapabilityManifest, ConfigFieldDescriptor } from "$lib/capabilities.js";
  import {
    CHOICE_FIELDS,
    COLLECTION_FIELDS,
    choiceFromKey,
    choiceKey,
    genericConfigFields,
    type ChoiceValue,
  } from "$lib/framework-options.js";

  interface Props {
    manifest: CapabilityManifest | null;
    /** Nested partial AgentConfig; bound so edits flow back to the parent config. */
    rawConfig: Record<string, unknown>;
    /** Show the fields directly (its own Lab section) instead of inside a collapsed disclosure. */
    expanded?: boolean;
  }
  let { manifest, rawConfig = $bindable(), expanded = false }: Props = $props();

  // Which fields render and with which widget: `lib/framework-options.ts`.
  // Paths a curated section sets come from the section registry
  // (`AGENT_CONFIG_SECTIONS[].configPaths`), so no option has two controls.

  // Toolset names come from the framework (`GET /api/tools/toolsets`), so a new
  // alias (e.g. `read`) appears without a Cortex edit.
  let builtinAliases = $state<string[]>(["all"]);
  onMount(() => {
    void fetch(`${CORTEX_SERVER_URL}/api/tools/toolsets`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((t: Record<string, readonly string[]>) => (builtinAliases = builtinsSuggestions(t)))
      .catch(() => undefined);
  });
  const suggestionsFor = (path: string): readonly string[] => (path === "tools.builtins" ? builtinAliases : []);

  function getPath(obj: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce<unknown>(
      (acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
      obj,
    );
  }

  function setPath(path: string, value: unknown): void {
    const keys = path.split(".");
    const next: Record<string, unknown> = { ...rawConfig };
    let cursor = next;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]!;
      const child = cursor[k];
      cursor[k] = child && typeof child === "object" && !Array.isArray(child) ? { ...(child as object) } : {};
      cursor = cursor[k] as Record<string, unknown>;
    }
    const leaf = keys[keys.length - 1]!;
    if (value === undefined || value === "") delete cursor[leaf];
    else cursor[leaf] = value;
    rawConfig = next;
  }

  interface Row {
    field: ConfigFieldDescriptor;
    label: string;
    help?: string;
    group: string;
    order: number;
  }

  const groups = $derived.by<{ name: string; rows: Row[] }[]>(() => {
    if (!manifest) return [];
    const rows: Row[] = genericConfigFields(manifest.configFields)
      .map((field) => {
        const hint = hintFor(field);
        return { field, label: hint.label, help: hint.help, group: hint.group, order: hint.order };
      });
    const byGroup = new Map<string, Row[]>();
    for (const r of rows) {
      const g = byGroup.get(r.group) ?? [];
      g.push(r);
      byGroup.set(r.group, g);
    }
    return [...byGroup.entries()]
      .map(([name, rs]) => ({ name, rows: rs.sort((a, b) => a.order - b.order || a.field.path.localeCompare(b.field.path)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const totalRows = $derived(groups.reduce((n, g) => n + g.rows.length, 0));
</script>


{#snippet fields()}
  <p class="acp-hint">
    Read live from the framework's typed config schema: a new framework option shows up here by itself. The settings in the other sections win when both set the same option.
  </p>
  {#each groups as group (group.name)}
    <div class="afc-group">
      <h4 class="afc-group-h">{group.name}</h4>
      {#each group.rows as row (row.field.path)}
        {@const val = getPath(rawConfig, row.field.path)}
        {@const coll = COLLECTION_FIELDS[row.field.path]}
        {@const choices = CHOICE_FIELDS[row.field.path]}
        <div class="acp-field">
          {#if coll}
            <label class="config-label" for={`adv-${row.field.path}`} use:tooltip={row.field.path}>{row.label}</label>
            <ListField
              id={`adv-${row.field.path}`}
              mode={coll.mode}
              value={val}
              onChange={(next) => setPath(row.field.path, next)}
              placeholder={coll.placeholder}
              {...(coll.mode === "record" ? { valueKind: coll.valueKind } : { suggestions: suggestionsFor(row.field.path) })}
            />
          {:else if choices}
            <label class="config-label" for={`adv-${row.field.path}`} use:tooltip={row.field.path}>{row.label}</label>
            <select
              id={`adv-${row.field.path}`}
              class="config-input"
              value={val === undefined ? "" : choiceKey(val as ChoiceValue)}
              onchange={(e) => setPath(row.field.path, choiceFromKey(row.field.path, (e.currentTarget as HTMLSelectElement).value))}
            >
              <option value="">Default</option>
              {#each choices as opt (choiceKey(opt))}
                <option value={choiceKey(opt)}>{String(opt)}</option>
              {/each}
            </select>
          {:else if row.field.type === "boolean"}
            <label class="acp-check" use:tooltip={row.field.path}>
              <input
                type="checkbox"
                checked={val === true}
                onchange={(e) => setPath(row.field.path, (e.currentTarget as HTMLInputElement).checked)}
              />
              <span><span class="acp-check-t">{row.label}</span></span>
            </label>
          {:else}
            <label class="config-label" for={`adv-${row.field.path}`} use:tooltip={row.field.path}>{row.label}</label>
            {#if row.field.type === "enum"}
              <select
                id={`adv-${row.field.path}`}
                class="config-input"
                value={val ?? ""}
                onchange={(e) => setPath(row.field.path, (e.currentTarget as HTMLSelectElement).value || undefined)}
              >
                <option value="">Default</option>
                {#each row.field.enumValues ?? [] as opt (opt)}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            {:else if row.field.type === "number"}
              <input
                id={`adv-${row.field.path}`}
                type="number"
                class="config-input acp-mono"
                value={val ?? ""}
                onchange={(e) => {
                  const raw = (e.currentTarget as HTMLInputElement).value;
                  setPath(row.field.path, raw === "" ? undefined : Number(raw));
                }}
              />
            {:else}
              <input
                id={`adv-${row.field.path}`}
                type="text"
                class="config-input"
                value={val ?? ""}
                onchange={(e) => setPath(row.field.path, (e.currentTarget as HTMLInputElement).value || undefined)}
              />
            {/if}
          {/if}
          {#if row.help}
            <p class="acp-hint">{row.help}</p>
          {/if}
        </div>
      {/each}
    </div>
  {/each}
{/snippet}

{#if manifest && totalRows > 0}
  {#if expanded}
    <div class="afc">{@render fields()}</div>
  {:else}
    <details class="afc acp-card">
      <summary class="afc-summary">
        All framework options <span class="acp-data">{totalRows} fields</span>
      </summary>
      <div class="afc">{@render fields()}</div>
    </details>
  {/if}
{/if}

<style>
  .afc { display: grid; gap: 16px; }
  .afc-summary { cursor: pointer; font-size: var(--cortex-t-sm); font-weight: 500; color: var(--cortex-text); }
  .afc-summary:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; border-radius: 4px; }
  details[open] > .afc-summary { margin-bottom: 12px; }
  .afc-group { display: grid; gap: 12px; padding-top: 12px; border-top: 1px solid var(--cortex-line); }
  .afc-group-h { margin: 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
</style>
