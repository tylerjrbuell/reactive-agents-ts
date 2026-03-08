import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  MemoryExtractor,
  MemoryExtractorLive,
  MemoryExtractorTier2Live,
} from "../src/index.js";
import type { MemoryLLM } from "../src/index.js";

const testMessages = [
  { role: "user", content: "What is the capital of France?" },
  {
    role: "assistant",
    content:
      "The capital of France is Paris, which is also the largest city in the country. It has been the capital since the 10th century.",
  },
  { role: "user", content: "What about Germany?" },
  {
    role: "assistant",
    content:
      "The capital of Germany is Berlin. Berlin has been the capital since reunification in 1990.",
  },
];

describe("MemoryExtractor — Tier 1 (Heuristic)", () => {
  it("extracts semantic entries from assistant messages", async () => {
    const entries = await Effect.runPromise(
      MemoryExtractor.pipe(
        Effect.flatMap((svc) =>
          svc.extractFromConversation("test-agent", testMessages),
        ),
        Effect.provide(MemoryExtractorLive),
      ),
    );

    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.agentId).toBe("test-agent");
      expect(e.importance).toBe(0.5); // Tier 1 hardcodes 0.5
      expect(e.content.length).toBeGreaterThan(30);
    }
  });

  it("extracts episodic entries from all messages", async () => {
    const entries = await Effect.runPromise(
      MemoryExtractor.pipe(
        Effect.flatMap((svc) =>
          svc.extractEpisodic("test-agent", testMessages),
        ),
        Effect.provide(MemoryExtractorLive),
      ),
    );

    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.agentId).toBe("test-agent");
      expect(e.eventType).toBe("observation");
    }
  });
});

describe("MemoryExtractor — Tier 2 (LLM-Enhanced)", () => {
  const mockLLM: MemoryLLM = {
    complete: ({ messages }) =>
      Effect.succeed({
        content: JSON.stringify([
          {
            content: "The capital of France is Paris",
            importance: 0.7,
            tags: ["geography", "france"],
          },
          {
            content: "Berlin is the capital of Germany since reunification in 1990",
            importance: 0.8,
            tags: ["geography", "germany"],
          },
        ]),
        usage: { totalTokens: 150 },
      }),
  };

  it("extracts semantic entries with LLM-scored importance", async () => {
    const entries = await Effect.runPromise(
      MemoryExtractor.pipe(
        Effect.flatMap((svc) =>
          svc.extractFromConversation("test-agent", testMessages),
        ),
        Effect.provide(MemoryExtractorTier2Live(mockLLM)),
      ),
    );

    expect(entries.length).toBe(2);
    expect(entries[0]!.importance).toBe(0.7);
    expect(entries[0]!.tags).toEqual(["geography", "france"]);
    expect(entries[1]!.importance).toBe(0.8);
    expect(entries[1]!.tags).toEqual(["geography", "germany"]);
  });

  it("clamps importance to 0-1 range", async () => {
    const clampLLM: MemoryLLM = {
      complete: () =>
        Effect.succeed({
          content: JSON.stringify([
            { content: "Out of range importance value for testing purposes", importance: 1.5, tags: [] },
            { content: "Negative importance value for edge case testing check", importance: -0.3, tags: [] },
          ]),
        }),
    };

    const entries = await Effect.runPromise(
      MemoryExtractor.pipe(
        Effect.flatMap((svc) =>
          svc.extractFromConversation("test-agent", testMessages),
        ),
        Effect.provide(MemoryExtractorTier2Live(clampLLM)),
      ),
    );

    expect(entries[0]!.importance).toBe(1.0);
    expect(entries[1]!.importance).toBe(0);
  });

  it("falls back to heuristic on unparseable LLM response", async () => {
    const badLLM: MemoryLLM = {
      complete: () =>
        Effect.succeed({ content: "I don't know how to format JSON" }),
    };

    const entries = await Effect.runPromise(
      MemoryExtractor.pipe(
        Effect.flatMap((svc) =>
          svc.extractFromConversation("test-agent", testMessages),
        ),
        Effect.provide(MemoryExtractorTier2Live(badLLM)),
      ),
    );

    // Falls back to Tier 1 — importance should be 0.5
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.importance).toBe(0.5);
    }
  });

  it("falls back to heuristic on LLM error", async () => {
    const failLLM: MemoryLLM = {
      complete: () => Effect.fail(new Error("API timeout")),
    };

    const entries = await Effect.runPromise(
      MemoryExtractor.pipe(
        Effect.flatMap((svc) =>
          svc.extractFromConversation("test-agent", testMessages),
        ),
        Effect.provide(MemoryExtractorTier2Live(failLLM)),
      ),
    );

    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.importance).toBe(0.5);
    }
  });

  it("handles markdown-fenced JSON response", async () => {
    const fencedLLM: MemoryLLM = {
      complete: () =>
        Effect.succeed({
          content: `Here are the extracted memories:\n\`\`\`json\n[{"content":"Paris is the capital of France","importance":0.75,"tags":["geography"]}]\n\`\`\``,
        }),
    };

    const entries = await Effect.runPromise(
      MemoryExtractor.pipe(
        Effect.flatMap((svc) =>
          svc.extractFromConversation("test-agent", testMessages),
        ),
        Effect.provide(MemoryExtractorTier2Live(fencedLLM)),
      ),
    );

    expect(entries.length).toBe(1);
    expect(entries[0]!.importance).toBe(0.75);
    expect(entries[0]!.tags).toEqual(["geography"]);
  });

  it("skips entries with missing or short content", async () => {
    const partialLLM: MemoryLLM = {
      complete: () =>
        Effect.succeed({
          content: JSON.stringify([
            { content: "short", importance: 0.9, tags: [] },
            { content: "This is a valid memory entry with enough content", importance: 0.6, tags: ["valid"] },
            { importance: 0.5, tags: [] }, // no content
          ]),
        }),
    };

    const entries = await Effect.runPromise(
      MemoryExtractor.pipe(
        Effect.flatMap((svc) =>
          svc.extractFromConversation("test-agent", testMessages),
        ),
        Effect.provide(MemoryExtractorTier2Live(partialLLM)),
      ),
    );

    expect(entries.length).toBe(1);
    expect(entries[0]!.tags).toEqual(["valid"]);
  });

  it("limits to 5 extracted memories", async () => {
    const manyLLM: MemoryLLM = {
      complete: () =>
        Effect.succeed({
          content: JSON.stringify(
            Array.from({ length: 10 }, (_, i) => ({
              content: `Memory entry number ${i + 1} with enough content to pass the filter`,
              importance: 0.5 + i * 0.05,
              tags: [`tag-${i}`],
            })),
          ),
        }),
    };

    const entries = await Effect.runPromise(
      MemoryExtractor.pipe(
        Effect.flatMap((svc) =>
          svc.extractFromConversation("test-agent", testMessages),
        ),
        Effect.provide(MemoryExtractorTier2Live(manyLLM)),
      ),
    );

    expect(entries.length).toBe(5);
  });
});
