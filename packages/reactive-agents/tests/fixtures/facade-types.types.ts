/**
 * Type-only fixture for facade-types.test.ts, which compiles this file with
 * the TypeScript compiler and expects zero diagnostics. Never imported at
 * runtime. Pins type names the facade must re-export, so users do not
 * redeclare them (the examples redeclared `ProviderName` before 2026-11-17).
 */
import type { ProviderName } from "../../src/index.js";

export const provider: ProviderName = "anthropic";

// @ts-expect-error not a provider name: the type is the real union, not string
export const notAProvider: ProviderName = "not-a-provider";
