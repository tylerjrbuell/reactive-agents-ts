// Per-framework tool factories. Same behavior, framework-native shape.
//
// RA: ToolDefinition + Effect handler
// Mastra: createTool({ id, description, inputSchema (Zod), execute })  ← v1.36+ current API

import { z } from "zod";
import type { ToolSpec } from "./tasks.js";

// ── Shared deterministic behaviors ───────────────────────────────────────────

interface ToolBehavior {
  readonly name: string;
  readonly description: string;
  readonly inputZodShape: Record<string, z.ZodTypeAny>;
  readonly raParameters: Array<{
    name: string;
    type: "string" | "number" | "boolean" | "object" | "array";
    description: string;
    required: boolean;
  }>;
  readonly run: (args: Record<string, unknown>) => Promise<unknown>;
}

function behaviorFor(spec: ToolSpec): ToolBehavior | null {
  switch (spec.kind) {
    case "none":
      return null;

    case "web-search-success":
      return {
        name: "bench_web_search",
        description: "Search the web (bench tool). Returns search results with snippets and source URLs.",
        inputZodShape: { query: z.string().describe("Search query") },
        raParameters: [{ name: "query", type: "string", description: "Search query", required: true }],
        run: async (args) => ({
          query: args.query,
          results: Array.from({ length: spec.returnsCount }, (_, i) => ({
            url: `https://tokio.rs/?ref=${i}`,
            snippet: spec.sampleSnippet,
          })),
        }),
      };

    case "web-search-error":
      return {
        name: "bench_web_search",
        description: "Search the web (bench tool). Returns search results with snippets and source URLs.",
        inputZodShape: { query: z.string().describe("Search query") },
        raParameters: [{ name: "query", type: "string", description: "Search query", required: true }],
        run: async () => {
          throw new Error(spec.errorMessage);
        },
      };

    case "calculator":
      return {
        name: "bench_calculator",
        description:
          "Evaluate a simple arithmetic expression. Supports + - * / and parentheses. Returns the numeric result.",
        inputZodShape: { expression: z.string().describe("Arithmetic expression") },
        raParameters: [{ name: "expression", type: "string", description: "Arithmetic expression", required: true }],
        run: async (args) => {
          const expr = String(args.expression ?? "").replace(/[^-+*/().0-9\s]/g, "");
          if (!expr) throw new Error("empty or invalid expression");
          // eslint-disable-next-line no-new-func
          const result = Function(`"use strict"; return (${expr});`)();
          return { expression: expr, result };
        },
      };

    case "key-value-store": {
      const store = spec.preloaded ?? {};
      return {
        name: "bench_lookup",
        description: "Look up a stored value by key. Returns { key, value } or { key, value: null } if not found.",
        inputZodShape: { key: z.string().describe("Key to look up") },
        raParameters: [{ name: "key", type: "string", description: "Key to look up", required: true }],
        run: async (args) => {
          const key = String(args.key ?? "");
          const value = store[key] ?? null;
          return { key, value };
        },
      };
    }
  }
}

// ── Reactive Agents shape ────────────────────────────────────────────────────

import { Effect } from "effect";

export function toolsForReactiveAgents(specs: readonly ToolSpec[]) {
  return specs
    .map(behaviorFor)
    .filter((b): b is ToolBehavior => b !== null)
    .map((b) => ({
      definition: {
        name: b.name,
        description: b.description,
        parameters: b.raParameters,
        riskLevel: "low" as const,
        timeoutMs: 10_000,
        requiresApproval: false,
        source: "function" as const,
      },
      handler: (args: Record<string, unknown>) =>
        Effect.tryPromise({
          try: () => b.run(args),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        }),
    }));
}

// ── Mastra shape (v1.36+ — createTool() with AI SDK v5) ──────────────────────

import { createTool } from "@mastra/core/tools";

export function toolsForMastra(specs: readonly ToolSpec[]) {
  const out: Record<string, ReturnType<typeof createTool>> = {};
  for (const spec of specs) {
    const b = behaviorFor(spec);
    if (!b) continue;
    out[b.name] = createTool({
      id: b.name,
      description: b.description,
      inputSchema: z.object(b.inputZodShape),
      execute: async ({ context }: { context: Record<string, unknown> }) => b.run(context),
    });
  }
  return out;
}
