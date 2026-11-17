// Run: bun test packages/tools/tests/recurring-fault-guards.test.ts
//
// Recurring tool-surface faults from the skill-learning phase 0 spike
// (wiki/Experiments/2026-11-17-skill-learning-phase0.md). Every fixture is an
// arg shape or path mined from real traces (pairs.jsonl). Zero tokens, no
// network: real tmp dirs, pure healers.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHealingPipeline } from "../src/healing/healing-pipeline.js";
import { validateToolInput } from "../src/validation/input-validator.js";
import { webSearchTool } from "../src/skills/web-search.js";
import { cryptoPriceTool, cryptoPriceHandler } from "../src/skills/crypto-price.js";
import {
  fileReadHandler,
  fileWriteHandler,
  listDirectoryHandler,
  withFileRoot,
} from "../src/skills/file-operations.js";
import { applyTodoChecklistAction } from "../src/skills/todo.js";
import type { ToolCallSpec } from "../src/tool-calling/types.js";

const schemas = [webSearchTool, cryptoPriceTool];
const heal = (name: string, args: Record<string, unknown>) =>
  runHealingPipeline({ id: "t", name, arguments: args } as ToolCallSpec, schemas, new Set(), "/tmp", {}, {});

describe("empty / wrong-key args on web-search and crypto-price", () => {
  it("empty args {} stay unhealed and the shared error shows a valid example (both tools)", async () => {
    for (const [tool, expected] of [
      [webSearchTool, 'Valid call: web-search({"query":"Bitcoin price today USD"})'],
      [cryptoPriceTool, 'Valid call: crypto-price({"coins":["BTC","ETH"]})'],
    ] as const) {
      expect(heal(tool.name, {}).call.arguments).toEqual({});
      const err = await Effect.runPromise(Effect.flip(validateToolInput(tool, {})));
      expect(err.message).toContain(expected);
    }
  });

  it("a lone string under any other key heals to query", () => {
    for (const key of ["q", "search", "queries", "text", "search_query"]) {
      const out = heal("web-search", { [key]: "XRP market trends" });
      expect(out.call.arguments).toEqual({ query: "XRP market trends" });
    }
  });

  it("a lone string under another key heals to the coins array", () => {
    expect(heal("crypto-price", { symbol: "BTC" }).call.arguments).toEqual({ coins: ["BTC"] });
    expect(heal("crypto-price", { ticker: "XRP" }).call.arguments).toEqual({ coins: ["XRP"] });
  });

  it("does not remap when ambiguous (two unknown keys) or when the string is empty", () => {
    expect(heal("web-search", { q: "a", foo: "b" }).call.arguments).toEqual({ q: "a", foo: "b" });
    expect(heal("crypto-price", { symbol: "  " }).call.arguments).toEqual({ symbol: "  " });
  });

  it("the crypto-price handler splits a wrapped 'BTC,ETH' string into symbols", async () => {
    // Unknown symbols only: no network round trip.
    const out = await Effect.runPromise(cryptoPriceHandler({ coins: ["ZZZ1,ZZZ2"] }));
    expect(out.prices.map((p) => p.symbol)).toEqual(["ZZZ1", "ZZZ2"]);
  });
});

describe("rooted-path heal for read tools (mined: doubled and foreign roots)", () => {
  const read = (root: string, path: string) =>
    withFileRoot(root, () => Effect.runPromise(Effect.either(fileReadHandler({ path }))));

  it("doubled absolute root (cortex README fixture) reads the file and reports the healed path", async () => {
    const base = await mkdtemp(join(tmpdir(), "rooted-heal-"));
    const root = join(base, "apps", "cortex");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "README.md"), "cortex readme");
    const out = await read(root, join(root, "apps", "cortex", "README.md"));
    expect(out._tag).toBe("Right");
    if (out._tag === "Right") {
      const r = out.right as { content: string; path: string; note: string };
      expect(r.content).toBe("cortex readme");
      expect(r.path).toBe(join(root, "README.md"));
      expect(r.note).toContain("used");
    }
  });

  it("foreign root (/workspace/a.txt, /home/user/.../CHANGELOG.md fixtures) reads the in-root file", async () => {
    const root = await mkdtemp(join(tmpdir(), "rooted-heal-"));
    await writeFile(join(root, "a.txt"), "A");
    await writeFile(join(root, "CHANGELOG.md"), "log");
    for (const [req, content] of [
      ["/workspace/a.txt", "A"],
      ["/workspace/workspace/a.txt", "A"],
      ["/home/user/reactive-agents-ts/CHANGELOG.md", "log"],
    ] as const) {
      const out = await read(root, req);
      expect(out._tag).toBe("Right");
      if (out._tag === "Right") expect((out.right as { content: string }).content).toBe(content);
    }
  });

  it("does not heal: nothing under the root, '..' segment, or a real outside file", async () => {
    const root = await mkdtemp(join(tmpdir(), "rooted-heal-"));
    const outside = await mkdtemp(join(tmpdir(), "rooted-heal-outside-"));
    await writeFile(join(outside, "x.txt"), "outside");
    await writeFile(join(root, "x.txt"), "inside");
    for (const req of ["/nonexistent/c.txt", "/workspace/../x.txt", join(outside, "x.txt")]) {
      const out = await read(root, req);
      expect(out._tag).toBe("Left");
      if (out._tag === "Left") expect(out.left.message).toContain("Path traversal");
    }
  });

  it("does not heal into a credential path", async () => {
    const root = await mkdtemp(join(tmpdir(), "rooted-heal-"));
    await writeFile(join(root, ".env"), "KEY=secret");
    const out = await read(root, "/workspace/.env");
    expect(out._tag).toBe("Left");
  });

  it("file-write is never healed", async () => {
    const root = await mkdtemp(join(tmpdir(), "rooted-heal-"));
    await writeFile(join(root, "a.txt"), "A");
    const out = await withFileRoot(root, () =>
      Effect.runPromise(Effect.either(fileWriteHandler({ path: "/workspace/a.txt", content: "B" }))),
    );
    expect(out._tag).toBe("Left");
  });

  it("list-directory heals a foreign-root directory and reports it", async () => {
    const root = await mkdtemp(join(tmpdir(), "rooted-heal-"));
    await mkdir(join(root, "data"));
    await writeFile(join(root, "data", "f.txt"), "f");
    const out = await withFileRoot(root, () =>
      Effect.runPromise(listDirectoryHandler({ path: "/home/user/data" })),
    ) as { path: string; entries: { name: string }[]; note: string };
    expect(out.path).toBe(join(root, "data"));
    expect(out.entries.map((e) => e.name)).toEqual(["f.txt"]);
    expect(out.note).toContain("used");
  });
});

describe("todo: a sentence in `action` (mined fixtures)", () => {
  it("with items present heals to add and reports healedFrom", () => {
    const res = applyTodoChecklistAction([], {
      action: "Verify crypto.md quality",
      items: ["Check all price/market-cap math", "Check all percentage claims"],
    });
    expect(res.ok).toBe(true);
    expect(res.healedFrom).toBe("Verify crypto.md quality");
    expect(res.healedTo).toBe("add");
    expect(res.changes.length).toBeGreaterThan(0);
    expect(res.rendered).toContain("Check all percentage claims");
  });

  it("without items the unknown-action hint lists every verb and shows the add example, not a substring match", () => {
    const res = applyTodoChecklistAction([], { action: "read crypto.md in full" });
    expect(res.ok).toBe(false);
    expect(res.rendered).toContain("Valid: add | start | done | reopen | edit | remove | clear | patch | list.");
    expect(res.rendered).toContain('Closest valid call: todo({action:"add"');
  });

  it("a real unknown verb still teaches the closest valid call", () => {
    const res = applyTodoChecklistAction([], { action: "lst" });
    expect(res.rendered).toContain('todo({action:"list"})');
  });
});
