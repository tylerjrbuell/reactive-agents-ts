import { CORTEX_SERVER_URL } from "$lib/constants.js";

/**
 * A chat turn paused on `request_user_input` (server `chat-approvals.ts`). The agent asked
 * the user something; its user message waits off-thread until the reply resumes the run.
 */
export interface ChatPendingInteractionWire {
  readonly runId: string;
  readonly sessionId: string;
  /** What the user last said before the question. */
  readonly userMessage: string;
  readonly interactionId: string;
  /** `form` | `choice` | `confirmation`; anything else gets a free-text reply box. */
  readonly kind: string;
  readonly prompt: string;
  readonly schema: unknown;
  readonly createdAt: number;
}

/** One field of a `form` interaction. */
export interface InteractionField {
  readonly name: string;
  readonly label: string;
  readonly type: "text" | "number" | "boolean";
  readonly required: boolean;
}

/** Server answer to a reply: the run finished, paused again, or failed. */
export type InteractionReplyResult =
  | { readonly ok: true; readonly status: "completed" | "awaiting-approval" | "awaiting-interaction" | "dismissed" }
  | { readonly ok: false; readonly status: number; readonly error: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The options of a `choice` interaction (`schema.options`, strings only). */
export function choiceOptions(schema: unknown): string[] {
  const options = isRecord(schema) ? schema.options : undefined;
  return Array.isArray(options) ? options.filter((o): o is string => typeof o === "string" && o.trim() !== "") : [];
}

/** The fields of a `form` interaction (`schema.fields`); unnamed fields are skipped. */
export function formFields(schema: unknown): InteractionField[] {
  const fields = isRecord(schema) ? schema.fields : undefined;
  if (!Array.isArray(fields)) return [];
  return fields.filter(isRecord).flatMap((f): InteractionField[] => {
    if (typeof f.name !== "string" || f.name.trim() === "") return [];
    const type = f.type === "number" || f.type === "boolean" ? f.type : "text";
    return [{ name: f.name, label: typeof f.label === "string" && f.label !== "" ? f.label : f.name, type, required: f.required === true }];
  });
}

/** How the reply box renders: the kind's own control, or free text when the schema gives nothing to pick. */
export type ReplyControl = "confirmation" | "choice" | "form" | "text";

export function replyControl(p: Pick<ChatPendingInteractionWire, "kind" | "schema">): ReplyControl {
  if (p.kind === "confirmation") return "confirmation";
  if (p.kind === "choice" && choiceOptions(p.schema).length > 0) return "choice";
  if (p.kind === "form" && formFields(p.schema).length > 0) return "form";
  return "text";
}

/**
 * The value a filled form sends: numbers as numbers, booleans as booleans, blank
 * optional fields left out. `missing` names required fields that are still blank.
 */
export function formValue(
  fields: readonly InteractionField[],
  draft: Readonly<Record<string, string | boolean>>,
): { readonly value: Record<string, string | number | boolean>; readonly missing: string[] } {
  const value: Record<string, string | number | boolean> = {};
  const missing: string[] = [];
  for (const f of fields) {
    const raw = draft[f.name];
    if (f.type === "boolean") {
      value[f.name] = raw === true;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "") {
      if (f.required) missing.push(f.label);
      continue;
    }
    const n = Number(text);
    value[f.name] = f.type === "number" && Number.isFinite(n) ? n : text;
  }
  return { value, missing };
}

/** POST a reply (or dismiss) for a paused chat turn. Never throws; network errors come back as `ok: false`. */
export async function replyToChatInteraction(
  sessionId: string,
  runId: string,
  reply: { readonly value: unknown } | "dismiss",
  fetchFn: Fetch = (url, init) => fetch(url, init),
): Promise<InteractionReplyResult> {
  const verb = reply === "dismiss" ? "dismiss" : "respond";
  const url = `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/interactions/${encodeURIComponent(runId)}/${verb}`;
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reply === "dismiss" ? {} : { value: reply.value }),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
    if (!res.ok) return { ok: false, status: res.status, error: body.error ?? `Request failed (${res.status})` };
    if (reply === "dismiss") return { ok: true, status: "dismissed" };
    const status = body.status === "awaiting-approval" || body.status === "awaiting-interaction" ? body.status : "completed";
    return { ok: true, status };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
