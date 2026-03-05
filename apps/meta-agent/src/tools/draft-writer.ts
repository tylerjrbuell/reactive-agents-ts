// apps/meta-agent/src/tools/draft-writer.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import type { ToolDefinition } from "reactive-agents/tools";

const DRAFTS_DIR = join(import.meta.dirname, "../../drafts");

export const draftWriterTool: ToolDefinition = {
  name: "draft-writer",
  description:
    "Save a draft response or blog post to the drafts directory for human review. " +
    "Use this whenever you have a response or post worth saving. " +
    "NEVER auto-post anything — always save as a draft first.",
  parameters: [
    {
      name: "type",
      type: "string",
      description: "Type of draft content",
      required: true,
      enum: ["response", "blog-post", "tweet", "reddit-post"],
    },
    {
      name: "title",
      type: "string",
      description: "Short title for the draft file",
      required: true,
    },
    {
      name: "content",
      type: "string",
      description: "The full draft content in markdown",
      required: true,
    },
    {
      name: "platform",
      type: "string",
      description: "Target platform: 'reddit', 'hackernews', 'dev.to', 'twitter', etc.",
      required: false,
    },
    {
      name: "threadUrl",
      type: "string",
      description: "URL of the thread this responds to (if applicable)",
      required: false,
    },
    {
      name: "context",
      type: "string",
      description: "Why this draft was created — what opportunity was spotted",
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
  Effect.try({
    try: () => {
      const type = args.type as string;
      const title = args.title as string;
      const content = args.content as string;
      const platform = args.platform as string | undefined;
      const threadUrl = args.threadUrl as string | undefined;
      const context = args.context as string | undefined;

      mkdirSync(DRAFTS_DIR, { recursive: true });

      const timestamp = new Date().toISOString().split("T")[0];
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 50);
      const filename = `${timestamp}-${type}-${slug}.md`;
      const filepath = join(DRAFTS_DIR, filename);

      const frontmatter = [
        "---",
        `type: ${type}`,
        `title: "${title.replace(/"/g, '\\"')}"`,
        platform ? `platform: ${platform}` : null,
        threadUrl ? `thread_url: ${threadUrl}` : null,
        `created: ${new Date().toISOString()}`,
        `status: draft`,
        "---",
        "",
      ]
        .filter((line): line is string => line !== null)
        .join("\n");

      const body = [
        context ? `> **Context:** ${context}\n` : null,
        threadUrl ? `> **Thread:** ${threadUrl}\n` : null,
        content,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");

      writeFileSync(filepath, frontmatter + body, "utf-8");

      return {
        saved: true,
        path: filepath,
        filename,
        message: `Draft saved to drafts/${filename}. Review and post manually.`,
      };
    },
    catch: (e) => new Error(String(e)),
  }).pipe(
    Effect.catchAll((e) =>
      Effect.succeed({ saved: false, error: e.message }),
    ),
  );
