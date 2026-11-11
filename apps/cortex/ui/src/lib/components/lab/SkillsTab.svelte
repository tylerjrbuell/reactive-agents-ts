<script lang="ts">
  import { onMount } from "svelte";
  import MarkdownRich from "$lib/components/MarkdownRich.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import {
    formatYamlValue,
    skillCatalogRows,
    type FsSkillSummary,
    type LabSkillsStore,
    type LabSkillsUi,
    type SkillListSelection,
    type SkillRow,
  } from "$lib/stores/lab-skills-store.js";

  interface Props {
    store: LabSkillsStore;
    /** View state the page keeps across tab switches. */
    ui: LabSkillsUi;
    /** The Builder's living-skill paths. */
    builderSkillPaths: readonly string[];
    /** Add skill roots to the Builder's living skills. */
    onAddPaths: (paths: string[]) => void;
    /** Ask to delete a SQLite skill (the page confirms). */
    onDelete: (skill: SkillRow) => void;
  }
  let { store, ui = $bindable(), builderSkillPaths, onAddPaths, onDelete }: Props = $props();

  const skills = $derived($store.skills);
  const fsSkillSummaries = $derived($store.fsSkills);
  const discoveredSkillPaths = $derived($store.discoveredPaths);
  const rows = $derived(skillCatalogRows(fsSkillSummaries, skills, ui.filter));

  onMount(() => {
    void store.loadDiscover();
    void store.loadFsSkills();
  });

  async function createNewSkill() {
    if (!ui.newSkillName.trim()) {
      toast.warning("Name is required");
      return;
    }
    if (!ui.newSkillInstructions.trim()) {
      toast.warning("Instructions are required");
      return;
    }

    ui.newSkillSaving = true;
    try {
      const tags = ui.newSkillTags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      await store.create({
        name: ui.newSkillName.trim(),
        instructions: ui.newSkillInstructions.trim(),
        description: ui.newSkillDescription.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });

      toast.success("Skill created", ui.newSkillName.trim());
      ui.showNewSkillForm = false;
      ui.newSkillName = "";
      ui.newSkillInstructions = "";
      ui.newSkillDescription = "";
      ui.newSkillTags = "";

      await store.reloadDb();
    } catch (e) {
      toast.error("Create failed", String(e));
    } finally {
      ui.newSkillSaving = false;
    }
  }

  async function loadSkillDetail(sel: SkillListSelection) {
    ui.selection = sel;
    ui.detailLoading = true;
    ui.detailError = null;
    ui.detail = null;
    try {
      const r = await store.fetchDetail(sel);
      if ("error" in r) {
        ui.detailError = r.error;
        return;
      }
      ui.detail = r.detail;
    } catch (e) {
      ui.detailError = String(e);
    } finally {
      ui.detailLoading = false;
    }
  }

  function selectFilesystemSkill(s: FsSkillSummary) {
    void loadSkillDetail({ kind: "filesystem", relPath: s.relPath });
  }

  function selectSqliteSkill(s: SkillRow) {
    const id = s.id != null ? String(s.id) : "";
    if (!id) {
      toast.warning("This row has no id", "Cannot load SQLite skill detail.");
      return;
    }
    void loadSkillDetail({ kind: "sqlite", id });
  }

  function isFsSkillSelected(s: FsSkillSummary): boolean {
    return ui.selection?.kind === "filesystem" && ui.selection.relPath === s.relPath;
  }

  function isSqliteSkillSelected(s: SkillRow): boolean {
    const id = s.id != null ? String(s.id) : "";
    return ui.selection?.kind === "sqlite" && id !== "" && ui.selection.id === id;
  }

  function skillPathInBuilder(p: string): boolean {
    return builderSkillPaths.includes(p);
  }
</script>

    <div class="flex flex-col flex-1 min-h-0 overflow-hidden gap-3">
      {#if ui.showNewSkillForm}
        <div
          class="gradient-border flex-shrink-0 rounded-lg p-4 shadow-md dark:shadow-[0_0_40px_-16px_rgba(139,92,246,0.25)]"
        >
          <div class="max-w-2xl space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="font-headline text-sm font-semibold text-slate-900 dark:text-on-surface">New Skill</h3>
              <button type="button" onclick={() => (ui.showNewSkillForm = false)}
                class="material-symbols-outlined cursor-pointer border-0 bg-transparent text-slate-500 hover:text-primary dark:text-on-surface-variant dark:hover:text-primary"
                >close</button>
            </div>

            <div>
              <label for="new-skill-name" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Name *</label>
              <input id="new-skill-name" bind:value={ui.newSkillName} placeholder="my-skill"
                class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/10 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20" />
            </div>

            <div>
              <label for="new-skill-instructions" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Instructions *</label>
              <textarea id="new-skill-instructions" bind:value={ui.newSkillInstructions} placeholder="Describe what this skill does and how to use it…" rows="6"
                class="w-full resize-none rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/10 dark:bg-surface-container-high/60 dark:text-on-surface dark:placeholder:text-on-surface-variant/50 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20">
              </textarea>
            </div>

            <div>
              <label for="new-skill-description" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Description <span class="font-normal normal-case text-slate-400 dark:text-on-surface-variant/55">(optional)</span></label>
              <input id="new-skill-description" bind:value={ui.newSkillDescription} placeholder="Brief one-liner"
                class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/10 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20" />
            </div>

            <div>
              <label for="new-skill-tags" class="mb-1.5 block font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Tags <span class="font-normal normal-case text-slate-400 dark:text-on-surface-variant/55">(comma-separated, optional)</span></label>
              <input id="new-skill-tags" bind:value={ui.newSkillTags} placeholder="analytics, reporting, data"
                class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/10 dark:bg-surface-container-high/60 dark:text-on-surface dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:focus:border-secondary/55 dark:focus:ring-secondary/20" />
            </div>

            <div class="flex justify-end gap-2 pt-2">
              <button type="button" onclick={() => (ui.showNewSkillForm = false)}
                class="cursor-pointer rounded border border-[var(--cortex-border)] bg-transparent px-4 py-1.5 font-mono text-[10px] uppercase text-slate-600 transition-colors hover:border-primary/35 hover:text-primary dark:border-white/10 dark:text-on-surface-variant dark:hover:text-on-surface">
                Cancel</button>
              <button type="button" disabled={ui.newSkillSaving || !ui.newSkillName.trim() || !ui.newSkillInstructions.trim()} onclick={createNewSkill}
                class="px-6 py-1.5 rounded border-0 cursor-pointer font-mono text-[10px] uppercase text-white disabled:opacity-40 hover:brightness-110 transition-all"
                style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);">
                {ui.newSkillSaving ? "Saving…" : "Create Skill"}
              </button>
            </div>
          </div>
        </div>
      {/if}

      <header class="flex flex-shrink-0 flex-col gap-2 border-b border-[var(--cortex-border)] pb-3 dark:border-primary/20">
        <div class="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 class="font-headline text-sm font-semibold tracking-tight text-slate-900 dark:text-on-surface">Skills workshop</h2>
            <p class="mt-1 max-w-3xl font-mono text-[10px] leading-relaxed text-slate-600 dark:text-on-surface-variant/85">
              Open Agent Skills use <code class="text-cyan-800 dark:text-secondary/90">.agents/skills/&lt;skill-name&gt;/SKILL.md</code>
              (YAML + markdown). The desk scans <strong class="text-slate-800 dark:text-on-surface/90">your process cwd</strong> and
              <strong class="text-slate-800 dark:text-on-surface/90">the Cortex app folder</strong> for the roots below, so skills still appear if you start the API from an unexpected directory.
              Optional: set <code class="text-slate-500 dark:text-on-surface-variant/70">CORTEX_SKILL_SCAN_ROOT</code> to add another base path.
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              onclick={() => {
                void store.loadDiscover();
                void store.loadFsSkills();
              }}
              class="shrink-0 cursor-pointer rounded border border-[var(--cortex-border)] bg-white px-3 py-1.5 font-mono text-[10px] text-slate-700 shadow-sm transition-colors hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-surface-container-high/50 dark:text-on-surface-variant dark:hover:border-secondary/40 dark:hover:text-secondary"
            >
              ↻ Rescan
            </button>
            <button
              type="button"
              onclick={() => (ui.showNewSkillForm = true)}
              class="flex items-center gap-1.5 px-4 py-1.5 rounded border-0 cursor-pointer font-mono text-[10px] uppercase text-white hover:brightness-110 transition-all shrink-0"
              style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);"
            >
              <span class="material-symbols-outlined text-sm">add</span> New Skill
            </button>
          </div>
        </div>
      </header>

      <div
        class="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden rounded-lg border border-[var(--cortex-border)] bg-white/70 shadow-inner dark:bg-surface-container-low/40 dark:shadow-[inset_0_0_0_1px_rgba(139,92,246,0.08)] md:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] xl:grid-cols-[minmax(240px,280px)_minmax(0,1fr)_minmax(220px,260px)]"
      >
        <!-- 1 — Catalog -->
        <aside
          class="flex min-h-0 flex-col border-b border-[var(--cortex-border)] bg-slate-50/80 dark:border-white/[0.08] dark:bg-surface-container/50 md:border-b-0 md:border-r"
        >
          <div class="flex-shrink-0 space-y-2 border-b border-[var(--cortex-border)] p-3 dark:border-white/[0.06]">
            <label for="skill-catalog-filter" class="font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Filter catalog</label>
            <input
              id="skill-catalog-filter"
              bind:value={ui.filter}
              placeholder="Filter skills…"
              class="w-full rounded-lg border border-[var(--cortex-border)] bg-white px-3 py-2 font-mono text-xs text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-white/10 dark:bg-surface-container-high/60 dark:text-on-surface dark:placeholder:text-on-surface-variant/45 dark:focus:border-secondary/55 dark:focus:ring-secondary/20"
            />
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {#if rows.length === 0}
              <div class="space-y-2 p-4 font-mono text-[10px] leading-relaxed text-slate-600 dark:text-on-surface-variant/80">
                {#if fsSkillSummaries.length === 0 && skills.length === 0}
                  <p>No skills found.</p>
                  <p class="text-slate-500 dark:text-on-surface-variant/65">
                    Create <code class="text-violet-700 dark:text-primary/90">.agents/skills/&lt;name&gt;/SKILL.md</code> (open skill layout), ensure the Cortex server cwd is the folder that contains <code class="text-slate-600 dark:text-on-surface-variant/55">.agents</code>, then <strong class="text-slate-800 dark:text-on-surface/80">Rescan</strong>.
                  </p>
                {:else}
                  <p>No skills match the filter.</p>
                  <p class="text-slate-500 dark:text-on-surface-variant/65">Clear the filter or try another name.</p>
                {/if}
              </div>
            {/if}
            {#each rows as row, idx (row.t === "hdr" ? `h-${idx}-${row.label}` : row.t === "fs" ? `f-${row.s.relPath}` : row.rowKey)}
              {#if row.t === "hdr"}
                <div
                  class="border-t border-[var(--cortex-border)] px-2 pb-1 pt-3 font-mono text-[9px] uppercase tracking-widest text-cyan-800 first:border-t-0 first:pt-1 dark:border-white/[0.06] dark:text-secondary/90"
                >
                  {row.label}
                </div>
              {:else if row.t === "fs"}
                <button
                  type="button"
                  class="w-full rounded-md border p-2.5 text-left transition-all {isFsSkillSelected(row.s)
                    ? 'border-primary/45 bg-violet-100/95 shadow-[inset_0_0_0_1px_rgba(124,58,237,0.18)] dark:border-primary/50 dark:bg-primary/[0.2] dark:shadow-[0_0_24px_-10px_rgba(139,92,246,0.35)]'
                    : 'border-[var(--cortex-border)] bg-white/95 hover:border-primary/35 dark:border-white/10 dark:bg-surface-container-high/45 dark:hover:border-primary/40'}"
                  onclick={() => selectFilesystemSkill(row.s)}
                >
                  <div class="font-mono text-[11px] font-medium leading-snug text-slate-900 dark:text-on-surface">{row.s.name}</div>
                  <div class="mt-1 line-clamp-2 font-mono text-[9px] text-slate-600 dark:text-on-surface-variant/80">{row.s.description || "—"}</div>
                  <div class="mt-1.5 truncate font-mono text-[8px] text-slate-400 dark:text-on-surface-variant/50" title={row.s.relPath}>{row.s.relPath}</div>
                </button>
              {:else}
                <div class="flex items-stretch gap-1">
                  <button
                    type="button"
                    class="flex-1 rounded-md border p-2.5 text-left transition-all {isSqliteSkillSelected(row.s)
                      ? 'border-primary/45 bg-violet-100/95 shadow-[inset_0_0_0_1px_rgba(124,58,237,0.18)] dark:border-primary/50 dark:bg-primary/[0.2] dark:shadow-[0_0_24px_-10px_rgba(139,92,246,0.35)]'
                      : 'border-[var(--cortex-border)] bg-white/95 hover:border-primary/35 dark:border-white/10 dark:bg-surface-container-high/45 dark:hover:border-primary/40'}"
                    onclick={() => selectSqliteSkill(row.s)}
                  >
                    <div class="mb-0.5 flex items-center gap-1.5">
                      <span class="rounded border border-[var(--cortex-border)] px-1 font-mono text-[7px] uppercase text-slate-500 dark:border-white/10 dark:text-on-surface-variant/70">db</span>
                      <span class="font-mono text-[11px] font-medium text-slate-900 dark:text-on-surface">{row.s.name ?? row.s.id ?? "skill"}</span>
                    </div>
                    <div class="line-clamp-2 font-mono text-[9px] text-slate-600 dark:text-on-surface-variant/80">{row.s.description ?? ""}</div>
                  </button>
                  <button
                    type="button"
                    onclick={() => onDelete(row.s)}
                    class="flex cursor-pointer items-center justify-center rounded-md border border-[var(--cortex-border)] bg-transparent p-2.5 text-slate-500 transition-colors hover:border-error/40 hover:text-error dark:border-white/10 dark:text-on-surface-variant dark:hover:text-error"
                    title="Delete skill"
                  >
                    <span class="material-symbols-outlined text-sm">delete</span>
                  </button>
                </div>
              {/if}
            {/each}
          </div>
        </aside>

        <!-- 2 — Document (primary reading column) -->
        <main class="flex min-h-0 min-w-0 flex-col border-b border-[var(--cortex-border)] bg-white/80 dark:border-white/[0.08] dark:bg-surface-container-low/30 md:border-b-0 xl:border-r">
          {#if ui.detailLoading}
            <div class="flex flex-1 items-center justify-center gap-2 p-8 font-mono text-xs text-slate-500 dark:text-on-surface-variant/80">
              <span class="material-symbols-outlined animate-spin text-primary">progress_activity</span>
              Loading…
            </div>
          {:else if ui.detailError}
            <div class="m-4 rounded border border-error/40 bg-error/10 p-4 font-mono text-[11px] text-error dark:bg-error/15 dark:text-red-200">{ui.detailError}</div>
          {:else if ui.detail}
            {@const skillDetail = ui.detail}
            <div class="flex-shrink-0 border-b border-[var(--cortex-border)] bg-slate-50/90 p-4 dark:border-white/[0.06] dark:bg-surface-container-high/30">
              <div class="flex flex-wrap items-start gap-2">
                <span class="material-symbols-outlined shrink-0 text-xl text-cyan-700 dark:text-secondary" aria-hidden="true">bolt</span>
                <div class="min-w-0 flex-1">
                  <h3 class="font-headline text-lg font-bold uppercase tracking-tight text-slate-900 dark:text-on-surface">{skillDetail.name}</h3>
                  <div class="flex flex-wrap gap-1.5 mt-2">
                    <span
                      class="rounded border border-[var(--cortex-border)] px-2 py-0.5 font-mono text-[8px] uppercase tracking-wider text-slate-600 dark:border-white/10 dark:text-on-surface-variant/85"
                    >
                      {skillDetail.filePath.startsWith("sqlite:") ? "SQLite" : "Open skill"}
                    </span>
                    {#if skillDetail.description}
                      <span class="rounded border border-cyan-400/40 px-2 py-0.5 font-mono text-[8px] uppercase tracking-wider text-cyan-800 dark:border-secondary/35 dark:text-secondary/90">when to use</span>
                    {/if}
                  </div>
                </div>
              </div>
              {#if skillDetail.description}
                <p class="mt-3 border-l-2 border-cyan-500/50 pl-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:border-secondary/45 dark:text-on-surface/85">
                  {skillDetail.description}
                </p>
              {/if}
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto p-4">
              <div class="mb-2 font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/80">Core instructions</div>
              <MarkdownRich markdown={skillDetail.instructions} class="text-sm max-w-none" showCopy={true} />
            </div>
          {:else}
            <div class="flex flex-1 items-center justify-center px-6 py-16 text-center font-mono text-xs text-slate-500 dark:text-on-surface-variant/75">
              Pick a skill from the catalog to preview instructions.
            </div>
          {/if}
        </main>

        <!-- 3 — Meta sidebar (YAML, roots, wire-up) -->
        <aside
          class="flex max-h-[50vh] min-h-0 flex-col overflow-y-auto border-t border-[var(--cortex-border)] bg-slate-50/90 md:col-span-2 md:max-h-none xl:col-span-1 xl:max-h-full dark:border-white/[0.06] dark:bg-surface-container/40"
        >
          <div class="space-y-3 border-b border-[var(--cortex-border)] p-3 dark:border-white/[0.06]">
            <div class="font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/85">Skill roots scanned</div>
            <p class="font-mono text-[9px] leading-relaxed text-slate-600 dark:text-on-surface-variant/75">
              Under each scan base, Cortex looks for: <code class="text-cyan-800 dark:text-secondary/90">.agents/skills</code>,
              <code class="text-slate-700 dark:text-on-surface-variant/80">skills</code>, <code class="text-slate-700 dark:text-on-surface-variant/80">.claude/skills</code>,
              <code class="text-slate-700 dark:text-on-surface-variant/80">apps/cortex/.agents/skills</code> (last is for monorepo-root cwd).
            </p>
            {#if discoveredSkillPaths.length === 0}
              <p class="font-mono text-[9px] text-slate-500 dark:text-on-surface-variant/65">No roots found on disk from this cwd.</p>
            {:else}
              <ul class="space-y-2">
                {#each discoveredSkillPaths as p (p)}
                  <li class="flex flex-col gap-1.5 font-mono text-[9px]">
                    <code class="break-all rounded bg-white px-2 py-1 text-cyan-800 shadow-sm dark:bg-surface-container-high/60 dark:text-secondary/90">{p}</code>
                    <button
                      type="button"
                      disabled={skillPathInBuilder(p)}
                      onclick={() => onAddPaths([p])}
                      class="self-start cursor-pointer rounded border border-primary/40 bg-primary/[0.08] px-2 py-1 text-[8px] text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40 dark:border-primary/50 dark:bg-primary/[0.14] dark:hover:bg-primary/[0.22]"
                    >
                      {skillPathInBuilder(p) ? "In Builder" : "Add to Builder"}
                    </button>
                  </li>
                {/each}
              </ul>
              {@const missing = discoveredSkillPaths.filter((p) => !skillPathInBuilder(p))}
              {#if missing.length > 0}
                <button
                  type="button"
                  onclick={() => onAddPaths(missing)}
                  class="w-full cursor-pointer rounded-md border-0 py-2 font-mono text-[9px] uppercase text-white shadow-[0_0_18px_rgba(139,92,246,0.35)] transition-all hover:brightness-110 dark:shadow-[0_0_26px_rgba(139,92,246,0.4)]"
                  style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);"
                >
                  Add all roots to Builder
                </button>
              {/if}
            {/if}
            <p class="font-mono text-[8px] leading-relaxed text-slate-500 dark:text-on-surface-variant/65">
              Framework runs use <strong class="text-slate-700 dark:text-on-surface/80">Living skills</strong> paths in Builder → Agent config.
            </p>
          </div>

          {#if ui.detail && !ui.detailLoading && !ui.detailError}
            {@const skillDetail = ui.detail}
            <div class="p-3 space-y-3 flex-1">
              {#if skillDetail.declaredFields && Object.keys(skillDetail.declaredFields).length > 0}
                <div>
                  <div class="mb-2 font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/80">Frontmatter</div>
                  <div class="flex flex-wrap gap-1">
                    {#each Object.entries(skillDetail.declaredFields) as [k, v] (k)}
                      <span
                        class="max-w-full break-all rounded border border-[var(--cortex-border)] bg-white px-1.5 py-0.5 font-mono text-[8px] text-slate-800 dark:border-white/10 dark:bg-surface-container-high/55 dark:text-on-surface/90"
                        title={formatYamlValue(v)}
                      >
                        <span class="text-secondary/75">{k}</span>={formatYamlValue(v)}
                      </span>
                    {/each}
                  </div>
                </div>
              {/if}
              {#if skillDetail.metadata && Object.keys(skillDetail.metadata).length > 0}
                <details class="group">
                  <summary class="flex cursor-pointer list-none items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-slate-600 dark:text-on-surface-variant/80">
                    <span class="material-symbols-outlined text-[14px] text-slate-400 dark:text-on-surface-variant/60">expand_more</span>
                    metadata block
                  </summary>
                  <pre
                    class="mt-2 max-h-40 overflow-y-auto overflow-x-auto break-words whitespace-pre-wrap rounded border border-[var(--cortex-border)] bg-white p-2 font-mono text-[9px] text-slate-800 dark:border-white/10 dark:bg-surface-container-high/50 dark:text-on-surface/85"
                  >{JSON.stringify(skillDetail.metadata, null, 2)}</pre>
                </details>
              {/if}
              {#if skillDetail.resources && (skillDetail.resources.scripts.length + skillDetail.resources.references.length + skillDetail.resources.assets.length > 0)}
                <div>
                  <div class="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-on-surface-variant/80">Resources</div>
                  <ul class="space-y-0.5 font-mono text-[9px] text-slate-600 dark:text-on-surface-variant/80">
                    {#if skillDetail.resources.scripts.length}<li>scripts: {skillDetail.resources.scripts.join(", ")}</li>{/if}
                    {#if skillDetail.resources.references.length}<li>references: {skillDetail.resources.references.join(", ")}</li>{/if}
                    {#if skillDetail.resources.assets.length}<li>assets: {skillDetail.resources.assets.join(", ")}</li>{/if}
                  </ul>
                </div>
              {/if}
              <div class="border-t border-[var(--cortex-border)] pt-2 font-mono text-[8px] text-slate-500 dark:border-white/[0.06] dark:text-on-surface-variant/65">
                File: <span class="break-all text-slate-700 dark:text-on-surface/75">{skillDetail.filePath}</span>
              </div>
            </div>
          {/if}
        </aside>
      </div>
    </div>
