<script lang="ts">
  /**
   * Lab · Memory: one agent's stored memory, read and edited through the
   * framework's `agent.memory()` (server `api/memory.ts`). Catalog (search,
   * layer tabs, entries) | entry (content, edit) | details (where it came from,
   * importance, tags, dates). `?agent=` picks the agent and `?run=` narrows to
   * what one run wrote (the run view links here). Rules live in
   * `lib/memory-studio.ts`.
   */
  import { onMount } from "svelte";
  import { replaceState } from "$app/navigation";
  import { formatRelativeTime } from "@reactive-agents/ui-core";
  import { tooltip } from "$lib/actions/tooltip.js";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Overlay from "$lib/components/kit/Overlay.svelte";
  import Combobox from "$lib/components/kit/Combobox.svelte";
  import { agentComboItems } from "$lib/combobox.js";
  import Tabs from "$lib/components/kit/Tabs.svelte";
  import Textarea from "$lib/components/kit/Textarea.svelte";
  import { tabId, tabPanelId } from "$lib/tablist.js";
  import { toast } from "$lib/stores/toast-store.js";
  import {
    deleteMemoryEntry,
    fetchMemory,
    fetchMemoryAgents,
    filterEntries,
    MEMORY_LAYERS,
    memoryLayerTabs,
    proceduralDraftOf,
    proceduralPatchOf,
    provenanceOf,
    searchHint,
    searchMemory,
    semanticDraftOf,
    findMemoryItem,
    semanticPatchOf,
    shortId,
    updateProceduralMemory,
    updateSemanticMemory,
    type EpisodicMemory,
    type MemoryAgent,
    type MemoryLayer,
    type MemoryListing,
    type ProceduralDraft,
    type ProceduralMemory,
    type SemanticDraft,
    type SemanticMemory,
  } from "$lib/memory-studio.js";

  type Selected =
    | { readonly layer: "semantic"; readonly entry: SemanticMemory }
    | { readonly layer: "procedural"; readonly entry: ProceduralMemory }
    | { readonly layer: "episodic"; readonly entry: EpisodicMemory };

  let agents = $state<MemoryAgent[]>([]);
  let agentsLoaded = $state(false);
  let agentId = $state("");
  let runFilter = $state("");
  /** Entry id from a `?item=` link, opened once the listing loads. */
  let itemId = "";
  let listing = $state<MemoryListing | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let layer = $state<MemoryLayer>("semantic");
  let query = $state("");
  let searchResults = $state<SemanticMemory[] | null>(null);
  let searching = $state(false);
  let selected = $state<Selected | null>(null);
  let editing = $state(false);
  let semDraft = $state<SemanticDraft>({ content: "", summary: "", importance: "", tags: "" });
  let procDraft = $state<ProceduralDraft>({ name: "", description: "", pattern: "", tags: "" });
  let editError = $state<string | null>(null);
  let saving = $state(false);
  let confirmDelete = $state(false);
  let deleting = $state(false);

  const now = Date.now();
  const tabs = $derived(memoryLayerTabs(listing));
  const blurb = $derived(MEMORY_LAYERS.find((l) => l.id === layer)?.blurb ?? "");
  // Named agents first, recent first; at most a screenful rendered (kit Combobox).
  const agentItems = $derived([
    ...agentComboItems(agents),
    ...(agentId && !agents.some((a) => a.agentId === agentId) ? [{ value: agentId, label: "Unnamed agent", hint: shortId(agentId), group: "Unnamed" }] : []),
  ]);
  // The latest request per kind; a newer one cancels the one in flight so a slow answer never lands late.
  let loadCtl: AbortController | undefined;
  let searchCtl: AbortController | undefined;
  const hint = $derived(searchHint(query));

  const rows = $derived.by((): Selected[] => {
    if (!listing) return [];
    if (layer === "semantic") {
      const src = searchResults ?? listing.semantic;
      return src.map((entry) => ({ layer: "semantic" as const, entry }));
    }
    if (layer === "procedural") return filterEntries(listing.procedural, query).map((entry) => ({ layer: "procedural" as const, entry }));
    return filterEntries(listing.episodic, query).map((entry) => ({ layer: "episodic" as const, entry }));
  });

  function syncUrl() {
    const q = new URLSearchParams(window.location.search);
    if (agentId) q.set("agent", agentId);
    else q.delete("agent");
    if (runFilter) q.set("run", runFilter);
    else q.delete("run");
    const qs = q.toString();
    try {
      replaceState(`${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`, {});
    } catch {
      // SvelteKit's replaceState throws before the router's first navigation; the URL just stays.
    }
  }

  async function load() {
    selected = null;
    editing = false;
    searchResults = null;
    if (!agentId) {
      listing = null;
      return;
    }
    loadCtl?.abort();
    searchCtl?.abort();
    const ctl = new AbortController();
    loadCtl = ctl;
    loading = true;
    loadError = null;
    try {
      const next = await fetchMemory(agentId, runFilter || undefined, fetch, ctl.signal);
      if (ctl.signal.aborted) return;
      listing = next;
      // A `?item=` deep link (Context · recalled memories) opens that entry once.
      const hit = itemId ? findMemoryItem(next, itemId) : undefined;
      itemId = "";
      if (hit) {
        layer = hit.layer;
        selected = hit;
      }
      if (query.trim() && layer === "semantic") await runSearch();
    } catch (e) {
      if (ctl.signal.aborted) return;
      loadError = e instanceof Error ? e.message : String(e);
      listing = null;
    } finally {
      if (loadCtl === ctl) loading = false;
    }
  }

  async function runSearch() {
    const q = query.trim();
    if (!agentId || layer !== "semantic" || q === "") {
      searchResults = null;
      return;
    }
    searchCtl?.abort();
    const ctl = new AbortController();
    searchCtl = ctl;
    searching = true;
    try {
      const found = await searchMemory(agentId, q, runFilter || undefined, fetch, ctl.signal);
      if (!ctl.signal.aborted) searchResults = found;
    } catch (e) {
      if (!ctl.signal.aborted) toast.error("Search failed", e instanceof Error ? e.message : String(e));
    } finally {
      if (searchCtl === ctl) searching = false;
    }
  }

  function pickAgent(id: string) {
    agentId = id;
    runFilter = "";
    query = "";
    syncUrl();
    void load();
  }

  function clearRunFilter() {
    runFilter = "";
    syncUrl();
    void load();
  }

  function select(row: Selected) {
    selected = row;
    editing = false;
    editError = null;
  }

  function startEdit() {
    if (!selected || selected.layer === "episodic") return;
    if (selected.layer === "semantic") semDraft = semanticDraftOf(selected.entry);
    else procDraft = proceduralDraftOf(selected.entry);
    editError = null;
    editing = true;
  }

  function replaceInListing(next: Selected) {
    if (!listing) return;
    if (next.layer === "semantic") {
      const swap = (e: SemanticMemory) => (e.id === next.entry.id ? next.entry : e);
      listing = { ...listing, semantic: listing.semantic.map(swap) };
      if (searchResults) searchResults = searchResults.map(swap);
    } else if (next.layer === "procedural") {
      listing = { ...listing, procedural: listing.procedural.map((e) => (e.id === next.entry.id ? next.entry : e)) };
    }
  }

  async function save() {
    if (!selected || selected.layer === "episodic") return;
    saving = true;
    editError = null;
    try {
      if (selected.layer === "semantic") {
        const r = semanticPatchOf(selected.entry, semDraft);
        if (!r.ok) return void (editError = r.error);
        if (r.patch) {
          const entry = await updateSemanticMemory(agentId, selected.entry.id, r.patch);
          selected = { layer: "semantic", entry };
          replaceInListing(selected);
          toast.success("Memory saved");
        }
      } else {
        const r = proceduralPatchOf(selected.entry, procDraft);
        if (!r.ok) return void (editError = r.error);
        if (r.patch) {
          const entry = await updateProceduralMemory(agentId, selected.entry.id, r.patch);
          selected = { layer: "procedural", entry };
          replaceInListing(selected);
          toast.success("Workflow saved");
        }
      }
      editing = false;
    } catch (e) {
      editError = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!selected || selected.layer === "episodic" || !listing) return;
    deleting = true;
    const { layer: l, entry } = selected;
    try {
      await deleteMemoryEntry(agentId, l, entry.id);
      if (l === "semantic") {
        listing = { ...listing, semantic: listing.semantic.filter((e) => e.id !== entry.id) };
        if (searchResults) searchResults = searchResults.filter((e) => e.id !== entry.id);
      } else {
        listing = { ...listing, procedural: listing.procedural.filter((e) => e.id !== entry.id) };
      }
      selected = null;
      confirmDelete = false;
      toast.success(l === "semantic" ? "Memory deleted" : "Workflow deleted");
    } catch (e) {
      toast.error("Delete failed", e instanceof Error ? e.message : String(e));
    } finally {
      deleting = false;
    }
  }

  function titleOf(row: Selected): string {
    if (row.layer === "procedural") return row.entry.name;
    if (row.layer === "semantic") return row.entry.summary || row.entry.content;
    return row.entry.content;
  }

  function when(iso: string): string {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? formatRelativeTime(t, now) : iso;
  }

  onMount(() => {
    const q = new URLSearchParams(window.location.search);
    agentId = q.get("agent") ?? "";
    runFilter = q.get("run") ?? "";
    itemId = q.get("item") ?? "";
    fetchMemoryAgents()
      .then((a) => {
        agents = a;
        if (!agentId && a.length === 1 && a[0]) pickAgent(a[0].agentId);
      })
      .catch((e) => toast.error("Could not list agents", e instanceof Error ? e.message : String(e)))
      .finally(() => (agentsLoaded = true));
    if (agentId) void load();
  });
</script>

<div class="studio">
  <div class="head">
    <div class="pick">
      <label class="sr-only" for="memory-agent">Agent</label>
      <Combobox
        id="memory-agent"
        label="Agent"
        value={agentId}
        items={agentItems}
        placeholder={agents.length ? "Pick an agent" : "No agents with memory"}
        emptyText="No agent matches"
        onpick={pickAgent}
      />
      {#if runFilter}
        <span class="runfilter">
          Written by run <a href={`/run/${encodeURIComponent(runFilter)}`} use:tooltip={runFilter}>{shortId(runFilter)}</a>
          <IconButton icon="x" size="sm" label="Show all memory" onclick={clearRunFilter} />
        </span>
      {/if}
    </div>
    <div class="head-actions">
      <Button icon="retry" disabled={!agentId || loading} onclick={() => void load()}>Reload</Button>
    </div>
  </div>

  {#if !agentId}
    <div class="center">
      {#if agentsLoaded && agents.length === 0}
        <EmptyState icon="book" title="No stored memory yet" description="Agents built with memory on store facts, workflows and a log here. Run an agent with Memory on in the Builder, then come back." />
      {:else}
        <EmptyState icon="book" title="Pick an agent" description="See what it remembers, where each memory came from, and edit or delete what is wrong." />
      {/if}
    </div>
  {:else if loading && !listing}
    <p class="center dim" role="status">Loading memory…</p>
  {:else if loadError}
    <p class="err" role="alert">Could not load memory: {loadError}</p>
  {:else if listing && !listing.available}
    <div class="center">
      <EmptyState icon="book" title="This agent has no memory database" description="Nothing has been stored for it yet. Memory appears after a run with Memory on." />
    </div>
  {:else if listing}
    <div class="cols">
      <aside class="catalog" aria-label="Memory entries">
        <Tabs items={tabs} value={layer} label="Memory layer" idBase="mem" onchange={(id) => { layer = id as MemoryLayer; selected = null; void runSearch(); }} class="mem-tabs" />
        <div class="catalog-filter">
          <label class="sr-only" for="memory-search">{layer === "semantic" ? "Search facts" : "Filter"}</label>
          <input
            id="memory-search"
            class="cx-control"
            type="search"
            bind:value={query}
            placeholder={layer === "semantic" ? "Search facts (press Enter)" : "Filter"}
            onkeydown={(e) => { if (e.key === "Enter") void runSearch(); }}
            oninput={() => { if (query.trim() === "") searchResults = null; }}
          />
          {#if layer === "semantic" && hint}<p class="dim small">{hint}</p>{/if}
          {#if searchResults}<p class="dim small" role="status">{searchResults.length} match{searchResults.length === 1 ? "" : "es"} in facts</p>{/if}
        </div>
        <div class="catalog-list" role="tabpanel" id={tabPanelId("mem", layer)} aria-labelledby={tabId("mem", layer)}>
          <p class="dim small blurb">{blurb}</p>
          {#if searching}<p class="dim small" role="status">Searching…</p>{/if}
          {#each rows as row (row.entry.id)}
            <button type="button" class="item" aria-current={selected?.entry.id === row.entry.id ? "true" : undefined} onclick={() => select(row)}>
              <span class="item-name">{titleOf(row)}</span>
              <span class="item-meta">
                {#if row.layer === "semantic"}importance {row.entry.importance.toFixed(2)}{:else if row.layer === "procedural"}{Math.round(row.entry.successRate * 100)}% success, used {row.entry.useCount}×{:else}{row.entry.eventType}{/if}
                {#if row.layer !== "episodic" && row.entry.runId}<span class="io">run {shortId(row.entry.runId)}</span>{/if}
              </span>
            </button>
          {:else}
            <p class="dim small">{searchResults ? "No facts match. Try other words." : runFilter ? "This run wrote nothing here." : "Nothing stored here yet."}</p>
          {/each}
        </div>
      </aside>

      <section class="doc" aria-label="Memory entry">
        {#if !selected}
          <div class="center">
            <EmptyState icon="book" title="Pick an entry" description="Its full text shows here; facts and workflows can be edited or deleted." />
          </div>
        {:else}
          <div class="doc-h">
            <h2>{selected.layer === "semantic" ? "Fact" : selected.layer === "procedural" ? "Workflow" : "Log entry"}</h2>
            {#if selected.layer !== "episodic" && !editing}
              <div class="doc-actions">
                <Button icon="edit" size="sm" onclick={startEdit}>Edit</Button>
                <Button icon="trash" size="sm" variant="danger" onclick={() => (confirmDelete = true)}>Delete</Button>
              </div>
            {/if}
          </div>
          <div class="doc-body">
            {#if editing && selected.layer === "semantic"}
              <form class="form" onsubmit={(e) => { e.preventDefault(); void save(); }}>
                <Field id="mem-content" label="Content"><Textarea id="mem-content" bind:value={semDraft.content} rows={8} /></Field>
                <Field id="mem-summary" label="Summary" hint="Short form used in recall and in this list."><Input id="mem-summary" bind:value={semDraft.summary} describedBy="mem-summary-hint" /></Field>
                <Field id="mem-importance" label="Importance" hint="0 to 1. Low-importance facts are pruned first."><Input id="mem-importance" bind:value={semDraft.importance} mono inputmode="decimal" describedBy="mem-importance-hint" /></Field>
                <Field id="mem-tags" label="Tags" hint="Comma separated."><Input id="mem-tags" bind:value={semDraft.tags} describedBy="mem-tags-hint" /></Field>
                {#if editError}<p class="err-inline" role="alert">{editError}</p>{/if}
                <div class="form-actions">
                  <Button variant="ghost" onclick={() => (editing = false)}>Cancel</Button>
                  <Button variant="primary" type="submit" icon="check" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
                </div>
              </form>
            {:else if editing && selected.layer === "procedural"}
              <form class="form" onsubmit={(e) => { e.preventDefault(); void save(); }}>
                <Field id="mem-name" label="Name"><Input id="mem-name" bind:value={procDraft.name} mono /></Field>
                <Field id="mem-description" label="When to use it"><Textarea id="mem-description" bind:value={procDraft.description} rows={3} /></Field>
                <Field id="mem-pattern" label="Steps"><Textarea id="mem-pattern" bind:value={procDraft.pattern} rows={6} mono /></Field>
                <Field id="mem-ptags" label="Tags" hint="Comma separated."><Input id="mem-ptags" bind:value={procDraft.tags} describedBy="mem-ptags-hint" /></Field>
                {#if editError}<p class="err-inline" role="alert">{editError}</p>{/if}
                <div class="form-actions">
                  <Button variant="ghost" onclick={() => (editing = false)}>Cancel</Button>
                  <Button variant="primary" type="submit" icon="check" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
                </div>
              </form>
            {:else if selected.layer === "semantic"}
              {#if selected.entry.summary && selected.entry.summary !== selected.entry.content}<p class="summary">{selected.entry.summary}</p>{/if}
              <p class="content">{selected.entry.content}</p>
            {:else if selected.layer === "procedural"}
              <p class="summary">{selected.entry.name}</p>
              {#if selected.entry.description}<p class="content">{selected.entry.description}</p>{/if}
              {#if selected.entry.pattern}<pre class="pattern">{selected.entry.pattern}</pre>{/if}
            {:else}
              <p class="content">{selected.entry.content}</p>
            {/if}
          </div>
        {/if}
      </section>

      <aside class="meta" aria-label="Entry details">
        {#if selected}
          {@const sel = selected}
          <div class="meta-block">
            <h3>Where it came from</h3>
            {#if sel.layer === "episodic"}
              {#if sel.entry.taskId}<p>Task <code use:tooltip={sel.entry.taskId}>{shortId(sel.entry.taskId)}</code></p>{:else}<p class="dim">No task recorded.</p>{/if}
            {:else}
              {@const prov = provenanceOf(sel.entry)}
              {#if prov.kind === "run"}
                <p>Written by run <a href={prov.href} use:tooltip={prov.runId}>{shortId(prov.runId)}</a></p>
                <Button size="sm" icon="external" href={prov.href}>Open the run</Button>
              {:else}
                <p class="dim">Not recorded. It was stored outside a run or before runs recorded where memory came from.</p>
              {/if}
            {/if}
          </div>
          <div class="meta-block">
            <h3>Details</h3>
            <dl class="fm">
              {#if sel.layer === "semantic"}
                <div><dt>Importance</dt><dd>{sel.entry.importance.toFixed(2)}</dd></div>
                <div><dt>Recalled</dt><dd>{sel.entry.accessCount}×</dd></div>
                <div><dt>Verified</dt><dd>{sel.entry.verified ? "yes" : "no"}</dd></div>
              {:else if sel.layer === "procedural"}
                <div><dt>Success</dt><dd>{Math.round(sel.entry.successRate * 100)}%</dd></div>
                <div><dt>Used</dt><dd>{sel.entry.useCount}×</dd></div>
              {:else}
                <div><dt>Event</dt><dd>{sel.entry.eventType}</dd></div>
                <div><dt>Date</dt><dd>{sel.entry.date}</dd></div>
              {/if}
              {#if sel.layer !== "episodic"}
                <div><dt>Created</dt><dd use:tooltip={sel.entry.createdAt}>{when(sel.entry.createdAt)}</dd></div>
                <div><dt>Updated</dt><dd use:tooltip={sel.entry.updatedAt}>{when(sel.entry.updatedAt)}</dd></div>
              {/if}
              <div><dt>Id</dt><dd use:tooltip={sel.entry.id}>{sel.entry.id}</dd></div>
            </dl>
            {#if sel.layer !== "episodic" && sel.entry.tags.length > 0}
              <div class="tags">{#each sel.entry.tags as t (t)}<Badge>{t}</Badge>{/each}</div>
            {/if}
          </div>
        {/if}
        <div class="meta-block">
          <h3>Database</h3>
          <p class="dim">Read and written through the agent's own memory API, the same store its runs use.</p>
          <code class="path">{listing.dbPath}</code>
        </div>
      </aside>
    </div>
  {/if}
</div>

<Overlay open={confirmDelete} title={selected?.layer === "procedural" ? "Delete this workflow?" : "Delete this memory?"} onclose={() => (confirmDelete = false)}>
  <p class="confirm">
    The agent will no longer recall it. This cannot be undone.
  </p>
  {#if selected && selected.layer !== "episodic"}<p class="confirm-quote">{titleOf(selected)}</p>{/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (confirmDelete = false)}>Keep it</Button>
    <Button variant="danger" icon="trash" disabled={deleting} onclick={() => void remove()}>{deleting ? "Deleting…" : "Delete"}</Button>
  {/snippet}
</Overlay>

<style>
  .studio { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 16px 32px 24px; overflow: hidden; }
  .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
  .pick { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-width: 0; }
  .pick :global(select) { min-width: 280px; max-width: 420px; }
  .runfilter { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 10px; border-radius: var(--cortex-r-ctl); background: var(--cortex-io-tint); color: var(--cortex-text); font-size: var(--cortex-t-xs); }
  .runfilter a, .meta a { color: var(--cortex-io); font-family: var(--cortex-font-data); }
  .head-actions { display: flex; gap: 8px; }
  .dim { color: var(--cortex-text-3); }
  .small { margin: 0; font-size: var(--cortex-t-xs); }
  .center { flex: 1; display: grid; place-items: center; padding: 24px; margin: 0; }
  .err { margin: 0; padding: 12px; border-radius: var(--cortex-r-ctl); background: var(--cortex-bad-tint); color: var(--cortex-bad); font-size: var(--cortex-t-sm); }
  .err-inline { margin: 0; color: var(--cortex-bad); font-size: var(--cortex-t-xs); }
  code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }

  .cols {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(260px, 320px) minmax(0, 1fr) minmax(240px, 280px);
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    overflow: hidden;
  }
  .catalog { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--cortex-line); }
  .catalog :global(.mem-tabs) { padding: 0 12px; border-bottom: 1px solid var(--cortex-line); }
  .catalog-filter { display: grid; gap: 6px; padding: 12px; border-bottom: 1px solid var(--cortex-line); }
  .catalog-filter :global(.cx-control) { height: 30px; }
  .catalog-list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; display: grid; align-content: start; gap: 4px; }
  .blurb { padding: 0 6px 6px; }
  .item { display: grid; gap: 2px; width: 100%; padding: 8px 10px; border: 0; border-radius: var(--cortex-r-ctl); background: transparent; text-align: left; cursor: pointer; font-family: var(--cortex-font-ui); }
  .item:hover { background: var(--cortex-surface-2); }
  .item[aria-current="true"] { background: var(--cortex-surface-3); }
  .item:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  .item-name { font-size: var(--cortex-t-sm); color: var(--cortex-text); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .item-meta { display: flex; flex-wrap: wrap; gap: 8px; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .io { color: var(--cortex-io); }

  .doc { display: flex; flex-direction: column; min-height: 0; min-width: 0; border-right: 1px solid var(--cortex-line); }
  .doc-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 20px; border-bottom: 1px solid var(--cortex-line); }
  .doc-h h2 { margin: 0; font-size: var(--cortex-t-md); font-weight: 600; color: var(--cortex-text); }
  .doc-actions { display: flex; gap: 8px; }
  .doc-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px; display: grid; align-content: start; gap: 12px; }
  .summary { margin: 0; font-weight: 500; color: var(--cortex-text); font-size: var(--cortex-t-sm); }
  .content { margin: 0; max-width: 72ch; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--cortex-text); font-size: var(--cortex-t-sm); line-height: var(--cortex-lh-ui); }
  .pattern { margin: 0; padding: 10px; border-radius: var(--cortex-r-ctl); background: var(--cortex-canvas); font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); white-space: pre-wrap; color: var(--cortex-text); }
  .form { display: grid; gap: 12px; max-width: 72ch; }
  .form-actions { display: flex; justify-content: flex-end; gap: 8px; }

  .meta { min-height: 0; overflow-y: auto; }
  .meta-block { display: grid; gap: 8px; justify-items: start; padding: 14px; border-bottom: 1px solid var(--cortex-line); font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .meta-block h3 { margin: 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text); }
  .meta-block p { margin: 0; }
  .fm { margin: 0; display: grid; gap: 4px; width: 100%; }
  .fm div { display: flex; gap: 8px; min-width: 0; }
  .fm dt { color: var(--cortex-text-3); flex: none; min-width: 72px; }
  .fm dd { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text); }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .path { word-break: break-all; color: var(--cortex-io); }
  .confirm { margin: 0 0 8px; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .confirm-quote { margin: 0; padding: 8px 10px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); font-size: var(--cortex-t-sm); color: var(--cortex-text); overflow-wrap: anywhere; }
  @media (max-width: 1280px) {
    .cols { grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); }
    .meta { grid-column: 1 / -1; max-height: 40vh; border-top: 1px solid var(--cortex-line); }
    .doc { border-right: 0; }
  }
</style>
