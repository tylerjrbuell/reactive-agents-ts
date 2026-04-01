import { c as attr_class, d as stringify, h as attr_style, e as escape_html, b as ensure_array_like, i as derived, a as attr, j as bind_props, g as getContext, k as head, s as store_get, u as unsubscribe_stores } from "../../chunks/index2.js";
import { A as AGENT_STATE_COLORS } from "../../chunks/constants.js";
import "@sveltejs/kit/internal";
import "../../chunks/exports.js";
import "../../chunks/utils.js";
import "@sveltejs/kit/internal/server";
import "../../chunks/root.js";
import "../../chunks/state.svelte.js";
import "clsx";
function AgentCard($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { agent } = $$props;
    const stateColor = derived(() => AGENT_STATE_COLORS[agent.state] ?? AGENT_STATE_COLORS.idle);
    const isRunning = derived(() => agent.state === "running" || agent.state === "exploring" || agent.state === "stressed");
    const isCompleted = derived(() => agent.state === "completed");
    const isError = derived(() => agent.state === "error");
    const isIdle = derived(() => agent.state === "idle");
    const stateIcon = {
      running: "science",
      exploring: "psychology",
      stressed: "warning",
      completed: "check_circle",
      error: "error",
      idle: "schedule"
    };
    const stateLabel = {
      running: "RUNNING",
      exploring: "EXPLORING",
      stressed: "STRESSED",
      completed: "SETTLED",
      error: "HALTED",
      idle: "IDLE"
    };
    const stateLabelClass = {
      running: "text-primary",
      exploring: "text-tertiary",
      stressed: "text-error",
      completed: "text-secondary",
      error: "text-error",
      idle: "text-outline"
    };
    function barHeightPct(i) {
      return 40 + i * 7 % 36;
    }
    $$renderer2.push(`<div${attr_class(`relative p-6 rounded-xl flex flex-col items-center justify-center min-h-[280px] cursor-pointer transition-all duration-300 group outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${stringify(isRunning() ? "gradient-border-glow shadow-neural" : "")} ${stringify(isCompleted() ? "bg-surface-container-low border border-secondary/10 hover:border-secondary/30" : "")} ${stringify(isError() ? "bg-surface-container-low border border-error/10" : "")} ${stringify(isIdle() ? "bg-surface-container-lowest border border-outline-variant/5 opacity-60" : "")} ${stringify(!isRunning() && !isCompleted() && !isError() && !isIdle() ? "bg-surface-container-low border border-outline-variant/10" : "")} hover:scale-[1.02]`)}${attr_style(`--ring-color: ${stringify(stateColor().ring)};`)} role="button" tabindex="0">`);
    if (isRunning()) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="relative w-24 h-24 mb-6 flex items-center justify-center"><div class="sonar-ring w-full h-full absolute"></div> <div class="sonar-ring w-full h-full absolute"></div> <div class="sonar-ring w-full h-full absolute"></div> <div${attr_class(`w-12 h-12 rounded-full flex items-center justify-center border relative z-10 ${stringify(agent.state === "stressed" ? "bg-error/20 border-error" : "")} ${stringify(agent.state === "exploring" ? "bg-tertiary/20 border-tertiary" : "")} ${stringify(agent.state === "running" ? "bg-primary/20 border-primary" : "")}`)}${attr_style(`box-shadow: 0 0 20px ${stringify(stateColor().glow)};`)}><span${attr_class(`material-symbols-outlined ${stringify(agent.state === "stressed" ? "text-error" : "")} ${stringify(agent.state === "exploring" ? "text-tertiary" : "")} ${stringify(agent.state === "running" ? "text-primary" : "")}`)} style="font-variation-settings: 'FILL' 1;">${escape_html(stateIcon[agent.state] ?? "science")}</span></div></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div${attr_class(`w-12 h-12 rounded-full flex items-center justify-center border mb-6 transition-all duration-300 ${stringify(isCompleted() ? "bg-secondary/10 border-secondary/40 group-hover:shadow-glow-secondary" : "")} ${stringify(isError() ? "bg-error/10 border-error/40" : "")} ${stringify(isIdle() ? "bg-surface-container-highest border-outline-variant/20" : "")}`)}><span${attr_class(`material-symbols-outlined ${stringify(isCompleted() ? "text-secondary" : "")} ${stringify(isError() ? "text-error" : "")} ${stringify(isIdle() ? "text-outline" : "")}`)}>${escape_html(stateIcon[agent.state] ?? "hub")}</span></div>`);
    }
    $$renderer2.push(`<!--]--> <div class="text-center"><span${attr_class(`font-mono text-[10px] uppercase tracking-[0.2em] block mb-1 ${stringify(stateLabelClass[agent.state] ?? "text-outline")}`)}>${escape_html(stateLabel[agent.state] ?? agent.state.toUpperCase())}</span> <h3${attr_class(`font-headline text-sm font-bold ${stringify(isIdle() ? "text-on-surface-variant" : "text-on-surface")}`)}>${escape_html(agent.name)}</h3> `);
    if (isRunning() && agent.maxIterations > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="mt-4 flex gap-1 justify-center items-end h-5"><!--[-->`);
      const each_array = ensure_array_like(Array(Math.min(agent.iteration, 8)));
      for (let i = 0, $$length = each_array.length; i < $$length; i++) {
        each_array[i];
        $$renderer2.push(`<div${attr_class(`w-1 rounded-full transition-all ${stringify(agent.state === "running" ? "bg-primary" : "")} ${stringify(agent.state === "exploring" ? "bg-tertiary" : "")} ${stringify(agent.state === "stressed" ? "bg-error" : "")}`)}${attr_style(`height: ${stringify(barHeightPct(i))}%; opacity: ${stringify(0.4 + i / 8 * 0.6)};`)}></div>`);
      }
      $$renderer2.push(`<!--]--></div> <div class="mt-2 text-[10px] font-mono text-outline">iter ${escape_html(agent.iteration)}/${escape_html(agent.maxIterations)}</div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (isCompleted()) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="mt-4 text-xs font-mono text-outline">${escape_html(agent.tokensUsed.toLocaleString())} tok · $${escape_html(agent.cost.toFixed(4))}</div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (isError()) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="mt-4 text-[10px] font-mono px-2 py-0.5 bg-error/10 text-error rounded border border-error/20 uppercase">Halted</div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (isIdle()) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="mt-4 text-xs font-mono text-on-surface-variant/60">${escape_html(agent.name)}</div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div></div>`);
  });
}
function AgentGrid($$renderer, $$props) {
  let { agents } = $$props;
  $$renderer.push(`<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 relative z-10"><!--[-->`);
  const each_array = ensure_array_like(agents);
  for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
    let agent = each_array[$$index];
    $$renderer.push(`<div class="animate-fade-up">`);
    AgentCard($$renderer, { agent });
    $$renderer.push(`<!----></div>`);
  }
  $$renderer.push(`<!--]--></div>`);
}
function EmptyStage($$renderer, $$props) {
  $$renderer.push(`<div class="flex flex-col items-center justify-center h-full text-center animate-fade-up"><div class="w-16 h-16 rounded-full border border-outline-variant/20 flex items-center justify-center mb-8 bg-surface-container-low"><span class="material-symbols-outlined text-2xl text-outline">hub</span></div> <p class="font-mono text-xs text-outline uppercase tracking-widest mb-6">No agents connected yet.</p> <div class="space-y-3 text-center"><div class="px-4 py-2 bg-primary/5 border border-primary/10 rounded-lg"><code class="font-mono text-xs text-primary">rax run "your prompt" --cortex</code></div> <div class="px-4 py-2 bg-surface-container-low border border-outline-variant/10 rounded-lg"><code class="font-mono text-xs text-on-surface/50"># or add .withCortex() to any agent</code></div></div> <button type="button" class="mt-8 text-xs font-mono text-secondary hover:underline transition-colors bg-transparent border-0 cursor-pointer">Or type below ↓</button></div>`);
}
function BottomInputBar($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      placeholder = "What should your agent do?",
      loading = false,
      onSubmit
    } = $$props;
    let value = "";
    function focus() {
    }
    $$renderer2.push(`<div class="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-40"><div class="bg-surface-container-low/80 backdrop-blur-md rounded-full border border-primary/20 p-1.5 flex items-center shadow-[0_0_30px_rgba(208,188,255,0.1)] focus-within:shadow-[0_0_40px_rgba(208,188,255,0.2)] focus-within:border-primary/40 transition-all duration-300"><div class="flex items-center gap-3 w-full px-4"><span class="material-symbols-outlined text-primary text-xl flex-shrink-0">keyboard_command_key</span> <input${attr("value", value)} type="text"${attr("placeholder", placeholder)}${attr("disabled", loading, true)} class="w-full bg-transparent border-none outline-none text-on-surface font-mono text-xs uppercase tracking-widest py-3 placeholder:text-outline/40 placeholder:normal-case placeholder:tracking-normal"/></div> <button type="button"${attr("disabled", !value.trim() || loading, true)} class="bg-primary text-on-primary h-10 w-10 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-glow-primary disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 border-0 cursor-pointer">`);
    if (loading) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<span class="material-symbols-outlined font-bold">arrow_forward</span>`);
    }
    $$renderer2.push(`<!--]--></button></div></div>`);
    bind_props($$props, { focus });
  });
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    var $$store_subs;
    const agentStore = getContext("agentStore");
    const stageStore = getContext("stageStore");
    head("1uha8ag", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>CORTEX — Stage</title>`);
      });
    });
    $$renderer2.push(`<div class="relative h-full flex flex-col overflow-hidden"><div class="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-primary/5 blur-[120px] rounded-full pointer-events-none"></div> <div class="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-secondary/5 blur-[100px] rounded-full pointer-events-none"></div> <div class="flex justify-between items-start px-8 pt-8 pb-6 relative z-10 flex-shrink-0"><div><h1 class="font-headline text-3xl font-light tracking-tight text-on-surface">Cortex <span class="font-bold text-primary">Stage</span></h1> <p class="font-mono text-[10px] text-outline uppercase tracking-widest mt-1">${escape_html(store_get($$store_subs ??= {}, "$agentStore", agentStore).length > 0 ? `${store_get($$store_subs ??= {}, "$agentStore", agentStore).length} node${store_get($$store_subs ??= {}, "$agentStore", agentStore).length !== 1 ? "s" : ""} · ${store_get($$store_subs ??= {}, "$agentStore", agentStore).filter((a) => a.state === "running" || a.state === "exploring" || a.state === "stressed").length} active` : "Awaiting connections")}</p></div> `);
    if (store_get($$store_subs ??= {}, "$agentStore", agentStore).length > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="flex flex-col items-end"><span class="font-mono text-[10px] text-outline uppercase tracking-widest">Active Nodes</span> <span class="font-headline text-xl text-secondary">${escape_html(String(store_get($$store_subs ??= {}, "$agentStore", agentStore).filter((a) => ["running", "exploring", "stressed"].includes(a.state)).length).padStart(2, "0"))}</span></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> <div class="flex-1 relative overflow-y-auto px-8 pb-32 z-10 min-h-0">`);
    if (store_get($$store_subs ??= {}, "$agentStore", agentStore).length > 0) {
      $$renderer2.push("<!--[0-->");
      AgentGrid($$renderer2, {
        agents: store_get($$store_subs ??= {}, "$agentStore", agentStore)
      });
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<div class="h-full flex items-center justify-center min-h-[40vh]">`);
      EmptyStage($$renderer2);
      $$renderer2.push(`<!----></div>`);
    }
    $$renderer2.push(`<!--]--></div> `);
    if (store_get($$store_subs ??= {}, "$stageStore", stageStore).lastSubmitError) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 max-w-xl px-4 text-center font-mono text-[10px] text-error" role="alert">${escape_html(store_get($$store_subs ??= {}, "$stageStore", stageStore).lastSubmitError)}</div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    BottomInputBar($$renderer2, {
      loading: store_get($$store_subs ??= {}, "$stageStore", stageStore).submitting,
      onSubmit: (prompt) => void stageStore.submitPrompt(prompt)
    });
    $$renderer2.push(`<!----></div>`);
    if ($$store_subs) unsubscribe_stores($$store_subs);
  });
}
export {
  _page as default
};
