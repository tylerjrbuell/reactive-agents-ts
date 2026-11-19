/**
 * Type-only fixture for facade-types.test.ts, which compiles this file with
 * the TypeScript compiler and expects zero diagnostics. Never imported at
 * runtime. Pins type names the facade must re-export, so users do not
 * redeclare them (the examples redeclared `ProviderName` before 2026-11-17).
 */
import type {
  BillableUsage,
  CodeActionApprovalConflict,
  CodeActionApprovalConflictInput,
  CostSum,
  JudgmentShadowOptions,
  PriceEntry,
  PricedUsage,
  PriceSource,
  ProviderName,
} from "../../src/index.js";
import { addCost, EMPTY_COST_SUM, priceFor, priceUsage, sumCosts } from "../../src/index.js";

// 0.19 cost migration works from the facade alone (no core / llm-provider import).
export const total: CostSum = addCost(sumCosts([0.01, undefined]), 0.02);
export const start: CostSum = EMPTY_COST_SUM;
export const source: PriceSource = "price-book";
const found = priceFor("anthropic", "claude-sonnet-4-5");
export const entry: PriceEntry | undefined = found._tag === "Some" ? found.value : undefined;
export const price = (usage: BillableUsage): PricedUsage => priceUsage(usage, entry);

// @ts-expect-error `PriceSource` is the closed union, not string
export const notASource: PriceSource = "guess";

// Code-action approval rule (audit G6): apps check it without importing reasoning.
export const conflictInput: CodeActionApprovalConflictInput = {
  callableTools: ["file-write"],
  policy: { tools: new Set(["file-write"]) },
};
export const conflict: CodeActionApprovalConflict = { refuse: true, gatedCallable: ["file-write"], requireFor: false };

export const provider: ProviderName = "anthropic";

// @ts-expect-error not a provider name: the type is the real union, not string
export const notAProvider: ProviderName = "not-a-provider";

export const shadow: JudgmentShadowOptions = { shadow: true, model: "nimble", baseUrl: "http://localhost:11434" };

// @ts-expect-error `shadow` is the literal `true`: auto-shadow is opt-in, never `false`
export const shadowOff: JudgmentShadowOptions = { shadow: false };
