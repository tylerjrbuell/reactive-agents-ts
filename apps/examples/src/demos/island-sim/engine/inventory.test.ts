// Run: bun test apps/examples/src/demos/island-sim/engine/inventory.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { INVENTORY_CAPACITY, addInventoryItem, normalizeInventory, removeInventoryItem } from "./inventory.js";

describe("canonical survivor inventory", () => {
  it("merges duplicate stacks and caps normalized inventory", () => {
    const result = normalizeInventory([
      { kind: "water", qty: 7 },
      { kind: "water", qty: 8 },
      { kind: "berries", qty: 5 },
    ]);

    expect(result.inventory).toEqual([{ kind: "water", qty: 12 }]);
    expect(result.overflow).toBe(8);
  }, 15000);

  it("adds quantities into an existing stack and refuses capacity overflow atomically", () => {
    const inventory = [{ kind: "water", qty: 11 }];
    const added = addInventoryItem(inventory, "water", 1);
    const rejected = addInventoryItem(added.inventory, "berries", 1);

    expect(INVENTORY_CAPACITY).toBe(12);
    expect(added).toMatchObject({ ok: true, inventory: [{ kind: "water", qty: 12 }] });
    expect(rejected).toMatchObject({ ok: false, inventory: [{ kind: "water", qty: 12 }] });
  }, 15000);

  it("removes quantities without leaving zero stacks", () => {
    const result = removeInventoryItem([
      { kind: "water", qty: 2 },
      { kind: "berries", qty: 1 },
    ], "water", 2);

    expect(result).toMatchObject({ ok: true, inventory: [{ kind: "berries", qty: 1 }] });
  }, 15000);
});
