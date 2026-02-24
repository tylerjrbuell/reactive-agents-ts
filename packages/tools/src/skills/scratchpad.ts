// File: src/skills/scratchpad.ts
import { Effect, Ref } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

// ─── Scratchpad Tool Definitions ───

export const scratchpadWriteTool: ToolDefinition = {
  name: "scratchpad-write",
  description:
    "Save a note to the scratchpad. Notes persist across reasoning steps and survive context compaction. " +
    "Use for plans, intermediate results, or key facts. IMPORTANT: use 'key' and 'content' params.",
  parameters: [
    {
      name: "key",
      type: "string" as const,
      description: "Note identifier (e.g., 'plan', 'findings', 'step-3-result')",
      required: true,
    },
    {
      name: "content",
      type: "string" as const,
      description: "Note content to save",
      required: true,
    },
  ],
  returnType: "object",
  riskLevel: "low" as const,
  timeoutMs: 1_000,
  requiresApproval: false,
  source: "function" as const,
};

export const scratchpadReadTool: ToolDefinition = {
  name: "scratchpad-read",
  description:
    "Read notes from the scratchpad. Call with a key to read one note, or without a key to list all notes.",
  parameters: [
    {
      name: "key",
      type: "string" as const,
      description: "Note identifier to read (omit to list all notes)",
      required: false,
    },
  ],
  returnType: "object",
  riskLevel: "low" as const,
  timeoutMs: 1_000,
  requiresApproval: false,
  source: "function" as const,
};

// ─── Scratchpad Storage ───

/** Shared in-memory note storage. Create one per agent run. */
export const makeScratchpadStore = () => Ref.make(new Map<string, string>());

// ─── Handlers ───

export const makeScratchpadWriteHandler = (
  storeRef: Ref.Ref<Map<string, string>>,
) => (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> => {
  const key = args.key;
  const content = args.content;

  if (typeof key !== "string" || !key.trim()) {
    return Effect.fail(
      new ToolExecutionError({
        message: 'Missing required parameter "key"',
        toolName: "scratchpad-write",
      }),
    );
  }
  if (typeof content !== "string") {
    return Effect.fail(
      new ToolExecutionError({
        message: 'Missing required parameter "content"',
        toolName: "scratchpad-write",
      }),
    );
  }

  return Ref.update(storeRef, (m) => {
    const next = new Map(m);
    next.set(key.trim(), content);
    return next;
  }).pipe(
    Effect.map(() => ({ saved: true, key: key.trim() })),
  );
};

export const makeScratchpadReadHandler = (
  storeRef: Ref.Ref<Map<string, string>>,
) => (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> => {
  const key = args.key;

  if (typeof key === "string" && key.trim()) {
    // Read a single note
    return Ref.get(storeRef).pipe(
      Effect.map((m) => {
        const content = m.get(key.trim());
        if (content === undefined) {
          return { found: false, key: key.trim() };
        }
        return { key: key.trim(), content };
      }),
    );
  }

  // List all notes
  return Ref.get(storeRef).pipe(
    Effect.map((m) => ({
      notes: Array.from(m.entries()).map(([k, v]) => ({
        key: k,
        content: v.length > 200 ? v.slice(0, 200) + "..." : v,
      })),
    })),
  );
};
