import { Effect } from "effect";
import type { AgentEvent, AgentEventTag } from "@reactive-agents/core";
import type { ObservableLoggerService } from "./observable-logger.js";
import type { LogEvent } from "../types.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const THINK_PREVIEW_LEN = 55;
const PANEL_LINES = 4;   // lines of think text shown when expanded
const PANEL_INDENT = "  ";

interface RendererState {
  phase: string;
  iteration: number;
  tool: string | null;
  thinkText: string;
  thinkExpanded: boolean;  // user toggled panel open
  drawnLines: number;      // panel lines currently drawn above status (0 = collapsed)
  tokens: number;
  costUsd: number;
  toolCallCount: number;
  entropy: number | null;
  entropyTrend: " ↑" | " ↓" | " →" | "";
  spinnerIdx: number;
  startMs: number;
  active: boolean;
}

/**
 * One frozen-on-completion summary line per tracked sub-agent.
 *
 * NOTE (scope, Task 7): expand/collapse of a sub-agent's line is NOT implemented
 * here. These lines are printed permanently to scrollback via `printLine` (not a
 * redrawable region), and this renderer has no per-sub-agent detail buffer to
 * expand INTO — a sub-agent's nested thought/tool detail is already streamed to
 * the console by the root's own EventBus subscription (Task 5), so re-printing it
 * on demand would duplicate it. A future task that adds a per-sub-agent detail
 * buffer can add an `expanded` flag then; until then this type deliberately
 * carries no expansion state rather than written-never-read fields.
 */
interface SubAgentLine {
  readonly taskId: string;
  readonly name: string;
  status: "running" | "done" | "error";
  startMs: number;
  tokens: number;
}

/**
 * Minimal shape of an `AgentStarted` event this renderer needs — deliberately
 * NOT the full event from `@reactive-agents/core`'s `event-bus.ts` (extra
 * fields like `provider`/`model`/`rootRunId` are ignored; structural typing
 * lets the real event satisfy this narrower shape).
 */
interface SubAgentStartedLike {
  readonly taskId: string;
  readonly agentId: string;
  readonly parentAgentId?: string;
  readonly agentDisplayName?: string;
}

/** Minimal shape of an `AgentCompleted` event this renderer needs. */
interface SubAgentCompletedLike {
  readonly taskId: string;
  readonly agentId: string;
  readonly success: boolean;
  readonly totalTokens: number;
  /** Present on the real event; not currently read (elapsed is computed from `startMs`). */
  readonly durationMs?: number;
}

/**
 * Narrow local view of the shared `EventBus`'s `.on()` method — only the
 * subscription half this renderer needs (no `publish`).
 *
 * The event types come from `@reactive-agents/core` (already a dependency of
 * this package), NOT `@reactive-agents/runtime` — `runtime` depends on
 * `observability`, so importing runtime's equivalent `EbLike`
 * (`engine/runtime-context.ts`) would create a package cycle. Because the
 * generic is constrained to the real `AgentEventTag` and the handler receives
 * the real `Extract<AgentEvent, { _tag: T }>`, this type is structurally
 * identical to both the real `EventBus.on` and runtime's `EbLike` — no cast is
 * needed at either boundary, and handlers get properly narrowed events.
 */
export interface EbLike {
  readonly on: <T extends AgentEventTag>(
    tag: T,
    handler: (event: Extract<AgentEvent, { _tag: T }>) => Effect.Effect<void, never>,
  ) => Effect.Effect<() => void, never>;
}

export interface StatusRenderer {
  readonly start: () => Effect.Effect<void, never>;
  readonly stop: () => void;
  /** Push a streaming think chunk — called per LLM text delta. */
  readonly pushThinkChunk: (text: string) => void;
  /** Begin tracking a sub-agent's collapsed live line. */
  readonly onAgentStarted: (event: SubAgentStartedLike) => void;
  /** Freeze a sub-agent's collapsed line to its done/failed summary. */
  readonly onAgentCompleted: (event: SubAgentCompletedLike) => void;
}

// ANSI SGR codes. Kept to the handful of icon colors this renderer needs —
// a dependency (chalk/picocolors) is overkill for wrapping five glyphs.
const ANSI = { green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", reset: "\x1b[0m" } as const;

export function makeStatusRenderer(
  logger: ObservableLoggerService,
  out: NodeJS.WriteStream = process.stdout,
  eb?: EbLike | null,
): StatusRenderer {
  const isTTY = Boolean(out.isTTY);
  // Respect NO_COLOR (https://no-color.org) same as every other color-aware
  // CLI tool — plain ASCII glyphs already carry the meaning (✓/✗/⚠), color
  // is a legibility bonus, not the only signal.
  const useColor = isTTY && !process.env.NO_COLOR;
  const color = (code: string, text: string): string => (useColor ? `${code}${text}${ANSI.reset}` : text);

  const s: RendererState = {
    phase: "starting",
    iteration: 0,
    tool: null,
    thinkText: "",
    thinkExpanded: true,
    drawnLines: 0,
    tokens: 0,
    costUsd: 0,
    toolCallCount: 0,
    entropy: null,
    entropyTrend: "",
    spinnerIdx: 0,
    startMs: Date.now(),
    active: false,
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  let unsub: (() => void) | null = null;
  let ebUnsubs: Array<() => void> = [];
  // Set only when setupKeyboard() actually took ownership of stdin's raw
  // mode — cleanupKeyboard() must not release a mode it never claimed.
  let ownsKeyboard = false;

  const subAgents = new Map<string, SubAgentLine>();

  // ─── Text helpers ────────────────────────────────────────────────────────────

  function elapsedStr(): string {
    const sec = (Date.now() - s.startMs) / 1000;
    if (sec < 60) return `${Math.round(sec)}s`;
    return `${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`;
  }

  function wrapText(text: string, width: number): string[] {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return [];
    const lines: string[] = [];
    let remaining = cleaned;
    while (remaining.length > 0) {
      if (remaining.length <= width) { lines.push(remaining); break; }
      const cut = remaining.lastIndexOf(" ", width);
      if (cut <= 0) { lines.push(remaining.slice(0, width)); remaining = remaining.slice(width); }
      else { lines.push(remaining.slice(0, cut)); remaining = remaining.slice(cut + 1); }
    }
    return lines;
  }

  function thinkPreview(): string {
    const text = s.thinkText.replace(/\s+/g, " ").trimStart();
    if (!text) return "Thinking...";
    const tail = text.length > THINK_PREVIEW_LEN ? "…" + text.slice(-THINK_PREVIEW_LEN) : text;
    return `"${tail}"`;
  }

  function statusLine(): string {
    const spin = SPINNER[s.spinnerIdx % SPINNER.length]!;
    let action: string;
    if (s.tool) {
      action = `Calling ${s.tool}...`;
    } else if (s.phase === "think") {
      action = s.thinkExpanded ? "Thinking..." : thinkPreview();
    } else if (s.phase === "act") {
      action = "Acting...";
    } else if (s.phase === "execution" || s.phase === "starting") {
      action = "Starting...";
    } else {
      action = `${s.phase.charAt(0).toUpperCase()}${s.phase.slice(1)}...`;
    }
    const parts: string[] = [`${spin}  ${action}`];
    if (s.iteration > 0) parts.push(`iter ${s.iteration}`);
    parts.push(elapsedStr());
    if (s.tokens > 0) parts.push(`${s.tokens.toLocaleString()} tok`);
    if (s.costUsd > 0) parts.push(`$${s.costUsd.toFixed(4)}`);
    if (s.entropy !== null && !s.tool) parts.push(`entropy ${s.entropy.toFixed(2)}${s.entropyTrend}`);
    // Keyboard hint
    if (isTTY && s.thinkText && s.phase === "think") {
      parts.push(s.thinkExpanded ? "[t: collapse]" : "[t: expand]");
    }
    return parts.join("  ·  ");
  }

  // ─── Panel (collapsible thinking block) ──────────────────────────────────────

  function panelLines(): string[] {
    const w = Math.max(20, (out.columns ?? 80) - PANEL_INDENT.length - 2);
    const all = wrapText(s.thinkText, w);
    // Show the most recent PANEL_LINES lines (tail of wrapped text)
    const visible = all.slice(Math.max(0, all.length - PANEL_LINES));
    while (visible.length < PANEL_LINES) visible.unshift("");
    return visible;
  }

  function writeStatus(): void {
    out.write(`\r\x1b[2K${statusLine()}`);
  }

  /**
   * Expand: writes the panel starting from the current cursor position.
   * Cursor must be on a writeable line (status line or blank line).
   * After: cursor is on the new status line, drawnLines = PANEL_LINES + 1.
   */
  function expandPanel(): void {
    if (!isTTY || !s.active || s.drawnLines > 0) return;
    out.write("\r\x1b[2K");  // clear current line (status)
    for (const line of panelLines()) {
      out.write(`${PANEL_INDENT}${line}\n`);
    }
    out.write(`${PANEL_INDENT}\x1b[2m[t: collapse thinking]\x1b[0m\n`);
    writeStatus();
    s.drawnLines = PANEL_LINES + 1;
  }

  /**
   * Collapse: clears the panel lines and the status line, positions cursor at
   * panel top (a blank line). Caller is responsible for writing the new status.
   * After: drawnLines = 0, cursor at panel top.
   */
  function collapsePanel(): void {
    if (!isTTY || s.drawnLines === 0) return;
    out.write(`\x1b[${s.drawnLines}A\r`);           // cursor → panel top
    for (let i = 0; i < s.drawnLines; i++) out.write("\r\x1b[2K\n");  // clear panel lines
    out.write("\r\x1b[2K");                           // clear old status line
    out.write(`\x1b[${s.drawnLines + 1}A\r`);        // cursor back to panel top
    s.drawnLines = 0;
  }

  /** Redraw the panel + status in-place. Cursor must be on the status line. */
  function redrawPanel(): void {
    out.write(`\x1b[${s.drawnLines}A\r`);
    for (const line of panelLines()) {
      out.write(`\r\x1b[2K${PANEL_INDENT}${line}\n`);
    }
    out.write(`\r\x1b[2K${PANEL_INDENT}\x1b[2m[t: collapse thinking]\x1b[0m\n`);
    writeStatus();
  }

  function redraw(): void {
    if (!isTTY || !s.active) return;
    if (s.drawnLines > 0) redrawPanel();
    else writeStatus();
  }

  function togglePanel(): void {
    s.thinkExpanded = !s.thinkExpanded;
    if (s.thinkExpanded && s.phase === "think" && s.thinkText) {
      expandPanel();
    } else if (!s.thinkExpanded && s.drawnLines > 0) {
      collapsePanel();
      writeStatus();
    } else {
      redraw();
    }
  }

  // ─── Keyboard ────────────────────────────────────────────────────────────────

  function onKey(key: string): void {
    if (key === "\x03") {
      // Ctrl+C in raw mode is captured here, not delivered as SIGINT
      // by the terminal. Previously this called `process.exit()`,
      // unilaterally killing the host. HS-11 (2026-05-20 sweep): tear
      // down the raw-mode keyboard hook and re-raise SIGINT so the
      // caller's signal handlers (or Node's defaults) decide the exit.
      cleanupKeyboard();
      process.kill(process.pid, "SIGINT");
      return;
    }
    if ((key === "t" || key === "T") && s.active) {
      // `t` toggles the ROOT's thinking panel only. It deliberately does NOT
      // expand/collapse sub-agent lines — those are permanent scrollback lines
      // with no detail buffer behind them (see `SubAgentLine`'s note). Stated
      // plainly rather than implemented as write-only state.
      togglePanel();
    }
  }

  function setupKeyboard(): void {
    if (!isTTY) return;
    try {
      if (!process.stdin.isTTY) return;
      // A host app's own `readline.createInterface({ input: process.stdin })`
      // (or anything else reading stdin directly) already has a 'data'
      // listener attached — that's how readline decodes raw bytes into
      // keypress/line events. If we ALSO call `setRawMode` and attach our
      // own listener here, our later `cleanupKeyboard()` forces the terminal
      // out of raw mode out from under readline without readline knowing,
      // desyncing its internal mode tracking — the next arrow-key press
      // then arrives as a literal, undecoded escape sequence (`^[[A`) instead
      // of recalling input history. Deferring to whoever got there first
      // means we lose the `t`-toggle / Ctrl+C rebind for that run, but that's
      // a fair trade for not breaking the host's own stdin handling.
      if (process.stdin.listenerCount("data") > 0) return;
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", onKey);
      ownsKeyboard = true;
    } catch { /* raw mode unavailable */ }
  }

  function cleanupKeyboard(): void {
    if (!isTTY || !ownsKeyboard) return;
    try {
      if (process.stdin.isTTY) {
        process.stdin.off("data", onKey);
        process.stdin.setRawMode(false);
        // Resume (not pause) so host REPLs (readline, playground) keep stdin
        // flowing after a run. pause() left scratch/playground loops exiting on
        // the second prompt with "readline was closed" / immediate EOF.
        process.stdin.resume();
      }
    } catch { /* ignore */ } finally {
      ownsKeyboard = false;
    }
  }

  // ─── Permanent line output ───────────────────────────────────────────────────

  function printLine(line: string): void {
    if (!isTTY) { out.write(`${line}\n`); return; }
    if (s.drawnLines > 0) collapsePanel();
    out.write(`\r\x1b[2K${line}\n`);
    writeStatus();
  }

  // ─── Sub-agent collapsed lines ────────────────────────────────────────────────

  function subAgentLineText(sa: SubAgentLine): string {
    const elapsed = `${((Date.now() - sa.startMs) / 1000).toFixed(1)}s`;
    if (sa.status === "running") {
      return `├─ spawn-agent → ${sa.name}  ●  ${elapsed}`;
    }
    const icon = sa.status === "done" ? color(ANSI.green, "✓") : color(ANSI.red, "✗");
    return `├─ spawn-agent → ${sa.name}  ${icon}  ${elapsed}  ${sa.tokens.toLocaleString()} tok`;
  }

  /**
   * Hoisted to a named function (rather than a property on the object this
   * factory returns) so the EventBus subscription set up in `start()` can
   * reference it directly — self-referencing the not-yet-constructed return
   * value from inside the constructor would require an awkward forward
   * declaration. The returned `StatusRenderer.onAgentStarted` below is the
   * same function, exposed for direct calls (e.g. by tests).
   */
  function onAgentStarted(event: SubAgentStartedLike): void {
    // `AgentStarted` fires for EVERY agent execution on the shared EventBus,
    // including the root run itself (`parentAgentId` undefined there) — this
    // renderer only tracks actual sub-agents (spawned via `spawn-agent`/
    // `spawn-agents`), never the root, which already has its own status line.
    // Caught live via a real-TTY manual check (Step 10): without this guard,
    // the root's own AgentStarted rendered a bogus "sub-agent" line for
    // itself. `onAgentCompleted` needs no matching guard — it only ever acts
    // on taskIds present in `subAgents`, and the root's taskId is never added.
    if (event.parentAgentId === undefined) return;
    subAgents.set(event.taskId, {
      taskId: event.taskId,
      name: event.agentDisplayName ?? event.agentId,
      status: "running",
      startMs: Date.now(),
      tokens: 0,
    });
    printLine(subAgentLineText(subAgents.get(event.taskId)!));
  }

  function onAgentCompleted(event: SubAgentCompletedLike): void {
    const sa = subAgents.get(event.taskId);
    if (!sa) return;
    sa.status = event.success ? "done" : "error";
    sa.tokens = event.totalTokens;
    printLine(subAgentLineText(sa));
  }

  // ─── Event handler ────────────────────────────────────────────────────────────

  function onEvent(event: LogEvent): void {
    switch (event._tag) {
      case "phase_started":
        s.phase = event.phase;
        if (event.phase !== "think") {
          s.thinkText = "";
          if (s.drawnLines > 0) { collapsePanel(); }
        }
        if (event.phase !== "execution") s.tool = null;
        redraw();
        break;

      case "tool_call":
        s.thinkText = "";
        if (s.drawnLines > 0) collapsePanel();
        s.tool = event.tool;
        redraw();
        break;

      case "tool_result": {
        s.toolCallCount++;
        const dur = `${(event.duration / 1000).toFixed(1)}s`;
        if (event.status === "success") {
          printLine(`→  ${event.tool}  ${color(ANSI.green, "✓")} ${dur}`);
        } else {
          printLine(`→  ${event.tool}  ${color(ANSI.red, "✗")} ${dur}${event.error ? ` — ${event.error}` : ""}`);
        }
        s.tool = null;
        break;
      }

      case "iteration":
        s.iteration = event.iteration;
        s.thinkText = "";
        s.tool = null;
        if (s.drawnLines > 0) { collapsePanel(); }
        redraw();
        break;

      case "metric":
        if (event.name === "tokens_used") { s.tokens = event.value; redraw(); }
        else if (event.name === "cost_usd") { s.costUsd = event.value; redraw(); }
        else if (event.name === "entropy") {
          const prev = s.entropy;
          s.entropy = event.value;
          s.entropyTrend = prev === null ? "" : event.value > prev + 0.05 ? " ↑" : event.value < prev - 0.05 ? " ↓" : " →";
          redraw();
        }
        break;

      case "warning":  printLine(`${color(ANSI.yellow, "⚠")}  ${event.message}`); break;
      case "error":    printLine(`${color(ANSI.red, "✗")}  ${event.message}`); break;
      case "notice":   printLine(`${color(ANSI.cyan, "ℹ")}  ${event.title} — ${event.message}`); break;

      case "completion": {
        if (s.drawnLines > 0) { collapsePanel(); }
        s.active = false;
        if (timer) { clearInterval(timer); timer = null; }
        const parts = [elapsedStr()];
        if (s.tokens > 0) parts.push(`${s.tokens.toLocaleString()} tok`);
        if (s.toolCallCount > 0) parts.push(`${s.toolCallCount} call${s.toolCallCount === 1 ? "" : "s"}`);
        parts.push(`$${s.costUsd.toFixed(4)}`);   // always show cost (even $0.0000 for local models)
        const line = event.success
          ? `${color(ANSI.green, "✓")}  Done  ·  ${parts.join("  ·  ")}`
          : `${color(ANSI.red, "✗")}  Failed  ·  ${parts.join("  ·  ")}`;
        out.write(isTTY ? `\r\x1b[2K${line}\n` : `${line}\n`);
        break;
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  return {
    start: (): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const unsubscribeFn = yield* logger.subscribe((_event, _formatted) =>
          Effect.sync(() => onEvent(_event)),
        );
        unsub = unsubscribeFn;
        s.active = true;
        s.startMs = Date.now();
        setupKeyboard();
        timer = setInterval(() => { s.spinnerIdx++; redraw(); }, 100);

        if (eb) {
          const unsubStarted = yield* eb.on("AgentStarted", (event) =>
            Effect.sync(() => onAgentStarted(event)),
          );
          const unsubCompleted = yield* eb.on("AgentCompleted", (event) =>
            Effect.sync(() => onAgentCompleted(event)),
          );
          ebUnsubs.push(unsubStarted, unsubCompleted);
        }
      }),

    stop: (): void => {
      if (s.drawnLines > 0) collapsePanel();
      s.active = false;
      if (timer) { clearInterval(timer); timer = null; }
      cleanupKeyboard();
      if (unsub) { unsub(); unsub = null; }
      for (const fn of ebUnsubs) fn();
      ebUnsubs = [];
      if (isTTY) out.write("\r\x1b[2K");
    },

    pushThinkChunk: (text: string): void => {
      s.thinkText += text;
      if (!s.thinkExpanded) { redraw(); return; }
      // Expanded: show or refresh the panel
      if (s.drawnLines > 0) redrawPanel();
      else if (s.phase === "think") expandPanel();
    },

    onAgentStarted,
    onAgentCompleted,
  };
}
