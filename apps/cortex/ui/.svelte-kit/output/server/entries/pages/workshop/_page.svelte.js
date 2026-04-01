import { b as ensure_array_like, e as escape_html, a as attr, c as attr_class, d as stringify, k as head } from "../../../chunks/index2.js";
import "@sveltejs/kit/internal";
import "../../../chunks/exports.js";
import "../../../chunks/utils.js";
import "@sveltejs/kit/internal/server";
import "../../../chunks/root.js";
import "../../../chunks/state.svelte.js";
function BuilderForm($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let provider = "anthropic";
    let model = "";
    let prompt = "";
    let loading = false;
    let enabledCapabilities = /* @__PURE__ */ new Set();
    const capabilities = [
      { id: "reasoning", label: "Reasoning", icon: "psychology" },
      { id: "tools", label: "Tools", icon: "construction" },
      { id: "guardrails", label: "Guardrails", icon: "security" },
      { id: "memory", label: "Memory", icon: "account_tree" }
    ];
    const providers = ["anthropic", "openai", "gemini", "ollama", "litellm", "test"];
    $$renderer2.push(`<div class="rounded-lg border border-outline-variant/20 bg-surface-container-low/40 p-6 space-y-5"><div class="flex flex-wrap gap-3 text-[10px] font-mono text-outline"><span class="px-3 py-1.5 rounded border border-outline-variant/20">New agent</span> <span class="px-3 py-1.5 rounded border border-outline-variant/10 text-on-surface-variant">Load config — soon</span></div> <div class="flex flex-col sm:flex-row gap-3">`);
    $$renderer2.select(
      {
        value: provider,
        class: "flex-1 bg-surface-container-lowest border border-outline-variant/20 rounded px-3 py-2 text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none"
      },
      ($$renderer3) => {
        $$renderer3.push(`<!--[-->`);
        const each_array = ensure_array_like(providers);
        for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
          let p = each_array[$$index];
          $$renderer3.option({ value: p }, ($$renderer4) => {
            $$renderer4.push(`${escape_html(p)}`);
          });
        }
        $$renderer3.push(`<!--]-->`);
      }
    );
    $$renderer2.push(` <input${attr("value", model)} placeholder="Model (optional)" class="flex-1 bg-surface-container-lowest border border-outline-variant/20 rounded px-3 py-2 text-sm font-mono text-on-surface placeholder:text-outline/40 focus:border-primary/50 focus:outline-none"/></div> <textarea placeholder="Describe what you want the agent to do…" rows="4" class="w-full bg-surface-container-lowest border border-outline-variant/20 rounded px-4 py-3 text-sm font-mono text-on-surface placeholder:text-outline/40 resize-none focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20">`);
    const $$body = escape_html(prompt);
    if ($$body) {
      $$renderer2.push(`${$$body}`);
    }
    $$renderer2.push(`</textarea> <div><span class="text-[9px] font-mono text-outline uppercase tracking-widest block mb-2">Capabilities</span> <div class="flex flex-wrap gap-2"><!--[-->`);
    const each_array_1 = ensure_array_like(capabilities);
    for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
      let cap = each_array_1[$$index_1];
      $$renderer2.push(`<button type="button"${attr_class(`flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono border transition-all ${stringify(enabledCapabilities.has(cap.id) ? "bg-primary/10 border-primary/40 text-primary" : "bg-surface-container border-outline-variant/20 text-outline hover:border-primary/30")}`)}><span class="material-symbols-outlined text-xs">${escape_html(cap.icon)}</span> ${escape_html(cap.label)}</button>`);
    }
    $$renderer2.push(`<!--]--></div> <p class="mt-2 text-[10px] font-mono text-on-surface-variant">Reasoning / guardrails / memory are visual tags for now; runner wiring can follow the same paths
      as \`rax run\`.</p></div> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <div class="flex items-center justify-end gap-3 pt-2"><button type="button"${attr("disabled", !prompt.trim() || loading, true)} class="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-primary-container to-primary text-on-primary font-mono text-xs uppercase rounded shadow-glow-primary hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed">`);
    {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<span class="material-symbols-outlined text-sm">play_arrow</span>`);
    }
    $$renderer2.push(`<!--]--> Run agent</button></div></div>`);
  });
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let activeTab = "builder";
    head("1qiizl6", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>CORTEX — Workshop</title>`);
      });
    });
    $$renderer2.push(`<div class="h-full flex flex-col overflow-hidden p-6 gap-4"><div class="flex items-center gap-1 border-b border-outline-variant/20 pb-0 flex-shrink-0"><!--[-->`);
    const each_array = ensure_array_like([
      { id: "builder", label: "Builder", icon: "build" },
      { id: "skills", label: "Skills", icon: "psychology" },
      { id: "tools", label: "Tools", icon: "construction" }
    ]);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let tab = each_array[$$index];
      $$renderer2.push(`<button type="button"${attr_class(`flex items-center gap-2 px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors border-b-2 -mb-px ${stringify(activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-outline hover:text-primary")}`)}><span class="material-symbols-outlined text-sm">${escape_html(tab.icon)}</span> ${escape_html(tab.label)}</button>`);
    }
    $$renderer2.push(`<!--]--></div> <div class="flex-1 overflow-y-auto min-h-0">`);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="max-w-2xl mx-auto">`);
      BuilderForm($$renderer2);
      $$renderer2.push(`<!----></div>`);
    }
    $$renderer2.push(`<!--]--></div></div>`);
  });
}
export {
  _page as default
};
