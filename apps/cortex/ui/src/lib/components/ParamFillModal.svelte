<script lang="ts">
  import type { VariableDef } from "../types/agent-config.js";
  import { CORTEX_SERVER_URL } from "../constants.js";
  import {
    initialValues,
    validateParamValues,
    toVariableValues,
    type ParamValues,
    type ParamErrors,
  } from "./param-fill-validate.js";

  interface Props {
    open: boolean;
    variables: VariableDef[];
    /** The unresolved config payload (e.g. { prompt, systemPrompt, taskContext }) for preview. */
    previewPayload: Record<string, unknown>;
    onConfirm: (values: Record<string, string | number>) => void;
    onCancel: () => void;
  }
  let { open, variables, previewPayload, onConfirm, onCancel }: Props = $props();

  // Seeded by the $effect below (which also re-seeds when `variables` changes),
  // so the initializer is intentionally empty to avoid capturing a stale snapshot.
  let values: ParamValues = $state({});
  let errors: ParamErrors = $state({});
  let preview = $state<string>("");
  let previewUnresolved = $state<string[]>([]);
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    // Re-seed when the variable set changes (e.g. reopened for a different agent).
    values = initialValues(variables);
  });

  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 250);
  }

  async function refreshPreview() {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/template/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payload: previewPayload,
          variables,
          values: toVariableValues(variables, values),
        }),
      });
      if (!res.ok) return;
      const json = (await res.json()) as { resolved: Record<string, unknown>; unresolved: string[] };
      preview = typeof json.resolved.prompt === "string" ? json.resolved.prompt : JSON.stringify(json.resolved, null, 2);
      previewUnresolved = json.unresolved;
    } catch {
      /* preview is best-effort */
    }
  }

  function submit() {
    errors = validateParamValues(variables, values);
    if (Object.keys(errors).length > 0) return;
    onConfirm(toVariableValues(variables, values));
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-[200] flex items-center justify-center bg-background/70 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Fill run variables"
  >
    <!-- Click outside → cancel via invisible full-size button behind modal -->
    <button
      type="button"
      class="absolute inset-0 w-full h-full bg-transparent border-0 cursor-default"
      onclick={onCancel}
      aria-label="Close dialog"
    ></button>

    <!-- Modal panel -->
    <div
      class="relative z-10 w-full max-w-md max-h-[85vh] overflow-y-auto bg-surface-container
             border border-outline-variant/20 rounded-xl shadow-neural-strong animate-fade-up mx-4"
    >
      <div class="px-6 pt-5 pb-4">
        <h3 class="font-headline text-base font-semibold text-on-surface mb-4">Fill run variables</h3>

        <div class="flex flex-col gap-3">
          {#each variables as v (v.name)}
            <label class="flex flex-col gap-1">
              <span class="font-mono text-[11px] uppercase text-on-surface-variant">
                {v.name}{v.required !== false ? " *" : ""}
              </span>
              {#if v.description}
                <small class="font-mono text-[10px] text-outline">{v.description}</small>
              {/if}
              {#if v.type === "enum" && v.enumValues}
                <select
                  class="bg-surface border border-outline-variant/25 rounded px-2 py-1.5 font-mono text-[11px]
                         text-on-surface focus:outline-none focus:border-primary/50"
                  bind:value={values[v.name]}
                  onchange={schedulePreview}
                >
                  {#each v.enumValues as opt}<option value={opt}>{opt}</option>{/each}
                </select>
              {:else if v.type === "multiline"}
                <textarea
                  class="bg-surface border border-outline-variant/25 rounded px-2 py-1.5 font-mono text-[11px]
                         text-on-surface min-h-[64px] focus:outline-none focus:border-primary/50"
                  bind:value={values[v.name]}
                  oninput={schedulePreview}
                ></textarea>
              {:else}
                <input
                  type="text"
                  inputmode={v.type === "number" ? "decimal" : "text"}
                  class="bg-surface border border-outline-variant/25 rounded px-2 py-1.5 font-mono text-[11px]
                         text-on-surface focus:outline-none focus:border-primary/50"
                  bind:value={values[v.name]}
                  oninput={schedulePreview}
                />
              {/if}
              {#if errors[v.name]}
                <span class="font-mono text-[10px] text-error">{errors[v.name]}</span>
              {/if}
            </label>
          {/each}
        </div>

        {#if preview}
          <div class="mt-4 flex flex-col gap-1">
            <strong class="font-mono text-[10px] uppercase text-on-surface-variant">Preview</strong>
            <pre
              class="whitespace-pre-wrap break-words bg-surface border border-outline-variant/20 rounded
                     px-2 py-1.5 font-mono text-[11px] text-on-surface-variant leading-relaxed max-h-40 overflow-y-auto">{preview}</pre>
            {#if previewUnresolved.length}
              <span class="font-mono text-[10px] text-error">Unresolved: {previewUnresolved.join(", ")}</span>
            {/if}
          </div>
        {/if}
      </div>

      <div class="px-6 pb-5 flex items-center justify-end gap-3">
        <button
          type="button"
          class="px-4 py-1.5 border border-outline-variant/25 text-outline font-mono text-[11px]
                 uppercase rounded bg-transparent cursor-pointer hover:text-on-surface transition-colors"
          onclick={onCancel}
        >Cancel</button>
        <button
          type="button"
          class="px-4 py-1.5 font-mono text-[11px] uppercase rounded cursor-pointer transition-colors
                 bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25"
          onclick={submit}
        >Run</button>
      </div>
    </div>
  </div>
{/if}
