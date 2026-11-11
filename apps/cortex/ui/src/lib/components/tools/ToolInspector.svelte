<script lang="ts">
  import { kindBadgeClass, kindLabel, relativeTime, type CatalogEntry } from "$lib/tool-workshop.js";

  interface Props {
    /** The selected catalog tool. */
    tool: CatalogEntry;
    onExport: () => void;
    /** Custom tools only. */
    onToggleDisabled: () => void | Promise<void>;
    onDelete: () => void | Promise<void>;
    onCopySchema: () => void | Promise<void>;
  }
  const { tool: selected, onExport, onToggleDisabled, onDelete, onCopySchema }: Props = $props();
</script>

        <div class="p-4 border-b border-outline-variant/15 space-y-3 flex-shrink-0 overflow-y-auto max-h-[45vh]">
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap mb-1">
                <h4 class="font-headline text-sm font-bold text-on-surface uppercase tracking-wide">
                  {selected.displayName}
                </h4>
                <span
                  class="text-[7px] font-mono px-1.5 py-0.5 rounded border uppercase {kindBadgeClass(selected.kind)}"
                  >{kindLabel(selected.kind)}</span
                >
              </div>
              <p class="font-mono text-[10px] text-outline/70 leading-relaxed">{selected.description}</p>
              {#if selected.executableHint && !selected.executable}
                <p class="font-mono text-[9px] text-amber-200/70 mt-2">{selected.executableHint}</p>
              {/if}
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onclick={onExport}
                class="text-[9px] font-mono px-3 py-1.5 rounded border border-outline-variant/30 text-outline hover:text-on-surface bg-transparent"
              >
                Export
              </button>
              {#if selected.kind === "custom"}
                <button
                  type="button"
                  onclick={onToggleDisabled}
                  class="text-[9px] font-mono px-3 py-1.5 rounded border border-error/35 text-error/90 hover:bg-error/10 bg-transparent"
                >
                  {selected.disabled ? "Enable" : "Disable"}
                </button>
                <button
                  type="button"
                  onclick={onDelete}
                  class="text-[9px] font-mono px-3 py-1.5 rounded border border-outline-variant/20 text-outline hover:text-error bg-transparent"
                >
                  Delete
                </button>
              {/if}
            </div>
          </div>

          <div
            class="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[9px] uppercase tracking-wider text-outline/55"
          >
            <div class="rounded bg-surface-container-lowest/50 px-2 py-1.5 border border-outline-variant/10">
              <div class="text-[7px] text-outline/40">Calls</div>
              <div class="text-secondary/90 tabular-nums">{selected.metrics.callCount}</div>
            </div>
            <div class="rounded bg-surface-container-lowest/50 px-2 py-1.5 border border-outline-variant/10">
              <div class="text-[7px] text-outline/40">Success</div>
              <div class="text-secondary/90 tabular-nums">
                {selected.metrics.successRatePct != null ? `${selected.metrics.successRatePct}%` : "—"}
              </div>
            </div>
            <div class="rounded bg-surface-container-lowest/50 px-2 py-1.5 border border-outline-variant/10">
              <div class="text-[7px] text-outline/40">Avg</div>
              <div class="text-secondary/90 tabular-nums">
                {selected.metrics.avgDurationMs != null ? `${selected.metrics.avgDurationMs}ms` : "—"}
              </div>
            </div>
            <div class="rounded bg-surface-container-lowest/50 px-2 py-1.5 border border-outline-variant/10">
              <div class="text-[7px] text-outline/40">Last used</div>
              <div class="text-secondary/90">{relativeTime(selected.metrics.lastUsedAt)}</div>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <div class="text-[8px] font-mono text-outline/50 uppercase tracking-widest">Input schema</div>
              {#if selected.parameters.length > 0}
                <button
                  type="button"
                  class="text-[8px] font-mono text-outline/40 hover:text-primary transition-colors border-0 bg-transparent cursor-pointer"
                  onclick={onCopySchema}
                  title="Copy schema JSON"
                >
                  copy
                </button>
              {/if}
            </div>
            <div class="overflow-x-auto rounded border border-outline-variant/15">
              <table class="w-full text-left font-mono text-[9px]">
                <thead class="bg-surface-container-lowest/80 text-outline/50 uppercase tracking-wider">
                  <tr>
                    <th class="px-2 py-1.5 font-normal">Property</th>
                    <th class="px-2 py-1.5 font-normal">Type</th>
                    <th class="px-2 py-1.5 font-normal">Status</th>
                    <th class="px-2 py-1.5 font-normal">Description</th>
                  </tr>
                </thead>
                <tbody class="text-on-surface/85">
                  {#if selected.parameters.length === 0}
                    <tr>
                      <td colspan="4" class="px-2 py-3 text-outline/45 italic">
                        {#if selected.kind === "mcp"}
                          No cached parameters — open <strong>Create tool</strong> → MCP, select the server, run <strong>Refresh tools</strong>.
                        {:else}
                          No parameters declared.
                        {/if}
                      </td>
                    </tr>
                  {:else}
                    {#each selected.parameters as p (p.name)}
                      <tr class="border-t border-outline-variant/10">
                        <td class="px-2 py-1.5 text-cyan-300/80">{p.name}</td>
                        <td class="px-2 py-1.5 text-outline/70">{p.type}</td>
                        <td class="px-2 py-1.5">
                          <span class={p.required ? "text-error/80" : "text-outline/50"}>
                            {p.required ? "REQUIRED" : "OPTIONAL"}
                          </span>
                        </td>
                        <td class="px-2 py-1.5 text-outline/65 max-w-[200px]">{p.description}</td>
                      </tr>
                    {/each}
                  {/if}
                </tbody>
              </table>
            </div>
          </div>
        </div>
