import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  ZettelkastenService,
  ZettelkastenServiceLive,
  MemoryDatabaseLive,
} from "../src/index.js";
import type { ZettelLink, MemoryId } from "../src/types.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-zettel-db";
const TEST_DB = path.join(TEST_DB_DIR, "zettel.db");

describe("ZettelkastenService", () => {
  afterEach(() => {
    try {
      fs.unlinkSync(TEST_DB);
      fs.unlinkSync(TEST_DB + "-wal");
      fs.unlinkSync(TEST_DB + "-shm");
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(TEST_DB_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
  const dbLayer = MemoryDatabaseLive(config);
  const serviceLayer = ZettelkastenServiceLive.pipe(Layer.provide(dbLayer));

  const run = <A, E>(
    effect: Effect.Effect<A, E, ZettelkastenService>,
  ) =>
    Effect.runPromise(
      Effect.scoped(effect.pipe(Effect.provide(serviceLayer))),
    );

  const makeLink = (
    source: string,
    target: string,
    strength = 0.8,
  ): ZettelLink => ({
    source: source as MemoryId,
    target: target as MemoryId,
    strength,
    type: "similar",
    createdAt: new Date(),
  });

  it("should add and retrieve links", async () => {
    const links = await run(
      Effect.gen(function* () {
        const svc = yield* ZettelkastenService;
        yield* svc.addLink(makeLink("a", "b"));
        yield* svc.addLink(makeLink("a", "c", 0.6));
        return yield* svc.getLinks("a" as MemoryId);
      }),
    );

    expect(links.length).toBe(2);
    // Sorted by strength desc
    expect(links[0]!.strength).toBeGreaterThanOrEqual(links[1]!.strength);
  });

  it("should get linked IDs", async () => {
    const linked = await run(
      Effect.gen(function* () {
        const svc = yield* ZettelkastenService;
        yield* svc.addLink(makeLink("a", "b"));
        yield* svc.addLink(makeLink("a", "c"));
        yield* svc.addLink(makeLink("d", "a"));
        return yield* svc.getLinked("a" as MemoryId);
      }),
    );

    expect(linked.length).toBe(3);
    expect(linked).toContain("b" as MemoryId);
    expect(linked).toContain("c" as MemoryId);
    expect(linked).toContain("d" as MemoryId);
  });

  it("should traverse link graph", async () => {
    const traversed = await run(
      Effect.gen(function* () {
        const svc = yield* ZettelkastenService;
        // a -> b -> c -> d
        yield* svc.addLink(makeLink("a", "b"));
        yield* svc.addLink(makeLink("b", "c"));
        yield* svc.addLink(makeLink("c", "d"));
        return yield* svc.traverse("a" as MemoryId, 2);
      }),
    );

    // With depth 2: a -> b (depth 1) -> c (depth 2)
    expect(traversed).toContain("b" as MemoryId);
    expect(traversed).toContain("c" as MemoryId);
    // d is at depth 3, should not be included
    expect(traversed).not.toContain("d" as MemoryId);
  });

  it("should delete all links for a memory", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ZettelkastenService;
        yield* svc.addLink(makeLink("a", "b"));
        yield* svc.addLink(makeLink("a", "c"));
        yield* svc.addLink(makeLink("d", "a"));
        yield* svc.deleteLinks("a" as MemoryId);
        return yield* svc.getLinks("a" as MemoryId);
      }),
    );

    expect(result.length).toBe(0);
  });

  // 2026-09-03: autoLinkText joined RAW words into an FTS5 MATCH string
  // ("word1 OR word2 OR ..."). A word containing an FTS5-special character
  // (hyphen, colon, etc. — e.g. "Effect-TS") was parsed as query SYNTAX, not
  // literal text, and threw `SQLiteError: no such column: TS`. The call site
  // in memory-service.ts silently swallows this (Effect.catchAll ->
  // emitErrorSwallowed), so auto-linking quietly never ran on any content
  // containing such a word — most real prose. Fixed by quoting each term as
  // an FTS5 string literal.
  it("auto-links similar content even when it contains FTS5-special characters (hyphens, colons)", async () => {
    const links = await run(
      Effect.gen(function* () {
        const svc = yield* ZettelkastenService;
        return yield* svc.autoLinkText(
          "entry-1" as MemoryId,
          "The framework uses Effect-TS for composable service layers: dependency injection, streams, and error tracking.",
          "test-agent",
          0,
        );
      }),
    );
    // Threshold 0 with no other stored entries: the query must not throw —
    // regardless of match count, a crash here means the bug is back.
    expect(Array.isArray(links)).toBe(true);
  });

  it("does not throw on content that is punctuation-only after word filtering", async () => {
    const links = await run(
      Effect.gen(function* () {
        const svc = yield* ZettelkastenService;
        return yield* svc.autoLinkText("entry-1" as MemoryId, "-- :: ---", "test-agent", 0);
      }),
    );
    expect(links).toEqual([]);
  });
});
