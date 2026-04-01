<script lang="ts">
  import { onMount } from "svelte";
  import BuilderForm from "$lib/components/BuilderForm.svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";

  type SkillRow = { id?: string; name?: string; description?: string; content?: string };
  type ToolRow = { name?: string; description?: string; schema?: unknown };

  let activeTab = $state<"builder" | "skills" | "tools">("builder");
  let skills = $state<SkillRow[]>([]);
  let tools = $state<ToolRow[]>([]);
  let selectedSkill = $state<SkillRow | null>(null);
  let selectedTool = $state<ToolRow | null>(null);

  onMount(() => {
    const h = typeof window !== "undefined" ? window.location.hash : "";
    if (h === "#skills") activeTab = "skills";
    else if (h === "#tools") activeTab = "tools";

    void Promise.all([
      fetch(`${CORTEX_SERVER_URL}/api/skills`)
        .then((r) => (r.ok ? r.json() : []))
        .then((j) => {
          skills = Array.isArray(j) ? j : [];
        })
        .catch(() => {
          skills = [];
        }),
      fetch(`${CORTEX_SERVER_URL}/api/tools`)
        .then((r) => (r.ok ? r.json() : []))
        .then((j) => {
          tools = Array.isArray(j) ? j : [];
        })
        .catch(() => {
          tools = [];
        }),
    ]);
  });
</script>

<svelte:head>
  <title>CORTEX — Workshop</title>
</svelte:head>

<div class="h-full flex flex-col overflow-hidden p-6 gap-4">
  <div class="flex items-center gap-1 border-b border-outline-variant/20 pb-0 flex-shrink-0">
    {#each [{ id: "builder" as const, label: "Builder", icon: "build" }, { id: "skills" as const, label: "Skills", icon: "psychology" }, { id: "tools" as const, label: "Tools", icon: "construction" }] as tab}
      <button
        type="button"
        class="flex items-center gap-2 px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors border-b-2 -mb-px {activeTab ===
        tab.id
          ? 'border-primary text-primary'
          : 'border-transparent text-outline hover:text-primary'}"
        onclick={() => (activeTab = tab.id)}
      >
        <span class="material-symbols-outlined text-sm">{tab.icon}</span>
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="flex-1 overflow-y-auto min-h-0">
    {#if activeTab === "builder"}
      <div class="max-w-2xl mx-auto">
        <BuilderForm />
      </div>
    {:else if activeTab === "skills"}
      <div id="skills" class="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 h-full min-h-[240px]">
        <div class="space-y-1 overflow-y-auto">
          {#if skills.length === 0}
            <p class="font-mono text-xs text-outline text-center mt-8">
              No skills in store yet. Agents with skills persistence will appear here.
            </p>
          {:else}
            {#each skills as skill, si (skill.id ?? skill.name ?? si)}
              <button
                type="button"
                class="w-full text-left p-3 rounded border transition-all {selectedSkill === skill
                  ? 'bg-primary/10 border-primary/30'
                  : 'bg-surface-container-low border-outline-variant/10 hover:border-primary/20'}"
                onclick={() => (selectedSkill = skill)}
              >
                <div class="font-mono text-xs text-on-surface font-medium">
                  {skill.name ?? skill.id ?? "skill"}
                </div>
                <div class="font-mono text-[10px] text-outline mt-0.5">{skill.description ?? ""}</div>
              </button>
            {/each}
          {/if}
        </div>
        {#if selectedSkill}
          <div class="rounded-lg border border-outline-variant/20 bg-surface-container-low/40 p-4 overflow-y-auto">
            <h3 class="font-headline text-sm font-bold text-primary mb-3">
              {selectedSkill.name ?? selectedSkill.id}
            </h3>
            <pre class="font-mono text-[10px] text-on-surface/70 whitespace-pre-wrap leading-relaxed">{selectedSkill.content ?? "No content."}</pre>
          </div>
        {:else}
          <div class="flex items-center justify-center text-outline font-mono text-xs">
            Select a skill to view content.
          </div>
        {/if}
      </div>
    {:else if activeTab === "tools"}
      <div id="tools" class="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 h-full min-h-[240px]">
        <div class="space-y-1 overflow-y-auto">
          {#if tools.length === 0}
            <p class="font-mono text-xs text-outline text-center mt-8">
              No tools registered in Cortex store yet.
            </p>
          {:else}
            {#each tools as tool, ti (tool.name ?? ti)}
              <button
                type="button"
                class="w-full text-left p-3 rounded border transition-all {selectedTool === tool
                  ? 'bg-primary/10 border-primary/30'
                  : 'bg-surface-container-low border-outline-variant/10 hover:border-primary/20'}"
                onclick={() => (selectedTool = tool)}
              >
                <div class="font-mono text-xs text-on-surface font-medium">{tool.name ?? "tool"}</div>
                <div class="font-mono text-[10px] text-outline mt-0.5">{tool.description ?? ""}</div>
              </button>
            {/each}
          {/if}
        </div>
        {#if selectedTool}
          <div class="rounded-lg border border-outline-variant/20 bg-surface-container-low/40 p-4 overflow-y-auto">
            <h3 class="font-headline text-sm font-bold text-primary mb-3">{selectedTool.name}</h3>
            <pre class="font-mono text-[10px] text-on-surface/70 whitespace-pre-wrap">{JSON.stringify(
                selectedTool.schema ?? selectedTool,
                null,
                2,
              )}</pre>
          </div>
        {:else}
          <div class="flex items-center justify-center text-outline font-mono text-xs">
            Select a tool to view schema.
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
