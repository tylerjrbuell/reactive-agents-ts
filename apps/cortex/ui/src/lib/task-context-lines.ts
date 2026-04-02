/** One `key=value` per line → {@link Record} for `withTaskContext` (empty lines skipped). */
export function parseTaskContextLines(s: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const line of s.split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k.length > 0) o[k] = v;
  }
  return o;
}

export function formatTaskContextLines(ctx: Record<string, string>): string {
  return Object.entries(ctx)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}
