/** Session name a chat starts with; only a session still carrying it is eligible for auto-naming. */
export const DEFAULT_CHAT_NAME = "New Chat";

const MAX_TITLE = 60;

/** Instant, model-free title: the first line of the user's message, clipped at a word. */
export function fallbackChatTitle(userMessage: string): string {
  const line = userMessage.replace(/\s+/g, " ").trim();
  if (line.length === 0) return DEFAULT_CHAT_NAME;
  if (line.length <= MAX_TITLE) return line;
  const cut = line.slice(0, MAX_TITLE);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Normalise a model-written title: single line, no wrapping quotes / markdown / trailing period. */
export function cleanChatTitle(raw: string): string {
  const first = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const stripped = first
    .replace(/^(title\s*:\s*)/i, "")
    .replace(/^["'`*_#\s]+|["'`*_\s]+$/g, "")
    .replace(/\.$/, "")
    .trim();
  return stripped.length > MAX_TITLE ? fallbackChatTitle(stripped) : stripped;
}
