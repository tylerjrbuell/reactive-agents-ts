<script lang="ts">
  import type { CortexTraceFrame } from "../stores/trace-store.js";

  interface Props {
    frame: CortexTraceFrame | null;
    frames?: CortexTraceFrame[];
    status?: string;
    /** Live streaming text from TextDeltaReceived events — shown above trace when live */
    streamText?: string;
  }

  // Default `[]` alone is inferred as `never[]` and breaks element typing in `{#each}`.
  // Bind prop `frames` → `traceRows` so markup does not resolve `frames` to `Window.frames` (breaks types).
  let {
    frame,
    frames: traceRows = [] as CortexTraceFrame[],
    status = "live",
    streamText = "",
  }: Props = $props();

  // Svelte 5: use array reassignment for reactivity (Set mutation doesn't trigger)
  let expandedRows = $state<number[]>([]);
  let expandedMessages = $state<number[]>([]); // conversation thread toggles
  /** Final-result banner: start collapsed */
  let finalResultCollapsed = $state(true);

  function toggleRow(idx: number) {
    expandedRows = expandedRows.includes(idx)
      ? expandedRows.filter((i) => i !== idx)
      : [...expandedRows, idx];
  }

  function toggleMessages(idx: number) {
    expandedMessages = expandedMessages.includes(idx)
      ? expandedMessages.filter((i) => i !== idx)
      : [...expandedMessages, idx];
  }

  function expandAll() {
    expandedRows = traceRows.map((_, i) => i);
    expandedMessages = traceRows
      .map((f, i) => ((f.messages?.length ?? 0) > 0 ? i : -1))
      .filter((i) => i >= 0);
    finalResultCollapsed = false;
  }

  function collapseAll() {
    expandedRows = [];
    expandedMessages = [];
    finalResultCollapsed = true;
  }

  function truncate(s: string, max = 100) {
    return s.length > max ? s.slice(0, max) + "…" : s;
  }

  function roleColor(role: string) {
    if (role === "assistant") return "text-primary";
    if (role === "system") return "text-tertiary/70";
    return "text-secondary";
  }

  // Find final answer frame
  const finalFrame = $derived(traceRows.findLast((f) => f.kind === "final"));
  const hasFinal = $derived(!!finalFrame);
  const isComplete = $derived(status === "completed" || status === "failed");

  /** True when every trace row, message sub-thread, and final banner are expanded. */
  const traceFullyExpanded = $derived.by(() => {
    if (traceRows.length === 0) return false;
    const rowSet = new Set(expandedRows);
    for (let i = 0; i < traceRows.length; i++) {
      if (!rowSet.has(i)) return false;
    }
    for (let i = 0; i < traceRows.length; i++) {
      if ((traceRows[i].messages?.length ?? 0) > 0 && !expandedMessages.includes(i)) return false;
    }
    if (isComplete && finalFrame && finalResultCollapsed) return false;
    return true;
  });

  function toggleExpandCollapseAll() {
    if (traceFullyExpanded) collapseAll();
    else expandAll();
  }
</script>

<div class="gradient-border-glow rounded-lg h-full flex flex-col overflow-hidden min-h-0">
  <!-- Header -->
  <div class="flex items-start justify-between px-4 py-3 border-b border-white/5 flex-shrink-0 gap-2">
    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
      <div class="flex items-center gap-2 min-w-0">
        <span class="material-symbols-outlined text-sm text-primary flex-shrink-0">receipt_long</span>
        <h3 class="font-headline text-sm font-bold uppercase tracking-wide truncate">Execution trace</h3>
        {#if traceRows.length > 0}
          <span class="text-[10px] font-mono text-outline bg-surface-container px-1.5 py-0.5 rounded flex-shrink-0">
            {traceRows.length}
          </span>
        {/if}
      </div>
      <p
        class="text-[9px] font-mono text-outline/45 normal-case tracking-normal pl-7 leading-tight"
        title="Rows follow kernel loops (ReasoningIterationProgress). Inner reasoning steps are counted separately as STEPS in the header."
      >
        Rows = kernel loops · not each reasoning step
      </p>
    </div>
    <div class="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
      {#if traceRows.length > 0}
        <button
          type="button"
          onclick={toggleExpandCollapseAll}
          class="p-1.5 rounded border border-outline-variant/25 text-outline hover:text-primary hover:border-primary/30 bg-transparent cursor-pointer flex-shrink-0"
          title={traceFullyExpanded ? "Collapse all" : "Expand all"}
          aria-label={traceFullyExpanded ? "Collapse all trace sections" : "Expand all trace sections"}
          aria-pressed={traceFullyExpanded}
        >
          <span class="material-symbols-outlined text-base leading-none">
            {traceFullyExpanded ? "collapse_all" : "expand_all"}
          </span>
        </button>
      {/if}
      {#if frame}
        <span
          class="text-[10px] font-mono text-primary/70 bg-primary/10 px-2 py-0.5 rounded"
          title="Kernel loop index for this row"
        >
          LOOP {String(frame.iteration).padStart(2, "0")}
        </span>
      {/if}
    </div>
  </div>

  <!-- ── FINAL RESULT BANNER (collapsible) ──────────────────────────────── -->
  {#if isComplete && finalFrame}
    <div
      class="flex-shrink-0 mx-3 mt-3 rounded-lg border
             {status === 'failed' ? 'bg-error/8 border-error/30' : 'bg-secondary/8 border-secondary/30'}"
    >
      <!-- Header row — always visible, click to collapse -->
      <button
        type="button"
        class="w-full flex items-center gap-2 px-4 py-2.5 cursor-pointer bg-transparent border-0 text-left"
        onclick={() => (finalResultCollapsed = !finalResultCollapsed)}
      >
        <span
          class="material-symbols-outlined text-sm {status === 'failed' ? 'text-error' : 'text-secondary'}"
          style="font-variation-settings: 'FILL' 1;"
        >
          {status === "failed" ? "error" : "task_alt"}
        </span>
        <span class="font-mono text-[10px] uppercase tracking-widest font-bold {status === 'failed' ? 'text-error' : 'text-secondary'}">
          {status === "failed" ? "Run Failed" : "Final Result"}
        </span>
        {#if finalResultCollapsed && finalFrame.thought}
          <!-- Preview when collapsed -->
          <span class="flex-1 font-mono text-[10px] text-on-surface/50 truncate min-w-0 text-left">
            {finalFrame.thought.slice(0, 60)}{finalFrame.thought.length > 60 ? "…" : ""}
          </span>
        {:else if finalFrame.model}
          <span class="ml-auto text-[9px] font-mono text-outline/50 flex-shrink-0">{finalFrame.model}</span>
        {/if}
        <span class="flex-shrink-0 material-symbols-outlined text-sm text-outline/30 transition-transform {finalResultCollapsed ? '-rotate-90' : ''}">
          expand_more
        </span>
      </button>

      <!-- Expandable content -->
      {#if !finalResultCollapsed}
        <div class="px-4 pb-3">
          <div class="max-h-48 overflow-y-auto">
            <p class="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words {status === 'failed' ? 'text-error/80' : 'text-on-surface/80'}">
              {finalFrame.thought}
            </p>
          </div>
          {#if finalFrame.tokensUsed > 0 || finalFrame.estimatedCost}
            <div class="flex gap-3 mt-2 font-mono text-[9px] text-outline/50">
              {#if finalFrame.tokensUsed > 0}
                <span>{finalFrame.tokensUsed.toLocaleString()} tok</span>
              {/if}
              {#if finalFrame.estimatedCost}
                <span>${finalFrame.estimatedCost.toFixed(4)}</span>
              {/if}
              {#if finalFrame.durationMs > 0}
                <span>{(finalFrame.durationMs / 1000).toFixed(1)}s</span>
              {/if}
            </div>
          {/if}
        </div><!-- end expandable -->
      {/if}
    </div>
  {/if}

  <!-- ── LIVE STREAMING TEXT ───────────────────────────────────────────────── -->
  {#if status === "live" && streamText}
    <div class="flex-shrink-0 mx-3 mb-1 px-3 py-2 bg-primary/5 border border-primary/15 rounded-lg">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0"></span>
        <span class="text-[9px] font-mono text-primary/70 uppercase tracking-widest">Streaming…</span>
      </div>
      <p class="font-mono text-[10px] text-on-surface/70 leading-relaxed whitespace-pre-wrap break-words">
        {streamText}<span class="inline-block w-2 h-3 bg-primary/50 ml-0.5 animate-pulse"></span>
      </p>
    </div>
  {/if}

  <!-- ── ITERATION LOG ────────────────────────────────────────────────────── -->
  <div class="flex-1 overflow-y-auto min-h-0 py-2">
    {#if traceRows.length === 0}
      <p class="font-mono text-[10px] text-outline text-center mt-8 px-4">
        Trace will appear here as the agent runs…
      </p>
    {:else}
      {#each traceRows as f, idx (idx)}
        {@const isExpanded = expandedRows.includes(idx)}
        {@const isSelected = frame?.iteration === f.iteration && frame?.kind === f.kind}
        {@const hasRichData = !!(f.llmThought || f.rawResponse || f.messages?.length || f.observation || f.action)}
        {@const isFinal = f.kind === "final"}

        <!-- Row: summary is a real button; details are a sibling (no nested buttons — fixes broken toggles). -->
        <div
          class="mx-2 mb-1 rounded-md transition-all duration-150
                 {isFinal
                   ? 'border-l-2 border-secondary/50 bg-secondary/5'
                   : isSelected
                     ? 'border-l-2 border-primary/60 bg-primary/8'
                     : 'border-l-2 border-transparent hover:border-outline-variant/40 bg-surface-container-lowest/30 hover:bg-surface-container-low/50'}"
        >
          <button
            type="button"
            class="w-full text-left cursor-pointer border-0 bg-transparent p-0 rounded-md"
            onclick={() => toggleRow(idx)}
          >
          <!-- ── Collapsed summary row ──────────────────────────────────── -->
          <div class="flex items-center gap-2 px-3 py-2">
            <!-- Iter badge -->
            <span
              class="flex-shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded-sm tabular-nums
                     {isFinal
                       ? 'text-secondary bg-secondary/15 border border-secondary/25'
                       : 'text-primary/80 bg-primary/10'}"
            >
              <span title="Kernel loop {f.iteration}">{isFinal ? "FINAL" : `L${f.iteration}`}</span>
            </span>

            <!-- Summary text -->
            <span class="flex-1 text-[10px] font-mono text-on-surface/70 truncate min-w-0">
              {truncate(f.llmThought || f.thought)}
            </span>

            <!-- Tool pills (compact) -->
            {#if f.toolsThisStep && f.toolsThisStep.length > 0 && !isFinal}
              <div class="flex-shrink-0 flex gap-1">
                {#each f.toolsThisStep.slice(0, 2) as tool}
                  <span class="text-[8px] font-mono px-1 py-0.5 bg-tertiary/10 text-tertiary rounded-sm">
                    {tool.length > 12 ? tool.slice(0, 10) + "…" : tool}
                  </span>
                {/each}
                {#if f.toolsThisStep.length > 2}
                  <span class="text-[8px] font-mono text-outline">+{f.toolsThisStep.length - 2}</span>
                {/if}
              </div>
            {/if}

            <!-- Rich data indicator -->
            {#if hasRichData}
              <span class="flex-shrink-0 material-symbols-outlined text-[12px] text-primary/30" title="Has LLM response data">
                psychology
              </span>
            {/if}

            <!-- Metrics -->
            <div class="flex-shrink-0 flex items-center gap-2 text-[9px] font-mono text-outline/50">
              {#if f.tokensUsed > 0}
                <span>{f.tokensUsed.toLocaleString()}t</span>
              {/if}
              {#if f.durationMs > 0}
                <span>{f.durationMs >= 1000 ? `${(f.durationMs/1000).toFixed(1)}s` : `${f.durationMs}ms`}</span>
              {/if}
              {#if f.entropy !== undefined}
                <span class="text-primary/40">η{f.entropy.toFixed(2)}</span>
              {/if}
            </div>

            <!-- Expand chevron -->
            <span
              class="flex-shrink-0 material-symbols-outlined text-sm text-outline/30 transition-transform duration-200 {isExpanded ? 'rotate-180' : ''}"
            >
              expand_more
            </span>
          </div>
          </button>

          <!-- ── Expanded detail ──────────────────────────────────────────── -->
          {#if isExpanded}
            <div
              class="px-3 pb-4 space-y-4 border-t border-white/5 pt-3 animate-fade-up"
              role="region"
              aria-label="Kernel loop {f.iteration} details"
            >

              <!-- LLM Thought (agent's reasoning) -->
              {#if f.llmThought}
                <div class="relative pl-3">
                  <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-primary/30 rounded-full"></div>
                  <span class="text-[9px] font-mono text-primary/80 uppercase tracking-widest block mb-1.5">
                    Agent Reasoning
                  </span>
                  <p class="text-[11px] font-mono text-on-surface/75 leading-relaxed whitespace-pre-wrap break-words bg-primary/5 rounded p-2 border border-primary/10">
                    {f.llmThought}
                  </p>
                </div>
              {/if}

              <!-- Action -->
              {#if f.action}
                <div class="relative pl-3">
                  <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-tertiary/30 rounded-full"></div>
                  <span class="text-[9px] font-mono text-tertiary/80 uppercase tracking-widest block mb-1.5">
                    Action
                  </span>
                  <div class="bg-tertiary/5 rounded p-2 border border-tertiary/10">
                    <code class="text-[10px] font-mono text-on-surface/70 break-all whitespace-pre-wrap">{f.action}</code>
                  </div>
                </div>
              {/if}

              <!-- Tools called this iteration -->
              {#if f.toolsThisStep && f.toolsThisStep.length > 0}
                <div class="relative pl-3">
                  <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-tertiary/30 rounded-full"></div>
                  <span class="text-[9px] font-mono text-tertiary/80 uppercase tracking-widest block mb-1.5">
                    Tools ({f.toolsThisStep.length})
                  </span>
                  <div class="flex flex-wrap gap-1.5">
                    {#each f.toolsThisStep as tool}
                      <span class="px-2 py-1 bg-tertiary/10 border border-tertiary/25 text-tertiary text-[10px] font-mono rounded">
                        {tool}
                      </span>
                    {/each}
                    {#if f.durationMs > 0}
                      <span class="text-[10px] font-mono text-outline/50 self-center">
                        {f.durationMs >= 1000 ? `${(f.durationMs/1000).toFixed(1)}s` : `${f.durationMs}ms`}
                      </span>
                    {/if}
                  </div>
                </div>
              {/if}

              <!-- Observation / tool result -->
              {#if f.observation}
                <div class="relative pl-3">
                  <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-secondary/30 rounded-full"></div>
                  <span class="text-[9px] font-mono text-secondary/80 uppercase tracking-widest block mb-1.5">
                    Tool Result
                  </span>
                  <div class="bg-secondary/5 border border-secondary/10 rounded overflow-hidden">
                    <div class="max-h-40 overflow-y-auto p-2">
                      <code class="text-[10px] font-mono text-on-surface/60 break-all whitespace-pre-wrap">
                        {f.observation}
                      </code>
                    </div>
                  </div>
                </div>
              {/if}

              <!-- Raw LLM Response -->
              {#if f.rawResponse}
                <div class="relative pl-3">
                  <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-outline-variant/40 rounded-full"></div>
                  <span class="text-[9px] font-mono text-outline uppercase tracking-widest block mb-1.5">
                    Raw LLM Response
                  </span>
                  <div class="bg-surface-container-lowest border border-white/5 rounded overflow-hidden">
                    <div class="max-h-56 overflow-y-auto p-2">
                      <code class="text-[10px] font-mono text-on-surface/55 break-all whitespace-pre-wrap">
                        {f.rawResponse}
                      </code>
                    </div>
                  </div>
                </div>
              {/if}

              <!-- Conversation thread (messages sent to LLM) -->
              {#if f.messages && f.messages.length > 0}
                <div class="relative pl-3">
                  <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-outline-variant/30 rounded-full"></div>
                  <button
                    type="button"
                    class="flex items-center gap-2 mb-1.5 cursor-pointer w-full text-left bg-transparent border-0 p-0"
                    onclick={() => toggleMessages(idx)}
                  >
                    <span class="text-[9px] font-mono text-outline/70 uppercase tracking-widest">
                      Conversation Thread ({f.messages.length} msgs)
                    </span>
                    <span class="material-symbols-outlined text-[11px] text-outline/40 transition-transform {expandedMessages.includes(idx) ? 'rotate-180' : ''}">
                      expand_more
                    </span>
                  </button>
                  {#if expandedMessages.includes(idx)}
                    <div class="space-y-1 max-h-72 overflow-y-auto">
                      {#each f.messages as msg, mi (mi)}
                        <div
                          class="rounded p-2 text-[10px] font-mono border
                                 {msg.role === 'assistant' ? 'bg-primary/5 border-primary/10' : msg.role === 'system' ? 'bg-tertiary/5 border-tertiary/10' : 'bg-surface-container border-outline-variant/10'}"
                        >
                          <div class="font-bold uppercase mb-1 text-[9px] tracking-wider {roleColor(msg.role)}">
                            {msg.role}
                          </div>
                          <div class="text-on-surface/60 break-words whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
                            {msg.content}
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}

              <!-- Stats footer -->
              <div class="flex flex-wrap gap-3 text-[9px] font-mono text-outline/40 pl-3 border-t border-white/5 pt-2">
                {#if f.model}
                  <span class="text-outline/60">{f.model}</span>
                {/if}
                {#if f.provider}
                  <span>{f.provider}</span>
                {/if}
                {#if f.tokensUsed > 0}
                  <span class="text-primary/50">{f.tokensUsed.toLocaleString()} tokens</span>
                {/if}
                {#if f.estimatedCost}
                  <span>${f.estimatedCost.toFixed(5)}</span>
                {/if}
                {#if f.entropy !== undefined}
                  <span>η {f.entropy.toFixed(3)}</span>
                {/if}
                <span>{new Date(f.ts).toLocaleTimeString()}</span>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>
