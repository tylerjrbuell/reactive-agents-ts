// apps/advocate/src/tools/draft-writer.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import type { ToolDefinition } from "reactive-agents/tools";
import { gradeDraft } from "../grounding/grade.js";

const DRAFTS_DIR = join(import.meta.dirname, "../../drafts");

const VALID_TYPES = ["response", "blog-post", "tweet", "reddit-post"] as const;
type DraftType = (typeof VALID_TYPES)[number];

/** Trim a value to a non-empty string, or undefined. */
function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** First of several aliases that yields a non-empty string. */
function pick(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = str(args[k]);
    if (v) return v;
  }
  return undefined;
}

/** Coerce a free-form type into the closest valid enum value (default "response"). */
function coerceType(raw: string | undefined): DraftType {
  if (!raw) return "response";
  const norm = raw.toLowerCase().replace(/[\s_]+/g, "-");
  if ((VALID_TYPES as readonly string[]).includes(norm)) return norm as DraftType;
  // Soft matches for the shapes weak models reach for.
  if (norm.includes("blog") || norm.includes("post") && norm.includes("article")) return "blog-post";
  if (norm.includes("tweet") || norm.includes("twitter") || norm === "x") return "tweet";
  if (norm.includes("reddit")) return "reddit-post";
  return "response";
}

/** Derive a title from the content when the model didn't supply one. */
function deriveTitle(content: string): string {
  const firstHeading = content.match(/^#{1,6}\s+(.+)$/m)?.[1];
  const firstLine = content.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  const base = (firstHeading ?? firstLine ?? "draft")
    .replace(/[#*`_>[\]]/g, "") // strip markdown punctuation
    .trim();
  return base.length > 0 ? base.slice(0, 70) : "draft";
}

export interface NormalizedDraft {
  readonly type: DraftType;
  readonly title: string;
  readonly content: string;
  readonly platform?: string;
  readonly threadUrl?: string;
  readonly context?: string;
}

/**
 * Tolerant argument recovery — the whole point of draft-writer being foolproof.
 *
 * Weak local models routinely omit "required" fields, mislabel them, or wrap the
 * draft text under a synonym (`body`/`text`/`draft`). Rather than let the tool
 * param validator reject the call (the model then loops), every field is optional
 * and recovered here:
 *   - content is pulled from a list of aliases; only its TOTAL absence fails.
 *   - type is coerced into the enum (default "response").
 *   - title is derived from the content's first heading/line when missing.
 *
 * Returns `{ ok: false, message }` only when there is genuinely no draft text to
 * save — and even then the message tells the model exactly how to retry.
 */
export function normalizeDraftArgs(
  args: Record<string, unknown>,
): { ok: true; draft: NormalizedDraft } | { ok: false; message: string } {
  const content = pick(args, "content", "body", "text", "draft", "markdown", "response", "message", "post");
  if (!content) {
    return {
      ok: false,
      message:
        "Nothing saved — draft-writer needs the draft text. Call it again with the markdown in the `content` field (a title and type are optional and will be inferred).",
    };
  }
  const draft: NormalizedDraft = {
    type: coerceType(pick(args, "type", "kind", "category", "format")),
    title: pick(args, "title", "subject", "heading", "name") ?? deriveTitle(content),
    content,
    platform: pick(args, "platform", "target", "site", "channel"),
    threadUrl: pick(args, "threadUrl", "thread_url", "url", "link", "thread", "source"),
    context: pick(args, "context", "reason", "why", "rationale", "notes"),
  };
  return { ok: true, draft };
}

export const draftWriterTool: ToolDefinition = {
  name: "draft-writer",
  description:
    "Save a draft response or blog post to the drafts directory for human review. " +
    "Use this whenever you have a response or post worth saving. " +
    "The ONLY thing you must provide is `content` (the full draft in markdown); " +
    "`type` and `title` are optional and inferred if omitted. " +
    "NEVER auto-post anything — always save as a draft first.",
  parameters: [
    {
      name: "content",
      type: "string",
      description: "The full draft content in markdown. This is the only field you must provide.",
      required: true,
    },
    {
      name: "type",
      type: "string",
      description: "Optional. One of: response, blog-post, tweet, reddit-post. Defaults to 'response'.",
      required: false,
      enum: [...VALID_TYPES],
    },
    {
      name: "title",
      type: "string",
      description: "Optional short title. Inferred from the content's first line if omitted.",
      required: false,
    },
    {
      name: "platform",
      type: "string",
      description: "Optional target platform: 'reddit', 'hackernews', 'dev.to', 'twitter', etc.",
      required: false,
    },
    {
      name: "threadUrl",
      type: "string",
      description: "Optional URL of the thread this responds to.",
      required: false,
    },
    {
      name: "context",
      type: "string",
      description: "Optional — why this draft was created, what opportunity was spotted.",
      required: false,
    },
  ],
  returnType: '{ saved: boolean, path: string, filename: string, message: string }',
  category: "file",
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function",
};

export const draftWriterHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown> =>
  Effect.gen(function* () {
    const normalized = normalizeDraftArgs(args);
    if (!normalized.ok) {
      return { saved: false, message: normalized.message };
    }
    const { type, title, content, platform, threadUrl, context } = normalized.draft;

    const grade = yield* gradeDraft(content, { fetchImpl: globalThis.fetch });
    if (!grade.pass) {
      return {
        saved: false,
        issues: grade.issues,
        deadLinks: grade.deadLinks,
        message:
          "Draft NOT saved — quality gate failed. Revise to fix these issues (lead with value, " +
          "remove dead links / promo) and call draft-writer again.",
      };
    }

    return yield* Effect.try({
      try: () => {
        mkdirSync(DRAFTS_DIR, { recursive: true });
        const timestamp = new Date().toISOString().split("T")[0];
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "draft";
        const filename = `${timestamp}-${type}-${slug}.md`;
        const filepath = join(DRAFTS_DIR, filename);
        const frontmatter = [
          "---",
          `type: ${type}`,
          `title: "${title.replace(/"/g, '\\"')}"`,
          platform ? `platform: ${platform}` : null,
          threadUrl ? `thread_url: ${threadUrl}` : null,
          `created: ${new Date().toISOString()}`,
          `quality: pass`,
          `status: draft`,
          "---",
          "",
        ].filter((l): l is string => l !== null).join("\n");
        const body = [
          context ? `> **Context:** ${context}\n` : null,
          threadUrl ? `> **Thread:** ${threadUrl}\n` : null,
          content,
        ].filter((l): l is string => l !== null).join("\n");
        writeFileSync(filepath, frontmatter + body, "utf-8");
        return { saved: true, path: filepath, filename, message: `Draft saved to drafts/${filename}. Review and post manually.` };
      },
      catch: (e) => new Error(String(e)),
    }).pipe(Effect.catchAll((e) => Effect.succeed({ saved: false, error: e.message })));
  });
