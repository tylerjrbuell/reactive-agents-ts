<script lang="ts">
  /**
   * The inspector's Messages tab: the full thread sent to the model, one group
   * per kernel pass (`GET /api/runs/:runId/messages`), with copy per message,
   * per pass and for the whole transcript, and a JSON download.
   */
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import Button from "$lib/components/kit/Button.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import type { MessageGroup, KernelMessage } from "$lib/types/messages.js";

  interface Props {
    runId: string;
  }
  const { runId }: Props = $props();

  let groups = $state<MessageGroup[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  /** Collapse state keyed by event `seq` (unique); avoids clashes when `kernelPass` repeats. */
  let collapsed = $state<Set<number>>(new Set());
  let copiedField = $state<string | null>(null);

  $effect(() => {
    loading = true;
    error = null;
    void fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/messages`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<MessageGroup[]>;
      })
      .then((data) => {
        groups = data;
        loading = false;
      })
      .catch((e) => {
        error = String(e);
        loading = false;
      });
  });

  function toggleCollapse(seq: number) {
    const next = new Set(collapsed);
    if (next.has(seq)) next.delete(seq);
    else next.add(seq);
    collapsed = next;
  }

  function contentText(content: KernelMessage["content"]): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((b) => {
          if (typeof b === "string") return b;
          if (b.type === "text" && typeof b.text === "string") return b.text;
          if (b.type === "tool_use") return `[tool_use: ${b.name ?? "?"}]`;
          if (b.type === "tool_result") {
            const c = b.content;
            return `[tool_result: ${typeof c === "string" ? c : JSON.stringify(c)}]`;
          }
          return JSON.stringify(b);
        })
        .join("\n");
    }
    return "";
  }

  async function copyToClipboard(text: string, fieldId: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedField = fieldId;
      setTimeout(() => {
        copiedField = null;
      }, 2000);
    } catch {
      /* clipboard refused: nothing to do */
    }
  }

  function formatThreadForCopy(group: MessageGroup): string {
    const lines: string[] = [];
    lines.push(`=== ${group.phaseLabel || `Loop ${group.kernelPass}`} ===`);
    if (group.totalSteps > 1) lines.push(`Step ${group.step}/${group.totalSteps} · ${group.strategy}`);
    lines.push("");
    for (const msg of group.messages) {
      lines.push(`[${msg.role.toUpperCase()}]`, contentText(msg.content), "");
    }
    return lines.join("\n");
  }

  /** Full transcript across every kernel pass: the complete record sent to the model. */
  function formatFullTranscript(): string {
    return groups.map(formatThreadForCopy).join("\n");
  }

  function downloadTranscriptJson() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(groups, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript-${runId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalMessages = $derived(groups.reduce((n, g) => n + g.messages.length, 0));

  /** Role edge colour: agent violet, tools cyan, the rest neutral. */
  const ROLE_TONE: Record<string, string> = { assistant: "accent", tool: "io", user: "text", system: "muted" };
</script>

<section class="sec">
  {#if loading}
    <p class="hint" role="status">Loading messages…</p>
  {:else if error}
    <p class="hint bad" role="alert">Could not load messages: {error}</p>
  {:else if groups.length === 0}
    <p class="hint">No model messages were recorded for this run. They are built from ReasoningStepCompleted events (the full message list when logged, otherwise thought, action and observation).</p>
  {:else}
    <div class="bar">
      <span class="meta">{totalMessages} messages · {groups.length} {groups.length === 1 ? "pass" : "passes"}</span>
      <Button size="sm" variant="ghost" icon={copiedField === "all" ? "check" : "copy"} onclick={() => copyToClipboard(formatFullTranscript(), "all")}>{copiedField === "all" ? "Copied" : "Copy all"}</Button>
      <Button size="sm" variant="ghost" icon="download" onclick={downloadTranscriptJson}>JSON</Button>
    </div>

    {#each groups as group (group.seq)}
      {@const open = !collapsed.has(group.seq)}
      <div class="group">
        <div class="gh">
          <button type="button" class="toggle" aria-expanded={open} onclick={() => toggleCollapse(group.seq)}>
            <span class="chev" class:open><Icon name="chevron" size="sm" /></span>
            <span class="gt">{group.phaseLabel || `Loop ${group.kernelPass}`}</span>
            <span class="meta">{#if group.totalSteps > 1}step {group.step}/{group.totalSteps} · {/if}{group.strategy} · {group.messages.length} messages</span>
          </button>
          <IconButton icon={copiedField === `thread-${group.seq}` ? "check" : "copy"} label="Copy this pass" size="sm" onclick={() => copyToClipboard(formatThreadForCopy(group), `thread-${group.seq}`)} />
        </div>
        {#if open}
          <div class="msgs">
            {#each group.messages as msg, i (i)}
              <div class="msg" data-tone={ROLE_TONE[msg.role] ?? "muted"}>
                <div class="mh">
                  <span class="role">{msg.role}</span>
                  {#if msg.toolName}<span class="meta io">from {msg.toolName}</span>{/if}
                  {#if msg.toolCalls && msg.toolCalls.length > 0}<span class="meta io">calls {msg.toolCalls.map((tc) => tc.name).join(", ")}</span>{/if}
                  <IconButton icon={copiedField === `msg-${group.seq}-${i}` ? "check" : "copy"} label="Copy message" size="sm" class="mcopy" onclick={() => copyToClipboard(contentText(msg.content), `msg-${group.seq}-${i}`)} />
                </div>
                <pre>{contentText(msg.content)}</pre>
                {#each msg.toolCalls ?? [] as tc, ti (ti)}
                  <details>
                    <summary>Arguments for {tc.name}</summary>
                    <pre>{JSON.stringify(tc.input, null, 2)}</pre>
                  </details>
                {/each}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</section>

<style>
  .sec { display: grid; gap: 10px; }
  .hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); line-height: var(--cortex-lh-ui); }
  .bad { color: var(--cortex-bad); }
  .bar { display: flex; align-items: center; gap: 4px; }
  .bar .meta { margin-right: auto; }
  .meta { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .io { color: var(--cortex-io); }
  .gh { display: flex; align-items: center; gap: 4px; }
  .toggle { display: flex; flex: 1; min-width: 0; align-items: center; gap: 6px; padding: 4px 0; border: 0; background: none; color: var(--cortex-text); font: inherit; text-align: left; cursor: pointer; }
  .toggle:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; border-radius: 4px; }
  .chev { display: inline-flex; color: var(--cortex-text-3); transition: transform var(--cortex-d-fast) var(--cortex-ease-out); }
  .chev.open { transform: rotate(90deg); }
  .gt { font-size: var(--cortex-t-sm); font-weight: 500; }
  .msgs { display: grid; gap: 6px; padding-left: 8px; }
  .msg { padding: 4px 0 4px 10px; border-left: 2px solid var(--cortex-line-strong); }
  .msg[data-tone="accent"] { border-left-color: var(--cortex-accent); }
  .msg[data-tone="io"] { border-left-color: var(--cortex-io); }
  .msg[data-tone="text"] { border-left-color: var(--cortex-text-3); }
  .mh { display: flex; align-items: center; gap: 8px; }
  .role { font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); text-transform: capitalize; }
  .mh :global(.mcopy) { margin-left: auto; }
  pre { margin: 2px 0 0; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); line-height: 1.55; color: var(--cortex-text); white-space: pre-wrap; overflow-wrap: anywhere; }
  details summary { cursor: pointer; font-size: var(--cortex-t-xs); color: var(--cortex-io); }
  details pre { color: var(--cortex-text-2); }
</style>
