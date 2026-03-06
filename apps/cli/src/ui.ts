const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";

function color(text: string, ansi: string): string {
  return `${ansi}${text}${RESET}`;
}

export function section(title: string): string {
  return `\n${color("==", DIM)} ${color(title, BOLD)} ${color("==", DIM)}`;
}

export function info(message: string): string {
  return `${color("i", CYAN)} ${message}`;
}

export function success(message: string): string {
  return `${color("+", GREEN)} ${message}`;
}

export function warn(message: string): string {
  return `${color("!", YELLOW)} ${message}`;
}

export function fail(message: string): string {
  return `${color("x", RED)} ${message}`;
}

export function event(label: string, message: string): string {
  return `${color(`${label}>`, MAGENTA)} ${message}`;
}

export function kv(key: string, value: string): string {
  return `  ${color(`${key}:`, DIM)} ${value}`;
}

export function hint(message: string): string {
  return `  ${color("tip:", DIM)} ${message}`;
}

export function muted(message: string): string {
  return color(message, DIM);
}
