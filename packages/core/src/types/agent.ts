import { Schema } from "effect";

// ─── Agent ID (branded string) ───

export const AgentId = Schema.String.pipe(Schema.brand("AgentId"));
export type AgentId = typeof AgentId.Type;

// ─── Capability ───

export const CapabilityType = Schema.Literal(
  "tool",
  "skill",
  "reasoning",
  "memory",
);
export type CapabilityType = typeof CapabilityType.Type;

export const CapabilitySchema = Schema.Struct({
  type: CapabilityType,
  name: Schema.String,
});
export type Capability = typeof CapabilitySchema.Type;

// ─── Reasoning Strategy (shared across layers) ───

export const ReasoningStrategy = Schema.Literal(
  "reactive",
  "plan-execute-reflect",
  "tree-of-thought",
  "reflexion",
  "adaptive",
);
export type ReasoningStrategy = typeof ReasoningStrategy.Type;

// ─── Memory Type ───
// Updated: "factual" replaced by "semantic" + "procedural" (see 02-layer-memory.md)

export const MemoryType = Schema.Literal(
  "semantic", // Long-term knowledge (SQLite + memory.md)
  "episodic", // Daily logs + session snapshots
  "procedural", // Learned workflows and patterns
  "working", // In-process Ref, capacity 7
);
export type MemoryType = typeof MemoryType.Type;

// ─── Agent Schema ───

export const AgentSchema = Schema.Struct({
  id: AgentId,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  capabilities: Schema.Array(CapabilitySchema),
  config: Schema.Unknown,
  state: Schema.Unknown,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
});
export type Agent = typeof AgentSchema.Type;

// ─── Agent Definition (input shape for creating agents) ───
// Renamed from AgentConfig (W2 FIX-25) to disambiguate from runtime's
// full `AgentConfig` (17 nested config schemas). This is the skeletal
// declaration surface; runtime/agent-config.ts owns the rich config.

export const AgentDefinitionSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  capabilities: Schema.Array(CapabilitySchema),
  config: Schema.optional(Schema.Unknown),
  initialState: Schema.optional(Schema.Unknown),
});
export type AgentDefinition = typeof AgentDefinitionSchema.Type;
