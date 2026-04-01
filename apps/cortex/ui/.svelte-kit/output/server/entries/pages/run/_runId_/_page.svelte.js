import { a as attr, e as escape_html, c as attr_class, d as stringify, i as derived, b as ensure_array_like, g as getContext, k as head, s as store_get, u as unsubscribe_stores } from "../../../../chunks/index2.js";
import { c as createWsClient, o as onDestroy, p as page } from "../../../../chunks/ws-client.js";
import "@sveltejs/kit/internal";
import "../../../../chunks/exports.js";
import "../../../../chunks/utils.js";
import "@sveltejs/kit/internal/server";
import "../../../../chunks/root.js";
import "../../../../chunks/state.svelte.js";
import "d3";
import "clsx";
import { w as writable, d as derived$1 } from "../../../../chunks/index.js";
import { C as CORTEX_SERVER_URL } from "../../../../chunks/constants.js";
function VitalsStrip($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { vitals, status, runId } = $$props;
    const statusLabel = derived(() => status === "live" ? "LIVE" : status === "paused" ? "PAUSED" : status === "completed" ? "DONE" : status === "failed" ? "FAILED" : status === "loading" ? "…" : "…");
    const statusClass = derived(() => status === "live" ? "text-green-400 border-green-500/20 bg-green-500/10" : status === "failed" ? "text-error border-error/20 bg-error/10" : "text-secondary border-secondary/20 bg-secondary/10");
    const trajectoryClass = derived(() => vitals.trajectory === "CONVERGING" ? "text-primary border-primary/30 bg-primary/10" : vitals.trajectory === "STRESSED" ? "text-error border-error/30 bg-error/10" : "text-tertiary border-tertiary/30 bg-tertiary/10");
    const costStr = derived(() => vitals.cost < 1e-3 ? `<$0.001` : `$${vitals.cost.toFixed(4)}`);
    const durationStr = derived(() => vitals.durationMs < 1e3 ? `${vitals.durationMs}ms` : `${(vitals.durationMs / 1e3).toFixed(1)}s`);
    const ekgStroke = derived(() => vitals.trajectory === "STRESSED" ? "#ffb4ab" : vitals.trajectory === "EXPLORING" ? "#f7be1d" : "#d0bcff");
    const runShort = derived(() => runId.length > 12 ? `${runId.slice(0, 8)}…` : runId);
    $$renderer2.push(`<div class="w-full bg-[#111317] border-b border-white/5 relative overflow-hidden flex-shrink-0"><div class="max-w-full px-6 py-3 flex items-center gap-0 font-mono text-[11px] uppercase tracking-widest text-on-surface-variant overflow-x-auto"><div class="flex items-center gap-2 pr-5"><span class="text-[9px] text-outline normal-case tracking-normal truncate max-w-[100px]"${attr("title", runId)}>${escape_html(runShort())}</span> <div${attr_class(`flex items-center gap-2 px-2 py-0.5 rounded-full border ${stringify(statusClass())}`)}>`);
    if (status === "live") {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <span class="text-[10px]">${escape_html(statusLabel())}</span></div></div> <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div> <div class="flex items-center gap-2 pr-5"><span class="text-primary">η</span> <span class="text-on-surface tabular-nums">${escape_html(vitals.entropy.toFixed(2))}</span></div> <div${attr_class(`px-2 py-0.5 rounded text-[10px] border mr-5 ${stringify(trajectoryClass())}`)}>${escape_html(vitals.trajectory)}</div> <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div> <div class="flex items-center gap-2 mr-5"><span class="text-primary tabular-nums">${escape_html(vitals.tokensUsed.toLocaleString())}</span> <span class="text-on-surface-variant">TOKENS</span></div> <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div> <div class="flex items-center gap-2 mr-5"><span class="text-primary">${escape_html(costStr())}</span> <span class="text-on-surface-variant">COST</span></div> <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div> <div class="flex items-center gap-2 mr-5"><span class="text-primary tabular-nums">${escape_html(durationStr())}</span> <span class="text-on-surface-variant">DURATION</span></div> `);
    if (vitals.iteration > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div> <div class="flex items-center gap-2"><span class="text-tertiary">ITER</span> <span${attr_class(`tabular-nums ${stringify(vitals.iteration > vitals.maxIterations && vitals.maxIterations > 0 ? "text-tertiary" : "text-on-surface")}`)}${attr("title", vitals.maxIterations > 0 ? `Max: ${vitals.maxIterations}` : void 0)}>${escape_html(vitals.iteration)}${escape_html(vitals.maxIterations > 0 && vitals.iteration <= vitals.maxIterations ? `/${vitals.maxIterations}` : "")}</span></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (vitals.fallbackProvider) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="ml-4 flex items-center gap-1 px-2 py-0.5 bg-tertiary/10 border border-tertiary/30 rounded text-[10px] text-tertiary"><span class="material-symbols-outlined text-xs">electric_bolt</span> → ${escape_html(vitals.fallbackProvider)}</div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> <div class="w-full h-7 relative overflow-hidden bg-transparent border-t border-white/[0.03]"><svg class="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1000 28">`);
    if (status === "live" || status === "loading") {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<path class="ekg-line" d="M0 14 L100 14 L110 4 L120 24 L130 14 L300 14 L310 14 L320 2 L330 26 L340 14 L600 14 L610 7 L620 21 L630 14 L850 14 L860 0 L870 28 L880 14 L1000 14" fill="none"${attr("stroke", ekgStroke())} stroke-width="1.5" opacity="0.7"></path>`);
    } else if (status === "paused") {
      $$renderer2.push("<!--[1-->");
      $$renderer2.push(`<path d="M0 14 L100 14 L110 4 L120 24 L130 14 L500 14" fill="none"${attr("stroke", ekgStroke())} stroke-width="1.5" opacity="0.5" stroke-dasharray="4 3"></path>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<line x1="0" y1="14" x2="1000" y2="14"${attr("stroke", status === "failed" ? "#ffb4ab" : "#4cd7f6")} stroke-width="1" opacity="0.3"></line><circle cx="980" cy="14" r="2.5"${attr("fill", status === "failed" ? "#ffb4ab" : "#4cd7f6")} opacity="0.5"></circle>`);
    }
    $$renderer2.push(`<!--]--></svg></div></div>`);
  });
}
function SignalMonitor($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { data } = $$props;
    let width = 600;
    let height = 400;
    $$renderer2.push(`<div class="gradient-border-glow rounded-lg h-full flex flex-col min-h-[320px]"><div class="flex justify-between items-center px-6 py-4 flex-shrink-0"><h2 class="font-headline text-sm font-bold tracking-tight text-on-surface/90 uppercase">Signal Monitor</h2> <div class="flex gap-4 text-[10px] font-mono text-on-surface/30"><span>${escape_html(data.entropy.length)} η samples</span></div></div> <div class="flex-1 relative px-4 pb-4 min-h-0"><svg${attr("width", width)}${attr("height", height)} class="w-full h-full overflow-visible block"></svg></div></div>`);
  });
}
function TracePanel($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { frame, frames = [] } = $$props;
    let expandedRows = [];
    function kindClass(f) {
      if (f.kind === "final") return "border-l-2 border-secondary/60";
      return "border-l-2 border-outline-variant/20 hover:border-primary/40";
    }
    function truncate(s, max = 120) {
      return s.length > max ? s.slice(0, max) + "…" : s;
    }
    $$renderer2.push(`<div class="gradient-border-glow rounded-lg h-full flex flex-col overflow-hidden min-h-0"><div class="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-sm text-primary">receipt_long</span> <h3 class="font-headline text-sm font-bold uppercase tracking-wide">Execution Trace</h3> `);
    if (frames.length > 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="text-[10px] font-mono text-outline bg-surface-container px-1.5 py-0.5 rounded">${escape_html(frames.length)}</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> `);
    if (frame) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">ITER ${escape_html(String(frame.iteration).padStart(2, "0"))} selected</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></div> <div class="flex-1 overflow-y-auto min-h-0 py-2">`);
    if (frames.length === 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<p class="font-mono text-[10px] text-outline text-center mt-8 px-4">Trace will appear here as the agent runs.</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<!--[-->`);
      const each_array = ensure_array_like(frames);
      for (let idx = 0, $$length = each_array.length; idx < $$length; idx++) {
        let f = each_array[idx];
        const isExpanded = expandedRows.includes(idx);
        const isSelected = frame?.iteration === f.iteration && frame?.kind === f.kind;
        $$renderer2.push(`<div${attr_class(`mx-2 mb-1 rounded transition-all duration-150 cursor-pointer ${stringify(kindClass(f))} ${stringify(isSelected ? "bg-primary/8 border-primary/50" : "bg-surface-container-lowest/40 hover:bg-surface-container-low/60")}`)}><div class="flex items-center gap-2 px-3 py-2"><span${attr_class(`flex-shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded tabular-nums ${stringify(f.kind === "final" ? "text-secondary bg-secondary/10 border border-secondary/20" : "text-primary/70 bg-primary/10")}`)}>${escape_html(f.kind === "final" ? "FINAL" : `#${f.iteration}`)}</span> <span class="flex-1 text-[10px] font-mono text-on-surface/70 truncate min-w-0">${escape_html(truncate(f.thought))}</span> `);
        if (f.toolsThisStep && f.toolsThisStep.length > 0) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="flex-shrink-0 flex gap-1"><!--[-->`);
          const each_array_1 = ensure_array_like(f.toolsThisStep.slice(0, 2));
          for (let $$index = 0, $$length2 = each_array_1.length; $$index < $$length2; $$index++) {
            let tool = each_array_1[$$index];
            $$renderer2.push(`<span class="text-[8px] font-mono px-1 py-0.5 bg-tertiary/10 text-tertiary rounded">${escape_html(tool.length > 10 ? tool.slice(0, 9) + "…" : tool)}</span>`);
          }
          $$renderer2.push(`<!--]--> `);
          if (f.toolsThisStep.length > 2) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<span class="text-[8px] font-mono text-outline">+${escape_html(f.toolsThisStep.length - 2)}</span>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--></div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--> <div class="flex-shrink-0 flex items-center gap-2 text-[9px] font-mono text-outline/60">`);
        if (f.tokensUsed > 0) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<span>${escape_html(f.tokensUsed.toLocaleString())}t</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--> `);
        if (f.durationMs > 0) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<span>${escape_html(f.durationMs)}ms</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--> `);
        if (f.entropy !== void 0) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<span class="text-primary/50">η${escape_html(f.entropy.toFixed(2))}</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div> <span${attr_class(`flex-shrink-0 material-symbols-outlined text-xs text-outline/40 transition-transform ${stringify(isExpanded ? "rotate-180" : "")}`)}>expand_more</span></div> `);
        if (isExpanded) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="px-3 pb-3 space-y-3 border-t border-white/5 pt-3">`);
          if (f.thought && f.thought !== `Called: ${f.toolsThisStep?.join(", ")}` && f.thought !== "(thinking)" && f.thought !== "(reasoning — no tools)") {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<div class="relative pl-3"><div class="absolute left-0 top-0 bottom-0 w-0.5 bg-primary/30 rounded-full"></div> <span class="text-[9px] font-mono text-primary uppercase tracking-widest block mb-1">${escape_html(f.kind === "final" ? "Final Answer" : "Summary")}</span> <p class="text-[11px] font-mono text-on-surface/70 leading-relaxed whitespace-pre-wrap break-words">${escape_html(f.thought)}</p></div>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--> `);
          if (f.toolsThisStep && f.toolsThisStep.length > 0) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<div class="relative pl-3"><div class="absolute left-0 top-0 bottom-0 w-0.5 bg-tertiary/30 rounded-full"></div> <span class="text-[9px] font-mono text-tertiary uppercase tracking-widest block mb-2">Tools Called (${escape_html(f.toolsThisStep.length)})</span> <div class="flex flex-wrap gap-1.5"><!--[-->`);
            const each_array_2 = ensure_array_like(f.toolsThisStep);
            for (let $$index_1 = 0, $$length2 = each_array_2.length; $$index_1 < $$length2; $$index_1++) {
              let tool = each_array_2[$$index_1];
              $$renderer2.push(`<span class="px-2 py-1 bg-tertiary/10 border border-tertiary/30 text-tertiary text-[10px] font-mono rounded">${escape_html(tool)}</span>`);
            }
            $$renderer2.push(`<!--]--></div></div>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--> `);
          if (f.observation) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<div class="relative pl-3"><div class="absolute left-0 top-0 bottom-0 w-0.5 bg-secondary/30 rounded-full"></div> <span class="text-[9px] font-mono text-secondary uppercase tracking-widest block mb-1">Result Preview</span> <div class="bg-secondary/5 border border-secondary/10 rounded p-2 max-h-32 overflow-y-auto"><code class="text-[10px] font-mono text-on-surface/50 break-all whitespace-pre-wrap">${escape_html(f.observation)}</code></div></div>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--> <div class="flex flex-wrap gap-3 text-[9px] font-mono text-outline/60 pl-3">`);
          if (f.tokensUsed > 0) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<span class="text-primary/60">${escape_html(f.tokensUsed.toLocaleString())} tokens</span>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--> `);
          if (f.durationMs > 0) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<span>${escape_html(f.durationMs)}ms</span>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--> `);
          if (f.entropy !== void 0) {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`<span>η ${escape_html(f.entropy.toFixed(3))}</span>`);
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--> <span class="text-outline/30">${escape_html(new Date(f.ts).toLocaleTimeString())}</span></div></div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div>`);
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]--></div></div>`);
  });
}
function DecisionLog($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { events } = $$props;
    const decisions = derived(() => {
      const out = [];
      for (const e of events) {
        let p = null;
        if (e.type === "ReactiveDecision") {
          p = e.payload;
        } else if (e.type === "Custom" && typeof e.payload.type === "string" && e.payload.type === "ReactiveDecision" && e.payload.payload && typeof e.payload.payload === "object") {
          p = e.payload.payload;
        }
        if (!p) continue;
        if (typeof p.decision !== "string" || !p.decision) continue;
        out.push({
          iteration: typeof p.iteration === "number" ? p.iteration : 0,
          decision: typeof p.decision === "string" ? p.decision : "?",
          reason: typeof p.reason === "string" ? p.reason : "",
          entropyBefore: typeof p.entropyBefore === "number" ? p.entropyBefore : 0,
          entropyAfter: typeof p.entropyAfter === "number" ? p.entropyAfter : void 0,
          triggered: p.triggered !== false
        });
      }
      return out;
    });
    const decisionIcon = {
      "early-stop": "stop_circle",
      compress: "compress",
      "switch-strategy": "swap_horiz",
      branch: "call_split",
      attribute: "label"
    };
    $$renderer2.push(`<div class="h-full overflow-y-auto px-4 py-3 space-y-2">`);
    if (decisions().length === 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<p class="font-mono text-[10px] text-outline text-center mt-4">No reactive interventions — agent ran without the controller needing to adapt.</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<!--[-->`);
      const each_array = ensure_array_like(decisions());
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let d = each_array[$$index];
        $$renderer2.push(`<div class="flex items-start gap-3 p-2 rounded bg-surface-container-low border border-outline-variant/10 hover:border-primary/20 transition-colors"><span class="material-symbols-outlined text-sm text-primary flex-shrink-0 mt-0.5">${escape_html(decisionIcon[d.decision] ?? "electric_bolt")}</span> <div class="flex-1 min-w-0"><div class="flex items-center gap-2 mb-1 flex-wrap"><span class="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">iter ${escape_html(String(d.iteration).padStart(2, "0"))}</span> <span class="text-[10px] font-mono text-on-surface uppercase">${escape_html(d.decision)}</span> `);
        if (!d.triggered) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<span class="text-[9px] font-mono text-outline">(not triggered)</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div> <p class="text-[10px] font-mono text-on-surface/60 leading-relaxed truncate">${escape_html(d.reason)}</p> <div class="flex gap-2 mt-1"><span class="text-[9px] font-mono text-outline">η ${escape_html(d.entropyBefore.toFixed(3))} `);
        if (d.entropyAfter !== void 0) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`→ ${escape_html(d.entropyAfter.toFixed(3))}`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></span></div></div></div>`);
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]--></div>`);
  });
}
function DebriefCard($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { debrief } = $$props;
    const d = derived(() => debrief && typeof debrief === "object" ? debrief : null);
    const successOutcome = derived(() => d()?.outcome === "success" || d()?.outcome === "partial");
    const toolCallSum = derived(() => (d()?.toolsUsed ?? []).reduce((s, t) => s + (typeof t.calls === "number" ? t.calls : 0), 0));
    if (d()) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="gradient-border rounded-lg p-6 animate-fade-up"><div class="flex items-center justify-between mb-5 flex-wrap gap-2"><div class="flex items-center gap-3"><span class="material-symbols-outlined text-primary">summarize</span> <h3 class="font-headline text-sm font-bold uppercase tracking-wide">Run Debrief</h3></div> <div class="flex items-center gap-3 flex-wrap"><span${attr_class(`px-2 py-0.5 rounded text-[10px] font-mono border ${stringify(successOutcome() ? "text-secondary border-secondary/30 bg-secondary/10" : "text-error border-error/30 bg-error/10")}`)}>${escape_html(successOutcome() ? "✓ SUCCESS" : "✗ FAILED")}</span> `);
      if (typeof d().markdown === "string" && d().markdown) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<button type="button" class="text-[10px] font-mono text-primary/60 hover:text-primary transition-colors flex items-center gap-1 bg-transparent border-0 cursor-pointer"><span class="material-symbols-outlined text-sm">${escape_html("content_copy")}</span> ${escape_html("Copy Markdown")}</button>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div></div> `);
      if (d().summary) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<p class="font-mono text-xs text-on-surface/70 leading-relaxed mb-5 pl-4 border-l-2 border-primary/30">${escape_html(d().summary)}</p>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">`);
      if ((d().keyFindings?.length ?? 0) > 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div><span class="text-[9px] font-mono text-primary uppercase tracking-widest block mb-2">Key Findings</span> <ul class="space-y-1"><!--[-->`);
        const each_array = ensure_array_like((d().keyFindings ?? []).slice(0, 4));
        for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
          let finding = each_array[$$index];
          $$renderer2.push(`<li class="text-[11px] font-mono text-on-surface/60 flex gap-2"><span class="text-primary/50 flex-shrink-0">•</span> ${escape_html(finding)}</li>`);
        }
        $$renderer2.push(`<!--]--></ul></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--> `);
      if ((d().lessonsLearned?.length ?? 0) > 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div><span class="text-[9px] font-mono text-secondary uppercase tracking-widest block mb-2">Lessons Learned</span> <ul class="space-y-1"><!--[-->`);
        const each_array_1 = ensure_array_like((d().lessonsLearned ?? []).slice(0, 4));
        for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
          let lesson = each_array_1[$$index_1];
          $$renderer2.push(`<li class="text-[11px] font-mono text-on-surface/60 flex gap-2"><span class="text-secondary/50 flex-shrink-0">•</span> ${escape_html(lesson)}</li>`);
        }
        $$renderer2.push(`<!--]--></ul></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div> `);
      if (d().metrics) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<div class="flex flex-wrap gap-4 font-mono text-[10px] pt-4 border-t border-white/5"><span class="text-outline">METRICS:</span> <span>${escape_html(d().metrics.iterations ?? 0)} iter</span> <span>·</span> <span>${escape_html((d().metrics.tokens ?? 0).toLocaleString())} tok</span> <span>·</span> <span>$${escape_html((d().metrics.cost ?? 0).toFixed(4))}</span> <span>·</span> <span>${escape_html(((d().metrics.duration ?? 0) / 1e3).toFixed(1))}s</span> `);
        if (toolCallSum() > 0) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<span>·</span> <span>${escape_html(toolCallSum())} tool calls</span>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></div>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
  });
}
function ReplayControls($$renderer, $$props) {
  let { status = "idle" } = $$props;
  $$renderer.push(`<div class="flex items-center gap-3 px-4 py-2 border border-outline-variant/10 rounded-lg bg-surface-container-low/50"><span class="material-symbols-outlined text-sm text-outline">replay</span> <span class="font-mono text-[9px] text-outline uppercase tracking-widest">Replay</span> <span class="font-mono text-[9px] text-on-surface/30">1× · scrubber · Phase 5+</span> <span class="font-mono text-[9px] text-outline/50">(${escape_html(status)})</span></div>`);
}
const DEFAULT_VITALS = {
  entropy: 0,
  trajectory: "EXPLORING",
  tokensUsed: 0,
  cost: 0,
  durationMs: 0,
  iteration: 0,
  maxIterations: 10
};
function readTokensUsed(p) {
  const raw = p.tokensUsed;
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object" && "total" in raw && typeof raw.total === "number") {
    return raw.total;
  }
  return 0;
}
function updateVitals(v, msg, runStartMs) {
  const p = msg.payload;
  switch (msg.type) {
    case "EntropyScored": {
      const composite = typeof p.composite === "number" ? p.composite : v.entropy;
      const shape = p.trajectory && typeof p.trajectory === "object" && "shape" in p.trajectory ? String(p.trajectory.shape) : "";
      const trajectory = shape === "converging" ? "CONVERGING" : shape === "diverging" ? "DIVERGING" : composite > 0.75 ? "STRESSED" : "EXPLORING";
      return { ...v, entropy: composite, trajectory };
    }
    case "LLMRequestCompleted":
      return {
        ...v,
        tokensUsed: v.tokensUsed + readTokensUsed(p),
        cost: v.cost + (typeof p.estimatedCost === "number" ? p.estimatedCost : 0),
        durationMs: Math.max(0, msg.ts - runStartMs)
      };
    case "ReasoningStepCompleted": {
      const iter = typeof p.totalSteps === "number" ? p.totalSteps : typeof p.step === "number" ? p.step : v.iteration;
      const clampedIter = Math.max(v.iteration, Math.max(0, iter));
      return { ...v, iteration: clampedIter, maxIterations: Math.max(v.maxIterations, clampedIter) };
    }
    case "ReasoningIterationProgress": {
      const iter = typeof p.iteration === "number" ? p.iteration : v.iteration;
      const max = typeof p.maxIterations === "number" && p.maxIterations > 0 ? p.maxIterations : v.maxIterations;
      const clampedIter = Math.max(v.iteration, Math.max(0, iter));
      return { ...v, iteration: clampedIter, maxIterations: max };
    }
    case "AgentCompleted":
      return {
        ...v,
        iteration: typeof p.totalIterations === "number" ? p.totalIterations : v.iteration,
        tokensUsed: typeof p.totalTokens === "number" ? p.totalTokens : v.tokensUsed,
        durationMs: typeof p.durationMs === "number" ? p.durationMs : v.durationMs
      };
    case "ProviderFallbackActivated":
      return {
        ...v,
        fallbackProvider: typeof p.toProvider === "string" ? p.toProvider : v.fallbackProvider
      };
    default:
      return v;
  }
}
function deriveStatus(current, msg) {
  if (msg.type === "AgentCompleted") return pSuccess(msg.payload) ? "completed" : "failed";
  if (msg.type === "TaskFailed") return "failed";
  if (msg.type === "DebriefCompleted") return "completed";
  if (current === "loading" && msg.type) return "live";
  return current;
}
function pSuccess(p) {
  return p.success === true;
}
function createRunStore(runId, options) {
  const fetchFn = globalThis.fetch.bind(globalThis);
  const state = writable({
    runId,
    agentId: "",
    status: "loading",
    vitals: DEFAULT_VITALS,
    events: [],
    debrief: null,
    isChat: false
  });
  let unsubMsg = null;
  let liveWs = null;
  let runStartMs = Date.now();
  const seenEventKeys = /* @__PURE__ */ new Set();
  function eventKey(msg) {
    return `${msg.ts}|${msg.type}|${JSON.stringify(msg.payload)}`;
  }
  function applyEvent(msg) {
    const key = eventKey(msg);
    if (seenEventKeys.has(key)) return;
    seenEventKeys.add(key);
    state.update((s) => {
      if (msg.runId && msg.runId !== runId) return s;
      const events = [...s.events, msg];
      const vitals = updateVitals(s.vitals, msg, runStartMs);
      const status = deriveStatus(s.status, msg);
      let debrief = s.debrief;
      if (msg.type === "DebriefCompleted" && msg.payload.debrief && typeof msg.payload.debrief === "object") {
        debrief = msg.payload.debrief;
      }
      const isChat = s.isChat || msg.type === "ChatTurn";
      return {
        ...s,
        events,
        vitals,
        status,
        debrief,
        isChat,
        agentId: msg.agentId || s.agentId
      };
    });
  }
  async function init() {
    try {
      const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}`);
      if (!res.ok) {
        state.update((s) => ({ ...s, status: "failed" }));
        return;
      }
      const run = await res.json();
      runStartMs = typeof run.startedAt === "number" ? run.startedAt : Date.now();
      const mapped = run.status === "live" ? "live" : run.status === "failed" ? "failed" : "completed";
      let parsedDebrief = null;
      if (typeof run.debrief === "string" && run.debrief) {
        try {
          parsedDebrief = JSON.parse(run.debrief);
        } catch {
        }
      }
      state.update((s) => ({
        ...s,
        agentId: run.agentId,
        status: mapped === "live" && s.events.length === 0 ? "loading" : mapped,
        debrief: parsedDebrief ?? s.debrief,
        vitals: {
          ...s.vitals,
          iteration: run.iterationCount ?? s.vitals.iteration,
          tokensUsed: run.tokensUsed ?? s.vitals.tokensUsed,
          cost: run.cost ?? s.vitals.cost,
          durationMs: Date.now() - runStartMs
        }
      }));
      const eventsRes = await fetchFn(
        `${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/events`
      );
      if (eventsRes.ok) {
        const rows = await eventsRes.json();
        for (const row of rows) {
          let payload = {};
          try {
            payload = JSON.parse(row.payload);
          } catch {
          }
          applyEvent({
            ts: row.ts,
            type: row.type,
            payload,
            runId,
            agentId: run.agentId,
            source: "eventbus",
            v: 1
          });
        }
      }
      liveWs = createWsClient(
        `/ws/live/${encodeURIComponent(run.agentId)}?runId=${encodeURIComponent(runId)}`
      );
      unsubMsg = liveWs.onMessage((raw) => {
        const msg = raw;
        if (!msg?.type) return;
        applyEvent(msg);
      });
    } catch {
      state.update((s) => ({ ...s, status: "failed" }));
    }
  }
  void init();
  async function pause() {
    try {
      await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/pause`, {
        method: "POST"
      });
      state.update((s) => ({ ...s, status: "paused" }));
    } catch {
    }
  }
  async function stop() {
    try {
      await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/stop`, {
        method: "POST"
      });
    } catch {
    }
  }
  async function deleteRun() {
    try {
      const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}`, {
        method: "DELETE"
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  return {
    subscribe: state.subscribe,
    pause,
    stop,
    deleteRun,
    destroy: () => {
      unsubMsg?.();
      unsubMsg = null;
      liveWs?.close();
      liveWs = null;
    }
  };
}
function entropyColor(value) {
  if (value < 0.5) return "#d0bcff";
  if (value < 0.75) return "#f7be1d";
  return "#ffb4ab";
}
function readTokensFromPayload(p) {
  const raw = p.tokensUsed;
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object" && "total" in raw && typeof raw.total === "number") {
    return raw.total;
  }
  return 0;
}
function createSignalStore(runState) {
  const selectedIteration = writable(null);
  const signalData = derived$1([runState, selectedIteration], ([$state, $sel]) => {
    const entropy = [];
    const tokens = [];
    const tools = [];
    const latency = [];
    const callIdToIndex = /* @__PURE__ */ new Map();
    let llmStart = null;
    let currentIteration = 0;
    for (const msg of $state.events) {
      const p = msg.payload;
      switch (msg.type) {
        case "EntropyScored": {
          const v = typeof p.composite === "number" ? p.composite : 0;
          entropy.push({
            ts: msg.ts,
            value: v,
            color: entropyColor(v),
            iteration: typeof p.iteration === "number" ? p.iteration : currentIteration
          });
          break;
        }
        case "LLMRequestStarted":
          llmStart = msg.ts;
          break;
        case "LLMRequestCompleted": {
          const durationMs = typeof p.durationMs === "number" && p.durationMs > 0 ? p.durationMs : llmStart !== null && msg.ts > llmStart ? msg.ts - llmStart : 1;
          latency.push({
            ts: msg.ts,
            value: durationMs,
            color: "#4cd7f6",
            iteration: currentIteration
          });
          llmStart = null;
          const t = readTokensFromPayload(p);
          tokens.push({ ts: msg.ts, iteration: currentIteration, tokens: Math.max(1, t) });
          break;
        }
        case "ReasoningStepCompleted":
          if (typeof p.totalSteps === "number" && p.totalSteps > 0) {
            currentIteration = Math.max(currentIteration, p.totalSteps);
          } else if (typeof p.step === "number" && p.step > 0) {
            currentIteration = Math.max(currentIteration, p.step);
          }
          break;
        case "ReasoningIterationProgress":
          if (typeof p.iteration === "number") currentIteration = p.iteration;
          break;
        case "ToolCallStarted": {
          const name = typeof p.toolName === "string" ? p.toolName : "unknown";
          const callId = typeof p.callId === "string" ? p.callId : `${msg.ts}-${name}`;
          const idx = tools.length;
          callIdToIndex.set(callId, idx);
          tools.push({ tStart: msg.ts, name, status: "active" });
          break;
        }
        case "ToolCallCompleted": {
          const callId = typeof p.callId === "string" ? p.callId : "";
          const idx = callId ? callIdToIndex.get(callId) : void 0;
          if (idx !== void 0 && tools[idx]) {
            callIdToIndex.delete(callId);
            const startTs = tools[idx].tStart;
            const success = p.success === true;
            tools[idx] = {
              ...tools[idx],
              tEnd: msg.ts,
              status: success ? "success" : "error",
              latencyMs: msg.ts - startTs
            };
          } else {
            const name = typeof p.toolName === "string" ? p.toolName : "unknown";
            const dur = typeof p.durationMs === "number" ? p.durationMs : 0;
            tools.push({
              name,
              status: p.success === true ? "success" : "error",
              tStart: msg.ts - Math.max(1, dur),
              tEnd: msg.ts,
              latencyMs: dur || void 0
            });
          }
          break;
        }
      }
    }
    return { entropy, tokens, tools, latency, selectedIteration: $sel };
  });
  return {
    subscribe: signalData.subscribe,
    selectIteration: selectedIteration.set
  };
}
function readTokens(p) {
  const raw = p.tokensUsed;
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object" && "total" in raw && typeof raw.total === "number") {
    return raw.total;
  }
  return 0;
}
function createTraceStore(runState) {
  return derived$1(runState, ($state) => {
    const frames = [];
    let carryEntropy;
    let carryTokens = 0;
    let carryDurationMs = 0;
    let carryTs = 0;
    for (const msg of $state.events) {
      const p = msg.payload;
      switch (msg.type) {
        // ── Carry: entropy scored during this iteration ───────────────────────
        case "EntropyScored":
          if (typeof p.composite === "number") carryEntropy = p.composite;
          break;
        // ── Carry: tokens + LLM latency ──────────────────────────────────────
        case "LLMRequestCompleted": {
          carryTokens += readTokens(p);
          const dur = typeof p.durationMs === "number" ? p.durationMs : 0;
          if (dur > carryDurationMs) carryDurationMs = dur;
          carryTs = msg.ts;
          break;
        }
        // ── Carry: tool call duration ─────────────────────────────────────────
        case "ToolCallCompleted": {
          const dur = typeof p.durationMs === "number" ? p.durationMs : 0;
          if (dur > 0) carryDurationMs = Math.max(carryDurationMs, dur);
          carryTs = msg.ts;
          break;
        }
        // ── PRIMARY: one frame per Think→Act→Observe cycle ───────────────────
        case "ReasoningIterationProgress": {
          const iteration = typeof p.iteration === "number" ? p.iteration : frames.length + 1;
          const toolsThisStep = Array.isArray(p.toolsThisStep) ? p.toolsThisStep.filter((t) => typeof t === "string") : [];
          const thought = toolsThisStep.length > 0 ? `Called: ${toolsThisStep.join(", ")}` : carryTokens > 0 ? "(reasoning — no tools)" : "(thinking)";
          frames.push({
            iteration,
            thought,
            toolName: toolsThisStep.length === 1 ? toolsThisStep[0] : void 0,
            toolArgs: toolsThisStep.length > 1 ? toolsThisStep.join(", ") : void 0,
            entropy: carryEntropy,
            tokensUsed: carryTokens,
            durationMs: carryDurationMs,
            ts: msg.ts || carryTs,
            kind: "step",
            toolsThisStep
          });
          carryTokens = 0;
          carryDurationMs = 0;
          carryEntropy = void 0;
          break;
        }
        // ── FINAL: answer produced ────────────────────────────────────────────
        case "FinalAnswerProduced": {
          const answer = typeof p.answer === "string" ? p.answer.trim() : "";
          if (!answer) break;
          const iteration = typeof p.iteration === "number" ? p.iteration : frames.length > 0 ? (frames[frames.length - 1]?.iteration ?? 0) + 1 : 1;
          frames.push({
            iteration,
            thought: answer,
            tokensUsed: typeof p.totalTokens === "number" ? p.totalTokens : carryTokens,
            durationMs: carryDurationMs,
            ts: msg.ts || carryTs,
            kind: "final"
          });
          carryTokens = 0;
          carryDurationMs = 0;
          break;
        }
      }
    }
    return frames;
  });
}
function RunDetail($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    var $$store_subs;
    let { runId } = $$props;
    const runStore = createRunStore(runId);
    getContext("agentStore");
    const signalStore = createSignalStore(runStore);
    const traceStore = createTraceStore(runStore);
    let bottomTab = "decisions";
    let deletingRun = false;
    function panelEvents(msgs) {
      return msgs.map((m) => ({ type: m.type, payload: m.payload, ts: m.ts }));
    }
    onDestroy(() => runStore.destroy());
    head("1b1ntf8", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>CORTEX — Run ${escape_html(runId.slice(0, 8))}</title>`);
      });
    });
    $$renderer2.push(`<div class="flex flex-col h-full overflow-hidden min-h-0"><nav class="flex-shrink-0 px-4 py-2 border-b border-white/5 flex items-center gap-2 text-[10px] font-mono text-outline"><a href="/" class="text-secondary hover:text-primary no-underline">Stage</a> <span class="text-on-surface/30">/</span> <span class="text-on-surface truncate max-w-[200px]"${attr("title", runId)}>${escape_html(runId)}</span> `);
    if (store_get($$store_subs ??= {}, "$runStore", runStore).isChat) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<span class="ml-2 px-1.5 py-0.5 rounded border border-primary/30 text-primary text-[9px]">CHAT</span>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <div class="flex-1"></div> `);
    ReplayControls($$renderer2, {
      status: store_get($$store_subs ??= {}, "$runStore", runStore).status
    });
    $$renderer2.push(`<!----></nav> `);
    VitalsStrip($$renderer2, {
      vitals: store_get($$store_subs ??= {}, "$runStore", runStore).vitals,
      status: store_get($$store_subs ??= {}, "$runStore", runStore).status,
      runId
    });
    $$renderer2.push(`<!----> <div class="flex-1 grid grid-cols-1 md:grid-cols-[65%_35%] gap-4 p-4 overflow-hidden min-h-0"><section class="flex flex-col gap-4 overflow-hidden min-h-0">`);
    if (store_get($$store_subs ??= {}, "$runStore", runStore).status === "failed") {
      $$renderer2.push("<!--[0-->");
      const errorEvents = store_get($$store_subs ??= {}, "$runStore", runStore).events.filter((e) => e.type === "TaskFailed" || e.type === "AgentCompleted" && e.payload.success === false);
      $$renderer2.push(`<div class="flex-shrink-0 gradient-border rounded-lg p-4 border-error/40 bg-error/5"><div class="flex items-center gap-2 mb-3"><span class="material-symbols-outlined text-error text-sm">error</span> <span class="font-mono text-xs text-error uppercase tracking-widest font-bold">Run Failed</span></div> <!--[-->`);
      const each_array = ensure_array_like(errorEvents);
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let ev = each_array[$$index];
        const msg = typeof ev.payload.error === "string" ? ev.payload.error : typeof ev.payload.reason === "string" ? ev.payload.reason : "Agent terminated with failure";
        $$renderer2.push(`<p class="font-mono text-[11px] text-error/80 leading-relaxed bg-error/10 rounded p-2 border border-error/20">${escape_html(msg)}</p>`);
      }
      $$renderer2.push(`<!--]--> `);
      if (errorEvents.length === 0) {
        $$renderer2.push("<!--[0-->");
        $$renderer2.push(`<p class="font-mono text-[11px] text-error/60">The run failed without a captured error message. Check the trace and signal monitor for the last state.</p>`);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <div class="flex-1 min-h-[280px] overflow-hidden">`);
    SignalMonitor($$renderer2, {
      data: store_get($$store_subs ??= {}, "$signalStore", signalStore)
    });
    $$renderer2.push(`<!----></div> `);
    if (store_get($$store_subs ??= {}, "$runStore", runStore).debrief) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="flex-shrink-0 max-h-64 overflow-y-auto">`);
      DebriefCard($$renderer2, {
        debrief: store_get($$store_subs ??= {}, "$runStore", runStore).debrief
      });
      $$renderer2.push(`<!----></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--></section> <section class="min-h-0 overflow-hidden flex flex-col">`);
    TracePanel($$renderer2, {
      frames: store_get($$store_subs ??= {}, "$traceStore", traceStore),
      frame: store_get($$store_subs ??= {}, "$traceStore", traceStore)[store_get($$store_subs ??= {}, "$traceStore", traceStore).length - 1] ?? null
    });
    $$renderer2.push(`<!----></section></div> <footer class="bg-[#111317]/80 backdrop-blur-md flex justify-between items-center px-6 flex-shrink-0 border-t border-primary/10 h-14"><div class="flex items-center h-full"><!--[-->`);
    const each_array_1 = ensure_array_like([
      {
        id: "decisions",
        label: "Reactive Decisions",
        icon: "analytics"
      },
      { id: "memory", label: "Memory", icon: "account_tree" },
      { id: "context", label: "Context Pressure", icon: "data_usage" }
    ]);
    for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
      let tab = each_array_1[$$index_1];
      $$renderer2.push(`<button type="button"${attr_class(`flex flex-col items-center justify-center px-5 h-full transition-all duration-200 font-mono text-[10px] uppercase tracking-wider border-0 bg-transparent cursor-pointer ${stringify(bottomTab === tab.id ? "text-primary border-t-2 border-primary bg-primary/5 -mt-0.5" : "text-outline hover:bg-white/5 hover:text-secondary")}`)}><span class="material-symbols-outlined text-sm mb-0.5">${escape_html(tab.icon)}</span> ${escape_html(tab.label)}</button>`);
    }
    $$renderer2.push(`<!--]--></div> <div class="flex items-center gap-3">`);
    if (store_get($$store_subs ??= {}, "$runStore", runStore).status === "live") {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<button type="button" class="px-5 py-1.5 border border-primary/20 text-primary font-mono text-xs uppercase hover:bg-primary/10 transition-colors rounded bg-transparent cursor-pointer">Pause</button> <button type="button" class="px-5 py-1.5 border border-error/20 text-error font-mono text-xs uppercase hover:bg-error/10 transition-colors rounded bg-transparent cursor-pointer">Stop</button>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <button type="button" class="px-4 py-1.5 border border-outline-variant/20 text-outline font-mono text-xs uppercase rounded bg-transparent cursor-pointer hover:text-on-surface">Back</button> <button type="button"${attr("disabled", deletingRun, true)} class="px-4 py-1.5 border border-error/20 text-error font-mono text-xs uppercase rounded bg-transparent cursor-pointer hover:bg-error/10 disabled:opacity-50 disabled:cursor-not-allowed">${escape_html("Delete Run")}</button></div></footer> <div class="bg-surface-container-low border-t border-outline-variant/10 h-40 overflow-hidden transition-all duration-300 flex-shrink-0">`);
    {
      $$renderer2.push("<!--[0-->");
      DecisionLog($$renderer2, {
        events: panelEvents(store_get($$store_subs ??= {}, "$runStore", runStore).events)
      });
    }
    $$renderer2.push(`<!--]--></div></div>`);
    if ($$store_subs) unsubscribe_stores($$store_subs);
  });
}
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    var $$store_subs;
    $$renderer2.push(`<!---->`);
    {
      RunDetail($$renderer2, {
        runId: store_get($$store_subs ??= {}, "$page", page).params.runId ?? ""
      });
    }
    $$renderer2.push(`<!---->`);
    if ($$store_subs) unsubscribe_stores($$store_subs);
  });
}
export {
  _page as default
};
