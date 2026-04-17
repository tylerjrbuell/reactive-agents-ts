import { Effect } from "effect";
import type { ObservableLoggerService } from "./observable-logger.js";
import type { LogEvent } from "../types.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const THINK_PREVIEW_LEN = 55;

interface RendererState {
  phase: string;
  iteration: number;
  tool: string | null;
  thinkText: string;
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

  function elapsedStr(): string {
    const sec = (Date.now() - s.startMs) / 1000;
    if (sec < 60) return `${Math.round(sec)}s`;
    return `${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`;
  }

  function thinkPreview(): string {
    const text = s.thinkText.replace(/\s+/g, " ").trimStart();
    if (text.length === 0) return "Thinking...";
    const tail = text.length > THINK_PREVIEW_LEN ? "…" + text.slice(-THINK_PREVIEW_LEN) : text;
    return `"${tail}"`;
  }

  function statusLine(): string {
    const spin = SPINNER[s.spinnerIdx % SPINNER.length]!;

    let action: string;
    if (s.tool) {
      action = `Calling ${s.tool}...`;
    } else if (s.phase === "think") {
      action = thinkPreview();
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
    if (s.entropy !== null && !s.tool) {
      parts.push(`entropy ${s.entropy.toFixed(2)}${s.entropyTrend}`);
    }

    return parts.join("  ·  ");
  }

  function redraw(): void {
    if (!isTTY || !s.active) return;
    out.write(`\r\x1b[2K${statusLine()}`);
  }

  function printLine(line: string): void {
    if (isTTY) {
      out.write(`\r\x1b[2K${line}\n`);
    } else {
      out.write(`${line}\n`);
    }
    redraw();
  }

  function onEvent(event: LogEvent): void {
    switch (event._tag) {
      case "phase_started":
        s.phase = event.phase;
        if (event.phase !== "think") s.thinkText = "";
        if (event.phase !== "execution") s.tool = null;
        redraw();
        break;
      case "tool_call":
        s.thinkText = "";
        s.tool = event.tool;
        printLine(`→  ${event.tool}`);
        break;
      case "tool_result": {
        s.toolCallCount++;
        const durationStr = `${(event.duration / 1000).toFixed(1)}s`;
        if (event.status === "success") {
          printLine(`   ✓ ${event.tool} (${durationStr})`);
        } else {
          const errStr = event.error ? ` — ${event.error}` : "";
          printLine(`   ✗ ${event.tool} (${durationStr})${errStr}`);
        }
        s.tool = null;
        break;
      }
      case "iteration":
        s.iteration = event.iteration;
        s.thinkText = "";
        s.tool = null;
        redraw();
        break;
      case "metric":
        if (event.name === "tokens_used") {
          s.tokens = event.value;
          redraw();
        } else if (event.name === "cost_usd") {
          s.costUsd = event.value;
          redraw();
        } else if (event.name === "entropy") {
          const prev = s.entropy;
          s.entropy = event.value;
          if (prev === null) {
            s.entropyTrend = "";
          } else if (event.value > prev + 0.05) {
            s.entropyTrend = " ↑";
          } else if (event.value < prev - 0.05) {
            s.entropyTrend = " ↓";
          } else {
            s.entropyTrend = " →";
          }
          redraw();
        }
        break;
      case "warning":
        printLine(`⚠  ${event.message}`);
        break;
      case "error":
        printLine(`✗  ${event.message}`);
        break;
      case "notice":
        printLine(`ℹ  ${event.title} — ${event.message}`);
        break;
      case "completion": {
        s.active = false;
        if (timer) { clearInterval(timer); timer = null; }
        const parts = [elapsedStr()];
        if (s.tokens > 0) parts.push(`${s.tokens.toLocaleString()} tok`);
        if (s.toolCallCount > 0) parts.push(`${s.toolCallCount} call${s.toolCallCount === 1 ? "" : "s"}`);
        if (s.costUsd > 0) parts.push(`$${s.costUsd.toFixed(4)}`);
        const statsStr = parts.join("  ·  ");
        const line = event.success
          ? `✓  Done  ·  ${statsStr}`
          : `✗  Failed  ·  ${statsStr}`;
        if (isTTY) out.write(`\r\x1b[2K${line}\n`);
        else out.write(`${line}\n`);
        break;
      }
    }
  }

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
            timer = setInterval(() => {
              s.spinnerIdx++;
              redraw();
            }, 100);
          }),
        ),
      ),

    stop: (): void => {
      s.active = false;
      if (timer) { clearInterval(timer); timer = null; }
      if (unsub) { unsub(); unsub = null; }
      if (isTTY) out.write("\r\x1b[2K");
    },

    pushThinkChunk: (text: string): void => {
      s.thinkText += text;
      redraw();
    },
  };
}
