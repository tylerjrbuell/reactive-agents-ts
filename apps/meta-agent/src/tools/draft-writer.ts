// apps/meta-agent/src/tools/draft-writer.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition } from "reactive-agents/tools";

const DRAFTS_DIR = join(import.meta.dirname, "../../drafts");

export const draftWriterTool: ToolDefinition = {
  name: "draft-writer",
  description:
    "Save a draft response or blog post to the drafts directory for human review. " +
    "Use this whenever you have a response or post worth saving. " +
    "NEVER auto-post anything — always save as a draft first.",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["response", "blog-post", "tweet", "reddit-post"],
        description: "Type of draft content",
      },
      title: {
        type: "string",
        description: "Short title for the draft file",
      },
      platform: {
        type: "string",
        description: "Target platform: 'reddit', 'hackernews', 'dev.to', 'twitter', etc.",
      },
      threadUrl: {
        type: "string",
        description: "URL of the thread this responds to (if applicable)",
      },
      content: {
        type: "string",
        description: "The full draft content in markdown",
      },
      context: {
        type: "string",
        description: "Why this draft was created — what opportunity was spotted",
      },
    },
    required: ["type", "title", "content"],
  },
  handler: async (input: {
    type: string;
    title: string;
    platform?: string;
    threadUrl?: string;
    content: string;
    context?: string;
  }) => {
    mkdirSync(DRAFTS_DIR, { recursive: true });

    const timestamp = new Date().toISOString().split("T")[0];
    const slug = input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50);
    const filename = `${timestamp}-${input.type}-${slug}.md`;
    const filepath = join(DRAFTS_DIR, filename);

    const frontmatter = [
      "---",
      `type: ${input.type}`,
      `title: "${input.title}"`,
      input.platform ? `platform: ${input.platform}` : null,
      input.threadUrl ? `thread_url: ${input.threadUrl}` : null,
      `created: ${new Date().toISOString()}`,
      `status: draft`,
      "---",
      "",
    ]
      .filter(Boolean)
      .join("\n");

    const body = [
      input.context ? `> **Context:** ${input.context}\n` : null,
      input.threadUrl ? `> **Thread:** ${input.threadUrl}\n` : null,
      input.content,
    ]
      .filter(Boolean)
      .join("\n");

    writeFileSync(filepath, frontmatter + body, "utf-8");

    return {
      saved: true,
      path: filepath,
      filename,
      message: `Draft saved to drafts/${filename}. Review and post manually.`,
    };
  },
};
