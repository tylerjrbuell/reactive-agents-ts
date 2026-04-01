import { e as escape_html, s as store_get, a as attr, b as ensure_array_like, c as attr_class, u as unsubscribe_stores, d as stringify, f as setContext } from "../../chunks/index2.js";
import { c as createWsClient, o as onDestroy, p as page } from "../../chunks/ws-client.js";
import "@sveltejs/kit/internal";
import "../../chunks/exports.js";
import "../../chunks/utils.js";
import { d as derived, w as writable } from "../../chunks/index.js";
import "@sveltejs/kit/internal/server";
import "../../chunks/root.js";
import "../../chunks/state.svelte.js";
import "clsx";
import { C as CORTEX_SERVER_URL } from "../../chunks/constants.js";
function Toast($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { agentId } = $$props;
    $$renderer2.push(`<div class="fixed bottom-10 right-6 z-[60] animate-slide-right bg-surface-container-high border border-primary/30 p-4 rounded-lg shadow-neural-strong flex flex-col gap-1 min-w-[280px] max-w-[320px] relative overflow-hidden"><div class="absolute top-0 left-0 w-1 h-full bg-primary rounded-l-lg"></div> <div class="flex justify-between items-center pl-2"><div class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span> <span class="font-mono font-bold text-xs text-primary uppercase tracking-widest">${escape_html(agentId)}</span></div> <button type="button" class="material-symbols-outlined text-sm text-outline/60 hover:text-outline transition-colors cursor-pointer bg-transparent border-0 p-0" aria-label="Dismiss">close</button></div> <p class="font-body text-sm text-on-surface-variant pl-2">connected to Cortex</p></div>`);
  });
}
const registered = writable([]);
const commandPaletteQuery = writable("");
const commandPaletteOpen = writable(false);
const commandPaletteFiltered = derived([registered, commandPaletteQuery], ([$commands, $q]) => {
  if (!$q.trim()) return $commands.slice(0, 12);
  const q = $q.toLowerCase();
  return $commands.filter(
    (c) => c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q) || c.keywords?.some((k) => k.toLowerCase().includes(q))
  ).slice(0, 12);
});
function CommandPalette($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    var $$store_subs;
    let selectedIndex = 0;
    if (store_get($$store_subs ??= {}, "$commandPaletteOpen", commandPaletteOpen)) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh] px-4" role="presentation"><div class="w-full max-w-lg rounded-xl border border-outline-variant/20 bg-surface-container shadow-neural-strong p-4" role="dialog" aria-modal="true" aria-label="Command palette"><div class="flex items-center gap-2 border-b border-outline-variant/10 pb-3 mb-3"><span class="material-symbols-outlined text-outline text-sm">search</span> <input class="flex-1 bg-transparent font-mono text-sm text-on-surface outline-none placeholder:text-on-surface-variant" placeholder="Search commands…"${attr("value", store_get($$store_subs ??= {}, "$commandPaletteQuery", commandPaletteQuery))} autocomplete="off"${attr("spellcheck", false)}/></div> <div class="max-h-72 overflow-y-auto space-y-1" role="listbox">`);
      if (store_get($$store_subs ??= {}, "$commandPaletteFiltered", commandPaletteFiltered).length === 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<p class="font-mono text-xs text-on-surface-variant px-2 py-4 text-center">No matches</p>`);
      } else {
        $$renderer2.push("<!--[-1-->");
        $$renderer2.push(`<!--[-->`);
        const each_array = ensure_array_like(store_get($$store_subs ??= {}, "$commandPaletteFiltered", commandPaletteFiltered));
        for (let i = 0, $$length = each_array.length; i < $$length; i++) {
          let cmd = each_array[i];
          $$renderer2.push(`<button type="button" role="option"${attr("aria-selected", i === selectedIndex)}${attr_class(`w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-colors ${stringify(i === selectedIndex ? "bg-primary/15 text-primary border border-primary/30" : "text-on-surface-variant hover:bg-surface-container-high border border-transparent")}`)}><span class="text-on-surface">${escape_html(cmd.label)}</span> `);
          if (cmd.description) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<span class="block text-[10px] text-on-surface-variant mt-0.5">${escape_html(cmd.description)}</span>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--></button>`);
        }
        $$renderer2.push(`<!--]-->`);
      }
      $$renderer2.push(`<!--]--></div> <p class="mt-3 font-mono text-[10px] text-on-surface-variant text-center">↑↓ navigate · ↵ run · esc close · ⌘K toggle</p></div></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
    if ($$store_subs) unsubscribe_stores($$store_subs);
  });
}
function entropyToState(entropy, isRunning) {
  if (!isRunning) return "idle";
  if (entropy < 0.5) return "running";
  if (entropy < 0.75) return "exploring";
  return "stressed";
}
function runToSeedNode(run, now) {
  const state = run.status === "live" ? "running" : run.status === "failed" ? "error" : "completed";
  return {
    agentId: run.agentId,
    runId: run.runId,
    name: run.agentId,
    state,
    entropy: 0,
    iteration: run.iterationCount,
    maxIterations: 0,
    tokensUsed: run.tokensUsed,
    cost: run.cost,
    connectedAt: 0,
    lastEventAt: now
  };
}
function createAgentStore(options) {
  const fetchFn = globalThis.fetch.bind(globalThis);
  const nowFn = (() => Date.now());
  const state = writable({ agents: /* @__PURE__ */ new Map(), loading: false });
  const agents = derived(state, ($s) => Array.from($s.agents.values()));
  async function loadAgents() {
    state.update((s) => ({ ...s, loading: true }));
    try {
      const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs`);
      if (!res.ok) throw new Error(String(res.status));
      const runs = await res.json();
      const trimmed = runs.slice(0, 20);
      const t = nowFn();
      state.update((s) => {
        const prev = s.agents;
        const next = /* @__PURE__ */ new Map();
        for (const run of trimmed) {
          const seeded = runToSeedNode(run, t);
          const existing = prev.get(run.runId);
          next.set(
            run.runId,
            existing ? {
              ...seeded,
              // Preserve richer live-derived fields when present.
              entropy: existing.entropy,
              iteration: Math.max(existing.iteration, seeded.iteration),
              maxIterations: existing.maxIterations,
              // Never regress visible totals due to delayed/stale summary rows.
              tokensUsed: Math.max(existing.tokensUsed, seeded.tokensUsed),
              cost: Math.max(existing.cost, seeded.cost),
              connectedAt: existing.connectedAt,
              lastEventAt: Math.max(existing.lastEventAt, seeded.lastEventAt)
            } : seeded
          );
        }
        return { agents: next, loading: false };
      });
    } catch {
      state.update((s) => ({ ...s, loading: false }));
    }
  }
  function handleLiveMessage(msg) {
    state.update((s) => {
      const map = new Map(s.agents);
      const existing = map.get(msg.runId);
      const patch = { lastEventAt: nowFn() };
      switch (msg.type) {
        case "AgentConnected":
          patch.state = "running";
          patch.connectedAt = nowFn();
          break;
        case "EntropyScored": {
          const entropy = typeof msg.payload.composite === "number" ? msg.payload.composite : 0;
          const isRunning = existing?.state !== "completed" && existing?.state !== "error";
          patch.entropy = entropy;
          patch.state = entropyToState(entropy, Boolean(isRunning));
          break;
        }
        case "LLMRequestCompleted": {
          const tokens = typeof msg.payload.tokensUsed === "number" ? msg.payload.tokensUsed : typeof msg.payload.tokensUsed?.total === "number" ? msg.payload.tokensUsed.total : 0;
          const est = typeof msg.payload.estimatedCost === "number" ? msg.payload.estimatedCost : 0;
          patch.tokensUsed = (existing?.tokensUsed ?? 0) + tokens;
          patch.cost = (existing?.cost ?? 0) + est;
          break;
        }
        case "ReasoningStepCompleted": {
          const iter = typeof msg.payload.iteration === "number" ? msg.payload.iteration : typeof msg.payload.totalSteps === "number" ? msg.payload.totalSteps : existing?.iteration ?? 0;
          patch.iteration = iter;
          break;
        }
        case "ReasoningIterationProgress": {
          const iter = typeof msg.payload.iteration === "number" ? msg.payload.iteration : existing?.iteration ?? 0;
          const max = typeof msg.payload.maxIterations === "number" ? msg.payload.maxIterations : existing?.maxIterations ?? 0;
          patch.iteration = iter;
          patch.maxIterations = max;
          if (existing?.state !== "completed" && existing?.state !== "error") {
            patch.state = entropyToState(existing?.entropy ?? 0, true);
          }
          break;
        }
        case "FinalAnswerProduced":
          patch.state = "running";
          break;
        case "AgentCompleted":
          patch.state = msg.payload.success === true ? "completed" : "error";
          if (typeof msg.payload.totalTokens === "number") {
            patch.tokensUsed = Math.max(existing?.tokensUsed ?? 0, msg.payload.totalTokens);
          }
          patch.completedAt = nowFn();
          break;
        case "TaskFailed":
          patch.state = "error";
          patch.completedAt = nowFn();
          break;
      }
      const updated = {
        agentId: msg.agentId,
        runId: msg.runId,
        name: existing?.name ?? msg.agentId,
        state: existing?.state ?? "running",
        entropy: existing?.entropy ?? 0,
        iteration: existing?.iteration ?? 0,
        maxIterations: existing?.maxIterations ?? 0,
        tokensUsed: existing?.tokensUsed ?? 0,
        cost: existing?.cost ?? 0,
        connectedAt: existing?.connectedAt ?? nowFn(),
        lastEventAt: nowFn(),
        ...patch
      };
      map.set(msg.runId, updated);
      return { ...s, agents: map };
    });
  }
  void loadAgents();
  return {
    subscribe: agents.subscribe,
    state,
    handleLiveMessage,
    refresh: loadAgents,
    /** No-op placeholder for layout teardown symmetry; unsubscribe WS in `onMount` cleanup. */
    destroy: () => {
    }
  };
}
async function resolveRunIdFromRunsApi(fetchFn, agentId, sinceMs) {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs`);
    if (!res.ok) continue;
    const runs = await res.json();
    const hit = runs.filter((x) => x.agentId === agentId && x.startedAt >= sinceMs - 1e4).sort((a, b) => b.startedAt - a.startedAt)[0];
    if (hit) return hit.runId;
  }
  return null;
}
function createStageStore(options) {
  const fetchFn = globalThis.fetch.bind(globalThis);
  let navigate = options?.navigate;
  const state = writable({
    submitting: false,
    lastSubmitError: null,
    firstConnectHandled: false
  });
  function setNavigate(fn) {
    navigate = fn;
  }
  function handleAgentConnected(agent, totalAgentCount) {
    state.update((s) => {
      if (!s.firstConnectHandled && totalAgentCount === 1) {
        void navigate?.(`/run/${agent.runId}`);
        return { ...s, firstConnectHandled: true };
      }
      return s;
    });
  }
  async function submitPrompt(prompt) {
    state.update((s) => ({ ...s, submitting: true, lastSubmitError: null }));
    const sinceMs = Date.now();
    try {
      const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          provider: "anthropic",
          tools: ["web-search"]
        })
      });
      if (res.status === 501) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Run submission is not available yet (server returned 501).");
      }
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      let runId = data.runId;
      if (!runId && data.agentId) {
        runId = await resolveRunIdFromRunsApi(fetchFn, data.agentId, sinceMs) ?? void 0;
      }
      if (!runId) {
        throw new Error(
          "Run started but run id was not available yet. Check Stage — the agent may still be connecting."
        );
      }
      void navigate?.(`/run/${runId}`);
    } catch (e) {
      state.update((s) => ({ ...s, lastSubmitError: String(e) }));
    } finally {
      state.update((s) => ({ ...s, submitting: false }));
    }
  }
  return {
    subscribe: state.subscribe,
    setNavigate,
    handleAgentConnected,
    submitPrompt
  };
}
function _layout($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    var $$store_subs;
    let { children } = $$props;
    const agentStore = createAgentStore();
    const stageStore = createStageStore();
    setContext("agentStore", agentStore);
    setContext("stageStore", stageStore);
    const toasts = writable([]);
    const wsClient = createWsClient("/ws/live/cortex-broadcast");
    const navItems = [
      { label: "Stage", href: "/", icon: "hub" },
      { label: "Run", href: "/run", icon: "analytics" },
      { label: "Workshop", href: "/workshop", icon: "build" }
    ];
    onDestroy(() => {
      wsClient.close();
      agentStore.destroy();
    });
    $$renderer2.push(`<div class="h-screen w-screen flex flex-col overflow-hidden bg-background text-on-surface"><header class="bg-[#17181c] flex justify-between items-center w-full px-6 h-12 border-b border-white/5 shadow-neural z-50 flex-shrink-0"><a href="/" class="flex items-center gap-2.5 no-underline group" aria-label="Cortex home"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="22" height="22" class="flex-shrink-0" aria-hidden="true"><defs><linearGradient id="lh-ed" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.8"></stop><stop offset="100%" stop-color="#06b6d4" stop-opacity="0.35"></stop></linearGradient><linearGradient id="lh-ed2" x1="100%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#06b6d4" stop-opacity="0.6"></stop><stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.25"></stop></linearGradient><filter id="lh-gN" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.2" result="b"></feGaussianBlur><feMerge><feMergeNode in="b"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter></defs><circle cx="24" cy="24" r="18" fill="#8b5cf6" opacity="0.05"></circle><line x1="14" y1="6" x2="34" y2="6" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"></line><line x1="14" y1="6" x2="6" y2="20" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"></line><line x1="34" y1="6" x2="42" y2="20" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"></line><line x1="6" y1="20" x2="6" y2="34" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"></line><line x1="42" y1="20" x2="42" y2="34" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"></line><line x1="6" y1="34" x2="18" y2="44" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"></line><line x1="42" y1="34" x2="30" y2="44" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"></line><line x1="18" y1="44" x2="30" y2="44" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"></line><line x1="14" y1="6" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"></line><line x1="34" y1="6" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"></line><line x1="6" y1="20" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"></line><line x1="42" y1="20" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"></line><line x1="6" y1="34" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"></line><line x1="42" y1="34" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"></line><line x1="18" y1="44" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"></line><line x1="30" y1="44" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"></line><circle cx="14" cy="6" r="2.5" fill="#8b5cf6" filter="url(#lh-gN)"></circle><circle cx="34" cy="6" r="2.5" fill="#06b6d4" filter="url(#lh-gN)"></circle><circle cx="6" cy="20" r="2" fill="#a78bfa" filter="url(#lh-gN)"></circle><circle cx="42" cy="20" r="2" fill="#c4b5fd" filter="url(#lh-gN)"></circle><circle cx="6" cy="34" r="2" fill="#06b6d4" filter="url(#lh-gN)"></circle><circle cx="42" cy="34" r="2" fill="#8b5cf6" filter="url(#lh-gN)"></circle><circle cx="18" cy="44" r="2.5" fill="#a78bfa" filter="url(#lh-gN)"></circle><circle cx="30" cy="44" r="2.5" fill="#06b6d4" filter="url(#lh-gN)"></circle><circle cx="24" cy="24" r="4.8" fill="#8b5cf6" opacity="0.9"></circle><circle cx="24" cy="24" r="7.5" fill="none" stroke="#06b6d4" stroke-width="0.5" opacity="0.2"></circle></svg> <span class="text-base font-semibold tracking-tight ra-gradient-text uppercase select-none">Cortex</span></a> <nav class="hidden md:flex items-center gap-6"><!--[-->`);
    const each_array = ensure_array_like(navItems);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let item = each_array[$$index];
      const active = item.href === "/" ? store_get($$store_subs ??= {}, "$page", page).url.pathname === "/" : store_get($$store_subs ??= {}, "$page", page).url.pathname.startsWith(item.href);
      $$renderer2.push(`<a${attr("href", item.href)}${attr_class(`flex items-center gap-1.5 text-sm font-medium transition-colors duration-200 no-underline ${stringify(active ? "text-primary border-b-2 border-primary pb-0.5" : "text-outline hover:text-primary")}`)}>${escape_html(item.label)}</a>`);
    }
    $$renderer2.push(`<!--]--></nav> <div class="flex items-center gap-3"><button type="button" class="hidden md:flex items-center gap-2 px-3 py-1.5 bg-surface-container-lowest rounded border border-outline-variant/10 text-[10px] font-mono text-outline uppercase tracking-widest hover:border-outline-variant/30 transition-colors cursor-pointer border-solid"><span class="material-symbols-outlined text-sm text-secondary">terminal</span> ⌘K</button> <span class="material-symbols-outlined text-outline p-1" aria-hidden="true">settings</span></div></header> <main class="flex-1 overflow-hidden min-h-0">`);
    children($$renderer2);
    $$renderer2.push(`<!----></main></div> `);
    CommandPalette($$renderer2);
    $$renderer2.push(`<!----> <!--[-->`);
    const each_array_1 = ensure_array_like(store_get($$store_subs ??= {}, "$toasts", toasts));
    for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
      let toast = each_array_1[$$index_1];
      Toast($$renderer2, {
        agentId: toast.agentId
      });
    }
    $$renderer2.push(`<!--]-->`);
    if ($$store_subs) unsubscribe_stores($$store_subs);
  });
}
export {
  _layout as default
};
