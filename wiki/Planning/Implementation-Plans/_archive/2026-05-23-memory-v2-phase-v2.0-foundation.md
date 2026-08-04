# Memory v2 Phase v2.0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `MemoryStore` abstraction with optimistic concurrency (CAS), content hashes, version history, and the v2 schema extensions — without changing any existing consumer's behavior.

**Architecture:** A new higher-level `MemoryStore` interface sits on top of the existing `MemoryDatabase` low-level SQLite service. The interface is the single foundational primitive for Memory v2; subsequent phases (v2.1 long-task durability, v2.2 multi-agent sharing, v2.3 dreaming, v2.4 projection) build on it. All existing schema additions are additive (`ALTER TABLE ADD COLUMN`) with defaults; legacy reads continue to work.

**Tech Stack:** TypeScript, Effect-TS (Context.Tag + Layer + Schema), Bun (runtime + test runner), better-sqlite3 (via `@reactive-agents/runtime-shim`), blake3 content hashing.

**Spec:** [[wiki/Architecture/Design-Specs/2026-05-23-memory-v2-design]] §1, §4 (interfaces), §6 (schema migration)

**Scope (this plan only):**
- Schema migration: 6 new columns on existing tier tables; new `memory_versions` table
- `MemoryStore` interface + `SQLiteStore` implementation
- Content-hash helper (blake3)
- CAS (compare-and-set) with version log append
- Scope/tier/provenance filter on `query()`
- Contract test suite + CAS stress test
- Layer-composition wiring into `runtime.ts`

**Out of scope (deferred to later phases):**
- `ScopeRegistry` (v2.2)
- `LightDream` / `HeavyDream` (v2.3)
- `CheckpointService` (v2.1)
- `AntiPatternsTier` (v2.3)
- `FilesystemStore` / `ProjectionLayer` (v2.4)
- Migrating consumers (`SemanticMemoryService` etc.) to use `MemoryStore` — they keep using `MemoryDatabase` directly until v2.2

---

## File Structure

**New files:**
- `packages/memory/src/store/types.ts` — `Scope`, `MemoryTier`, `Provenance`, `CheckpointId`, `MemoryVersion`, `PutResult`, `QueryFilter`
- `packages/memory/src/store/memory-store.ts` — `MemoryStore` interface + Context.Tag
- `packages/memory/src/store/sqlite-store.ts` — `SQLiteStoreLive` Layer implementation
- `packages/memory/src/store/content-hash.ts` — blake3 helper
- `packages/memory/src/store/errors.ts` — `StoreError`, `CASConflict`
- `packages/memory/src/store/migrations/001-v2-foundation.ts` — schema migration runner
- `packages/memory/src/store/__tests__/sqlite-store.contract.test.ts` — full contract suite
- `packages/memory/src/store/__tests__/cas-stress.test.ts` — concurrent-write stress test
- `packages/memory/src/store/__tests__/migration.test.ts` — schema migration test
- `packages/memory/src/store/__tests__/content-hash.test.ts` — hash determinism test

**Modified files:**
- `packages/memory/src/types.ts` — extend `MemoryEntrySchema` with v2 fields (additive)
- `packages/memory/src/database.ts` — invoke migration runner on Layer build
- `packages/memory/src/runtime.ts` — add `SQLiteStoreLive` to layer composition
- `packages/memory/src/index.ts` — export new types + interface
- `packages/memory/package.json` — add `@noble/hashes` dep

---

## Pre-Flight

- [ ] **Step 0.1: Read spec sections**

Read `wiki/Architecture/Design-Specs/2026-05-23-memory-v2-design.md` §1 (Architecture Overview), §4 (Interfaces & Contracts), §6 (Schema Migration) before starting. Understand the 2-axis model (tier × scope), the `MemoryStore` interface shape, and the CAS contract.

- [ ] **Step 0.2: Read existing database layer**

Read `packages/memory/src/database.ts` fully. Understand:
- `MemoryDatabase` is a Context.Tag providing `query` / `exec` / `transaction` / `close` / `hasFTS5`
- Tables are created via `SCHEMA_CORE_SQL` constant
- `MemoryDatabaseLive(config)` is the Layer factory

The new `MemoryStore` sits ON TOP of `MemoryDatabase` — it does not replace it. `SQLiteStoreLive` will `yield* MemoryDatabase` to get the low-level service.

- [ ] **Step 0.3: Verify clean baseline**

```bash
bun test packages/memory/ 2>&1 | tail -20
```

Expected: existing tests pass (38 from M10 Phase 1 + provider tests). If any fail, stop and surface before continuing.

---

## Task 1: Add blake3 dependency + content-hash helper

**Files:**
- Modify: `packages/memory/package.json`
- Create: `packages/memory/src/store/content-hash.ts`
- Create: `packages/memory/src/store/__tests__/content-hash.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `packages/memory/src/store/__tests__/content-hash.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { computeContentHash } from "../content-hash.js";

describe("computeContentHash", () => {
  test("produces deterministic blake3 hash for identical content", () => {
    const h1 = computeContentHash("hello world");
    const h2 = computeContentHash("hello world");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // 32-byte hex
  });

  test("produces different hashes for different content", () => {
    const h1 = computeContentHash("hello");
    const h2 = computeContentHash("world");
    expect(h1).not.toBe(h2);
  });

  test("handles unicode content stably", () => {
    const h1 = computeContentHash("日本語テスト");
    const h2 = computeContentHash("日本語テスト");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  test("handles empty string", () => {
    const h = computeContentHash("");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
bun test packages/memory/src/store/__tests__/content-hash.test.ts
```

Expected: FAIL with module-not-found or `computeContentHash is not a function`.

- [ ] **Step 1.3: Add `@noble/hashes` dependency**

```bash
cd packages/memory && bun add @noble/hashes
```

Verify `package.json` now lists `"@noble/hashes": "^X.Y.Z"` under dependencies.

- [ ] **Step 1.4: Implement content-hash helper**

Create `packages/memory/src/store/content-hash.ts`:

```typescript
import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex } from "@noble/hashes/utils";

/**
 * Compute blake3 content hash as 64-char hex string.
 *
 * Used for optimistic concurrency control (CAS) in MemoryStore.
 * Stable across runs, platforms, and unicode input.
 */
export function computeContentHash(content: string): string {
  const bytes = new TextEncoder().encode(content);
  return bytesToHex(blake3(bytes));
}
```

- [ ] **Step 1.5: Run test to verify it passes**

```bash
bun test packages/memory/src/store/__tests__/content-hash.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 1.6: Commit**

```bash
git add packages/memory/package.json packages/memory/bun.lockb packages/memory/src/store/content-hash.ts packages/memory/src/store/__tests__/content-hash.test.ts
git commit -m "feat(memory): add blake3 content-hash helper for MemoryStore CAS"
```

---

## Task 2: Define v2 store types

**Files:**
- Create: `packages/memory/src/store/types.ts`

This task has no runtime test — it only defines types. Type errors at compile time are the test.

- [ ] **Step 2.1: Create the types file**

Create `packages/memory/src/store/types.ts`:

```typescript
import { Schema } from "effect";

// ─── Scope ────────────────────────────────────────────────────────────────

export const ScopeSchema = Schema.Literal("private", "team", "global");
export type Scope = typeof ScopeSchema.Type;

// ─── Tier ─────────────────────────────────────────────────────────────────

export const MemoryTierSchema = Schema.Literal(
  "working",
  "episodic",
  "semantic",
  "procedural",
  "anti-pattern",
);
export type MemoryTier = typeof MemoryTierSchema.Type;

// ─── Provenance ───────────────────────────────────────────────────────────

export const ProvenanceSchema = Schema.Literal(
  "agent",
  "user",
  "tool",
  "system",
  "llm-extraction",
  "promoted",
  "dream",
);
export type Provenance = typeof ProvenanceSchema.Type;

// ─── Result Types ─────────────────────────────────────────────────────────

export interface PutResult {
  readonly id: string;
  readonly tier: MemoryTier;
  readonly scope: Scope;
  readonly version: number;
  readonly contentHash: string;
}

export interface MemoryVersion {
  readonly version: number;
  readonly contentHash: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly changeReason?: string;
}

// ─── Query Filter ─────────────────────────────────────────────────────────

export interface QueryFilter {
  readonly tier?: MemoryTier;
  readonly scopes: ReadonlyArray<Scope>;
  readonly agentId?: string;
  readonly teamId?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly textSearch?: string;
  readonly since?: Date;
  readonly provenance?: ReadonlyArray<Provenance>;
  readonly minImportance?: number;
  readonly limit?: number;
}
```

- [ ] **Step 2.2: Verify types compile**

```bash
bunx turbo run build --filter=@reactive-agents/memory
```

Expected: clean build. If errors, fix them inline before continuing.

- [ ] **Step 2.3: Commit**

```bash
git add packages/memory/src/store/types.ts
git commit -m "feat(memory): add v2 store types (Scope, MemoryTier, Provenance, PutResult, QueryFilter)"
```

---

## Task 3: Define MemoryStore errors

**Files:**
- Create: `packages/memory/src/store/errors.ts`

- [ ] **Step 3.1: Create error classes**

Create `packages/memory/src/store/errors.ts`:

```typescript
import { Data } from "effect";

/** Generic backend I/O failure. */
export class StoreError extends Data.TaggedError("StoreError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Compare-and-set hash mismatch — caller's `expectedHash` does not match stored value. */
export class CASConflict extends Data.TaggedError("CASConflict")<{
  readonly id: string;
  readonly expectedHash: string;
  readonly actualHash: string;
}> {}
```

- [ ] **Step 3.2: Verify compile**

```bash
bunx turbo run build --filter=@reactive-agents/memory
```

Expected: clean build.

- [ ] **Step 3.3: Commit**

```bash
git add packages/memory/src/store/errors.ts
git commit -m "feat(memory): add StoreError and CASConflict tagged errors"
```

---

## Task 4: Extend MemoryEntrySchema with v2 fields

**Files:**
- Modify: `packages/memory/src/types.ts:56-79`

- [ ] **Step 4.1: Write the failing test**

Append to `packages/memory/src/__tests__/types-provider.test.ts`:

```typescript
import { MemoryEntrySchema } from "../types.js";

describe("MemoryEntrySchema v2 fields", () => {
  test("accepts entry with v2 fields", () => {
    const entry = Schema.decodeUnknownSync(MemoryEntrySchema)({
      id: "mem-v2-1",
      agentId: "agent-1",
      type: "semantic",
      content: "test content",
      importance: 0.5,
      createdAt: new Date(),
      updatedAt: new Date(),
      source: { type: "agent", id: "agent-1" },
      tags: [],
      scope: "private",
      version: 1,
      contentHash: "0".repeat(64),
      provenance: "agent",
    });
    expect(entry.scope).toBe("private");
    expect(entry.version).toBe(1);
    expect(entry.provenance).toBe("agent");
  });

  test("scope defaults are enforced at runtime — invalid scope rejected", () => {
    expect(() =>
      Schema.decodeUnknownSync(MemoryEntrySchema)({
        id: "mem-v2-2",
        agentId: "agent-1",
        type: "semantic",
        content: "test",
        importance: 0.5,
        createdAt: new Date(),
        updatedAt: new Date(),
        source: { type: "agent", id: "agent-1" },
        tags: [],
        scope: "invalid-scope",
        version: 1,
        contentHash: "0".repeat(64),
        provenance: "agent",
      }),
    ).toThrow();
  });

  test("teamId is optional", () => {
    const entry = Schema.decodeUnknownSync(MemoryEntrySchema)({
      id: "mem-v2-3",
      agentId: "agent-1",
      type: "semantic",
      content: "test",
      importance: 0.5,
      createdAt: new Date(),
      updatedAt: new Date(),
      source: { type: "agent", id: "agent-1" },
      tags: [],
      scope: "team",
      teamId: "T1",
      version: 1,
      contentHash: "0".repeat(64),
      provenance: "agent",
      confidence: 0.9,
    });
    expect(entry.teamId).toBe("T1");
    expect(entry.confidence).toBe(0.9);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
bun test packages/memory/src/__tests__/types-provider.test.ts
```

Expected: FAIL — `MemoryEntrySchema` does not accept `scope`, `version`, `contentHash`, `provenance`.

- [ ] **Step 4.3: Extend MemoryEntrySchema**

Edit `packages/memory/src/types.ts:56-79` — locate the `MemoryEntrySchema = Schema.Struct({...})` block and add the new v2 fields after the existing `metadata` field. The full extended schema:

```typescript
export const MemoryEntrySchema = Schema.Struct({
  // existing fields (unchanged)
  id: MemoryId,
  agentId: Schema.String,
  type: MemoryType,
  content: Schema.String,
  importance: Schema.Number.pipe(Schema.between(0, 1)),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
  source: MemorySourceSchema,
  tags: Schema.Array(Schema.String),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),

  // v2 fields (additive, required on new writes; defaulted on legacy reads)
  scope: Schema.Literal("private", "team", "global"),
  teamId: Schema.optional(Schema.String),
  version: Schema.Number,
  contentHash: Schema.String,
  provenance: Schema.Literal(
    "agent",
    "user",
    "tool",
    "system",
    "llm-extraction",
    "promoted",
    "dream",
  ),
  confidence: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
});
export type MemoryEntry = typeof MemoryEntrySchema.Type;
```

Also extend the `MemoryType` literal to include `"anti-pattern"`:

```typescript
export const MemoryType = Schema.Literal(
  "semantic",
  "episodic",
  "procedural",
  "working",
  "anti-pattern",
);
```

- [ ] **Step 4.4: Run test to verify it passes**

```bash
bun test packages/memory/src/__tests__/types-provider.test.ts
```

Expected: PASS — all 3 new tests + all existing tests still pass.

- [ ] **Step 4.5: Run full memory test suite (regression gate)**

```bash
bun test packages/memory/
```

Expected: all 38 existing tests + new tests pass. If any legacy test breaks because it constructs `MemoryEntrySchema` without v2 fields, that test must be updated to supply defaults (`scope: "private"`, `version: 1`, `contentHash: computeContentHash(content)`, `provenance: "agent"`).

- [ ] **Step 4.6: Commit**

```bash
git add packages/memory/src/types.ts packages/memory/src/__tests__/types-provider.test.ts
git commit -m "feat(memory): extend MemoryEntrySchema with v2 fields (scope, version, contentHash, provenance, confidence, teamId)"
```

---

## Task 5: Schema migration runner

**Files:**
- Create: `packages/memory/src/store/migrations/001-v2-foundation.ts`
- Create: `packages/memory/src/store/__tests__/migration.test.ts`
- Modify: `packages/memory/src/database.ts` (invoke migration on Layer build)

- [ ] **Step 5.1: Write the failing test**

Create `packages/memory/src/store/__tests__/migration.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { MemoryDatabase, MemoryDatabaseLive } from "../../database.js";
import { runV2FoundationMigration } from "../migrations/001-v2-foundation.js";
import type { MemoryConfig } from "../../types.js";
import { defaultMemoryConfig } from "../../types.js";

const testConfig: MemoryConfig = {
  ...defaultMemoryConfig("migration-test-agent"),
  dbPath: ":memory:",
};

describe("v2 foundation migration", () => {
  test("adds scope/version/contentHash/provenance columns to semantic_memory", async () => {
    const program = Effect.gen(function* () {
      const db = yield* MemoryDatabase;
      yield* runV2FoundationMigration(db);
      const cols = yield* db.query<{ name: string }>(
        `PRAGMA table_info(semantic_memory)`,
      );
      return cols.map((c) => c.name);
    });

    const columns = await Effect.runPromise(
      program.pipe(Effect.provide(MemoryDatabaseLive(testConfig))),
    );

    expect(columns).toContain("scope");
    expect(columns).toContain("team_id");
    expect(columns).toContain("version");
    expect(columns).toContain("content_hash");
    expect(columns).toContain("provenance");
    expect(columns).toContain("confidence");
  });

  test("creates memory_versions table", async () => {
    const program = Effect.gen(function* () {
      const db = yield* MemoryDatabase;
      yield* runV2FoundationMigration(db);
      const rows = yield* db.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='memory_versions'`,
      );
      return rows.length;
    });

    const count = await Effect.runPromise(
      program.pipe(Effect.provide(MemoryDatabaseLive(testConfig))),
    );

    expect(count).toBe(1);
  });

  test("migration is idempotent (safe to run twice)", async () => {
    const program = Effect.gen(function* () {
      const db = yield* MemoryDatabase;
      yield* runV2FoundationMigration(db);
      yield* runV2FoundationMigration(db); // second run must not throw
      return true;
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(MemoryDatabaseLive(testConfig))),
    );

    expect(result).toBe(true);
  });

  test("creates per-tier scope indexes", async () => {
    const program = Effect.gen(function* () {
      const db = yield* MemoryDatabase;
      yield* runV2FoundationMigration(db);
      const indexes = yield* db.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%_scope_agent'`,
      );
      return indexes.map((i) => i.name);
    });

    const idx = await Effect.runPromise(
      program.pipe(Effect.provide(MemoryDatabaseLive(testConfig))),
    );

    expect(idx).toContain("idx_semantic_scope_agent");
    expect(idx).toContain("idx_episodic_scope_agent");
    expect(idx).toContain("idx_procedural_scope_agent");
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
bun test packages/memory/src/store/__tests__/migration.test.ts
```

Expected: FAIL — `runV2FoundationMigration` not defined.

- [ ] **Step 5.3: Implement the migration**

Create `packages/memory/src/store/migrations/001-v2-foundation.ts`:

```typescript
import { Effect } from "effect";
import type { MemoryDatabaseService } from "../../database.js";
import { DatabaseError } from "../../errors.js";

/**
 * v2 Foundation migration — additive schema changes.
 *
 * - Adds scope/team_id/version/content_hash/provenance/confidence columns
 *   to semantic_memory, episodic_log, procedural_memory
 * - Creates memory_versions table (per-id version log for CAS history)
 * - Creates per-tier scope+agent indexes
 *
 * Idempotent: uses IF NOT EXISTS / ALTER TABLE catch-on-error pattern.
 * Safe to run on existing v1 databases — defaults backfill legacy rows.
 */
export const runV2FoundationMigration = (
  db: MemoryDatabaseService,
): Effect.Effect<void, DatabaseError> =>
  Effect.gen(function* () {
    // ALTER TABLE — SQLite throws if column exists; we swallow that specific case
    const tierTables = ["semantic_memory", "episodic_log", "procedural_memory"];
    const v2Columns: Array<{ name: string; ddl: string }> = [
      { name: "scope", ddl: "TEXT NOT NULL DEFAULT 'private'" },
      { name: "team_id", ddl: "TEXT" },
      { name: "version", ddl: "INTEGER NOT NULL DEFAULT 1" },
      { name: "content_hash", ddl: "TEXT" }, // nullable; computed on next write per spec FIX 3
      { name: "provenance", ddl: "TEXT NOT NULL DEFAULT 'agent'" },
      { name: "confidence", ddl: "REAL" },
    ];

    for (const table of tierTables) {
      for (const col of v2Columns) {
        yield* db
          .exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.ddl}`, [])
          .pipe(
            Effect.catchTag("DatabaseError", (e) => {
              // Idempotency: ignore "duplicate column" errors
              const msg = String(e.message ?? "");
              if (msg.includes("duplicate column")) return Effect.void;
              return Effect.fail(e);
            }),
          );
      }
    }

    // memory_versions table — version log
    yield* db.exec(
      `CREATE TABLE IF NOT EXISTS memory_versions (
        id            TEXT NOT NULL,
        version       INTEGER NOT NULL,
        content       TEXT NOT NULL,
        content_hash  TEXT NOT NULL,
        agent_id      TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        change_reason TEXT,
        PRIMARY KEY (id, version)
      )`,
      [],
    );

    yield* db.exec(
      `CREATE INDEX IF NOT EXISTS idx_memory_versions_id ON memory_versions(id)`,
      [],
    );

    // Per-tier scope indexes
    yield* db.exec(
      `CREATE INDEX IF NOT EXISTS idx_semantic_scope_agent ON semantic_memory(scope, agent_id)`,
      [],
    );
    yield* db.exec(
      `CREATE INDEX IF NOT EXISTS idx_episodic_scope_agent ON episodic_log(scope, agent_id)`,
      [],
    );
    yield* db.exec(
      `CREATE INDEX IF NOT EXISTS idx_procedural_scope_agent ON procedural_memory(scope, agent_id)`,
      [],
    );
  });
```

- [ ] **Step 5.4: Run migration test to verify it passes**

```bash
bun test packages/memory/src/store/__tests__/migration.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5.5: Wire migration into database Layer**

Edit `packages/memory/src/database.ts`. Locate the `MemoryDatabaseLive` factory and ensure the v2 migration runs after `SCHEMA_CORE_SQL` is applied (look for where the schema is initialized — typically inside `Layer.scoped` or after `Database` open).

Add at the appropriate place (after core schema init, inside the same Effect.gen block that builds the `MemoryDatabase` service):

```typescript
// v2 Foundation migration — idempotent, runs on every boot
import { runV2FoundationMigration } from "./store/migrations/001-v2-foundation.js";

// ... existing core schema init ...

yield* runV2FoundationMigration(databaseService);
```

If `database.ts` does not yet construct a `databaseService` value before returning, refactor so the migration runs after the service is fully assembled but before the Layer is returned. The exact insertion point depends on the current structure — read `MemoryDatabaseLive` carefully and place the call where it has access to a functional `MemoryDatabaseService` instance.

- [ ] **Step 5.6: Run full memory suite (regression gate)**

```bash
bun test packages/memory/
```

Expected: all existing tests pass; migration tests pass. If any existing test uses an on-disk database and fails because the migration runs against a v1 DB, the migration's idempotency should handle it — but verify the failure mode.

- [ ] **Step 5.7: Commit**

```bash
git add packages/memory/src/store/migrations/001-v2-foundation.ts packages/memory/src/store/__tests__/migration.test.ts packages/memory/src/database.ts
git commit -m "feat(memory): v2 foundation schema migration (scope/version/content_hash/provenance + memory_versions table)"
```

---

## Task 6: Define MemoryStore interface

**Files:**
- Create: `packages/memory/src/store/memory-store.ts`

- [ ] **Step 6.1: Write the interface and Context.Tag**

Create `packages/memory/src/store/memory-store.ts`:

```typescript
import { Context, Effect } from "effect";
import type { MemoryEntry } from "../types.js";
import type {
  MemoryVersion,
  PutResult,
  QueryFilter,
} from "./types.js";
import type { CASConflict, StoreError } from "./errors.js";

/**
 * MemoryStore — foundational backend interface for Memory v2.
 *
 * Sits on top of MemoryDatabase (low-level SQLite service). Provides:
 * - get / put / cas / query / versions / delete
 * - Content-hash optimistic concurrency
 * - Version log on every write
 * - Scope-aware queries (private/team/global)
 *
 * Implementations: SQLiteStore (default), FilesystemStore (v0.14).
 * Consumers (SemanticMemoryService etc.) migrate to this in v2.2.
 */
export interface MemoryStoreService {
  /** Fetch a single entry by id. Returns null if not found. */
  readonly get: (
    id: string,
  ) => Effect.Effect<MemoryEntry | null, StoreError>;

  /**
   * Upsert without concurrency check.
   * Computes contentHash on write; appends to memory_versions log;
   * bumps version monotonically.
   */
  readonly put: (
    entry: MemoryEntry,
  ) => Effect.Effect<PutResult, StoreError>;

  /**
   * Compare-and-set: reject if stored contentHash != expectedHash.
   * On success, bumps version + appends to memory_versions log.
   */
  readonly cas: (
    entry: MemoryEntry,
    expectedHash: string,
  ) => Effect.Effect<PutResult, StoreError | CASConflict>;

  /** Query with scope-aware filter. */
  readonly query: (
    filter: QueryFilter,
  ) => Effect.Effect<ReadonlyArray<MemoryEntry>, StoreError>;

  /** Full version history for one id. Newest first. */
  readonly versions: (
    id: string,
  ) => Effect.Effect<ReadonlyArray<MemoryVersion>, StoreError>;

  /** Delete with CAS guard. */
  readonly delete: (
    id: string,
    expectedHash: string,
  ) => Effect.Effect<void, StoreError | CASConflict>;
}

export class MemoryStore extends Context.Tag("MemoryStore")<
  MemoryStore,
  MemoryStoreService
>() {}
```

- [ ] **Step 6.2: Verify compile**

```bash
bunx turbo run build --filter=@reactive-agents/memory
```

Expected: clean build. No tests yet — pure interface definition.

- [ ] **Step 6.3: Commit**

```bash
git add packages/memory/src/store/memory-store.ts
git commit -m "feat(memory): define MemoryStore interface + Context.Tag"
```

---

## Task 7: SQLiteStore — get + put

**Files:**
- Create: `packages/memory/src/store/sqlite-store.ts`
- Create: `packages/memory/src/store/__tests__/sqlite-store.contract.test.ts` (start contract suite — extended in later tasks)

- [ ] **Step 7.1: Write the failing test (contract suite skeleton)**

Create `packages/memory/src/store/__tests__/sqlite-store.contract.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Layer } from "effect";
import { MemoryDatabaseLive } from "../../database.js";
import { SQLiteStoreLive } from "../sqlite-store.js";
import { MemoryStore } from "../memory-store.js";
import { computeContentHash } from "../content-hash.js";
import { defaultMemoryConfig } from "../../types.js";
import type { MemoryEntry } from "../../types.js";

const makeTestLayer = (agentId = "test-agent") => {
  const config = { ...defaultMemoryConfig(agentId), dbPath: ":memory:" };
  return SQLiteStoreLive.pipe(Layer.provide(MemoryDatabaseLive(config)));
};

const makeEntry = (overrides: Partial<MemoryEntry> = {}): MemoryEntry => {
  const content = overrides.content ?? "test content";
  return {
    id: "mem-1",
    agentId: "test-agent",
    type: "semantic",
    content,
    importance: 0.5,
    createdAt: new Date(),
    updatedAt: new Date(),
    source: { type: "agent", id: "test-agent" },
    tags: [],
    scope: "private",
    version: 1,
    contentHash: computeContentHash(content),
    provenance: "agent",
    ...overrides,
  } as MemoryEntry;
};

describe("SQLiteStore — get + put", () => {
  test("get returns null for missing entry", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        return yield* store.get("nonexistent");
      }).pipe(Effect.provide(makeTestLayer())),
    );
    expect(result).toBeNull();
  });

  test("put inserts new entry and computes contentHash", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        const entry = makeEntry({ id: "mem-put-1", content: "hello" });
        const put = yield* store.put(entry);
        const fetched = yield* store.get("mem-put-1");
        return { put, fetched };
      }).pipe(Effect.provide(makeTestLayer())),
    );

    expect(result.put.id).toBe("mem-put-1");
    expect(result.put.version).toBe(1);
    expect(result.put.contentHash).toBe(computeContentHash("hello"));
    expect(result.put.tier).toBe("semantic");
    expect(result.put.scope).toBe("private");
    expect(result.fetched?.content).toBe("hello");
  });

  test("put on existing id bumps version + recomputes hash", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        const first = yield* store.put(
          makeEntry({ id: "mem-put-2", content: "v1" }),
        );
        const second = yield* store.put(
          makeEntry({ id: "mem-put-2", content: "v2" }),
        );
        return { first, second };
      }).pipe(Effect.provide(makeTestLayer())),
    );

    expect(result.first.version).toBe(1);
    expect(result.second.version).toBe(2);
    expect(result.second.contentHash).toBe(computeContentHash("v2"));
  });
});
```

- [ ] **Step 7.2: Run test to verify it fails**

```bash
bun test packages/memory/src/store/__tests__/sqlite-store.contract.test.ts
```

Expected: FAIL — `SQLiteStoreLive` not defined.

- [ ] **Step 7.3: Implement SQLiteStore (get + put only)**

Create `packages/memory/src/store/sqlite-store.ts`:

```typescript
import { Effect, Layer } from "effect";
import { MemoryDatabase } from "../database.js";
import { CASConflict, StoreError } from "./errors.js";
import { MemoryStore, type MemoryStoreService } from "./memory-store.js";
import { computeContentHash } from "./content-hash.js";
import type { MemoryEntry } from "../types.js";
import type {
  MemoryTier,
  MemoryVersion,
  PutResult,
  QueryFilter,
} from "./types.js";

/** Map tier → SQLite table name. */
const tierTable = (tier: MemoryTier): string => {
  switch (tier) {
    case "semantic":
      return "semantic_memory";
    case "episodic":
      return "episodic_log";
    case "procedural":
      return "procedural_memory";
    case "anti-pattern":
      return "anti_patterns";
    case "working":
      throw new Error("Working memory is in-process only — not in SQLiteStore");
  }
};

/** Convert SQLite row → MemoryEntry. */
const rowToEntry = (
  row: Record<string, unknown>,
  tier: MemoryTier,
): MemoryEntry => {
  const tags = row.tags ? (JSON.parse(row.tags as string) as string[]) : [];
  const metadata = row.metadata
    ? (JSON.parse(row.metadata as string) as Record<string, unknown>)
    : undefined;
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    type: tier,
    content: row.content as string,
    importance: (row.importance as number) ?? 0.5,
    createdAt: new Date(row.created_at as string | number),
    updatedAt: new Date(row.updated_at as string | number),
    source: {
      type: "agent",
      id: row.agent_id as string,
    },
    tags,
    metadata,
    scope: (row.scope as "private" | "team" | "global") ?? "private",
    teamId: (row.team_id as string | undefined) ?? undefined,
    version: (row.version as number) ?? 1,
    contentHash: (row.content_hash as string) ?? computeContentHash(row.content as string),
    provenance: (row.provenance as MemoryEntry["provenance"]) ?? "agent",
    confidence:
      typeof row.confidence === "number" ? (row.confidence as number) : undefined,
  } as MemoryEntry;
};

export const SQLiteStoreLive: Layer.Layer<MemoryStore, never, MemoryDatabase> =
  Layer.effect(
    MemoryStore,
    Effect.gen(function* () {
      const db = yield* MemoryDatabase;

      const service: MemoryStoreService = {
        get: (id) =>
          Effect.gen(function* () {
            for (const tier of ["semantic", "episodic", "procedural"] as const) {
              const rows = yield* db
                .query<Record<string, unknown>>(
                  `SELECT * FROM ${tierTable(tier)} WHERE id = ? LIMIT 1`,
                  [id],
                )
                .pipe(
                  Effect.mapError(
                    (e) =>
                      new StoreError({ message: `get(${id}): ${e.message}`, cause: e }),
                  ),
                );
              if (rows.length > 0) return rowToEntry(rows[0]!, tier);
            }
            return null;
          }),

        put: (entry) =>
          Effect.gen(function* () {
            const tier = entry.type as MemoryTier;
            if (tier === "working") {
              return yield* Effect.fail(
                new StoreError({
                  message: "Cannot put working memory entries to SQLiteStore",
                }),
              );
            }
            const table = tierTable(tier);
            const contentHash = computeContentHash(entry.content);

            const existing = yield* db
              .query<{ version: number }>(
                `SELECT version FROM ${table} WHERE id = ? LIMIT 1`,
                [entry.id],
              )
              .pipe(
                Effect.mapError(
                  (e) =>
                    new StoreError({ message: `put(${entry.id}): ${e.message}`, cause: e }),
                ),
              );

            const nextVersion = existing.length > 0 ? existing[0]!.version + 1 : 1;
            const now = new Date().toISOString();

            // Always pass created_at + updated_at; ON CONFLICT preserves existing created_at
            // by omitting it from the DO UPDATE SET clause.
            yield* db
              .exec(
                `INSERT INTO ${table} (
                  id, agent_id, content, importance, tags,
                  scope, team_id, version, content_hash, provenance, confidence,
                  created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  content       = excluded.content,
                  importance    = excluded.importance,
                  tags          = excluded.tags,
                  scope         = excluded.scope,
                  team_id       = excluded.team_id,
                  version       = excluded.version,
                  content_hash  = excluded.content_hash,
                  provenance    = excluded.provenance,
                  confidence    = excluded.confidence,
                  updated_at    = excluded.updated_at`,
                [
                  entry.id,
                  entry.agentId,
                  entry.content,
                  entry.importance,
                  JSON.stringify(entry.tags),
                  entry.scope,
                  entry.teamId ?? null,
                  nextVersion,
                  contentHash,
                  entry.provenance,
                  entry.confidence ?? null,
                  now,
                  now,
                ],
              )
              .pipe(
                Effect.mapError(
                  (e) =>
                    new StoreError({ message: `put(${entry.id}): ${e.message}`, cause: e }),
                ),
              );

            yield* db
              .exec(
                `INSERT INTO memory_versions (id, version, content, content_hash, agent_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  entry.id,
                  nextVersion,
                  entry.content,
                  contentHash,
                  entry.agentId,
                  Date.now(),
                ],
              )
              .pipe(
                Effect.mapError(
                  (e) =>
                    new StoreError({
                      message: `put-version(${entry.id}): ${e.message}`,
                      cause: e,
                    }),
                ),
              );

            return {
              id: entry.id,
              tier,
              scope: entry.scope,
              version: nextVersion,
              contentHash,
            } satisfies PutResult;
          }),

        cas: () =>
          Effect.fail(new StoreError({ message: "cas not implemented (Task 8)" })),

        query: () =>
          Effect.fail(new StoreError({ message: "query not implemented (Task 9)" })),

        versions: () =>
          Effect.fail(
            new StoreError({ message: "versions not implemented (Task 10)" }),
          ),

        delete: () =>
          Effect.fail(new StoreError({ message: "delete not implemented (Task 10)" })),
      };

      return service;
    }),
  );
```

- [ ] **Step 7.4: Run contract tests to verify pass**

```bash
bun test packages/memory/src/store/__tests__/sqlite-store.contract.test.ts
```

Expected: PASS (3/3 for get + put).

- [ ] **Step 7.5: Commit**

```bash
git add packages/memory/src/store/sqlite-store.ts packages/memory/src/store/__tests__/sqlite-store.contract.test.ts
git commit -m "feat(memory): SQLiteStore get+put with version log + content hash"
```

---

## Task 8: SQLiteStore — cas (compare-and-set)

**Files:**
- Modify: `packages/memory/src/store/sqlite-store.ts` (implement `cas`)
- Modify: `packages/memory/src/store/__tests__/sqlite-store.contract.test.ts` (add CAS tests)

- [ ] **Step 8.1: Append CAS tests**

Append to `sqlite-store.contract.test.ts`:

```typescript
describe("SQLiteStore — cas", () => {
  test("cas succeeds when expectedHash matches stored hash", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        const first = yield* store.put(
          makeEntry({ id: "mem-cas-1", content: "original" }),
        );
        const updated = yield* store.cas(
          makeEntry({ id: "mem-cas-1", content: "updated" }),
          first.contentHash,
        );
        return updated;
      }).pipe(Effect.provide(makeTestLayer())),
    );
    expect(result.version).toBe(2);
    expect(result.contentHash).toBe(computeContentHash("updated"));
  });

  test("cas fails with CASConflict when expectedHash does not match", async () => {
    const program = Effect.gen(function* () {
      const store = yield* MemoryStore;
      yield* store.put(makeEntry({ id: "mem-cas-2", content: "original" }));
      return yield* store.cas(
        makeEntry({ id: "mem-cas-2", content: "updated" }),
        "0".repeat(64), // wrong hash
      );
    }).pipe(Effect.provide(makeTestLayer()));

    const result = await Effect.runPromiseExit(program);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      const cause = result.cause;
      // Inspect cause for CASConflict tag
      const causeStr = JSON.stringify(cause);
      expect(causeStr).toContain("CASConflict");
    }
  });

  test("cas on missing entry fails with CASConflict (treated as hash mismatch)", async () => {
    const program = Effect.gen(function* () {
      const store = yield* MemoryStore;
      return yield* store.cas(
        makeEntry({ id: "mem-cas-3-missing" }),
        "any-hash",
      );
    }).pipe(Effect.provide(makeTestLayer()));

    const result = await Effect.runPromiseExit(program);
    expect(result._tag).toBe("Failure");
  });
});
```

- [ ] **Step 8.2: Run to verify failure**

```bash
bun test packages/memory/src/store/__tests__/sqlite-store.contract.test.ts
```

Expected: FAIL on CAS tests with `"cas not implemented (Task 8)"`.

- [ ] **Step 8.3: Implement cas**

In `packages/memory/src/store/sqlite-store.ts`, replace the `cas:` stub with:

```typescript
cas: (entry, expectedHash) =>
  Effect.gen(function* () {
    const tier = entry.type as MemoryTier;
    const table = tierTable(tier);

    // Fetch current hash
    const rows = yield* db
      .query<{ content_hash: string | null; version: number }>(
        `SELECT content_hash, version FROM ${table} WHERE id = ? LIMIT 1`,
        [entry.id],
      )
      .pipe(
        Effect.mapError(
          (e) =>
            new StoreError({ message: `cas(${entry.id}): ${e.message}`, cause: e }),
        ),
      );

    if (rows.length === 0) {
      return yield* Effect.fail(
        new CASConflict({
          id: entry.id,
          expectedHash,
          actualHash: "<missing>",
        }),
      );
    }

    const actualHash = rows[0]!.content_hash ?? "";
    if (actualHash !== expectedHash) {
      return yield* Effect.fail(
        new CASConflict({ id: entry.id, expectedHash, actualHash }),
      );
    }

    // Hash matches → proceed with write (reuse put logic)
    const newHash = computeContentHash(entry.content);
    const nextVersion = rows[0]!.version + 1;
    const now = new Date().toISOString();

    yield* db
      .exec(
        `UPDATE ${table} SET
          content = ?, importance = ?, tags = ?,
          scope = ?, team_id = ?, version = ?, content_hash = ?,
          provenance = ?, confidence = ?, updated_at = ?
         WHERE id = ?`,
        [
          entry.content,
          entry.importance,
          JSON.stringify(entry.tags),
          entry.scope,
          entry.teamId ?? null,
          nextVersion,
          newHash,
          entry.provenance,
          entry.confidence ?? null,
          now,
          entry.id,
        ],
      )
      .pipe(
        Effect.mapError(
          (e) =>
            new StoreError({ message: `cas-update(${entry.id}): ${e.message}`, cause: e }),
        ),
      );

    yield* db
      .exec(
        `INSERT INTO memory_versions (id, version, content, content_hash, agent_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [entry.id, nextVersion, entry.content, newHash, entry.agentId, Date.now()],
      )
      .pipe(
        Effect.mapError(
          (e) =>
            new StoreError({ message: `cas-version(${entry.id}): ${e.message}`, cause: e }),
        ),
      );

    return {
      id: entry.id,
      tier,
      scope: entry.scope,
      version: nextVersion,
      contentHash: newHash,
    } satisfies PutResult;
  }),
```

(The `CASConflict` import was already added in Task 7 — verify it's present at the top of `sqlite-store.ts`; if missing, add `import { CASConflict, StoreError } from "./errors.js";`.)

- [ ] **Step 8.4: Run to verify pass**

```bash
bun test packages/memory/src/store/__tests__/sqlite-store.contract.test.ts
```

Expected: PASS (6/6 — 3 get+put + 3 cas).

- [ ] **Step 8.5: Commit**

```bash
git add packages/memory/src/store/sqlite-store.ts packages/memory/src/store/__tests__/sqlite-store.contract.test.ts
git commit -m "feat(memory): SQLiteStore CAS with content-hash optimistic concurrency"
```

---

## Task 9: SQLiteStore — query (scope-aware)

**Files:**
- Modify: `packages/memory/src/store/sqlite-store.ts` (implement `query`)
- Modify: `packages/memory/src/store/__tests__/sqlite-store.contract.test.ts` (add query tests)

- [ ] **Step 9.1: Append query tests**

Append to contract test file:

```typescript
describe("SQLiteStore — query", () => {
  test("query filters by tier", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        yield* store.put(makeEntry({ id: "q-1", type: "semantic", content: "a" }));
        yield* store.put(makeEntry({ id: "q-2", type: "episodic", content: "b" }));
        return yield* store.query({ tier: "semantic", scopes: ["private"] });
      }).pipe(Effect.provide(makeTestLayer())),
    );
    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe("q-1");
  });

  test("query filters by scope", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        yield* store.put(makeEntry({ id: "q-priv", scope: "private", content: "p" }));
        yield* store.put(
          makeEntry({ id: "q-team", scope: "team", teamId: "T1", content: "t" }),
        );
        yield* store.put(makeEntry({ id: "q-glob", scope: "global", content: "g" }));
        const privOnly = yield* store.query({ scopes: ["private"] });
        const teamOnly = yield* store.query({ scopes: ["team"] });
        const mixed = yield* store.query({ scopes: ["private", "global"] });
        return { privOnly, teamOnly, mixed };
      }).pipe(Effect.provide(makeTestLayer())),
    );
    expect(result.privOnly.map((e) => e.id).sort()).toEqual(["q-priv"]);
    expect(result.teamOnly.map((e) => e.id)).toEqual(["q-team"]);
    expect(result.mixed.map((e) => e.id).sort()).toEqual(["q-glob", "q-priv"]);
  });

  test("query filters by provenance", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        yield* store.put(makeEntry({ id: "q-agent", provenance: "agent" }));
        yield* store.put(makeEntry({ id: "q-dream", provenance: "dream" }));
        return yield* store.query({
          scopes: ["private"],
          provenance: ["dream"],
        });
      }).pipe(Effect.provide(makeTestLayer())),
    );
    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe("q-dream");
  });

  test("query respects limit", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        for (let i = 0; i < 5; i++) {
          yield* store.put(makeEntry({ id: `q-lim-${i}`, content: `c${i}` }));
        }
        return yield* store.query({ scopes: ["private"], limit: 2 });
      }).pipe(Effect.provide(makeTestLayer())),
    );
    expect(result.length).toBe(2);
  });

  test("query filters by minImportance", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        yield* store.put(makeEntry({ id: "q-lo", importance: 0.3 }));
        yield* store.put(makeEntry({ id: "q-hi", importance: 0.9 }));
        return yield* store.query({ scopes: ["private"], minImportance: 0.5 });
      }).pipe(Effect.provide(makeTestLayer())),
    );
    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe("q-hi");
  });
});
```

- [ ] **Step 9.2: Run to verify failure**

```bash
bun test packages/memory/src/store/__tests__/sqlite-store.contract.test.ts
```

Expected: FAIL on query tests with `"query not implemented (Task 9)"`.

- [ ] **Step 9.3: Implement query**

In `sqlite-store.ts`, replace the `query:` stub:

```typescript
query: (filter) =>
  Effect.gen(function* () {
    // Determine which tier tables to scan
    const tiers: MemoryTier[] = filter.tier
      ? [filter.tier]
      : ["semantic", "episodic", "procedural"];

    const allResults: MemoryEntry[] = [];

    for (const tier of tiers) {
      if (tier === "working" || tier === "anti-pattern") continue;
      const table = tierTable(tier);
      const conditions: string[] = [];
      const params: unknown[] = [];

      // Scope filter (always provided; never empty)
      if (filter.scopes.length === 0) continue;
      const scopePlaceholders = filter.scopes.map(() => "?").join(", ");
      conditions.push(`scope IN (${scopePlaceholders})`);
      params.push(...filter.scopes);

      if (filter.agentId) {
        conditions.push(`agent_id = ?`);
        params.push(filter.agentId);
      }
      if (filter.teamId) {
        conditions.push(`team_id = ?`);
        params.push(filter.teamId);
      }
      if (filter.provenance && filter.provenance.length > 0) {
        const provPlaceholders = filter.provenance.map(() => "?").join(", ");
        conditions.push(`provenance IN (${provPlaceholders})`);
        params.push(...filter.provenance);
      }
      if (typeof filter.minImportance === "number") {
        conditions.push(`importance >= ?`);
        params.push(filter.minImportance);
      }
      if (filter.since) {
        conditions.push(`updated_at >= ?`);
        params.push(filter.since.toISOString());
      }
      if (filter.textSearch) {
        conditions.push(`content LIKE ?`);
        params.push(`%${filter.textSearch}%`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const limit = filter.limit ? `LIMIT ${filter.limit}` : "";
      const sql = `SELECT * FROM ${table} ${where} ORDER BY updated_at DESC ${limit}`;

      const rows = yield* db
        .query<Record<string, unknown>>(sql, params)
        .pipe(
          Effect.mapError(
            (e) => new StoreError({ message: `query: ${e.message}`, cause: e }),
          ),
        );

      for (const row of rows) {
        allResults.push(rowToEntry(row, tier));

        // Tag-filter post-query (tags are JSON-encoded strings)
        if (filter.tags && filter.tags.length > 0) {
          const entryTags = allResults[allResults.length - 1]!.tags;
          const hasAll = filter.tags.every((t) => entryTags.includes(t));
          if (!hasAll) allResults.pop();
        }
      }
    }

    return allResults.slice(0, filter.limit ?? allResults.length);
  }),
```

- [ ] **Step 9.4: Run to verify pass**

```bash
bun test packages/memory/src/store/__tests__/sqlite-store.contract.test.ts
```

Expected: PASS (11/11 cumulative).

- [ ] **Step 9.5: Commit**

```bash
git add packages/memory/src/store/sqlite-store.ts packages/memory/src/store/__tests__/sqlite-store.contract.test.ts
git commit -m "feat(memory): SQLiteStore scope-aware query with provenance + importance filters"
```

---

## Task 10: SQLiteStore — versions + delete

**Files:**
- Modify: `packages/memory/src/store/sqlite-store.ts` (implement `versions`, `delete`)
- Modify: `packages/memory/src/store/__tests__/sqlite-store.contract.test.ts`

- [ ] **Step 10.1: Append tests**

Append:

```typescript
describe("SQLiteStore — versions + delete", () => {
  test("versions returns full history newest first", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        yield* store.put(makeEntry({ id: "v-1", content: "v1" }));
        yield* store.put(makeEntry({ id: "v-1", content: "v2" }));
        yield* store.put(makeEntry({ id: "v-1", content: "v3" }));
        return yield* store.versions("v-1");
      }).pipe(Effect.provide(makeTestLayer())),
    );
    expect(result.length).toBe(3);
    expect(result[0]!.version).toBe(3);
    expect(result[0]!.content).toBe("v3");
    expect(result[2]!.version).toBe(1);
  });

  test("versions returns empty array for unknown id", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        return yield* store.versions("never-existed");
      }).pipe(Effect.provide(makeTestLayer())),
    );
    expect(result.length).toBe(0);
  });

  test("delete succeeds with correct hash", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        const put = yield* store.put(makeEntry({ id: "d-1", content: "doomed" }));
        yield* store.delete("d-1", put.contentHash);
        return yield* store.get("d-1");
      }).pipe(Effect.provide(makeTestLayer())),
    );
    expect(result).toBeNull();
  });

  test("delete fails with CASConflict on wrong hash", async () => {
    const program = Effect.gen(function* () {
      const store = yield* MemoryStore;
      yield* store.put(makeEntry({ id: "d-2", content: "safe" }));
      return yield* store.delete("d-2", "0".repeat(64));
    }).pipe(Effect.provide(makeTestLayer()));

    const result = await Effect.runPromiseExit(program);
    expect(result._tag).toBe("Failure");
  });
});
```

- [ ] **Step 10.2: Run to verify failure**

```bash
bun test packages/memory/src/store/__tests__/sqlite-store.contract.test.ts
```

Expected: FAIL on versions + delete with `"not implemented"`.

- [ ] **Step 10.3: Implement versions + delete**

In `sqlite-store.ts`, replace the `versions:` and `delete:` stubs:

```typescript
versions: (id) =>
  Effect.gen(function* () {
    const rows = yield* db
      .query<{
        version: number;
        content: string;
        content_hash: string;
        created_at: number;
        change_reason: string | null;
      }>(
        `SELECT version, content, content_hash, created_at, change_reason
         FROM memory_versions WHERE id = ? ORDER BY version DESC`,
        [id],
      )
      .pipe(
        Effect.mapError(
          (e) => new StoreError({ message: `versions(${id}): ${e.message}`, cause: e }),
        ),
      );
    return rows.map((r) => ({
      version: r.version,
      content: r.content,
      contentHash: r.content_hash,
      createdAt: new Date(r.created_at),
      changeReason: r.change_reason ?? undefined,
    } satisfies MemoryVersion));
  }),

delete: (id, expectedHash) =>
  Effect.gen(function* () {
    // Find which tier table holds this id, and verify hash
    for (const tier of ["semantic", "episodic", "procedural"] as const) {
      const table = tierTable(tier);
      const rows = yield* db
        .query<{ content_hash: string | null }>(
          `SELECT content_hash FROM ${table} WHERE id = ? LIMIT 1`,
          [id],
        )
        .pipe(
          Effect.mapError(
            (e) => new StoreError({ message: `delete(${id}): ${e.message}`, cause: e }),
          ),
        );
      if (rows.length === 0) continue;

      const actualHash = rows[0]!.content_hash ?? "";
      if (actualHash !== expectedHash) {
        return yield* Effect.fail(
          new CASConflict({ id, expectedHash, actualHash }),
        );
      }

      yield* db
        .exec(`DELETE FROM ${table} WHERE id = ?`, [id])
        .pipe(
          Effect.mapError(
            (e) => new StoreError({ message: `delete(${id}): ${e.message}`, cause: e }),
          ),
        );
      return;
    }

    // Not found anywhere
    return yield* Effect.fail(
      new CASConflict({ id, expectedHash, actualHash: "<missing>" }),
    );
  }),
```

- [ ] **Step 10.4: Run to verify pass**

```bash
bun test packages/memory/src/store/__tests__/sqlite-store.contract.test.ts
```

Expected: PASS (15/15 cumulative).

- [ ] **Step 10.5: Commit**

```bash
git add packages/memory/src/store/sqlite-store.ts packages/memory/src/store/__tests__/sqlite-store.contract.test.ts
git commit -m "feat(memory): SQLiteStore versions log + CAS-guarded delete"
```

---

## Task 11: CAS stress test

**Files:**
- Create: `packages/memory/src/store/__tests__/cas-stress.test.ts`

- [ ] **Step 11.1: Write the stress test**

Create `packages/memory/src/store/__tests__/cas-stress.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { MemoryDatabaseLive } from "../../database.js";
import { SQLiteStoreLive } from "../sqlite-store.js";
import { MemoryStore } from "../memory-store.js";
import { computeContentHash } from "../content-hash.js";
import { defaultMemoryConfig } from "../../types.js";
import type { MemoryEntry } from "../../types.js";

const makeEntry = (id: string, content: string): MemoryEntry =>
  ({
    id,
    agentId: "stress-agent",
    type: "semantic",
    content,
    importance: 0.5,
    createdAt: new Date(),
    updatedAt: new Date(),
    source: { type: "agent", id: "stress-agent" },
    tags: [],
    scope: "private",
    version: 1,
    contentHash: computeContentHash(content),
    provenance: "agent",
  }) as MemoryEntry;

describe("CAS stress — concurrent writes preserve correctness", () => {
  test("10 concurrent writers, 1 entry, no data loss", async () => {
    const config = { ...defaultMemoryConfig("stress"), dbPath: ":memory:" };
    const layer = SQLiteStoreLive.pipe(Layer.provide(MemoryDatabaseLive(config)));

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        const seed = yield* store.put(makeEntry("stress-1", "v0"));

        // 10 concurrent CAS attempts — only one should succeed per "round"
        const attempts = Array.from({ length: 10 }, (_, i) =>
          store
            .cas(makeEntry("stress-1", `v-${i}`), seed.contentHash)
            .pipe(
              Effect.either, // collect success/failure without short-circuit
            ),
        );

        const results = yield* Effect.all(attempts, { concurrency: 10 });
        const successes = results.filter((r) => r._tag === "Right");
        const failures = results.filter((r) => r._tag === "Left");

        const versions = yield* store.versions("stress-1");
        return { successes: successes.length, failures: failures.length, versions };
      }).pipe(Effect.provide(layer)),
    );

    // Exactly one CAS with the original hash should succeed; others see new hash
    expect(result.successes).toBe(1);
    expect(result.failures).toBe(9);
    // Version log: v=1 (initial put) + v=2 (the one successful CAS) = 2 entries
    expect(result.versions.length).toBe(2);
  });

  test("sequential CAS retries succeed when each reads fresh hash", async () => {
    const config = { ...defaultMemoryConfig("stress2"), dbPath: ":memory:" };
    const layer = SQLiteStoreLive.pipe(Layer.provide(MemoryDatabaseLive(config)));

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MemoryStore;
        let put = yield* store.put(makeEntry("seq-1", "v0"));
        for (let i = 1; i <= 5; i++) {
          put = yield* store.cas(
            makeEntry("seq-1", `v${i}`),
            put.contentHash,
          );
        }
        const versions = yield* store.versions("seq-1");
        return { final: put, versions };
      }).pipe(Effect.provide(layer)),
    );

    expect(result.final.version).toBe(6);
    expect(result.versions.length).toBe(6);
  });
});
```

- [ ] **Step 11.2: Run the stress test**

```bash
bun test packages/memory/src/store/__tests__/cas-stress.test.ts
```

Expected: PASS (2/2). If the concurrent test shows >1 success, CAS is broken (last-write-wins instead of optimistic concurrency) — diagnose before continuing.

- [ ] **Step 11.3: Commit**

```bash
git add packages/memory/src/store/__tests__/cas-stress.test.ts
git commit -m "test(memory): CAS stress test — concurrent writers + sequential retry"
```

---

## Task 12: Wire SQLiteStoreLive into runtime + exports

**Files:**
- Modify: `packages/memory/src/runtime.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] **Step 12.1: Add SQLiteStoreLive to runtime layer composition**

Edit `packages/memory/src/runtime.ts`. At the top of the file with other imports:

```typescript
import { SQLiteStoreLive } from "./store/sqlite-store.js";
```

In the `createMemoryLayer` function, after `coreServices` definition and before the `return Layer.mergeAll(...)` block, add:

```typescript
  // MemoryStore v2 (foundational backend)
  const storeLayer = SQLiteStoreLive.pipe(Layer.provide(dbLayer));
```

Then add `storeLayer` to the `Layer.mergeAll(...)` arguments at the end of the function:

```typescript
  return Layer.mergeAll(
    dbLayer,
    workingLayer,
    coreServices,
    fsLayer,
    storeLayer,            // ← new
    memoryServiceLayer,
    agentMemoryAdapter,
    consolidatorLayer,
    compactionLayer,
    extractorLayer,
  );
```

- [ ] **Step 12.2: Export new types from package index**

Edit `packages/memory/src/index.ts`. Add to existing exports:

```typescript
// v2 store
export { MemoryStore, type MemoryStoreService } from "./store/memory-store.js";
export { SQLiteStoreLive } from "./store/sqlite-store.js";
export {
  type Scope,
  type MemoryTier,
  type Provenance,
  type PutResult,
  type MemoryVersion,
  type QueryFilter,
  ScopeSchema,
  MemoryTierSchema,
  ProvenanceSchema,
} from "./store/types.js";
export { StoreError, CASConflict } from "./store/errors.js";
export { computeContentHash } from "./store/content-hash.js";
```

- [ ] **Step 12.3: Build and verify clean compile**

```bash
bunx turbo run build --filter=@reactive-agents/memory
```

Expected: clean build.

- [ ] **Step 12.4: Run full memory package test suite (regression gate)**

```bash
bun test packages/memory/
```

Expected: all existing 38 tests + new tests pass (~55+ total). No regression in legacy tests.

- [ ] **Step 12.5: Run wider downstream test suite (sanity check)**

```bash
bunx turbo run test --filter=@reactive-agents/runtime --filter=@reactive-agents/reasoning
```

Expected: PASS. If any test fails because of the schema migration (e.g., an existing test opens a v1 DB and the migration corrupts it), surface the failure before continuing.

- [ ] **Step 12.6: Commit**

```bash
git add packages/memory/src/runtime.ts packages/memory/src/index.ts
git commit -m "feat(memory): wire SQLiteStoreLive into createMemoryLayer + export v2 store API"
```

---

## Task 13: Final regression + smoke test

**Files:** none (verification only)

- [ ] **Step 13.1: Repo-wide test suite**

```bash
bunx turbo run test
```

Expected: all packages pass. If anything fails, diagnose before declaring v2.0 done.

- [ ] **Step 13.2: Repo-wide typecheck**

```bash
bunx turbo run typecheck
```

Expected: clean. `tsc --noEmit` may report false positives on `ignoreDeprecations` — trust `turbo run build` output (per [feedback_typecheck_vs_build.md] memory).

- [ ] **Step 13.3: Build**

```bash
bunx turbo run build
```

Expected: all packages build.

- [ ] **Step 13.4: Manual smoke test — example agent**

Run one of the existing examples to confirm v0.11 user-facing behavior is unchanged:

```bash
cd apps/examples && bun run index.ts example-1
```

Expected: example runs to completion. Memory v2 schema migration runs silently on first SQLite open; no behavioral change visible to user.

- [ ] **Step 13.5: Verify version log populated**

Add a one-off probe (don't commit):

```bash
cd packages/memory && bun -e '
import { Database } from "@reactive-agents/runtime-shim";
const db = new Database(".reactive-agents/memory/example-1/memory.db", { readonly: true });
console.log(db.prepare("SELECT COUNT(*) AS n FROM memory_versions").get());
console.log(db.prepare("PRAGMA table_info(semantic_memory)").all().map(c => c.name));
'
```

Expected: `memory_versions` row count ≥ 0; `semantic_memory` columns include `scope`, `version`, `content_hash`, `provenance`.

- [ ] **Step 13.6: Final commit (if any docs need touch-up)**

If any inline docstrings, JSDoc, or README references need updating (e.g., `packages/memory/README.md` mentions current schema), update inline and commit. Otherwise skip.

---

## Phase v2.0 Done Criteria

All of these must be true before declaring Phase v2.0 complete:

- [ ] `MemoryStore` interface defined + `Context.Tag` exported
- [ ] `SQLiteStoreLive` implements all 6 methods (get/put/cas/query/versions/delete)
- [ ] `memory_versions` table populated on every put + cas
- [ ] `content_hash` computed on every write; CAS rejects mismatched hashes
- [ ] Schema migration idempotent; runs on every `MemoryDatabaseLive` boot
- [ ] All 38 existing memory tests still pass with zero modification
- [ ] New tests: ≥15 contract tests + ≥2 stress tests + ≥4 migration tests + ≥4 hash tests = ≥25 new
- [ ] `bunx turbo run test` green across whole repo
- [ ] `bunx turbo run build` green
- [ ] No consumer (`SemanticMemoryService`, etc.) yet uses `MemoryStore` — that's v2.2 scope
- [ ] `withMemoryV2()` builder option NOT yet added — design preserved for v2.1+

## Handoff to Phase v2.1

Phase v2.1 will:
1. Build `CheckpointService` on top of `MemoryStore`
2. Add `importance` field to `WorkingMemoryItem`
3. Implement `promoteOnSessionEnd(threshold=0.7)`
4. Add `entropyTrajectory` signal to `memory-flush-dispatch.ts`
5. Remove moderate-flush daemon fork (`engine/phases/memory-flush-dispatch.ts`)

No coupling work needed in v2.0 — Phase v2.1 starts clean from the v2.0 baseline.
