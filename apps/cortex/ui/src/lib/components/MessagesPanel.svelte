<script lang="ts">
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import Tooltip from "$lib/components/Tooltip.svelte";
  import type { MessageGroup, KernelMessage } from "$lib/types/messages.js";

  interface Props {
    runId: string;
  }
  const { runId } = $props();

  let groups = $state<MessageGroup[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  /** Collapse state keyed by event `seq` (unique); avoids clashes when `kernelPass` repeats. */
  let collapsed = $state<Set<number>>(new Set());
  let copiedField = $state<string | null>(null); // track which field was just copied

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
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }

  function formatThreadForCopy(group: MessageGroup): string {
    const lines: string[] = [];
    const label = group.phaseLabel || `Loop ${group.kernelPass}`;
    lines.push(`=== ${label} ===`);
    if (group.totalSteps > 1) {
      lines.push(`Step ${group.step}/${group.totalSteps} · ${group.strategy}`);
    }
    lines.push("");
    for (const msg of group.messages) {
      lines.push(`[${msg.role.toUpperCase()}]`);
      lines.push(contentText(msg.content));
      lines.push("");
    }
    return lines.join("\n");
  }

  const roleStyle: Record<string, { border: string; label: string; labelColor: string }> = {
    system: { border: "border-outline-variant/30 dark:border-outline-variant/25", label: "system", labelColor: "text-outline/50" },
    user: { border: "border-primary/25", label: "user", labelColor: "text-primary/70" },
    assistant: {
      border: "border-secondary/25",
      label: "assistant",
      labelColor: "text-secondary/70",
    },
    tool: { border: "border-tertiary/25", label: "tool", labelColor: "text-tertiary/70" },
  };
</script>

<div class="h-full overflow-y-auto font-mono text-[11px] p-3 space-y-4">
  {#if loading}
    <p class="text-outline/40 italic">Loading messages…</p>
  {:else if error}
    <p class="text-error/70">Failed to load: {error}</p>
  {:else if groups.length === 0}
    <p class="text-outline/40 italic">
      No LLM messages recorded for this run. Messages are built from ReasoningStepCompleted events (full
    `messages[]` when logged, otherwise thought / action / observation).
    </p>
  {:else}
    {#each groups as group (group.seq)}
      <!-- Iteration header -->
      <div>
        <div class="flex items-center gap-2 mb-2">
          <button
            type="button"
            class="flex items-center gap-2 flex-1 text-left text-[10px] text-outline/50 uppercase tracking-widest
                   hover:text-outline/80 bg-transparent border-0 cursor-pointer p-0"
            onclick={() => toggleCollapse(group.seq)}
          >
            <span class="material-symbols-outlined text-[11px]">
              {collapsed.has(group.seq) ? "chevron_right" : "expand_more"}
            </span>
            {#if group.phaseLabel}
              <span class="text-outline/70 normal-case tracking-normal font-mono">{group.phaseLabel}</span>
            {:else}
              Loop {group.kernelPass}
            {/if}
            {#if group.totalSteps > 1}
              <span class="text-outline/30">· step {group.step}/{group.totalSteps}</span>
            {/if}
            <span class="text-outline/30">· {group.strategy}</span>
            <span class="text-outline/20">· {group.messages.length} messages</span>
          </button>
          <Tooltip text={copiedField === `thread-${group.seq}` ? "Copied!" : "Copy thread"}>
            <button
              type="button"
              class="text-outline/30 hover:text-outline/60 transition-colors bg-transparent border-0 cursor-pointer p-1 flex-shrink-0"
              onclick={() => copyToClipboard(formatThreadForCopy(group), `thread-${group.seq}`)}
              aria-label="Copy entire thread"
            >
              <span class="material-symbols-outlined text-sm">{copiedField === `thread-${group.seq}` ? "check" : "content_copy"}</span>
            </button>
          </Tooltip>
        </div>

        {#if !collapsed.has(group.seq)}
          <div class="space-y-1.5 pl-2">
            {#each group.messages as msg, i (i)}
              {@const style = roleStyle[msg.role] ?? roleStyle["system"]!}
              <div class="border-l-2 {style.border} pl-3 py-1">
                <div class="flex items-center justify-between gap-2 mb-0.5">
                  <div class="flex items-center gap-2">
                    <span class="text-[9px] uppercase tracking-widest {style.labelColor}">{msg.role}</span>
                    {#if msg.toolName}
                      <span class="text-[9px] text-tertiary/60">← {msg.toolName}</span>
                    {/if}
                    {#if msg.toolCalls && msg.toolCalls.length > 0}
                      <span class="text-[9px] text-secondary/60">
                        calls: {msg.toolCalls.map((tc) => tc.name).join(", ")}
                      </span>
                    {/if}
                  </div>
                  <Tooltip text={copiedField === `msg-${group.seq}-${i}` ? "Copied!" : "Copy message"}>
                    <button
                      type="button"
                      class="text-on-surface/30 hover:text-on-surface/60 transition-colors bg-transparent border-0 cursor-pointer p-0.5 flex-shrink-0"
                      onclick={() => copyToClipboard(contentText(msg.content), `msg-${group.seq}-${i}`)}
                      aria-label="Copy message"
                    >
                      <span class="material-symbols-outlined text-sm">{copiedField === `msg-${group.seq}-${i}` ? "check" : "content_copy"}</span>
                    </button>
                  </Tooltip>
                </div>
                <pre
                  class="whitespace-pre-wrap text-on-surface/75 leading-relaxed text-[10px] m-0 font-mono"
                >{contentText(msg.content)}</pre>
                {#if msg.toolCalls && msg.toolCalls.length > 0}
                  {#each msg.toolCalls as tc}
                    <details class="mt-1">
                      <summary
                        class="text-[9px] text-secondary/50 cursor-pointer hover:text-secondary/80"
                      >
                        tool_use: {tc.name}
                      </summary>
                      <pre
                        class="text-[9px] text-on-surface/50 ml-2 mt-0.5 whitespace-pre-wrap"
                      >{JSON.stringify(tc.input, null, 2)}</pre>
                    </details>
                  {/each}
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>
