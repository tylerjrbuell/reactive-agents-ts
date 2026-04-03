/**
 * One-line-ish preview of markdown for compact UI (not rendered as HTML).
 */
export function plainPreviewFromMarkdown(source: string, maxChars = 160): string {
  let s = source.replace(/\$\$[\s\S]*?\$\$/g, " … ");
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`[^`]+`/g, " ");
  s = s.replace(/#{1,6}\s+/g, "");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/\[([^\]]+)]\([^)]+\)/g, "$1");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * Prefer expanded chrome when the answer fits in a small viewport without scrolling.
 */
export function preferExpandedDeliverable(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  const lines = t.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return t.length <= 360 && lines.length <= 5;
}
