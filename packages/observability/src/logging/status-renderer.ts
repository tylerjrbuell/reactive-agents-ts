import { Effect } from "effect";
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

export interface StatusRenderer {
  readonly start: () => Effect.Effect<void, never>;
  readonly stop: () => void;
  /** Push a streaming think chunk — called per LLM text delta. */
  readonly pushThinkChunk: (text: string) => void;
}

export function makeStatusRenderer(
  logger: ObservableLoggerService,
  out: NodeJS.WriteStream = process.stdout,
): StatusRenderer {
  const isTTY = Boolean(out.isTTY);

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
    if (key === "\x03") process.exit();                 // Ctrl+C
    if ((key === "t" || key === "T") && s.active) togglePanel();
  }

  function setupKeyboard(): void {
    if (!isTTY) return;
    try {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", onKey);
      }
    } catch { /* raw mode unavailable */ }
  }

  function cleanupKeyboard(): void {
    if (!isTTY) return;
    try {
      if (process.stdin.isTTY) {
        process.stdin.off("data", onKey);
        process.stdin.setRawMode(false);
        process.stdin.pause();
      }
    } catch { /* ignore */ }
  }

  // ─── Permanent line output ───────────────────────────────────────────────────

  function printLine(line: string): void {
    if (!isTTY) { out.write(`${line}\n`); return; }
    if (s.drawnLines > 0) collapsePanel();
    out.write(`\r\x1b[2K${line}\n`);
    writeStatus();
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
          printLine(`→  ${event.tool}  ✓ ${dur}`);
        } else {
          printLine(`→  ${event.tool}  ✗ ${dur}${event.error ? ` — ${event.error}` : ""}`);
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

      case "warning":  printLine(`⚠  ${event.message}`); break;
      case "error":    printLine(`✗  ${event.message}`); break;
      case "notice":   printLine(`ℹ  ${event.title} — ${event.message}`); break;

      case "completion": {
        if (s.drawnLines > 0) { collapsePanel(); }
        s.active = false;
        if (timer) { clearInterval(timer); timer = null; }
        const parts = [elapsedStr()];
        if (s.tokens > 0) parts.push(`${s.tokens.toLocaleString()} tok`);
        if (s.toolCallCount > 0) parts.push(`${s.toolCallCount} call${s.toolCallCount === 1 ? "" : "s"}`);
        parts.push(`$${s.costUsd.toFixed(4)}`);   // always show cost (even $0.0000 for local models)
        const line = event.success
          ? `✓  Done  ·  ${parts.join("  ·  ")}`
          : `✗  Failed  ·  ${parts.join("  ·  ")}`;
        out.write(isTTY ? `\r\x1b[2K${line}\n` : `${line}\n`);
        break;
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  return {
    start: (): Effect.Effect<void, never> =>
      logger.subscribe((_event, _formatted) =>
        Effect.sync(() => onEvent(_event)),
      ).pipe(
        Effect.flatMap((unsubscribeFn) =>
          Effect.sync(() => {
            unsub = unsubscribeFn;
            s.active = true;
            s.startMs = Date.now();
            setupKeyboard();
            timer = setInterval(() => { s.spinnerIdx++; redraw(); }, 100);
          }),
        ),
      ),

    stop: (): void => {
      if (s.drawnLines > 0) collapsePanel();
      s.active = false;
      if (timer) { clearInterval(timer); timer = null; }
      cleanupKeyboard();
      if (unsub) { unsub(); unsub = null; }
      if (isTTY) out.write("\r\x1b[2K");
    },

    pushThinkChunk: (text: string): void => {
      s.thinkText += text;
      if (!s.thinkExpanded) { redraw(); return; }
      // Expanded: show or refresh the panel
      if (s.drawnLines > 0) redrawPanel();
      else if (s.phase === "think") expandPanel();
    },
  };
}
