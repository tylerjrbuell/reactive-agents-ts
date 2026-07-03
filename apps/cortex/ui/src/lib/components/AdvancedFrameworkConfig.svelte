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
   * Curated paths (fields the hand-built panel already exposes) are excluded so
   * they aren't shown twice; everything else framework-settable shows up here.
   */
  import { hintFor } from "$lib/config-presentation.js";
  import type { CapabilityManifest, ConfigFieldDescriptor } from "$lib/capabilities.js";

  interface Props {
    manifest: CapabilityManifest | null;
    /** Nested partial AgentConfig; bound so edits flow back to the parent config. */
    rawConfig: Record<string, unknown>;
  }
  let { manifest, rawConfig = $bindable() }: Props = $props();

  // Framework paths the curated panel already renders — excluded from the
  // generic section to avoid duplicate controls. Everything else framework-
  // settable is surfaced generically.
  const CURATED = new Set<string>([
    "name", "agentId", "provider", "model", "systemPrompt", "temperature",
    "maxTokens", "numCtx", "thinking",
    "reasoning.defaultStrategy", "reasoning.enableStrategySwitching",
    "execution.maxIterations", "execution.minIterations", "execution.timeoutMs",
    "tools.allowedTools", "tools.focusedTools", "tools.adaptive", "tools.terminal",
  ]);

  // Only scalar/enum leaves render generically; arrays + nested objects are
  // handled by curated controls or left to future widgets.
  const RENDERABLE = new Set(["string", "number", "boolean", "enum"]);

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
    const rows: Row[] = manifest.configFields
      .filter((f) => RENDERABLE.has(f.type) && !CURATED.has(f.path))
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

{#if manifest && totalRows > 0}
  <details class="mt-2 rounded-md border border-[var(--cortex-border)] bg-surface-container-lowest/40">
    <summary class="cursor-pointer select-none px-3 py-2 font-mono text-[10px] uppercase text-[var(--cortex-text-muted)]">
      Advanced — framework config
      <span class="ml-1 opacity-60">({totalRows} fields, auto-synced)</span>
    </summary>
    <div class="px-3 pb-3 pt-1">
      <p class="mb-2 font-mono text-[8px] text-[var(--cortex-text-muted)]">
        Rendered live from the framework's typed config schema. New framework
        fields appear here automatically. Curated controls above win on conflict.
      </p>
      {#each groups as group (group.name)}
        <div class="mb-2">
          <div class="mb-1 font-mono text-[9px] uppercase tracking-wide text-[var(--cortex-text-muted)] opacity-70">{group.name}</div>
          {#each group.rows as row (row.field.path)}
            {@const val = getPath(rawConfig, row.field.path)}
            <div class="mb-1.5">
              {#if row.field.type === "boolean"}
                <label class="flex items-center gap-2 font-mono text-[10px]" title={row.field.path}>
                  <input
                    type="checkbox"
                    checked={val === true}
                    onchange={(e) => setPath(row.field.path, (e.currentTarget as HTMLInputElement).checked)}
                  />
                  {row.label}
                </label>
              {:else}
                <label class="config-label block" for={`adv-${row.field.path}`} title={row.field.path}>{row.label}</label>
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
                    class="config-input"
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
                <p class="mt-0.5 font-mono text-[8px] text-[var(--cortex-text-muted)] opacity-70">{row.help}</p>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </details>
{/if}
