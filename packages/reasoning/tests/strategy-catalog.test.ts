// File: tests/strategy-catalog.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { STRATEGY_CATALOG } from "../src/services/strategy-catalog.js";
import {
  StrategyRegistry,
  StrategyRegistryLive,
} from "../src/services/strategy-registry.js";

describe("STRATEGY_CATALOG", () => {
  it("exposes the three previously-missing strategies as canonical entries", () => {
    const names = STRATEGY_CATALOG.map((e) => e.name);
    expect(names).toContain("blueprint");
    expect(names).toContain("code-action");
    expect(names).toContain("direct");
  });

  it("marks rewoo/react as aliases, not canonical entries", () => {
    const names = STRATEGY_CATALOG.map((e) => e.name);
    expect(names).not.toContain("rewoo");
    expect(names).not.toContain("react");
    expect(STRATEGY_CATALOG.find((e) => e.name === "blueprint")?.aliases).toContain("rewoo");
    expect(STRATEGY_CATALOG.find((e) => e.name === "reactive")?.aliases).toContain("react");
  });

  it("every catalog entry has a non-empty label + description", () => {
    for (const e of STRATEGY_CATALOG) {
      expect(e.label, `${e.name} missing label`).toBeTruthy();
      expect(e.description, `${e.name} missing description`).toBeTruthy();
    }
  });

  it("covers exactly the live registry key set (canonical + aliases)", async () => {
    // If a strategy is added to the registry without updating the catalog, this
    // fails — the manifest can never silently drift from the registry.
    const liveKeys = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* StrategyRegistry;
        return yield* registry.list();
      }).pipe(Effect.provide(StrategyRegistryLive)),
    );

    const catalogKeys = new Set<string>();
    for (const e of STRATEGY_CATALOG) {
      catalogKeys.add(e.name);
      for (const a of e.aliases) catalogKeys.add(a);
    }

    const missingFromCatalog = [...liveKeys].filter((k) => !catalogKeys.has(k));
    expect(
      missingFromCatalog,
      `registry keys missing from STRATEGY_CATALOG: ${missingFromCatalog.join(", ")}`,
    ).toEqual([]);

    const extraInCatalog = [...catalogKeys].filter((k) => !liveKeys.includes(k as never));
    expect(
      extraInCatalog,
      `catalog keys not registered in StrategyRegistry: ${extraInCatalog.join(", ")}`,
    ).toEqual([]);
  });
});
