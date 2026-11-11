import type { ChatTurnRow } from "../db/chat-queries.js";
import { formatCost } from "@reactive-agents/ui-core";

/** Filesystem- and header-safe slug; falls back to `chat` when nothing usable remains. */
export function slugifyFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "chat";
}

function money(turn: ChatTurnRow): string {
  if (!turn.costKnown) return turn.costUsd > 0 ? `>= ${formatCost(turn.costUsd)} (cost unknown)` : "cost unknown";
  return formatCost(turn.costUsd);
}

/** A readable Markdown transcript: roles in order, tool calls, and model + cost per assistant turn. */
export function renderChatMarkdown(session: { readonly name: string }, turns: readonly ChatTurnRow[]): string {
  const out: string[] = [`# ${session.name}`, ""];
  for (const t of turns) {
    if (t.role === "user") {
      out.push("## You", "", t.content, "");
      continue;
    }
    out.push("## Assistant", "", t.content, "");
    const calls = t.trace?.toolCalls ?? [];
    if (calls.length > 0) {
      out.push("Tool calls:");
      for (const c of calls) out.push(`- ${c.name} (${c.status}${c.durationMs !== undefined ? `, ${c.durationMs}ms` : ""})`);
      out.push("");
    }
    const meta = [
      t.provider && t.model ? `${t.provider}/${t.model}` : t.model,
      `${t.tokensUsed.toLocaleString("en-US")} tokens`,
      money(t),
    ].filter(Boolean);
    out.push(`_${meta.join(" · ")}_`, "");
  }
  return out.join("\n");
}
