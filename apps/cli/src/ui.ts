import chalk from "chalk";
import ora, { type Ora } from "ora";
import boxen from "boxen";

// ── Brand Colors ──────────────────────────────────────────
const VIOLET = "#8b5cf6";
const CYAN = "#06b6d4";
const YELLOW = "#eab308";
const GREEN = "#22c55e";
const RED = "#ef4444";
const DIM_COLOR = "#6b7280";

// ── Preserved API (internals upgraded) ────────────────────

export function color(text: string, _ansi: string): string {
  return chalk.dim(text);
}

export function section(title: string): string {
  return `\n${chalk.hex(DIM_COLOR)("══")} ${chalk.bold(title)} ${chalk.hex(DIM_COLOR)("══")}`;
}

export function info(message: string): string {
  return `${chalk.hex(CYAN)("ℹ")} ${message}`;
}

export function success(message: string): string {
  return `${chalk.hex(GREEN)("✔")} ${message}`;
}

export function warn(message: string): string {
  return `${chalk.hex(YELLOW)("⚠")} ${message}`;
}

export function fail(message: string): string {
  return `${chalk.hex(RED)("✖")} ${message}`;
}

export function event(label: string, message: string): string {
  return `${chalk.hex(VIOLET)(`${label}›`)} ${message}`;
}

export function kv(key: string, value: string): string {
  return `  ${chalk.hex(DIM_COLOR)(`${key}:`)} ${value}`;
}

export function hint(message: string): string {
  return `  ${chalk.hex(DIM_COLOR)("tip:")} ${message}`;
}

export function muted(message: string): string {
  return chalk.hex(DIM_COLOR)(message);
}

// ── New Helpers ───────────────────────────────────────────

/** Boxen-wrapped banner header with violet border. */
export function banner(title: string, subtitle?: string): void {
  const content = subtitle
    ? `${chalk.bold.hex(VIOLET)(title)}\n${chalk.hex(DIM_COLOR)(subtitle)}`
    : chalk.bold.hex(VIOLET)(title);

  console.log(
    boxen(content, {
      padding: { top: 1, bottom: 1, left: 3, right: 3 },
      borderColor: VIOLET,
      borderStyle: "round",
    }),
  );
}

/** Styled ora spinner. Returns handle for .succeed(), .fail(), .text = ... */
export function spinner(text: string): Ora {
  return ora({
    text,
    color: "magenta",
    spinner: "dots",
    discardStdin: false,
  }).start();
}

/**
 * Lightweight spinner safe for use inside readline loops.
 * Uses \r line rewrites only — no cursor hiding, no stdin manipulation.
 * Won't interfere with readline or process.stdin.
 */
export function inlineSpinner(text: string) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const render = () => {
    const frame = chalk.hex(VIOLET)(frames[i % frames.length]);
    process.stdout.write(`\r${frame} ${text}`);
    i++;
  };
  render();
  const id = setInterval(render, 80);

  return {
    /** Clear spinner line and print success message. */
    succeed(msg: string) {
      clearInterval(id);
      process.stdout.write(`\r\x1b[K${success(msg)}\n`);
    },
    /** Clear spinner line and print failure message. */
    fail(msg: string) {
      clearInterval(id);
      process.stdout.write(`\r\x1b[K${fail(msg)}\n`);
    },
    /** Clear spinner line and print info message. */
    stop(msg?: string) {
      clearInterval(id);
      if (msg) process.stdout.write(`\r\x1b[K${msg}\n`);
      else process.stdout.write(`\r\x1b[K`);
    },
    /** Update the spinner text. */
    set text(newText: string) {
      text = newText;
    },
  };
}

/** Boxen wrapper with consistent styling. */
export function box(
  content: string,
  opts?: { title?: string; borderColor?: string; dimBorder?: boolean },
): void {
  console.log(
    boxen(content, {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      borderColor: opts?.borderColor ?? CYAN,
      borderStyle: "round",
      title: opts?.title,
      titleAlignment: "left",
      dimBorder: opts?.dimBorder ?? false,
    }),
  );
}

/** Formatted agent response with cyan accent. */
export function agentResponse(text: string): void {
  box(text, { title: chalk.hex(CYAN)(" Agent "), borderColor: CYAN });
}

/** Colored tool call indicator. */
export function toolCall(
  name: string,
  status: "start" | "done" | "error",
  duration?: number,
): void {
  const icon = status === "start" ? "🔧" : status === "done" ? "✅" : "❌";
  const dur = duration !== undefined ? ` ${chalk.hex(DIM_COLOR)(`${duration}ms`)}` : "";
  const nameStr =
    status === "error" ? chalk.hex(RED)(name) : chalk.hex(CYAN)(name);
  console.log(`${icon} ${nameStr}${dur}`);
}

/** Iteration progress line. */
export function thinking(iteration: number, max?: number): void {
  const progress = max ? `${iteration}/${max}` : `${iteration}`;
  console.log(
    `${chalk.hex(VIOLET)("💭")} ${chalk.hex(DIM_COLOR)(`Step ${progress}`)} ${chalk.hex(DIM_COLOR)("— thinking...")}`,
  );
}

/** Aligned key-value metric pair. */
export function metric(label: string, value: string | number): void {
  const padded = label.padEnd(14);
  console.log(`  ${chalk.hex(DIM_COLOR)(padded)} ${chalk.bold(String(value))}`);
}

/** Subtle horizontal divider. */
export function divider(): void {
  console.log(chalk.hex(DIM_COLOR)("─".repeat(50)));
}

/** Styled prompt string for readline. */
export function styledPrompt(prefix?: string): string {
  const p = prefix ?? "❯";
  return `${p} `;
}

/** Metrics summary one-liner for post-run display. */
export function metricsSummary(opts: {
  duration: number;
  steps: number;
  tokens: number;
  tools: number;
  success: boolean;
}): void {
  const icon = opts.success ? chalk.hex(GREEN)("✔") : chalk.hex(RED)("✖");
  const dur = `${(opts.duration / 1000).toFixed(1)}s`;
  console.log(
    `${icon} ${dur} · ${opts.steps} steps · ${opts.tokens.toLocaleString()} tokens · ${opts.tools} tools`,
  );
}

// ── Dashboard Renderer ────────────────────────────────────

export interface DashboardPhase {
  readonly name: string;
  readonly duration: number;
  readonly status: "success" | "warning" | "error";
  readonly detail?: string;
}

export interface DashboardTool {
  readonly name: string;
  readonly calls: number;
  readonly errors: number;
  readonly avgDuration: number;
}

export interface DashboardData {
  readonly status: "success" | "error" | "partial";
  readonly totalDuration: number;
  readonly stepCount: number;
  readonly tokenCount: number;
  readonly estimatedCost: number;
  readonly modelName: string;
  readonly provider: string;
  readonly phases: readonly DashboardPhase[];
  readonly tools: readonly DashboardTool[];
  readonly alerts: readonly string[];
}

/** Render a rich metrics dashboard using boxen + chalk. */
export function renderDashboard(data: DashboardData): void {
  const statusIcon =
    data.status === "success"
      ? chalk.hex(GREEN)("✔ Success")
      : data.status === "error"
        ? chalk.hex(RED)("✖ Failed")
        : chalk.hex(YELLOW)("⚠ Partial");

  const dur = `${(data.totalDuration / 1000).toFixed(1)}s`;
  const cost = `~$${data.estimatedCost.toFixed(4)}`;

  const header = [
    `${chalk.bold("Status:")}    ${statusIcon}   ${chalk.bold("Duration:")} ${dur}   ${chalk.bold("Steps:")} ${data.stepCount}`,
    `${chalk.bold("Tokens:")}    ${data.tokenCount.toLocaleString()}        ${chalk.bold("Cost:")} ${cost}     ${chalk.bold("Model:")} ${data.modelName}`,
  ].join("\n");

  box(header, {
    title: chalk.hex(GREEN).bold(" Execution Summary "),
    borderColor: data.status === "success" ? GREEN : data.status === "error" ? RED : YELLOW,
  });

  if (data.phases.length > 0) {
    console.log(`\n${chalk.bold("📊 Execution Timeline")}`);
    const totalMs = data.totalDuration || 1;
    for (let i = 0; i < data.phases.length; i++) {
      const p = data.phases[i];
      const prefix = i === data.phases.length - 1 ? "└─" : "├─";
      const pct = ((p.duration / totalMs) * 100).toFixed(0);
      const durStr = `${p.duration.toLocaleString()}ms`.padStart(10);
      const icon =
        p.status === "warning"
          ? chalk.hex(YELLOW)("⚠️")
          : p.status === "error"
            ? chalk.hex(RED)("✖")
            : chalk.hex(GREEN)("✔");
      const detail = p.detail ? chalk.hex(DIM_COLOR)(` (${p.detail})`) : "";
      const nameStr = chalk.hex(DIM_COLOR)(`[${p.name}]`).padEnd(25);
      console.log(
        `${prefix} ${nameStr} ${durStr}  ${icon}  ${chalk.hex(DIM_COLOR)(`${pct}%`)}${detail}`,
      );
    }
  }

  if (data.tools.length > 0) {
    console.log(`\n${chalk.bold("🔧 Tool Execution")} (${data.tools.length} tool${data.tools.length === 1 ? "" : "s"})`);
    for (let i = 0; i < data.tools.length; i++) {
      const t = data.tools[i];
      const prefix = i === data.tools.length - 1 ? "└─" : "├─";
      const errStr =
        t.errors > 0 ? chalk.hex(RED)(` ${t.errors} errors`) : "";
      console.log(
        `${prefix} ${chalk.hex(CYAN)(t.name)}  ${chalk.hex(GREEN)("✔")} ${t.calls} calls, ${t.avgDuration}ms avg${errStr}`,
      );
    }
  }

  if (data.alerts.length > 0) {
    console.log(`\n${chalk.hex(YELLOW).bold("⚠️  Alerts")}`);
    for (let i = 0; i < data.alerts.length; i++) {
      const prefix = i === data.alerts.length - 1 ? "└─" : "├─";
      console.log(`${prefix} ${data.alerts[i]}`);
    }
  }
}

/** Legacy compat — deprecated in favor of spinner(). */
export function createSpinner(message: string) {
  const s = spinner(message);
  return {
    stop(finalMessage?: string) {
      if (finalMessage) s.succeed(finalMessage);
      else s.succeed();
    },
    fail(finalMessage: string) {
      s.fail(finalMessage);
    },
  };
}
