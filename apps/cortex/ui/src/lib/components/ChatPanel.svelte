<script lang="ts">
  import { chatStore, type ChatTurn } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import ChatDocumentFailures from "$lib/components/ChatDocumentFailures.svelte";
  import ChatTodoDock from "$lib/components/ChatTodoDock.svelte";
  import ChatGoalBar from "$lib/components/ChatGoalBar.svelte";
  import ChatHeader from "$lib/components/chat/ChatHeader.svelte";
  import ChatThread from "$lib/components/chat/ChatThread.svelte";
  import ChatComposer from "$lib/components/chat/ChatComposer.svelte";
  import ChatErrorBanner from "$lib/components/chat/ChatErrorBanner.svelte";
  import { agentControlEnabled, toggleAgentControlPatch } from "$lib/proposal-view.js";
  import { chatGoalStore } from "$lib/stores/chat-goal.js";
  import { planHidden } from "$lib/stores/plan-visibility.js";
  import { parsePlanArg, GO_MESSAGE } from "$lib/plan-command.js";
  import { runGoalSlash } from "$lib/chat-goal-commands.js";
  import { inferredFromChecklist, todoToolEnabled, type TodoItem } from "$lib/todo-dock.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import ChatTraceDrawer from "$lib/components/ChatTraceDrawer.svelte";
  import { readStoredFlag, traceLayout, TRACE_OPEN_KEY, writeStoredFlag } from "$lib/chat-trace-layout.js";
  import type { ChatTotals } from "$lib/stores/chat-cost.js";
  import { contextMeterOf } from "$lib/chat-token-usage.js";
  import { compactionRows } from "$lib/chat-compaction.js";
  import { composerAction, lastRunFailed, queueMessage, queuedAfterRun, type QueuedMessage } from "$lib/chat-queue.js";
  import { configAppliedNote, isLiveConfigCommand, slashMenuAllowed, submitRoute } from "$lib/chat-live-config.js";
  import ChatJumpToLatest from "$lib/components/ChatJumpToLatest.svelte";
  import { showJumpToLatest } from "$lib/chat-scroll.js";
  import { replaceDraft, restoreDraft } from "$lib/chat-draft.js";
  import { loadProviders, PROVIDER_FALLBACK, type ProviderOption } from "$lib/providers.js";
  import { fetchModelsForProvider, type UiModelOption } from "$lib/framework-models.js";
  import { fetchExport, transcriptText, type ExportFormat } from "$lib/chat-export.js";
  import { saveTextFile } from "$lib/chat-download.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { documentsOf, pinnedSkills, toggleSkillPatch, type DiscoveredSkill } from "$lib/chat-config-patch.js";
  import { untrack } from "svelte";
  import { selectedTools, terminalChoice } from "$lib/chat-quickbar.js";
  import { EMPTY_CATALOG, loadQuickbarCatalog, type QuickbarCatalog } from "$lib/chat-quickbar-data.js";
  import { quickBarChips } from "$lib/chat-quickbar-chips.js";
  import ChatQuickBar from "$lib/components/ChatQuickBar.svelte";
  import ChatSlashMenu from "$lib/components/ChatSlashMenu.svelte";
  import { closeMenu as closedMenu, createToggleQueue, keepsMenuOpen, NO_CHIP_MENU, pickChip as chipPicked, syncChipMenu, type ChipMenu, type MenuUi } from "$lib/chat-menu.js";
  import { commandMenuItems, pickerItems } from "$lib/chat-menu-items.js";
  import WorkspacePickerDialog from "$lib/components/WorkspacePickerDialog.svelte";
  let providerList = $state<readonly ProviderOption[]>(PROVIDER_FALLBACK);
  $effect(() => {
    void loadProviders().then((list) => { providerList = list; });
  });
  import {
    parseKeepLast,
    parseExportFormat,
    parseSlash,
    resolveCommand,
    type ChatCommand,
  } from "$lib/chat-commands.js";

  interface Props {
    sessionId: string;
    turns: ChatTurn[];
    /** Server-summed session totals (tokens, cost, whether cost is complete). */
    totals?: ChatTotals | undefined;
    /** The conversation's to-do list, shown as a dock beside the input. */
    todo?: TodoItem[];
    /** Documents that failed to load for this session. */
    documentFailures?: { source: string; reason: string }[];
    sending: boolean;
    error: string | null;
  }
  const { sessionId, turns, totals, todo = [], documentFailures = [], sending, error }: Props = $props();

  let message = $state("");
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let thread = $state<ChatThread | null>(null);
  let lastSent = $state("");

  // Session token meter inputs (context, totals, last reply), derived in one pure helper.
  const meter = $derived(contextMeterOf(turns, totals));

  // ── Trace drawer + context meter ──────────────────────────────────────────
  let traceOpen = $state(readStoredFlag(TRACE_OPEN_KEY));
  let winW = $state(1440);
  let rowW = $state(1200);
  let desiredTraceW = $state(448);
  const layout = $derived(traceLayout(winW, rowW, desiredTraceW));
  let traceTurnId = $state<number | null>(null);
  let inspectorInitialTab = $state<"context" | "steps" | "trace">("context");
  const setTraceOpen = (open: boolean, tab?: "context" | "steps" | "trace") => {
    if (tab) inspectorInitialTab = tab;
    traceOpen = open;
    writeStoredFlag(TRACE_OPEN_KEY, open);
  };
  const traceTurn = $derived(
    turns.find((t) => t.id === traceTurnId && t.role === "assistant") ?? [...turns].reverse().find((t) => t.role === "assistant"),
  );
  // Dock notes come from the latest assistant turn's checklist: inferred rows + "not marked done" once it finished.
  const lastChecklistTurn = $derived([...turns].reverse().find((t) => t.role === "assistant"));
  const dockInferred = $derived(inferredFromChecklist(lastChecklistTurn?.checklist));
  const dockTurnComplete = $derived(lastChecklistTurn?.checklist !== undefined && lastChecklistTurn.streaming !== true && !sending);
  let editingSummaryId = $state<number | null>(null);
  let summaryDraft = $state("");
  const saveSummary = (turnId: number) =>
    runAction("Summary", async () => {
      await chatStore.editSummary(turnId, summaryDraft);
      editingSummaryId = null;
    }, "Summary saved · used from your next message");
  const compaction = $derived(compactionRows(turns));
  const STARTERS = ["Summarise what you can do here", "What tools do you have available?", "Plan how you'd research a topic step by step"];

  // The prop getter tracks the parent's whole chat store, so effects reading `sessionId` directly
  // re-ran on every store update (a config PATCH reloads sessions) and wiped the composer. A derived
  // only notifies when the id actually changes.
  const activeSession = $derived(sessionId);

  // A chat opens ready to type in.
  $effect(() => {
    void activeSession;
    queueMicrotask(() => inputEl?.focus());
  });

  // Entrance choreography: turns stagger in while a session is loading, then fire instantly once settled.
  let entering = $state(true);
  $effect(() => {
    void activeSession;
    traceTurnId = null;
    queuedSkills = [];
    editingSummaryId = null;
    message = "";
    entering = true;
    const t = setTimeout(() => (entering = false), 700);
    return () => clearTimeout(t);
  });

  // The thread follows the stream while the user is pinned at the bottom (ChatThread, chat-scroll.ts).
  let atBottom = $state(true);

  // ── Typing during a run ───────────────────────────────────────────────────
  // The composer stays editable while a run goes. Enter during a run parks the text in
  // one pending slot (chat-queue.ts); it is sent when the run ends normally.
  let queued = $state<QueuedMessage>(null);
  let stopRequested = false;
  let wasSending = false;
  const hasText = $derived(message.trim() !== "");
  $effect(() => {
    const now = sending;
    untrack(() => {
      const was = wasSending;
      wasSending = now;
      if (now) {
        stopRequested = false;
        return;
      }
      const action = queuedAfterRun({ wasSending: was, sending: now, queued, aborted: stopRequested || error !== null || lastRunFailed(turns) });
      stopRequested = false;
      if (action !== "send" || queued === null) return;
      const text = queued;
      queued = null;
      void dispatch(text);
    });
  });

  /** Enter (or the send button) while a run is going parks the text; otherwise it is sent now. */
  async function submit() {
    const text = message.trim();
    if (!text) return;
    const typed = parseSlash(text);
    if (submitRoute({ sending, command: typed ? resolveCommand(typed)?.name : undefined }) === "queue") {
      queued = queueMessage(queued, text);
      message = "";
      return;
    }
    if (!typed) message = "";
    await dispatch(text);
    inputEl?.focus();
  }

  /** Run one piece of input: a slash command or a chat message. */
  async function dispatch(text: string) {
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
    await sendWithQueuedSkills(text);
  }

  function sendQueuedNow() {
    const text = queued;
    queued = null;
    if (text !== null) void dispatch(text);
  }

  function clearQueued() {
    queued = null;
    inputEl?.focus();
  }

  /** The composer's send button: stop while a run goes with an empty input, otherwise queue or send. */
  function onSendButton() {
    if (sendAction === "stop") {
      stopRequested = true;
      void chatStore.stop();
      return;
    }
    void submit();
  }

  /**
   * Put `next` in the composer without silently losing a draft. A displaced draft is
   * stashed behind a Restore toast (chat-draft.ts). The quickbar chip command the
   * composer still shows is not treated as a draft.
   */
  function swapDraft(next: string) {
    const r = replaceDraft(message, next, chipMenu.chipCmd);
    message = r.message;
    if (r.stash !== null) offerRestore(r.stash);
  }

  /** Restore toast for a stashed draft. Restore is a swap: the text it displaces gets its own Restore. */
  function offerRestore(stash: string) {
    toast.prompt({
      kind: "info",
      title: "Draft replaced",
      message: "Your draft was set aside. Restore brings it back.",
      durationMs: 8000,
      key: "chat-draft-replaced",
      buttons: [
        {
          label: "Restore",
          variant: "primary",
          onClick: () => {
            const r = restoreDraft(message, stash);
            message = r.message;
            inputEl?.focus();
            // Same key: the new toast replaces this one (the container's close is then a no-op).
            if (r.stash !== null) offerRestore(r.stash);
          },
        },
      ],
    });
  }

  /**
   * Run one message with the queued skills active, then put the session's own skills
   * back. The server rebuilds the agent on a config change, so the skills load for
   * exactly this run; if the restore fails they stay pinned (the status line shows it).
   */
  async function sendWithQueuedSkills(text: string, posture?: "execute" | "plan") {
    const queued = (skillList ?? []).filter((sk) => queuedSkills.includes(sk.name));
    queuedSkills = [];
    if (queued.length === 0) return void (await chatStore.sendMessageStream(text, posture ? { posture } : {}));
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
      await chatStore.sendMessageStream(text, posture ? { posture } : {});
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
  // Send / stop / queue; a config command during a run applies now (chat-live-config.ts).
  const sendAction = $derived(composerAction({ sending, hasText, configCommand: isLiveConfigCommand(slashCmd?.name) }));

  // Session config the pickers read from and patch.
  const session = $derived($chatStore.sessions.find((s) => s.sessionId === sessionId));
  const cfg = $derived(session?.agentConfig ?? {});
  const provider = $derived(typeof cfg.provider === "string" ? cfg.provider : "");
  const model = $derived(typeof cfg.model === "string" ? cfg.model : "");
  const pinned = $derived(pinnedSkills(cfg));
  const docs = $derived(documentsOf(cfg));

  // Quick-bar state: strategy, toolset, shell, workspace, iteration cap. A tool-using turn
  // runs `reactive` when no strategy is stored (server buildChatAgentParams).
  const strategy = $derived(typeof cfg.strategy === "string" && cfg.strategy !== "" ? cfg.strategy : "reactive");
  const workspace = $derived(typeof cfg.workspace === "string" ? cfg.workspace : "");
  const shell = $derived(terminalChoice(cfg));
  const toolNames = $derived(selectedTools(cfg));
  let catalog = $state<QuickbarCatalog>(EMPTY_CATALOG);
  $effect(() => {
    void loadQuickbarCatalog().then((c) => (catalog = c));
  });
  const strategyLabel = $derived(catalog.strategies.find((s) => s.value === strategy)?.label ?? strategy);

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

  /**
   * Apply a config patch; takes effect on the next turn because the server rebuilds the agent.
   * Allowed during a run (chat-live-config.ts): the running turn keeps its settings.
   */
  const applyConfig = (what: string, patch: Record<string, unknown>) => {
    setMenu(closedMenu(menuUi(), "picked"));
    return patchConfig(what, patch);
  };
  async function patchConfig(what: string, patch: Record<string, unknown>) {
    try {
      await chatStore.patchSessionConfig(sessionId, patch);
      toast.success(configAppliedNote(what, sending));
    } catch (e) {
      toast.error("Config failed", e instanceof Error ? e.message : String(e));
    }
  }
  // Multi-value pickers (tools, skills, docs) toggle in place: the menu stays open and the row's
  // check mark is the feedback. Toggles queue (chat-menu.ts createToggleQueue).
  const toggleInPlace = createToggleQueue(
    (patch) => chatStore.patchSessionConfig(sessionId, patch),
    (what, e) => toast.error(`${what} failed`, e instanceof Error ? e.message : String(e)),
  );

  // Quick-bar chips open their picker; the draft they replace comes back when the picker closes.
  let chipMenu = $state<ChipMenu>(NO_CHIP_MENU);
  let workspaceDialog = $state(false);
  const menuUi = (): MenuUi => ({ chip: chipMenu, message, dismissed: menuDismissed });
  const setMenu = (u: MenuUi) => { chipMenu = u.chip; message = u.message; menuDismissed = u.dismissed; };
  function pickChip(cmd: string) {
    setMenu(chipPicked(menuUi(), cmd, menuOpen));
    menuRaw = 0;
    inputEl?.focus();
  }
  /** Escape, click outside, or Enter on a multi row: close and give the composer back. */
  function closeMenu() {
    setMenu(closedMenu(menuUi(), "dismiss"));
    inputEl?.focus();
    // A click outside blurs the composer after this runs; take focus back unless the click focused something else.
    setTimeout(() => {
      if (document.activeElement === document.body || document.activeElement === null) inputEl?.focus();
    }, 0);
  }
  async function setProvider(next: string) {
    const r = await fetchModelsForProvider(next).catch(() => ({ options: [] as UiModelOption[], default: undefined }));
    const nextModel = r.default ?? r.options[0]?.value;
    await applyConfig(`Provider ${next}${nextModel ? `, model ${nextModel}` : ""}`, { provider: next, ...(nextModel ? { model: nextModel } : {}) });
    if (!nextModel) toast.info("Pick a model", "Use /model to choose one for this provider");
  }

  const thinkingChoice = $derived(cfg.thinking === true ? "on" : cfg.thinking === false ? "off" : "auto");
  /** true = the current model has a thinking mode, false = it does not, null = not known. */
  const modelThinking = $derived(models.find((m) => m.value === model)?.thinking ?? null);

  // Menu rows are built in chat-menu-items.ts. `cfg` is a getter: rows read it again when they run.
  const pickItems = $derived(
    pickerItems({
      slash,
      command: slashCmd,
      get cfg() { return cfg; },
      provider, model, models, thinkingChoice, modelThinking, strategy, workspace, shell, toolNames, catalog, pinned, docs,
      providers: providerList.map((x) => x.id),
      skills: skillList,
      apply: applyConfig,
      setProvider,
      toggle: toggleInPlace,
      swapDraft,
      browseWorkspace: () => {
        setMenu(closedMenu(menuUi(), "picked"));
        workspaceDialog = true;
      },
      info: (title, detail) => void toast.info(title, detail),
    }),
  );
  const commandItems = $derived(
    commandMenuItems({
      slash,
      skills: skillList,
      queuedSkills,
      pinned,
      runCommand: (cmd) => runSlash(cmd, ""),
      completeCommand,
      toggleQueuedSkill: toggleQueued,
    }),
  );
  const menuItems = $derived(slash?.hasArg ? pickItems : commandItems);
  let menuRaw = $state(0);
  const menuIndex = $derived(Math.min(menuRaw, Math.max(0, menuItems.length - 1)));
  let menuDismissed = $state(false);
  const menuOpen = $derived(
    menuItems.length > 0 && !menuDismissed && slashMenuAllowed({ sending, command: slashCmd?.name, hasArg: slash?.hasArg === true }),
  );
  // Only what the user typed resets the menu; async list loads (skills, models) must not
  // re-open a menu they dismissed or move their highlight.
  $effect(() => {
    void slash?.query;
    void slash?.arg;
    untrack(() => {
      menuRaw = 0;
      menuDismissed = false;
      chipMenu = syncChipMenu(chipMenu, message);
    });
  });

  /** Put the command in the input; commands that take an argument keep the caret waiting for it. */
  function completeCommand(cmd: ChatCommand) {
    swapDraft(cmd.name === "rename" || cmd.picker || cmd.arg?.startsWith("<") || cmd.arg?.startsWith('"') ? `/${cmd.name} ` : `/${cmd.name}`);
    inputEl?.focus();
  }

  async function runSlash(cmd: ChatCommand, arg: string) {
    if (cmd.needsTurns && turns.length === 0) {
      toast.error(`Nothing to ${cmd.name} yet`);
      return;
    }
    if ((cmd.name === "rename" || cmd.picker || cmd.name === "goal" || cmd.name === "loop" || cmd.name === "schedule") && arg === "") {
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
      case "export": {
        const format = parseExportFormat(arg);
        if (!format) return void toast.error("Unknown format", "Use /export md, json or jsonl");
        return void (await exportConversation(format));
      }
      case "help": swapDraft("/"); inputEl?.focus(); return;
      case "model":
      case "provider":
      case "skills":
      case "thinking":
      case "docs":
      case "strategy":
      case "tools":
      case "terminal":
      case "workspace":
      case "iterations":
      case "approvals":
        return; // second-level picks are executed from the menu rows
      case "goal":
      case "loop":
      case "schedule":
        return void (await runGoalSlash(cmd.name, arg, sessionId, chatGoalStore, {
          ok: (t, d) => toast.success(t, d),
          info: (t, d) => toast.info(t, d),
          err: (t, d) => toast.error(t, d),
        }));
      case "agent": {
        const want = arg.toLowerCase() === "on" ? true : arg.toLowerCase() === "off" ? false : !agentControlEnabled(cfg);
        if (want === agentControlEnabled(cfg)) return void toast.info(`Agent control already ${want ? "on" : "off"}`);
        return void (await applyConfig(want ? "Agent may propose changes (you approve each)" : "Agent control off", want ? toggleAgentControlPatch(cfg) : { agentControl: false }));
      }
      case "plan": {
        const plan = parsePlanArg(arg);
        if (plan.kind === "hide") {
          planHidden.set(true);
          return void toast.info("Plan card and to-do hidden", "/plan show brings them back");
        }
        planHidden.set(false);
        if (plan.kind === "show") {
          return void toast.info(todo.length > 0 ? "Plan shown" : "No plan yet", todo.length > 0 ? undefined : "Use /plan <task> to have the agent plan it");
        }
        // The harness restricts the turn to planning; the to-do tool must be on so the plan can be recorded.
        if (!todoToolEnabled(cfg)) {
          const mt = typeof cfg.metaTools === "object" && cfg.metaTools !== null ? cfg.metaTools : {};
          await chatStore.patchSessionConfig(sessionId, { metaTools: { ...mt, todo: true } });
        }
        message = "";
        lastSent = plan.task;
        return void (await sendWithQueuedSkills(plan.task, "plan"));
      }
      case "go":
        lastSent = GO_MESSAGE;
        return void (await sendWithQueuedSkills(GO_MESSAGE, "execute"));
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
        const via = e.key === "Tab" ? "tab" : "enter";
        // Multi rows: Tab toggles in place (keyboard multi-select), Enter toggles and closes.
        if (via === "tab" && !item.multi) item.complete?.();
        else void item.run();
        if (item.multi && !keepsMenuOpen(item, via)) closeMenu();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
        return;
      }
    }
    if (e.key === "Escape" && queued !== null) {
      e.preventDefault();
      clearQueued();
      return;
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
      const ok = await confirmAction({
        title: "Rewind here?",
        message: "This message and everything after it is removed from the chat.",
        confirmLabel: "Rewind",
      });
      if (!ok) return;
      await chatStore.rewind(turnId);
    });

  /** Edit & resend: rewind to the message, drop its text back into the input (a draft in the input is set aside, not lost). */
  const editFrom = (turnId: number) =>
    runAction("Edit", async () => {
      const text = await chatStore.rewind(turnId);
      swapDraft(text);
      inputEl?.focus();
    });

  const rerunLast = () => runAction("Rerun", () => chatStore.rerun());
  const forkFrom = (turnId?: number) => runAction("Fork", async () => void (await chatStore.fork(turnId)), "Forked into a new chat");
  const clearChat = () =>
    runAction("Clear", async () => {
      const ok = await confirmAction({
        title: "Clear context?",
        message: "Messages are deleted. The session and its config stay.",
        confirmLabel: "Clear",
      });
      if (!ok) return;
      await chatStore.clearContext();
    });
  const compactChat = (keepLast?: number) =>
    runAction("Compact", async () => {
      const compacted = await chatStore.compact(keepLast);
      toast.success(compacted > 0 ? "Context compacted" : "Nothing to compact yet");
    });

  async function copyText(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied", `${what} copied to clipboard`);
    } catch {
      toast.error("Copy failed");
    }
  }
  const copyUserMessage = (content: string) => copyText(content, "Message");
  const copyAllConversation = () => copyText(transcriptText(turns), "Conversation");

  async function exportConversation(format: ExportFormat) {
    const out = await fetchExport(CORTEX_SERVER_URL, sessionId, format);
    if (!out.ok) return void toast.error("Export failed");
    saveTextFile(out.text, out.filename, out.mime);
    toast.success("Conversation exported", out.filename);
  }

  const strategyName = (id: string) => catalog.strategies.find((s) => s.value === id)?.label ?? id;
</script>

<svelte:window bind:innerWidth={winW} />
<div class="relative z-10 flex h-full min-h-0 w-full flex-col text-[var(--cortex-text)]">
  <ChatHeader
    title={session?.name ?? "Chat"}
    {provider}
    {model}
    {meter}
    empty={turns.length === 0}
    {traceOpen}
    onExport={exportConversation}
    onOpenContext={() => setTraceOpen(true, "context")}
    onToggleTrace={() => setTraceOpen(!traceOpen, traceOpen ? undefined : "steps")}
  />

  <div class="relative flex min-h-0 flex-1" bind:clientWidth={rowW}>
  <div class="flex min-h-0 min-w-0 md:min-w-[420px] flex-1 flex-col">
  <div class="chat-busy-bar h-px flex-shrink-0 {busyAction ? 'opacity-100' : 'opacity-0'}" aria-hidden="true"></div>

  <ChatThread
    bind:this={thread}
    bind:atBottom
    bind:editingSummaryId
    bind:summaryDraft
    {sessionId}
    {turns}
    {sending}
    {compaction}
    busy={busyAction !== null}
    {entering}
    {provider}
    {model}
    planHidden={$planHidden}
    {lastAssistantId}
    starters={STARTERS}
    toolCount={toolNames.length}
    onStarter={(starter) => { swapDraft(starter); inputEl?.focus(); }}
    onSaveSummary={saveSummary}
    onCopy={copyUserMessage}
    strategyLabel={strategyName}
    onEdit={editFrom}
    onRewind={rewindTo}
    onRerun={rerunLast}
    onTrace={(id) => { traceTurnId = id; setTraceOpen(true, "steps"); }}
    onFork={forkFrom}
  />

  <!-- The slash menu anchors above the composer so its quick-bar chips stay clickable while a picker is open. -->
  <div class="relative flex flex-shrink-0 flex-col px-6 pb-5">
  {#if error}<ChatErrorBanner {error} onRetry={lastSent ? () => void retry() : undefined} />{/if}
  {#if showJumpToLatest({ atBottom, turnCount: turns.length, menuOpen })}<ChatJumpToLatest onJump={() => thread?.jumpToLatest()} live={sending} />{/if}
  {#if menuOpen}
    <ChatSlashMenu items={menuItems} selected={menuIndex} onHover={(i) => (menuRaw = i)} onDismiss={closeMenu} />
  {/if}
  {#if workspaceDialog}
    <WorkspacePickerDialog
      current={workspace}
      onClose={() => { workspaceDialog = false; inputEl?.focus(); }}
      onPick={(p) => {
        workspaceDialog = false;
        // Not applyConfig: the composer already holds the restored draft, which must survive the pick.
        void patchConfig(p ? `Workspace ${p}` : "Workspace cleared", { workspace: p });
        inputEl?.focus();
      }}
    />
  {/if}
  <div class="mx-auto w-full max-w-[808px]">
    <ChatDocumentFailures failures={documentFailures} />
    <ChatGoalBar {sessionId} turnCount={turns.length} />
    {#if !$planHidden}<ChatTodoDock items={todo} busy={sending} inferred={dockInferred} turnComplete={dockTurnComplete} enabled={todoToolEnabled(cfg)} onChange={(next) => void chatStore.setTodo(next)} />{/if}
  </div>
  <ChatComposer
    bind:message
    bind:inputEl
    {sending}
    planning={$chatStore.planning}
    {queued}
    {sendAction}
    {hasText}
    {onKeydown}
    {onSendButton}
    onSendQueuedNow={sendQueuedNow}
    onClearQueued={clearQueued}
  >
    {#snippet quickBar()}
      {#if provider || queuedSkills.length > 0}
        <ChatQuickBar
          {queuedSkills}
          chips={quickBarChips(cfg, { provider, model, modelThinking, thinkingChoice, strategyLabel, pinnedSkillCount: pinned.length, documentCount: docs.length, shellPresets: catalog.shellPresets })}
          onRemoveSkill={(name) => (queuedSkills = queuedSkills.filter((n) => n !== name))}
          onPick={pickChip}
        />
      {/if}
    {/snippet}
  </ChatComposer>
  </div>
  </div>
  {#if traceOpen}
    {#if layout.mode === "overlay"}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="absolute inset-0 z-10 bg-black/40 backdrop-blur-[1px]" onclick={() => setTraceOpen(false)} aria-hidden="true"></div>
    {/if}
    <ChatTraceDrawer
      turn={traceTurn}
      session={session}
      totals={totals}
      turns={turns}
      sessionId={sessionId}
      overlay={layout.mode === "overlay"}
      width={layout.width}
      initialTab={inspectorInitialTab}
      onSelectTurn={(id) => { traceTurnId = id; inspectorInitialTab = "steps"; }}
      onWidth={(w) => (desiredTraceW = w)}
      onClose={() => setTraceOpen(false)}
    />
  {/if}
  </div>
</div>
