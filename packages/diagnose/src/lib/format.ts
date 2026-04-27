// Terminal formatting helpers — small, dependency-free ANSI without chalk.
// Falls back to plain text when stdout is not a TTY (CI/pipe-friendly).

const isTTY = (): boolean => {
  try {
    return Boolean(process.stdout.isTTY);
  } catch {
    return false;
  }
};

const wrap = (code: string) => (text: string): string =>
  isTTY() ? `\x1b[${code}m${text}\x1b[0m` : text;

export const dim = wrap("2");
export const bold = wrap("1");
export const red = wrap("31");
export const green = wrap("32");
export const yellow = wrap("33");
export const blue = wrap("34");
export const magenta = wrap("35");
export const cyan = wrap("36");
export const gray = wrap("90");

export function badge(label: string, color: (s: string) => string): string {
  return color(`[${label}]`);
}

export function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}K`;
  return `${(b / 1024 / 1024).toFixed(1)}M`;
}

export function truncate(text: string, max: number): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function indent(text: string, n = 2): string {
  const pad = " ".repeat(n);
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}
