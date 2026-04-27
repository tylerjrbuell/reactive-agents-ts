// `rax diagnose replay <runId>` — pretty-print a trace as a structured timeline.
//
// Default view groups events by iteration, shows timing, signals key transitions
// (verifier rejections, harness signals, strategy switches). Use --raw to get
// per-event lines or --json for the full JSONL stream.

import { loadTrace, traceStats, type TraceEvent } from "@reactive-agents/trace";
import { resolveTracePath } from "../lib/resolve.js";
import {
  badge, bold, cyan, dim, fmtMs, gray, green, red, truncate, yellow, indent,
} from "../lib/format.js";

export interface ReplayOpts {
  readonly raw?: boolean;
  readonly json?: boolean;
  readonly only?: readonly string[]; // filter to these kinds
}

export async function replayCommand(idOrPath: string, opts: ReplayOpts = {}): Promise<void> {
  const path = await resolveTracePath(idOrPath);
  const trace = await loadTrace(path);
  const stats = traceStats(trace);

  if (opts.json) {
    for (const ev of trace.events) console.log(JSON.stringify(ev));
    return;
  }

  // ── Header ──
  console.log("");
  console.log(bold(`Trace ${trace.runId}`));
  console.log(dim(`  ${path}`));
  console.log("");

  // ── Stats line ──
  const statsParts = [
    `${trace.events.length} events`,
    `${stats.iterations} iter`,
    `${stats.toolCalls} tools`,
    `${stats.llmExchanges} llm`,
    stats.verifierRejections > 0
      ? red(`${stats.verifierRejections}/${stats.verifierVerdicts} verifier rejections`)
      : `${stats.verifierVerdicts} verifier verdicts`,
    stats.harnessSignalsInjected > 0
      ? yellow(`${stats.harnessSignalsInjected} harness signals`)
      : `${stats.harnessSignalsInjected} harness signals`,
    `${stats.totalTokens} tok`,
    fmtMs(stats.durationMs),
  ];
  console.log(`${dim("│")} ${statsParts.join(`  ${dim("·")}  `)}`);
  console.log("");

  // ── Raw mode: one event per line ──
  if (opts.raw) {
    for (const ev of trace.events) {
      if (opts.only && !opts.only.includes(ev.kind)) continue;
      console.log(formatEventLine(ev));
    }
    return;
  }

  // ── Grouped timeline by iteration ──
  const filtered = opts.only
    ? trace.events.filter((e) => opts.only!.includes(e.kind))
    : trace.events;

  let lastIter = -2;
  for (const ev of filtered) {
    if (ev.iter !== lastIter && ev.iter >= 0) {
      console.log(bold(`\n── iter ${ev.iter} ──`));
      lastIter = ev.iter;
    } else if (ev.iter < 0 && lastIter !== -2) {
      // separator after iteration body, before final events
      lastIter = -2;
      console.log("");
    }
    console.log(indent(formatEventLine(ev), 2));
  }
  console.log("");
}

function formatEventLine(ev: TraceEvent): string {
  const ts = dim(`[+${ev.seq}]`);
  switch (ev.kind) {
    case "run-started":
      return `${ts} ${badge("run-start", cyan)} task model=${ev.model} provider=${ev.provider}`;
    case "run-completed": {
      const status = ev.status === "success" ? green(ev.status) : red(ev.status);
      return `${ts} ${badge("run-end", cyan)} ${status} tokens=${ev.totalTokens} ${fmtMs(ev.durationMs)}`;
    }
    case "kernel-state-snapshot": {
      const stepStr = Object.entries(ev.stepsByType)
        .map(([k, n]) => `${k}=${n}`)
        .join(" ");
      const out = ev.outputLen > 0 ? ` out=${ev.outputLen}b` : "";
      return `${ts} ${badge("snapshot", gray)} status=${ev.status} steps=${ev.stepsCount} (${stepStr || "-"})${out} tools=[${ev.toolsUsed.join(",")}]`;
    }
    case "verifier-verdict": {
      const ok = ev.verified ? green("✓") : red("✗");
      return `${ts} ${badge("verifier", ev.verified ? green : red)} ${ok} ${ev.summary}`;
    }
    case "guard-fired":
      return `${ts} ${badge("guard", yellow)} ${ev.guard}=${ev.outcome} ${dim(ev.reason)}`;
    case "harness-signal-injected":
      return `${ts} ${badge("harness", yellow)} ${ev.signalKind} ${dim(`(${ev.origin})`)} ${truncate(ev.contentPreview, 100)}`;
    case "llm-exchange": {
      const tokens = ev.response.tokensIn !== undefined ? `in=${ev.response.tokensIn} out=${ev.response.tokensOut}` : "";
      const tools = ev.response.toolCalls?.length ? ` tools=[${ev.response.toolCalls.map((t) => t.name).join(",")}]` : "";
      return `${ts} ${badge("llm", cyan)} ${ev.requestKind} ${ev.model} ${tokens}${tools} ${fmtMs(ev.response.durationMs)}`;
    }
    case "tool-call-start":
      return `${ts} ${badge("tool", cyan)} → ${ev.toolName}`;
    case "tool-call-end":
      return `${ts} ${badge("tool", ev.ok ? green : red)} ← ${ev.toolName} ${ev.ok ? "ok" : "FAIL"} ${fmtMs(ev.durationMs)}${ev.error ? ` ${dim(ev.error)}` : ""}`;
    case "entropy-scored":
      return `${ts} ${badge("entropy", gray)} ${ev.composite.toFixed(2)}`;
    case "decision-evaluated":
      return `${ts} ${badge("decide", cyan)} ${ev.decisionType} conf=${ev.confidence.toFixed(2)} ${dim(ev.reason)}`;
    case "intervention-dispatched":
      return `${ts} ${badge("interv", cyan)} ${ev.decisionType} → ${ev.patchKind}`;
    case "intervention-suppressed":
      return `${ts} ${badge("interv", gray)} ${ev.decisionType} suppressed (${ev.reason})`;
    case "strategy-switched":
      return `${ts} ${badge("strategy", yellow)} ${ev.from} → ${ev.to} ${dim(ev.reason)}`;
    case "phase-enter":
    case "phase-exit":
      return `${ts} ${badge(ev.kind, gray)} ${ev.phase}${ev.durationMs !== undefined ? ` ${fmtMs(ev.durationMs)}` : ""}`;
    case "iteration-enter":
    case "iteration-exit":
      return `${ts} ${badge(ev.kind, gray)}`;
    case "state-patch-applied":
      return `${ts} ${badge("patch", gray)} ${ev.patchKind}`;
    case "message-appended":
      return `${ts} ${badge("msg", gray)} ${ev.role} (${ev.tokenCount} tok)`;
    default: {
      // Exhaustiveness via cast — keeps the switch open to future kinds.
      const e = ev as { kind: string };
      return `${ts} ${dim(e.kind)}`;
    }
  }
}
