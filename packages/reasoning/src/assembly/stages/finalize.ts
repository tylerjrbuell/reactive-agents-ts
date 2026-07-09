import type { AssemblyCtx } from "../project.js";
import { pushStage, recordProjection } from "../trace.js";
import { surfacedRecallRefs } from "../ref-grammar.js";

/** A FRESH `result_ref="<ref>"` matcher (global flag → stateful lastIndex). */
const resultRefRe = (): RegExp => /result_ref="([^"]+)"/g;

/** Extract text content from a projected message (string or block array). */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text?: string }).text ?? "") : ""))
      .join("");
  }
  return "";
}

export const finalizeStage = (c: AssemblyCtx): AssemblyCtx => {
  // Trace.messages is recorded single-source by project-results (the sole c.messages
  // builder), in thread order with per-result projection tags. finalize must NOT
  // re-record — doing so double-counted assistant turns and appended the goal last,
  // producing a trace that misrepresented the real thread.
  //
  // D1 (Projector): finalize is also where the `projection` trace is assembled —
  // the traceability half of the two-way contract. Every rendered section carries
  // provenance (standing-frame refs); `refs` is the union of every ref reachable
  // from the window (result_ref pointers + recall hints across systemPrompt and
  // messages + standing-frame refs) so reachability is checkable; `droppedRefs`
  // mirrors compaction's enumeration; `chars` is the total rendered size.
  const rendered = [c.systemPrompt, ...c.messages.map((m) => messageText(m.content))].join("\n");

  const windowRefs = new Set<string>();
  for (const m of rendered.matchAll(resultRefRe())) {
    if (m[1]) windowRefs.add(m[1]);
  }
  for (const r of surfacedRecallRefs(rendered)) windowRefs.add(r);

  const standing = c.standingSections ?? [];
  for (const s of standing) for (const r of s.refs) windowRefs.add(r);

  const sections = [
    ...standing.map((s) => ({ name: s.name, refs: s.refs, chars: s.text.length })),
    {
      name: "evidence",
      refs: [...windowRefs].filter((r) => !standing.some((s) => s.refs.includes(r))),
      chars: c.messages.reduce((n, m) => n + messageText(m.content).length, 0),
    },
    { name: "systemPrompt", refs: [], chars: c.systemPrompt.length },
  ];

  const chars = c.systemPrompt.length + c.messages.reduce((n, m) => n + messageText(m.content).length, 0);

  const trace = recordProjection(
    pushStage(c.trace, "finalize", `${c.messages.length} messages`),
    {
      sections,
      refs: [...windowRefs],
      droppedRefs: c.trace.compaction?.droppedRefs ?? [],
      chars,
    },
  );

  return { ...c, trace };
};
