<script lang="ts">
  import { tooltip } from "$lib/actions/tooltip.js";
  import MarkdownRich from "$lib/components/MarkdownRich.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Panel from "$lib/components/kit/Panel.svelte";
  import Textarea from "$lib/components/kit/Textarea.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import Tabs from "$lib/components/kit/Tabs.svelte";
  import AgentSkillsPanel from "$lib/components/skills/AgentSkillsPanel.svelte";
  import { moveLibrarySkill } from "$lib/agent-skills.js";
  import { tabId, tabPanelId } from "$lib/tablist.js";
  import {
    formatYamlValue,
    skillCatalogRows,
    WORKSPACE_SOURCE_LABEL,
    type LabSkillsStore,
    type LabSkillsUi,
    type SkillListSelection,
    type SkillRow,
    type WorkspaceSkillScope,
    type WorkspaceSkillSummary,
  } from "$lib/stores/lab-skills-store.js";

  interface Props {
    store: LabSkillsStore;
    /** View state the page keeps across tab switches. */
    ui: LabSkillsUi;
    /** The Builder's workspace and skills settings: discovery runs where its agent would. */
    scope: WorkspaceSkillScope;
    /** Ask to delete a SQLite skill (the page confirms). */
    onDelete: (skill: SkillRow) => void;
  }
  let { store, ui = $bindable(), scope, onDelete }: Props = $props();

  const VIEWS = [
    { id: "agent", label: "Agent skills" },
    { id: "files", label: "Skill files" },
  ] as const;

  async function moveToAgent(s: SkillRow) {
    const id = s.id != null ? String(s.id) : "";
    if (!id || ui.agentId === "") return;
    try {
      const moved = await moveLibrarySkill(ui.agentId, id);
      toast.success("Moved into agent skills", `${moved.name} is now a skill of ${ui.agentId}`);
      ui.agentReload += 1;
      await store.reloadDb();
    } catch (e) {
      toast.error("Move failed", e instanceof Error ? e.message : String(e));
    }
  }

  const skills = $derived($store.skills);
  const workspaceSkills = $derived($store.workspaceSkills);
  const scan = $derived($store.workspaceScan);
  const rows = $derived(skillCatalogRows(workspaceSkills, skills, ui.filter));

  // Rescan when the Builder's workspace or skills settings change.
  const scopeKey = $derived(JSON.stringify(scope));
  $effect(() => {
    void scopeKey;
    void store.loadWorkspace(scope);
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

  function selectWorkspaceSkill(s: WorkspaceSkillSummary) {
    void loadSkillDetail({ kind: "workspace", filePath: s.filePath });
  }

  function selectSqliteSkill(s: SkillRow) {
    const id = s.id != null ? String(s.id) : "";
    if (!id) {
      toast.warning("This row has no id", "Cannot load SQLite skill detail.");
      return;
    }
    void loadSkillDetail({ kind: "sqlite", id });
  }

  function isWorkspaceSkillSelected(s: WorkspaceSkillSummary): boolean {
    return ui.selection?.kind === "workspace" && ui.selection.filePath === s.filePath;
  }

  function isSqliteSkillSelected(s: SkillRow): boolean {
    const id = s.id != null ? String(s.id) : "";
    return ui.selection?.kind === "sqlite" && id !== "" && ui.selection.id === id;
  }

</script>

<div class="skills">
  <Tabs items={VIEWS} bind:value={ui.view} label="Skills view" idBase="lab-skills-view" />

  {#if ui.view === "agent"}
  <div class="view" role="tabpanel" id={tabPanelId("lab-skills-view", "agent")} aria-labelledby={tabId("lab-skills-view", "agent")}>
    <p class="intro">
      Skills an agent learned from its runs or had loaded, kept with its memory. They gain confidence as runs succeed, get refined into new
      versions, and roll back when a refinement does worse.
    </p>
    <AgentSkillsPanel bind:agentId={ui.agentId} workspaceRoot={scope.root ?? ""} reloadKey={ui.agentReload} />
  </div>
  {:else}
  <div class="view" role="tabpanel" id={tabPanelId("lab-skills-view", "files")} aria-labelledby={tabId("lab-skills-view", "files")}>
  <div class="head">
    <p class="intro">
      Skills are <code>&lt;name&gt;/SKILL.md</code> folders (YAML front matter and markdown). An agent finds them in its workspace
      (<code>.agents/skills</code>, <code>.claude/skills</code>) and in the folders the Builder's Skills section adds; this list is that same search,
      run at the Builder's workspace.
    </p>
    <div class="head-actions">
      <Button icon="retry" onclick={() => void store.loadWorkspace(scope)}>Rescan</Button>
      <Button variant="primary" icon="plus" onclick={() => (ui.showNewSkillForm = true)}>New skill</Button>
    </div>
  </div>

  {#if ui.showNewSkillForm}
    <Panel class="newskill">
      <div class="newskill-h">
        <h2>New skill</h2>
        <IconButton icon="x" label="Close the form" onclick={() => (ui.showNewSkillForm = false)} />
      </div>
      <div class="newskill-grid">
        <Field id="new-skill-name" label="Name">
          <Input id="new-skill-name" bind:value={ui.newSkillName} mono placeholder="my-skill" />
        </Field>
        <Field id="new-skill-description" label="Description" hint="Optional: one line on when to use it.">
          <Input id="new-skill-description" bind:value={ui.newSkillDescription} placeholder="Brief one-liner" describedBy="new-skill-description-hint" />
        </Field>
        <Field id="new-skill-instructions" label="Instructions" class="wide">
          <Textarea id="new-skill-instructions" bind:value={ui.newSkillInstructions} rows={6} placeholder="What this skill does and how to use it" />
        </Field>
        <Field id="new-skill-tags" label="Tags" hint="Optional, comma separated.">
          <Input id="new-skill-tags" bind:value={ui.newSkillTags} placeholder="analytics, reporting, data" describedBy="new-skill-tags-hint" />
        </Field>
      </div>
      <div class="newskill-actions">
        <Button variant="ghost" onclick={() => (ui.showNewSkillForm = false)}>Cancel</Button>
        <Button variant="primary" icon="check" disabled={ui.newSkillSaving || !ui.newSkillName.trim() || !ui.newSkillInstructions.trim()} onclick={createNewSkill}>
          {ui.newSkillSaving ? "Saving…" : "Create skill"}
        </Button>
      </div>
    </Panel>
  {/if}

  <div class="cols">
    <!-- Catalog -->
    <aside class="catalog" aria-label="Skill catalog">
      <div class="catalog-filter">
        <label class="sr-only" for="skill-catalog-filter">Filter skills</label>
        <input id="skill-catalog-filter" class="cx-control" type="search" bind:value={ui.filter} placeholder="Filter skills" />
      </div>
      <div class="catalog-list">
        {#if rows.length === 0}
          <div class="catalog-empty">
            {#if workspaceSkills.length === 0 && skills.length === 0}
              <p>No skills found.</p>
              <p class="dim">Add <code>.agents/skills/&lt;name&gt;/SKILL.md</code> to the workspace, then Rescan.</p>
            {:else}
              <p>No skills match the filter.</p>
              <p class="dim">Clear it or try another name.</p>
            {/if}
          </div>
        {/if}
        {#each rows as row, idx (row.t === "hdr" ? `h-${idx}-${row.label}` : row.t === "ws" ? `w-${row.s.filePath}` : row.rowKey)}
          {#if row.t === "hdr"}
            <h3 class="group-h">{row.label} <span class="group-note">{row.note}</span></h3>
          {:else if row.t === "ws"}
            <button type="button" class="item" aria-current={isWorkspaceSkillSelected(row.s) ? "true" : undefined} onclick={() => selectWorkspaceSkill(row.s)}>
              <span class="item-name">{row.s.name}</span>
              <span class="item-desc">{row.s.description || "No description"}</span>
              <span class="item-path" use:tooltip={row.s.filePath}>{WORKSPACE_SOURCE_LABEL[row.s.source]}</span>
            </button>
          {:else}
            <div class="item-row">
              <button type="button" class="item" aria-current={isSqliteSkillSelected(row.s) ? "true" : undefined} onclick={() => selectSqliteSkill(row.s)}>
                <span class="item-name"><Badge data>db</Badge> {row.s.name ?? row.s.id ?? "skill"}</span>
                <span class="item-desc">{row.s.description ?? ""}</span>
              </button>
              <IconButton
                icon="agents"
                size="sm"
                label={ui.agentId === ""
                  ? "Pick an agent under Agent skills to move this skill into"
                  : `Move into agent skills (${ui.agentId})`}
                disabled={ui.agentId === ""}
                onclick={() => void moveToAgent(row.s)}
              />
              <IconButton icon="trash" size="sm" label={`Delete ${row.s.name ?? "skill"}`} onclick={() => onDelete(row.s)} />
            </div>
          {/if}
        {/each}
      </div>
    </aside>

    <!-- Document -->
    <section class="doc" aria-label="Skill">
      {#if ui.detailLoading}
        <p class="center dim" role="status">Loading the skill…</p>
      {:else if ui.detailError}
        <p class="err" role="alert">{ui.detailError}</p>
      {:else if ui.detail}
        {@const skillDetail = ui.detail}
        <div class="doc-h">
          <div class="doc-title">
            <h2>{skillDetail.name}</h2>
            <Badge tone={skillDetail.filePath.startsWith("sqlite:") ? "neutral" : "io"}>{skillDetail.filePath.startsWith("sqlite:") ? "SQLite" : "Open skill"}</Badge>
          </div>
          {#if skillDetail.description}
            <p class="doc-when"><span class="dim">When to use:</span> {skillDetail.description}</p>
          {/if}
        </div>
        <div class="doc-body">
          <MarkdownRich markdown={skillDetail.instructions} class="max-w-none" showCopy={true} />
        </div>
      {:else}
        <div class="center">
          <EmptyState icon="book" title="Pick a skill" description="Its instructions show here, with its front matter and files on the right." />
        </div>
      {/if}
    </section>

    <!-- Roots and metadata -->
    <aside class="meta" aria-label="Skill roots and details">
      <div class="meta-block">
        <h3>Where agents look</h3>
        {#if $store.workspaceError}
          <p class="err-inline" role="alert">{$store.workspaceError}</p>
        {:else if scan}
          <p class="dim">From <code class="root">{scan.root}</code>{scope.root ? "" : " (no Builder workspace: the server's launch folder)"}, earlier wins on a name clash:</p>
          <ul class="roots">
            {#each scan.scanned as d (d.path)}
              <li class:missing={!d.exists}>
                <code class="root">{d.path}</code>
                <span class="dim">{WORKSPACE_SOURCE_LABEL[d.source]}{d.exists ? "" : " · not found"}</span>
              </li>
            {/each}
          </ul>
        {/if}
        <p class="dim">Pin skills by name and add folders in the Builder's Skills section. Chats list the same skills for their own workspace.</p>
      </div>

      {#if ui.detail && !ui.detailLoading && !ui.detailError}
        {@const skillDetail = ui.detail}
        <div class="meta-block">
          {#if skillDetail.declaredFields && Object.keys(skillDetail.declaredFields).length > 0}
            <h3>Front matter</h3>
            <dl class="fm">
              {#each Object.entries(skillDetail.declaredFields) as [k, v] (k)}
                <div><dt>{k}</dt><dd use:tooltip={formatYamlValue(v)}>{formatYamlValue(v)}</dd></div>
              {/each}
            </dl>
          {/if}
          {#if skillDetail.metadata && Object.keys(skillDetail.metadata).length > 0}
            <details>
              <summary>Metadata block</summary>
              <pre>{JSON.stringify(skillDetail.metadata, null, 2)}</pre>
            </details>
          {/if}
          {#if skillDetail.resources && (skillDetail.resources.scripts.length + skillDetail.resources.references.length + skillDetail.resources.assets.length > 0)}
            <h3>Files</h3>
            <ul class="res">
              {#if skillDetail.resources.scripts.length}<li><span class="dim">Scripts</span> {skillDetail.resources.scripts.join(", ")}</li>{/if}
              {#if skillDetail.resources.references.length}<li><span class="dim">References</span> {skillDetail.resources.references.join(", ")}</li>{/if}
              {#if skillDetail.resources.assets.length}<li><span class="dim">Assets</span> {skillDetail.resources.assets.join(", ")}</li>{/if}
            </ul>
          {/if}
          <p class="file"><span class="dim">File</span> <code>{skillDetail.filePath}</code></p>
        </div>
      {/if}
    </aside>
  </div>
  </div>
  {/if}
</div>

<style>
  .skills { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 16px 32px 24px; overflow: hidden; }
  .view { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
  .head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .intro { margin: 0; max-width: 72ch; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); line-height: var(--cortex-lh-ui); }
  .head-actions { display: flex; gap: 8px; }
  code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-accent); background: var(--cortex-accent-tint); padding: 0 4px; border-radius: 4px; }
  .dim { color: var(--cortex-text-3); }
  :global(.newskill) { flex: none; }
  .newskill-h { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .newskill-h h2 { margin: 0; font-size: var(--cortex-t-md); font-weight: 600; color: var(--cortex-text); }
  .newskill-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
  .newskill-grid :global(.wide) { grid-column: 1 / -1; }
  .newskill-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }

  .cols {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(240px, 280px) minmax(0, 1fr) minmax(240px, 280px);
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    overflow: hidden;
  }
  .catalog { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--cortex-line); }
  .catalog-filter { padding: 12px; border-bottom: 1px solid var(--cortex-line); }
  .catalog-filter :global(.cx-control) { height: 30px; }
  .catalog-list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; display: grid; align-content: start; gap: 4px; }
  .catalog-empty { padding: 12px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); display: grid; gap: 6px; }
  .catalog-empty p { margin: 0; }
  .group-h { margin: 8px 6px 2px; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .group-note { font-weight: 400; color: var(--cortex-text-3); }
  .roots li.missing { opacity: 0.7; }
  .err-inline { color: var(--cortex-bad); }
  .item-row { display: flex; align-items: flex-start; gap: 2px; }
  .item {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--cortex-r-ctl);
    background: transparent;
    text-align: left;
    cursor: pointer;
    font-family: var(--cortex-font-ui);
  }
  .item:hover { background: var(--cortex-surface-2); }
  .item[aria-current="true"] { background: var(--cortex-surface-3); }
  .item:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  .item-name { display: flex; align-items: center; gap: 6px; font-size: var(--cortex-t-sm); font-weight: 500; color: var(--cortex-text); }
  .item-desc { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .item-path { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .doc { display: flex; flex-direction: column; min-height: 0; min-width: 0; border-right: 1px solid var(--cortex-line); }
  .doc-h { padding: 16px 20px; border-bottom: 1px solid var(--cortex-line); display: grid; gap: 8px; }
  .doc-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .doc-title h2 { margin: 0; font-size: var(--cortex-t-lg); font-weight: 600; color: var(--cortex-text); }
  .doc-when { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); max-width: 68ch; }
  .doc-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px; }
  .center { flex: 1; display: grid; place-items: center; padding: 24px; margin: 0; }
  .err { margin: 16px; padding: 12px; border-radius: var(--cortex-r-ctl); background: var(--cortex-bad-tint); color: var(--cortex-bad); font-size: var(--cortex-t-sm); }

  .meta { min-height: 0; overflow-y: auto; }
  .meta-block { display: grid; gap: 8px; padding: 14px; border-bottom: 1px solid var(--cortex-line); font-size: var(--cortex-t-xs); }
  .meta-block h3 { margin: 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text); }
  .meta-block p { margin: 0; }
  .roots { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .roots li { display: grid; gap: 6px; justify-items: start; }
  .root { word-break: break-all; color: var(--cortex-io); background: var(--cortex-io-tint); }
  .fm { margin: 0; display: grid; gap: 4px; }
  .fm div { display: flex; gap: 8px; min-width: 0; }
  .fm dt { color: var(--cortex-text-3); flex: none; }
  .fm dd { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text); }
  details summary { cursor: pointer; color: var(--cortex-text-2); }
  details pre { margin: 6px 0 0; max-height: 10rem; overflow: auto; padding: 8px; border-radius: var(--cortex-r-ctl); background: var(--cortex-canvas); font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text); white-space: pre-wrap; }
  .res { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-2); }
  .file code { word-break: break-all; }
  @media (max-width: 1280px) {
    .cols { grid-template-columns: minmax(220px, 260px) minmax(0, 1fr); }
    .meta { grid-column: 1 / -1; max-height: 40vh; border-top: 1px solid var(--cortex-line); }
    .doc { border-right: 0; }
  }
</style>
