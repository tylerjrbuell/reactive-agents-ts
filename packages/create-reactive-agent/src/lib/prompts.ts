import * as readline from "node:readline/promises";

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m",
};

function color(s: string, c: keyof typeof COLORS): string {
  if (!process.stdout.isTTY) return s;
  return `${COLORS[c]}${s}${COLORS.reset}`;
}

export interface PromptIO {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
}

const defaultIO: PromptIO = { input: process.stdin, output: process.stdout };

export async function promptText(
  question: string,
  fallback: string,
  io: PromptIO = defaultIO,
): Promise<string> {
  const rl = readline.createInterface({ input: io.input, output: io.output });
  try {
    const ans = await rl.question(`${color("?", "cyan")} ${question} ${color(`(${fallback})`, "dim")} `);
    const t = ans.trim();
    return t.length === 0 ? fallback : t;
  } finally {
    rl.close();
  }
}

export async function promptSelect<T extends string>(
  question: string,
  options: readonly { value: T; label: string }[],
  fallback: T,
  io: PromptIO = defaultIO,
): Promise<T> {
  const rl = readline.createInterface({ input: io.input, output: io.output });
  try {
    io.output.write(`${color("?", "cyan")} ${question}\n`);
    options.forEach((o, i) => {
      const marker = o.value === fallback ? color("(default)", "dim") : "";
      io.output.write(`  ${color(String(i + 1), "yellow")}) ${o.label} ${marker}\n`);
    });
    const ans = await rl.question(`${color("›", "cyan")} `);
    const t = ans.trim();
    if (t.length === 0) return fallback;
    const n = Number.parseInt(t, 10);
    if (Number.isFinite(n) && n >= 1 && n <= options.length) {
      return options[n - 1]!.value;
    }
    const byValue = options.find((o) => o.value === t);
    return byValue ? byValue.value : fallback;
  } finally {
    rl.close();
  }
}

export function logSuccess(msg: string): void {
  process.stdout.write(`${color("✓", "green")} ${msg}\n`);
}

export function logInfo(msg: string): void {
  process.stdout.write(`${color("•", "cyan")} ${msg}\n`);
}

export function logHeader(msg: string): void {
  process.stdout.write(`\n${color(msg, "bold")}\n`);
}
