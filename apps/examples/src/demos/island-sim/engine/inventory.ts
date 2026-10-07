import type { AgentState } from "../world/schema.js";

type ItemStack = AgentState["inventory"][number];

/** Maximum number of individual item units a survivor can carry. */
export const INVENTORY_CAPACITY = 12;

/** Merge duplicate item kinds and retain no more than the supplied unit capacity. */
export function normalizeInventory(
  items: readonly ItemStack[],
  capacity: number = INVENTORY_CAPACITY,
): { inventory: ItemStack[]; overflow: number } {
  const totals = new Map<string, number>();
  let overflow = 0;
  let used = 0;
  for (const item of items) {
    const quantity = Math.max(0, Math.floor(item.qty));
    if (quantity === 0) continue;
    const accepted = Math.min(quantity, Math.max(0, capacity - used));
    if (accepted > 0) {
      totals.set(item.kind, (totals.get(item.kind) ?? 0) + accepted);
      used += accepted;
    }
    overflow += quantity - accepted;
  }
  return {
    inventory: [...totals].map(([kind, qty]) => ({ kind, qty })),
    overflow,
  };
}

/** Add one item stack atomically, merging it with an existing stack of that kind. */
export function addInventoryItem(
  items: readonly ItemStack[],
  kind: string,
  quantity: number,
  capacity: number = INVENTORY_CAPACITY,
): { ok: boolean; inventory: ItemStack[] } {
  const current = normalizeInventory(items, capacity);
  const amount = Math.floor(quantity);
  const used = current.inventory.reduce((sum, item) => sum + item.qty, 0);
  if (amount <= 0 || current.overflow > 0 || used + amount > capacity) {
    return { ok: false, inventory: current.inventory };
  }
  const existing = current.inventory.find((item) => item.kind === kind);
  const inventory = existing
    ? current.inventory.map((item) => item.kind === kind ? { ...item, qty: item.qty + amount } : item)
    : [...current.inventory, { kind, qty: amount }];
  return { ok: true, inventory };
}

/** Remove an item quantity, dropping the stack once its quantity reaches zero. */
export function removeInventoryItem(
  items: readonly ItemStack[],
  kind: string,
  quantity: number = 1,
): { ok: boolean; inventory: ItemStack[] } {
  const current = normalizeInventory(items);
  const amount = Math.floor(quantity);
  const existing = current.inventory.find((item) => item.kind === kind);
  if (!existing || amount <= 0 || existing.qty < amount) {
    return { ok: false, inventory: current.inventory };
  }
  return {
    ok: true,
    inventory: current.inventory
      .map((item) => item.kind === kind ? { ...item, qty: item.qty - amount } : item)
      .filter((item) => item.qty > 0),
  };
}

/** Count carried item units after merging duplicate stacks. */
export function inventoryUnits(items: readonly ItemStack[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, Math.floor(item.qty)), 0);
}
