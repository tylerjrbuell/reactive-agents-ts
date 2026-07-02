/**
 * Browser-side mirror of the framework CapabilityManifest served by
 * GET /api/capabilities. Structural mirror of @reactive-agents/runtime's
 * manifest types — no framework import in the browser bundle. New strategies /
 * builder methods / config fields flow through here automatically; the UI reads
 * these instead of hardcoding the framework surface.
 */
import { CORTEX_SERVER_URL } from "./constants.js";

export interface StrategyDescriptor {
  name: string;
  aliases: string[];
  label: string;
  description: string;
  multiStep: boolean;
}

export interface BuilderMethodDescriptor {
  name: string;
  kind: "config" | "overlay";
  configPath?: string;
  description: string;
  inferred?: boolean;
}

export interface ConfigFieldDescriptor {
  path: string;
  type: "string" | "number" | "boolean" | "enum" | "object" | "array" | "unknown";
  enumValues?: string[];
  optional: boolean;
  description?: string;
}

export interface CapabilityManifest {
  version: string;
  strategies: StrategyDescriptor[];
  builderMethods: BuilderMethodDescriptor[];
  configFields: ConfigFieldDescriptor[];
}

export async function loadCapabilities(
  fetchFn: typeof fetch = fetch,
): Promise<CapabilityManifest> {
  const res = await fetchFn(`${CORTEX_SERVER_URL}/api/capabilities`);
  if (!res.ok) throw new Error(`capabilities fetch failed: ${res.status}`);
  return (await res.json()) as CapabilityManifest;
}

export function strategyOptions(
  m: CapabilityManifest,
): { value: string; label: string }[] {
  return m.strategies.map((s) => ({ value: s.name, label: s.label }));
}
