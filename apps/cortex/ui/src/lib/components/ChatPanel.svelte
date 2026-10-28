<script lang="ts">
  import { chatStore, type ChatTurn } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import GuardedMarkdown from "$lib/components/GuardedMarkdown.svelte";
  import PromptPickerButton from "$lib/components/PromptPickerButton.svelte";
  import ChatTurnTimeline from "$lib/components/ChatTurnTimeline.svelte";
  import Tooltip from "$lib/components/Tooltip.svelte";
  import ChatContextMeter from "$lib/components/ChatContextMeter.svelte";
  import ChatTraceDrawer from "$lib/components/ChatTraceDrawer.svelte";
  import { compactionRows } from "$lib/chat-compaction.js";
  import { CHAT_PROVIDERS } from "$lib/inference-presets.js";
  import { fetchModelsForProvider, type UiModelOption } from "$lib/framework-models.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import {
    addDocumentPatch,
    documentsOf,
    pinnedSkills,
    removeDocumentPatch,
    toggleSkillPatch,
    type DiscoveredSkill,
  } from "$lib/chat-config-patch.js";
  import { fade } from "svelte/transition";
  import { untrack } from "svelte";
  import {
    matchCommands,
    parseKeepLast,
    parseSlash,
    resolveCommand,
    type ChatCommand,
  } from "$lib/chat-commands.js";

  interface Props {
    sessionId: string;
    turns: ChatTurn[];
    sending: boolean;
    error: string | null;
  }
  const { sessionId, turns, sending, error }: Props = $props();

  let message = $state("");
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let scrollEl = $state<HTMLDivElement | null>(null);
  let lastSent = $state("");

  const sessionTokenTotal = $derived(
    turns.reduce((sum, t) => sum + (t.streaming ? (t.liveTokens ?? 0) : (t.tokensUsed ?? 0)), 0),
  );
  const sessionCostTotal = $derived(
    turns.reduce((sum, t) => sum + (t.streaming ? (t.liveCost ?? 0) : (t.costUsd ?? 0)), 0),
  );

  // ── Trace drawer + context meter ──────────────────────────────────────────
  const TRACE_KEY = "cortex.chat.traceOpen";
  const readTraceOpen = (): boolean => {
    try {
      return localStorage.getItem(TRACE_KEY) === "1";
    } catch {
      return false;
    }
  };
  let traceOpen = $state(readTraceOpen());
  let traceTurnId = $state<number | null>(null);
  const setTraceOpen = (open: boolean) => {
    traceOpen = open;
    try {
      localStorage.setItem(TRACE_KEY, open ? "1" : "0");
    } catch {
      /* storage unavailable: the toggle still works for this visit */
    }
  };
  const traceTurn = $derived(
    turns.find((t) => t.id === traceTurnId && t.role === "assistant") ?? [...turns].reverse().find((t) => t.role === "assistant"),
  );
  const latestContext = $derived([...turns].reverse().find((t) => t.context)?.context);
  const lastReply = $derived.by(() => {
    const t = [...turns].reverse().find((x) => x.role === "assistant" && !x.streaming);
    return t ? { tokens: t.tokensUsed, ...(t.steps ? { steps: t.steps } : {}), toolCalls: t.toolCalls?.length ?? 0 } : undefined;
  });
  let editingSummaryId = $state<number | null>(null);
  let summaryDraft = $state("");
  const saveSummary = (turnId: number) =>
    runAction("Summary", async () => {
      await chatStore.editSummary(turnId, summaryDraft);
      editingSummaryId = null;
    }, "Summary saved · used from your next message");
  const compaction = $derived(compactionRows(turns));
  const STARTERS = ["Summarise what you can do here", "What tools do you have available?", "Plan how you'd research a topic step by step"];
  /** What the agent is doing right now, for the live status line. */
  const liveStatus = (t: ChatTurn): string => {
    const running = t.toolCalls?.filter((c) => c.status === "running") ?? [];
    if (running.length > 0) return `Running ${running.map((c) => c.name).join(", ")}`;
    return t.streamProgress && t.streamProgress.maxIterations > 0
      ? `Working, step ${t.streamProgress.iteration} of ${t.streamProgress.maxIterations}`
      : "Thinking";
  };

  // Entrance choreography: turns stagger in while a session is loading, then fire instantly once settled.
  let entering = $state(true);
  $effect(() => {
    void sessionId;
    traceTurnId = null;
    queuedSkills = [];
    editingSummaryId = null;
    message = "";
    entering = true;
    const t = setTimeout(() => (entering = false), 700);
    return () => clearTimeout(t);
  });

  // Smart autoscroll: follow the stream only while the user is pinned at the bottom.
  let atBottom = $state(true);
  function onScroll() {
    if (!scrollEl) return;
    atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80;
  }
  $effect(() => {
    void turns; // track every store update (deltas re-create the array)
    if (turns.length > 0 && scrollEl && atBottom) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  });

  async function submit() {
    const text = message.trim();
    if (!text || sending) return;
    const typed = parseSlash(text);
    if (typed) {
      const cmd = resolveCommand(typed);
      if (!cmd) {
        toast.error(`Unknown command /${typed.query}`, "Type / to see what's available");
        return;
      }
      await runSlash(cmd, typed.arg);
      return;
    }
    lastSent = text;
    message = "";
    await sendWithQueuedSkills(text);
    inputEl?.focus();
  }

  /**
   * Run one message with the queued skills active, then put the session's own skills
   * back. The server rebuilds the agent on a config change, so the skills load for
   * exactly this run; if the restore fails they stay pinned (the status line shows it).
   */
  async function sendWithQueuedSkills(text: string) {
    const queued = (skillList ?? []).filter((sk) => queuedSkills.includes(sk.name));
    queuedSkills = [];
    if (queued.length === 0) return void (await chatStore.sendMessageStream(text));
    const before = cfg.skills ?? { paths: [] };
    let working: Record<string, unknown> = { ...cfg };
    for (const sk of queued) {
      if (!pinnedSkills(working).includes(sk.name)) working = { ...working, ...toggleSkillPatch(working, sk) };
    }
    try {
      await chatStore.patchSessionConfig(sessionId, { skills: working.skills });
    } catch (e) {
      toast.error("Couldn't activate skills", e instanceof Error ? e.message : String(e));
      return;
    }
    try {
      await chatStore.sendMessageStream(text);
    } finally {
      await chatStore.patchSessionConfig(sessionId, { skills: before }).catch((e) =>
        toast.error("Skills stayed pinned", e instanceof Error ? e.message : String(e)),
      );
    }
  }

  async function retry() {
    if (!lastSent || sending) return;
    await chatStore.sendMessageStream(lastSent);
    inputEl?.focus();
  }

  // ── Slash commands ────────────────────────────────────────────────────────
  const slash = $derived(parseSlash(message));
  const slashCmd = $derived(slash ? resolveCommand(slash) : undefined);

  /** One row in the slash menu: a command, or a second-level choice for /model, /skills, … */
  type MenuItem = {
    key: string;
    icon: string;
    label: string;
    hint?: string;
    detail?: string;
    active?: boolean;
    /** Small icon after the label, e.g. the brain on thinking models (survives the "current" check mark). */
    badge?: string;
    run: () => void | Promise<void>;
    complete?: () => void;
  };

  // Session config the pickers read from and patch.
  const session = $derived($chatStore.sessions.find((s) => s.sessionId === sessionId));
  const cfg = $derived(session?.agentConfig ?? {});
  const provider = $derived(typeof cfg.provider === "string" ? cfg.provider : "");
  const model = $derived(typeof cfg.model === "string" ? cfg.model : "");
  const pinned = $derived(pinnedSkills(cfg));
  const docs = $derived(documentsOf(cfg));

  let models = $state<UiModelOption[]>([]);
  let modelsFor = "";
  let skillList = $state<DiscoveredSkill[] | null>(null);
  // The model list also drives the "thinks" badge and the status chip, so load it whenever the provider is known.
  $effect(() => {
    const picker = slash?.hasArg ? slashCmd?.picker : undefined;
    if (provider && modelsFor !== provider) {
      modelsFor = provider;
      void fetchModelsForProvider(provider).then((r) => (models = r.options));
    }
    // Skills are offered in the plain `/` menu too, so load them as soon as a slash is typed.
    if ((picker === "skill" || slash) && skillList === null) loadSkills();
  });
  function loadSkills() {
    skillList = [];
    void fetch(`${CORTEX_SERVER_URL}/api/skills/files`)
      .then((r) => (r.ok ? r.json() : { skills: [] }))
      .then((j: { skills?: DiscoveredSkill[] }) => (skillList = j.skills ?? []))
      .catch(() => (skillList = []));
  }

  // Skills queued from the `/` menu for the NEXT message only (pinned for that run, then restored).
  let queuedSkills = $state<string[]>([]);
  const toggleQueued = (name: string) => {
    queuedSkills = queuedSkills.includes(name) ? queuedSkills.filter((n) => n !== name) : [...queuedSkills, name];
    message = "";
    inputEl?.focus();
  };

  const configRow = (key: string, icon: string, label: string, run: () => void | Promise<void>, extra: Partial<MenuItem> = {}): MenuItem => ({ key, icon, label, run, ...extra });
  /** Apply a config patch; takes effect on the next turn because the server rebuilds the agent. */
  const applyConfig = (what: string, patch: Record<string, unknown>) => {
    message = "";
    return runAction("Config", () => chatStore.patchSessionConfig(sessionId, patch), `${what} · applies to your next message`);
  };
  async function setProvider(next: string) {
    const r = await fetchModelsForProvider(next).catch(() => ({ options: [] as UiModelOption[], default: undefined }));
    const nextModel = r.default ?? r.options[0]?.value;
    await applyConfig(`Provider ${next}${nextModel ? `, model ${nextModel}` : ""}`, { provider: next, ...(nextModel ? { model: nextModel } : {}) });
    if (!nextModel) toast.info("Pick a model", "Use /model to choose one for this provider");
  }

  const thinkingChoice = $derived(cfg.thinking === true ? "on" : cfg.thinking === false ? "off" : "auto");
  /** true = the current model has a thinking mode, false = it does not, null = not known. */
  const modelThinking = $derived(models.find((m) => m.value === model)?.thinking ?? null);

  const pickItems = $derived.by((): MenuItem[] => {
    if (!slash?.hasArg || !slashCmd?.picker) return [];
    const q = slash.arg.toLowerCase();
    const has = (...parts: string[]) => q === "" || parts.some((p) => p.toLowerCase().includes(q));
    switch (slashCmd.picker) {
      case "provider":
        return CHAT_PROVIDERS.filter((p) => has(p)).map((p) =>
          configRow(p, "cloud", p, () => setProvider(p), { active: p === provider, ...(p === provider ? { hint: "current" } : {}) }),
        );
      case "thinking": {
        const note = modelThinking === false ? "This model has no thinking mode" : modelThinking === null ? "Support not known for this model" : "";
        return ([["auto", "Auto", "The model's own default"], ["on", "On", "Reason before answering (slower, more tokens)"], ["off", "Off", "Answer directly"]] as const)
          .filter(([v, label]) => has(v, label))
          .map(([v, label, detail]) =>
            configRow(v, "psychology", label, () => applyConfig(`Thinking ${v}`, { thinking: v === "auto" ? null : v === "on" }), {
              active: v === thinkingChoice,
              detail: v === "auto" && note ? `${detail} · ${note}` : detail,
            }),
          );
      }
      case "model": {
        const rows = models.filter((m) => has(m.value, m.label)).map((m) =>
          configRow(m.value, "memory", m.label || m.value, () => applyConfig(`Model ${m.value}`, { model: m.value }), { active: m.value === model, ...(m.thinking ? { badge: "psychology", hint: "thinking model" } : {}), ...(m.label !== m.value ? { detail: m.value } : {}) }),
        );
        const typed = slash.arg.trim();
        if (typed && !models.some((m) => m.value === typed)) {
          rows.push(configRow(`use:${typed}`, "edit", `Use "${typed}"`, () => applyConfig(`Model ${typed}`, { model: typed }), { detail: "custom model id" }));
        }
        return rows;
      }
      case "skill":
        return (skillList ?? []).filter((s) => has(s.name, s.description)).map((s) =>
          configRow(s.name, "bolt", s.name, () => applyConfig(pinned.includes(s.name) ? `Unpinned ${s.name}` : `Pinned ${s.name}`, toggleSkillPatch(cfg, s)), {
            active: pinned.includes(s.name),
            hint: pinned.includes(s.name) ? "pinned" : "",
            detail: s.description,
          }),
        );
      case "doc": {
        if (q.startsWith("add ")) {
          const source = slash.arg.slice(4).trim();
          const patch = addDocumentPatch(cfg, source);
          return source === ""
            ? []
            : [configRow(`add:${source}`, "add", `Add ${source}`, () => (patch ? applyConfig(`Added ${source}`, patch) : void toast.info("Already added", source)), { detail: "path or URL the agent can search" })];
        }
        const rows = docs.filter((d) => has(d.source)).map((d) =>
          configRow(d.source, "menu_book", d.source, () => applyConfig(`Removed ${d.source}`, removeDocumentPatch(cfg, d.source)), { active: true, hint: "select to remove" }),
        );
        if (q === "" || "add".startsWith(q)) {
          rows.push(configRow("add", "add", "add <path or URL>", () => void (message = "/docs add "), { detail: docs.length === 0 ? "No documents yet" : "Add another", complete: () => void (message = "/docs add ") }));
        }
        return rows;
      }
    }
  });

  const skillItems = $derived.by((): MenuItem[] => {
    if (!slash || slash.hasArg) return [];
    const q = slash.query;
    return (skillList ?? [])
      .filter((sk) => q === "" || sk.name.toLowerCase().includes(q) || sk.description.toLowerCase().includes(q))
      .map((sk): MenuItem => ({
        key: `skill:${sk.name}`,
        icon: "bolt",
        label: sk.name,
        hint: queuedSkills.includes(sk.name) ? "queued" : pinned.includes(sk.name) ? "pinned" : "skill",
        detail: sk.description,
        active: queuedSkills.includes(sk.name) || pinned.includes(sk.name),
        run: () => toggleQueued(sk.name),
        complete: () => toggleQueued(sk.name),
      }));
  });
  const commandItems = $derived.by((): MenuItem[] =>
    slash && !slash.hasArg
      ? [...matchCommands(slash.query).map((cmd): MenuItem => ({
          key: cmd.name,
          icon: cmd.icon,
          label: `/${cmd.name}`,
          ...(cmd.arg ? { hint: cmd.arg } : {}),
          detail: cmd.summary,
          run: () => runSlash(cmd, ""),
          complete: () => completeCommand(cmd),
        })), ...skillItems]
      : [],
  );
  const menuItems = $derived(slash?.hasArg ? pickItems : commandItems);
  let menuRaw = $state(0);
  const menuIndex = $derived(Math.min(menuRaw, Math.max(0, menuItems.length - 1)));
  let menuDismissed = $state(false);
  const menuOpen = $derived(menuItems.length > 0 && !menuDismissed && !sending);
  // Only what the user typed resets the menu; async list loads (skills, models) must not
  // re-open a menu they dismissed or move their highlight.
  $effect(() => {
    void slash?.query;
    void slash?.arg;
    untrack(() => {
      menuRaw = 0;
      menuDismissed = false;
    });
  });

  /** Put the command in the input; commands that take an argument keep the caret waiting for it. */
  function completeCommand(cmd: ChatCommand) {
    message = cmd.name === "rename" || cmd.picker ? `/${cmd.name} ` : `/${cmd.name}`;
    inputEl?.focus();
  }

  async function runSlash(cmd: ChatCommand, arg: string) {
    if (cmd.needsTurns && turns.length === 0) {
      toast.error(`Nothing to ${cmd.name} yet`);
      return;
    }
    if ((cmd.name === "rename" || cmd.picker) && arg === "") {
      completeCommand(cmd);
      return;
    }
    message = "";
    switch (cmd.name) {
      case "clear": return void (await clearChat());
      case "compact": return void (await compactChat(parseKeepLast(arg)));
      case "fork": return void (await forkFrom());
      case "rerun": return void (await rerunLast());
      case "copy": return void (await copyAllConversation());
      case "help": message = "/"; inputEl?.focus(); return;
      case "model":
      case "provider":
      case "skills":
      case "thinking":
      case "docs":
        return; // second-level picks are executed from the menu rows
      case "rename":
        return void (await runAction("Rename", () => chatStore.renameSession(sessionId, arg), `Renamed to "${arg}"`));
      case "rewind": {
        const lastUser = [...turns].reverse().find((t) => t.role === "user");
        if (lastUser) await editFrom(lastUser.id);
        return;
      }
    }
  }

  function onKeydown(e: KeyboardEvent) {
    // Enter/Tab while an IME is composing (accents, CJK, dead keys) confirms the composition; it must not send or complete.
    if (e.isComposing || e.keyCode === 229) return;
    if (menuOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = menuItems.length;
        menuRaw = (menuIndex + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const item = menuItems[menuIndex];
        if (!item) return;
        if (e.key === "Tab") item.complete?.();
        else void item.run();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        menuDismissed = true;
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  // ── History utilities (rewind / rerun / fork / clear / compact) ───────────
  let busyAction = $state<string | null>(null);
  const lastAssistantId = $derived([...turns].reverse().find((t) => t.role === "assistant")?.id);

  async function runAction(label: string, fn: () => Promise<void>, done?: string) {
    if (sending || busyAction) return;
    busyAction = label;
    try {
      await fn();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(`${label} failed`, e instanceof Error ? e.message : String(e));
    } finally {
      busyAction = null;
    }
  }

  const rewindTo = (turnId: number) =>
    runAction("Rewind", async () => {
      if (!confirm("Rewind here? This message and everything after it is removed from the chat.")) return;
      await chatStore.rewind(turnId);
    });

  /** Edit & resend: rewind to the message, drop its text back into the input. */
  const editFrom = (turnId: number) =>
    runAction("Edit", async () => {
      const text = await chatStore.rewind(turnId);
      message = text;
      inputEl?.focus();
    });

  const rerunLast = () => runAction("Rerun", () => chatStore.rerun());
  const forkFrom = (turnId?: number) => runAction("Fork", async () => void (await chatStore.fork(turnId)), "Forked into a new chat");
  const clearChat = () =>
    runAction("Clear", async () => {
      if (!confirm("Clear this conversation's context? Messages are deleted; the session and its config stay.")) return;
      await chatStore.clearContext();
    });
  const compactChat = (keepLast?: number) =>
    runAction("Compact", async () => {
      const compacted = await chatStore.compact(keepLast);
      toast.success(compacted > 0 ? "Context compacted" : "Nothing to compact yet");
    });

  async function copyUserMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Copied", "Message copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }

  async function copyAllConversation() {
    try {
      const formatted = turns
        .map((turn: ChatTurn) => {
          const speaker = turn.role === "user" ? "You" : "Assistant";
          return `**${speaker}**: ${turn.content}`;
        })
        .join("\n\n");
      await navigator.clipboard.writeText(formatted);
      toast.success("Copied", "Conversation copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }

  const bubbleUser =
    "max-w-[80%] rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-[var(--cortex-text)]";
  const bubbleAsst =
    "max-w-[80%] rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] px-3 py-2 text-[var(--cortex-text)]";
</script>

<div
  class="flex h-full min-h-0 w-full flex-col bg-surface-container-lowest/90 text-on-surface backdrop-blur-md dark:bg-surface/90"
>
  <div
    class="flex-shrink-0 border-b border-[color:var(--cortex-border)] px-4 py-3 flex items-center justify-between"
  >
    <h2 class="text-[11px] uppercase tracking-widest font-mono text-[var(--cortex-text-muted)]">
      Conversation
    </h2>
    <div class="flex items-center gap-4">
      <ChatContextMeter
        context={latestContext}
        sessionTokens={sessionTokenTotal}
        sessionCost={sessionCostTotal}
        last={lastReply}
      />
      <button
        type="button"
        onclick={() => setTraceOpen(!traceOpen)}
        aria-pressed={traceOpen}
       
        class="flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors
               {traceOpen ? 'border-primary/40 bg-primary/10 text-primary' : 'border-[color:var(--cortex-border)] text-[var(--cortex-text-muted)] hover:bg-[var(--cortex-surface-mid)] hover:text-[var(--cortex-text)]'}"
      >
        <span class="material-symbols-outlined text-[15px] leading-none">account_tree</span>
        Trace
      </button>
    </div>
  </div>

  <div class="flex min-h-0 flex-1">
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <div class="chat-busy-bar h-px flex-shrink-0 {busyAction ? 'opacity-100' : 'opacity-0'}" aria-hidden="true"></div>

  <div
    bind:this={scrollEl}
    onscroll={onScroll}
    class="flex-1 space-y-4 overflow-y-auto p-4 font-mono text-[12px]"
  >
    {#if turns.length === 0}
      <div class="chat-turn-in flex h-full items-center justify-center">
        <div class="max-w-md text-center">
          <p class="m-0 text-[13px] text-[var(--cortex-text)]">Ask the agent anything</p>
          <p class="mx-0 mb-4 mt-1 text-[12px] text-[var(--cortex-text-muted)]">Type <kbd class="rounded border border-[color:var(--cortex-border)] px-1">/</kbd> for commands like compact, fork and rewind.</p>
          <div class="flex flex-col items-stretch gap-1.5">
            {#each STARTERS as starter (starter)}
              <button
                type="button"
                onclick={() => { message = starter; inputEl?.focus(); }}
                class="cursor-pointer rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] px-3 py-2 text-left text-[12px] text-[var(--cortex-text-muted)] transition-colors hover:border-primary/40 hover:text-[var(--cortex-text)]"
              >{starter}</button>
            {/each}
          </div>
        </div>
      </div>
    {:else}
      {#each turns as turn, i (turn.id)}
        {#if compaction.markers.has(i)}
          <div class="chat-turn-in flex items-center gap-3 text-[11px] text-[var(--cortex-text-muted)]" out:fade|local={{ duration: 140 }}>
            <span class="h-px flex-1 bg-[color:var(--cortex-border)]"></span>
            <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px] leading-none">compress</span>Earlier messages summarised</span>
            <span class="h-px flex-1 bg-[color:var(--cortex-border)]"></span>
          </div>
        {:else if compaction.summaries.has(i)}
          <details class="chat-turn-in rounded-lg border border-dashed border-[color:var(--cortex-border)] px-3 py-2 text-[12px] text-[var(--cortex-text-muted)]" out:fade|local={{ duration: 140 }}>
            <summary class="cursor-pointer select-none">View summary the agent carries forward</summary>
            {#if editingSummaryId === turn.id}
              <textarea
                bind:value={summaryDraft}
                rows="10"
                aria-label="Edit summary"
                class="mt-2 w-full resize-y rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] px-3 py-2 font-mono text-[12px] text-[var(--cortex-text)] focus:border-primary/40 focus:outline-none"
              ></textarea>
              <div class="mt-2 flex items-center gap-2">
                <button type="button" onclick={() => void saveSummary(turn.id)} disabled={busyAction !== null || summaryDraft.trim() === ""} class="cursor-pointer rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40">Save summary</button>
                <button type="button" onclick={() => (editingSummaryId = null)} class="cursor-pointer rounded-md px-2.5 py-1 text-[11px] transition-colors hover:text-[var(--cortex-text)]">Cancel</button>
                <span class="text-[11px]">The agent uses this text for everything before this point.</span>
              </div>
            {:else}
              <div class="mt-2"><GuardedMarkdown markdown={turn.content} class="text-[11px]" /></div>
              {#if !sending}
                <button type="button" onclick={() => { editingSummaryId = turn.id; summaryDraft = turn.content; }} class="mt-2 flex cursor-pointer items-center gap-1 text-[11px] transition-colors hover:text-[var(--cortex-text)]">
                  <span class="material-symbols-outlined text-[14px] leading-none">edit</span>Edit summary
                </button>
              {/if}
            {/if}
          </details>
        {:else}
        <div
          class="chat-turn-in flex gap-2 {turn.role === 'user' ? 'justify-end' : 'justify-start'}"
          style:--chat-turn-delay="{entering ? Math.min(i, 8) * 40 : 0}ms"
          out:fade|local={{ duration: 140 }}
        >
          <div class="{turn.role === 'user' ? bubbleUser : bubbleAsst} relative group">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <span
                class="text-[9px] uppercase tracking-widest {turn.role === 'user'
                  ? 'text-primary/80'
                  : 'text-secondary/80'}"
              >
                {turn.role}
              </span>
              {#if turn.role === "assistant" && (turn.model ?? (turn.streaming ? model : ""))}
                <span class="text-[10px] normal-case tracking-normal text-[var(--cortex-text-muted)]">
                  {turn.provider ?? (turn.streaming ? provider : "")} · {turn.model ?? model}
                </span>
              {/if}
              {#if turn.streaming && (turn.liveTokens ?? 0) > 0}
                <span class="font-mono text-[9px] text-[var(--cortex-text-muted)] tabular-nums animate-pulse">
                  {(turn.liveTokens ?? 0).toLocaleString()} tok
                  {#if (turn.liveCost ?? 0) > 0}
                    · ${((turn.liveCost ?? 0) * 100).toFixed(3)}¢
                  {/if}
                </span>
              {:else if turn.tokensUsed > 0}
                <span class="text-[9px] text-[var(--cortex-text-muted)]">{turn.tokensUsed} tok</span>
              {/if}
              {#if turn.steps != null && turn.steps > 0}
                <span class="text-[9px] text-[var(--cortex-text-muted)]">{turn.steps} steps</span>
              {/if}
              {#if turn.cancelled}
                <span class="font-mono text-[9px] text-[var(--cortex-text-muted)] italic">stopped</span>
              {/if}
            </div>
            {#if turn.role === "assistant"}
              <div class="flex gap-2 items-start">
                <div class="flex-1 min-w-0">
                  <ChatTurnTimeline {turn} />
                  {#if turn.streaming && !turn.liveText && !turn.content}
                    <p class="mb-2 text-[11px] font-mono italic text-[var(--cortex-text-muted)]">
                      {liveStatus(turn)}<span class="chat-dots ml-1 inline-flex items-center gap-0.5 align-middle" aria-hidden="true"><i></i><i></i><i></i></span>
                    </p>
                  {/if}
                  {#if turn.streaming && turn.liveText}
                    <!-- Streaming text is NOT yet known to be the answer (it may turn out to be thinking
                         before a tool call): keep it muted + unrendered; markdown renders only once the
                         run finishes and the final answer is known. -->
                    <p class="m-0 whitespace-pre-wrap text-[11px] italic leading-relaxed text-[var(--cortex-text-muted)]">{turn.liveText}<span class="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-secondary/60 align-middle"></span></p>
                  {:else if turn.streaming && turn.content}
                    <p class="whitespace-pre-wrap text-[11px] leading-relaxed m-0">{turn.content}<span class="inline-block w-1.5 h-3.5 ml-0.5 bg-secondary/80 animate-pulse rounded-sm align-middle"></span></p>
                  {:else if turn.streaming}
                    <!-- no text yet: thinking indicator above covers this state -->
                  {:else}
                    <GuardedMarkdown markdown={turn.content} showCopy={true} class="text-[11px]" />
                  {/if}
                  {#if turn.liveObject && Object.keys(turn.liveObject).length > 0}
                    <!-- Op E: partial/final structured-output preview, updates live as it streams. -->
                    <div class="mt-2 rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-mid)]/40 p-2">
                      <div class="mb-1 flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-[13px] text-secondary/80">data_object</span>
                        <span class="font-mono text-[9px] uppercase tracking-wide text-[var(--cortex-text-muted)]">
                          Structured output
                        </span>
                      </div>
                      <pre class="m-0 overflow-x-auto font-mono text-[10px] leading-snug text-[var(--cortex-text)] whitespace-pre">{JSON.stringify(turn.liveObject, null, 2)}</pre>
                    </div>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="flex gap-2 items-start">
                <p class="flex-1 whitespace-pre-wrap text-[11px] leading-relaxed">{turn.content}</p>
                <Tooltip text="Copy message"><button
                  type="button"
                  onclick={() => void copyUserMessage(turn.content)}
                  class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity
                         flex items-center justify-center px-2 py-1 rounded-md
                         border border-primary/25 text-primary/90 font-mono text-[9px]
                         uppercase tracking-wider bg-primary/5 hover:bg-primary/15
                         hover:border-primary/40 cursor-pointer shadow-sm"
                  aria-label="Copy message"
                 
                >
                  <span class="material-symbols-outlined text-[14px] leading-none">content_copy</span>
                </button></Tooltip>
              </div>
            {/if}
            {#if !turn.streaming && !sending && busyAction === null}
              <div class="mt-1.5 flex flex-wrap gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {#each (turn.role === "user"
                  ? [
                      { label: "Edit", icon: "edit", title: "", run: () => editFrom(turn.id) },
                      { label: "Rewind", icon: "undo", title: "Remove this message and everything after", run: () => rewindTo(turn.id) },
                    ]
                  : [
                      ...(turn.id === lastAssistantId
                        ? [{ label: "Rerun", icon: "refresh", title: "", run: () => rerunLast() }]
                        : []),
                      { label: "Trace", icon: "account_tree", title: "", run: async () => { traceTurnId = turn.id; setTraceOpen(true); } },
                      { label: "Fork", icon: "call_split", title: "", run: () => forkFrom(turn.id) },
                    ]) as action (action.label)}
                  <Tooltip text={action.title}><button
                    type="button"
                   
                    onclick={() => void action.run()}
                    class="flex cursor-pointer items-center gap-1 rounded border border-[color:var(--cortex-border)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--cortex-text-muted)] transition-colors hover:bg-[var(--cortex-surface-mid)] hover:text-[var(--cortex-text)]"
                  >
                    <span class="material-symbols-outlined text-[12px] leading-none">{action.icon}</span>
                    {action.label}
                  </button></Tooltip>
                {/each}
              </div>
            {/if}
          </div>
        </div>
        {/if}
      {/each}
    {/if}
  </div>

  {#if error}
    <div
      class="flex-shrink-0 border-t border-error/30 bg-error/10 px-4 py-2 font-mono text-[10px] text-error flex items-center justify-between gap-2"
    >
      <span>{error}</span>
      {#if lastSent}
        <button
          type="button"
          onclick={() => void retry()}
          class="flex-shrink-0 rounded border border-error/40 px-2 py-0.5 text-[9px] uppercase tracking-wider hover:bg-error/20"
        >retry</button>
      {/if}
    </div>
  {/if}

  {#if provider || queuedSkills.length > 0}
    <div class="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-[color:var(--cortex-border)] px-3 pt-2 text-[11px] text-[var(--cortex-text-muted)]">
      {#each queuedSkills as name (name)}
        <Tooltip text="Active for your next message only. Click to remove."><button
          type="button"
          onclick={() => (queuedSkills = queuedSkills.filter((n) => n !== name))}
         
          class="flex cursor-pointer items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary transition-colors hover:bg-primary/20"
        >
          <span class="material-symbols-outlined text-[13px] leading-none">bolt</span>{name}
          <span class="material-symbols-outlined text-[13px] leading-none opacity-70">close</span>
        </button></Tooltip>
      {/each}
      {#each [
        ...(provider ? [{ text: `${provider} · ${model || "default model"}`, icon: "memory", cmd: "/model " }] : []),
        ...(provider && model ? [{ text: modelThinking === false ? "No thinking mode" : `Thinking ${thinkingChoice}`, icon: "psychology", cmd: "/thinking " }] : []),
        ...(pinned.length > 0 ? [{ text: `${pinned.length} skill${pinned.length === 1 ? "" : "s"} pinned`, icon: "bolt", cmd: "/skills " }] : []),
        ...(docs.length > 0 ? [{ text: `${docs.length} document${docs.length === 1 ? "" : "s"}`, icon: "menu_book", cmd: "/docs " }] : []),
      ] as chip (chip.cmd)}
        <button
          type="button"
          onclick={() => { message = chip.cmd; inputEl?.focus(); }}
         
          class="flex cursor-pointer items-center gap-1 transition-colors hover:text-[var(--cortex-text)]"
        >
          <span class="material-symbols-outlined text-[14px] leading-none">{chip.icon}</span>{chip.text}
        </button>
      {/each}
    </div>
  {/if}
  <div
    class="flex flex-shrink-0 items-end gap-2 p-3 {provider || queuedSkills.length > 0 ? '' : 'border-t border-[color:var(--cortex-border)]'}"
  >
    <div class="relative flex flex-1">
    {#if menuOpen}
      <ul
        role="listbox"
        aria-label="Slash commands"
        class="chat-menu-in absolute bottom-full left-0 right-0 z-20 mb-2 max-h-64 overflow-y-auto rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] p-1 font-mono shadow-xl backdrop-blur-md"
      >
        {#each menuItems as item, i (item.key)}
          <li role="option" aria-selected={i === menuIndex}>
            <button
              type="button"
              tabindex="-1"
              onmousedown={(e) => e.preventDefault()}
              onmouseenter={() => (menuRaw = i)}
              onclick={() => void item.run()}
              class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors
                     {i === menuIndex ? 'bg-primary/15 text-[var(--cortex-text)]' : 'text-[var(--cortex-text-muted)]'}"
            >
              <span class="material-symbols-outlined text-[15px] leading-none {i === menuIndex || item.active ? 'text-primary' : ''}">{item.active ? "check_circle" : item.icon}</span>
              <span class="max-w-[60%] flex-shrink-0 truncate text-[var(--cortex-text)]">{item.label}</span>
              {#if item.badge}<span class="material-symbols-outlined flex-shrink-0 text-[15px] leading-none text-primary" aria-label="Thinking model">{item.badge}</span>{/if}
              {#if item.hint}<span class="flex-shrink-0 text-[10px] opacity-60">{item.hint}</span>{/if}
              {#if item.detail}<span class="min-w-0 flex-1 truncate pl-3 text-right text-[10px]">{item.detail}</span>{/if}
            </button>
          </li>
        {/each}
        <li class="px-2 pb-0.5 pt-1 text-[9px] uppercase tracking-wider text-[var(--cortex-text-muted)]/70">
          ↑↓ navigate · Tab complete · Enter run · Esc close
        </li>
      </ul>
    {/if}
    <textarea
      bind:this={inputEl}
      class="min-h-[4.5rem] w-full flex-1 resize-none rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] px-3 py-2 font-mono text-[12px] text-[var(--cortex-text)] placeholder:text-[var(--cortex-text-muted)] focus:border-primary/40 focus:outline-none"
      placeholder="Message… (Enter to send, Shift+Enter for newline, / for commands)"
      rows="3"
      bind:value={message}
      onkeydown={onKeydown}
      disabled={sending}
    ></textarea>
    </div>
    <PromptPickerButton
      types={["task", "snippet"]}
      defaultSaveType="task"
      onSelect={(body) => {
        message = message ? `${message}\n${body}` : body;
        inputEl?.focus();
      }}
    />
    <button
      type="button"
      disabled={!sending && !message.trim()}
      class="flex-shrink-0 cursor-pointer rounded-lg border border-primary/35 bg-primary/10 px-4 py-2 font-mono text-[11px] uppercase text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
      onclick={() => (sending ? chatStore.stop() : void submit())}
    >
      {#if sending}
        <span class="material-symbols-outlined text-sm">stop_circle</span>
      {:else}
        <span class="material-symbols-outlined text-sm">send</span>
      {/if}
    </button>
  </div>
  </div>
  {#if traceOpen}
    <ChatTraceDrawer turn={traceTurn} onClose={() => setTraceOpen(false)} />
  {/if}
  </div>
</div>
