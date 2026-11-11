<script lang="ts">
  import PromptPickerButton from "$lib/components/PromptPickerButton.svelte";
  import HighlightedField from "$lib/components/HighlightedField.svelte";
  import {
    BUILDER_ADHOC_ACTIONS,
    SCHEDULE_PRESETS,
    adHocPrimaryDisabled,
    adHocPrimaryTitle,
    type BuilderAdHocAction,
    type BuilderAgentConfig,
  } from "$lib/lab-builder.js";

  interface Props {
    config: BuilderAgentConfig;
    agentType?: "ad-hoc" | "persistent";
    name?: string;
    schedule?: string;
    adHocAction?: BuilderAdHocAction;
    running: boolean;
    saving: boolean;
    /** Run the selected ad-hoc action. */
    onExecute: () => void | Promise<void>;
    /** Create the persistent (gateway) agent. */
    onCreatePersistent: () => void | Promise<void>;
    onExport: () => void;
  }
  let {
    config = $bindable(), agentType = $bindable("ad-hoc"), name = $bindable(""), schedule = $bindable(""), adHocAction = $bindable("save-run"),
    running, saving, onExecute, onCreatePersistent, onExport,
  }: Props = $props();

  let builderActionMenuOpen = $state(false);
  let builderActionMenuRoot = $state<HTMLDivElement | undefined>();
  const buttonState = $derived({ action: adHocAction, busy: running || saving, prompt: config.prompt, name });

  $effect(() => {
    if (!builderActionMenuOpen || typeof document === "undefined") return;
    const root = builderActionMenuRoot;
    const onPointerDown = (ev: PointerEvent) => {
      const t = ev.target;
      if (!(t instanceof Node) || !root?.contains(t)) builderActionMenuOpen = false;
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") builderActionMenuOpen = false;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  });
</script>

          <aside
            class="flex min-h-0 min-w-0 flex-col gap-4 lg:sticky lg:top-0 lg:self-start lg:max-h-[calc(100dvh-7rem)]"
          >
            <div class="grid shrink-0 grid-cols-2 gap-3">
              <label
                class="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--cortex-border)] bg-white/95 p-2 transition-colors hover:border-primary/45 dark:border-white/10 dark:bg-surface-container-high/40 dark:hover:border-primary/40 dark:hover:bg-primary/[0.07]"
              >
                <input
                  type="radio"
                  name="builder-agent-type"
                  checked={agentType === "ad-hoc"}
                  onchange={() => (agentType = "ad-hoc")}
                  class="accent-primary"
                />
                <span class="font-mono text-[10px] text-slate-800 dark:text-on-surface/90">Ad-hoc (saved, on-demand)</span>
              </label>
              <label
                class="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--cortex-border)] bg-white/95 p-2 transition-colors hover:border-primary/45 dark:border-white/10 dark:bg-surface-container-high/40 dark:hover:border-primary/40 dark:hover:bg-primary/[0.07]"
              >
                <input
                  type="radio"
                  name="builder-agent-type"
                  checked={agentType === "persistent"}
                  onchange={() => (agentType = "persistent")}
                  class="accent-primary"
                />
                <span class="font-mono text-[10px] text-slate-800 dark:text-on-surface/90">Persistent (gateway process)</span>
              </label>
            </div>

            <div class="space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-0.5">
              <div>
              <div class="mb-1.5 flex items-end justify-between gap-2">
                <label for="builder-prompt" class="block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Prompt</label>
                <PromptPickerButton
                  types={["task", "snippet"]}
                  defaultSaveType="task"
                  placement="down"
                  title="Insert a saved prompt"
                  onSelect={(body) => {
                    config = { ...config, prompt: config.prompt ? `${config.prompt}\n${body}` : body };
                  }}
                />
              </div>
              <HighlightedField
                multiline
                id="builder-prompt"
                value={config.prompt}
                oninput={(e) => (config.prompt = (e.currentTarget as HTMLTextAreaElement).value)}
                placeholder="Describe what you want the agent to do…"
                rows={5}
                frameClass="rounded-lg border border-[var(--cortex-border)] bg-white shadow-sm transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/25 dark:border-white/10 dark:bg-surface-container-high/60 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus-within:border-secondary/55 dark:focus-within:ring-secondary/20"
                textClass="w-full resize-y bg-transparent px-4 py-3 font-mono text-sm leading-5 text-slate-900 outline-none placeholder:text-slate-400 dark:text-on-surface dark:placeholder:text-on-surface-variant/50 min-h-[7.5rem] lg:min-h-[11rem]"
              />
              </div>

              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div class={agentType === "persistent" ? "" : "sm:col-span-2 lg:col-span-1"}>
                <label for="builder-persistent-name" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Name *</label>
                <input
                  id="builder-persistent-name"
                  bind:value={name}
                  placeholder={agentType === "persistent" ? "my-gateway-agent" : "my-ad-hoc-agent"}
                  class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/10 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20"
                />
              </div>
              {#if agentType === "persistent"}
                <div class="sm:col-span-2 lg:col-span-1">
                  <label for="builder-persistent-schedule" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">
                    Schedule <span class="font-normal normal-case text-slate-400 dark:text-on-surface-variant/50">(preset or cron, blank = manual)</span>
                  </label>
                  <div class="mb-1.5 flex flex-wrap gap-1">
                    {#each SCHEDULE_PRESETS as preset}
                      <button
                        type="button"
                        onclick={() => (schedule = preset.cron)}
                        class="cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[8px] transition-colors {schedule === preset.cron
                          ? 'border-primary/45 bg-violet-100/90 text-violet-900 dark:border-primary/50 dark:bg-primary/[0.18] dark:text-primary'
                          : 'border-[var(--cortex-border)] text-slate-500 hover:border-primary/35 hover:text-primary dark:border-white/10 dark:text-on-surface-variant dark:hover:border-primary/40 dark:hover:text-primary'}"
                      >
                        {preset.label}
                      </button>
                    {/each}
                    {#if schedule && !SCHEDULE_PRESETS.some((p) => p.cron === schedule)}
                      <span class="self-center font-mono text-[8px] text-slate-400 dark:text-on-surface-variant/45">custom:</span>
                    {/if}
                  </div>
                  <input
                    id="builder-persistent-schedule"
                    bind:value={schedule}
                    placeholder="*/5 * * * *  or leave blank for manual"
                    class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/10 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20"
                  />
                  {#if schedule}
                    <p class="mt-1 font-mono text-[9px] text-cyan-800 dark:text-secondary/80">
                      Agent process will start immediately and fire on this schedule.
                    </p>
                  {:else}
                    <p class="mt-1 font-mono text-[9px] text-slate-500 dark:text-on-surface-variant/60">
                      No schedule — start the process manually from Agents after creation.
                    </p>
                  {/if}
                </div>
              {/if}
              </div>
            </div>

            <div
              class="flex shrink-0 flex-col gap-2 border-t border-[var(--cortex-border)] pt-4 dark:border-white/10"
            >
              {#if agentType === "ad-hoc"}
                <p class="font-mono text-[10px] leading-snug text-slate-600 dark:text-on-surface-variant/80">
                  Use the <span class="text-slate-800 dark:text-on-surface/90">chevron</span> to pick run vs save, then the main button.
                </p>
                <div class="relative w-full min-w-0" bind:this={builderActionMenuRoot}>
                  {#if builderActionMenuOpen}
                    <div
                      role="listbox"
                      aria-label="Ad-hoc action"
                      class="absolute bottom-full left-0 right-0 z-40 mb-1.5 overflow-hidden rounded-lg border border-[var(--cortex-border)] bg-white py-1 shadow-lg dark:border-white/10 dark:bg-surface-container-high"
                    >
                      {#each BUILDER_ADHOC_ACTIONS as a (a.id)}
                        <button
                          type="button"
                          role="option"
                          aria-selected={adHocAction === a.id}
                          class="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wide text-slate-900 transition-colors hover:bg-violet-50/90 dark:text-on-surface dark:hover:bg-white/[0.06]"
                          onclick={() => {
                            adHocAction = a.id;
                            builderActionMenuOpen = false;
                          }}
                        >
                          <span class="inline-flex w-5 shrink-0 justify-center pt-0.5">
                            {#if adHocAction === a.id}
                              <span class="material-symbols-outlined text-base text-primary dark:text-secondary">check</span>
                            {/if}
                          </span>
                          <span class="min-w-0 flex-1">
                            <span class="block">{a.label}</span>
                            <span
                              class="mt-0.5 block font-normal normal-case tracking-normal text-[9px] text-slate-500 dark:text-on-surface-variant/75">{a.hint}</span>
                          </span>
                        </button>
                      {/each}
                    </div>
                  {/if}

                  <div
                    class="flex w-full min-w-0 overflow-hidden rounded-lg shadow-sm {adHocAction === 'save-run'
                      ? 'shadow-[0_0_20px_rgba(139,92,246,0.35)] dark:shadow-[0_0_32px_rgba(139,92,246,0.45),0_0_24px_rgba(6,182,212,0.15)]'
                      : 'border border-[var(--cortex-border)] dark:border-white/10'}"
                  >
                    <button
                      type="button"
                      disabled={adHocPrimaryDisabled(buttonState)}
                      title={adHocPrimaryTitle(buttonState)}
                      onclick={() => {
                        builderActionMenuOpen = false;
                        void onExecute();
                      }}
                      class="flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 py-2.5 pl-3 pr-2 font-mono text-[10px] uppercase tracking-wider transition-all hover:brightness-110 disabled:opacity-40 {adHocAction === 'save-run'
                        ? 'text-white'
                        : 'bg-white text-slate-800 hover:bg-violet-50/80 dark:bg-surface-container-high/60 dark:text-on-surface dark:hover:bg-primary/[0.08]'}"
                      style={adHocAction === "save-run"
                        ? "background:linear-gradient(135deg,#8b5cf6,#06b6d4);"
                        : undefined}
                    >
                      {#if running || saving}
                        <span class="material-symbols-outlined shrink-0 text-sm animate-spin">progress_activity</span>
                      {:else if adHocAction === "run"}
                        <span class="material-symbols-outlined shrink-0 text-sm">science</span>
                      {:else if adHocAction === "save"}
                        <span class="material-symbols-outlined shrink-0 text-sm">bookmark_add</span>
                      {:else}
                        <span class="material-symbols-outlined shrink-0 text-sm">rocket_launch</span>
                      {/if}
                      <span class="truncate">{BUILDER_ADHOC_ACTIONS.find((x) => x.id === adHocAction)?.label ?? ""}</span>
                    </button>
                    <button
                      type="button"
                      disabled={running || saving}
                      aria-haspopup="listbox"
                      aria-expanded={builderActionMenuOpen}
                      aria-label="Choose ad-hoc action"
                      onclick={(e) => {
                        e.stopPropagation();
                        builderActionMenuOpen = !builderActionMenuOpen;
                      }}
                      class="flex w-10 shrink-0 cursor-pointer items-center justify-center border-l py-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 {adHocAction === 'save-run'
                        ? 'border-white/25 text-white hover:bg-white/10'
                        : 'border-[var(--cortex-border)] bg-white text-slate-600 hover:bg-violet-50/80 dark:border-white/10 dark:bg-surface-container-high/60 dark:text-on-surface-variant dark:hover:bg-primary/[0.08]'}"
                      style={adHocAction === "save-run"
                        ? "background:linear-gradient(135deg,#8b5cf6,#06b6d4);"
                        : undefined}
                    >
                      <span
                        class="material-symbols-outlined text-lg leading-none transition-transform {builderActionMenuOpen
                          ? 'rotate-180'
                          : ''}"
                      >expand_less</span>
                    </button>
                  </div>
                </div>
              {:else}
                <button type="button" disabled={!name.trim() || saving} onclick={() => onCreatePersistent()}
                  class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-0 px-6 py-2.5 font-mono text-[11px] uppercase tracking-wider text-white shadow-[0_0_20px_rgba(139,92,246,0.35)] transition-all hover:brightness-110 disabled:opacity-40 dark:shadow-[0_0_32px_rgba(139,92,246,0.45),0_0_24px_rgba(6,182,212,0.15)]"
                  style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);">
                  {#if saving}
                    <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                  {:else}
                    <span class="material-symbols-outlined text-sm">save</span>
                  {/if}
                  Create Gateway Agent
                </button>
              {/if}
              <button
                type="button"
                onclick={onExport}
                class="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[var(--cortex-border)] px-6 py-2 font-mono text-[10px] uppercase tracking-wider text-slate-600 transition-colors hover:border-primary/40 hover:text-primary dark:text-on-surface-variant"
              >
                <span class="material-symbols-outlined text-sm">ios_share</span>
                Export agent (TS / JSON)
              </button>
            </div>
          </aside>
