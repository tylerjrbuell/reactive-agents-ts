import type * as React from "react";

export interface UiNode {
  readonly type: string;
  readonly props?: Record<string, unknown>;
  readonly children?: readonly UiNode[];
  readonly key?: string;
}

export type ComponentRegistry = Record<
  string,
  React.ComponentType<{ node: UiNode; children?: React.ReactNode }>
>;

/**
 * A JSON-schema-ish descriptor whose `type` field is an enum over the
 * registry's keys — pass to `.withOutputSchema(uiTreeSchema(registry))` on the
 * server so the model can only emit registered node types (hallucinated
 * components are unrepresentable, not merely rejected).
 */
export function uiTreeSchema(registry: ComponentRegistry): {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
} {
  const nodeTypes = Object.keys(registry);
  return {
    type: "object",
    properties: {
      type: { enum: nodeTypes },
      props: { type: "object" },
      children: { type: "array" },
      key: { type: "string" },
    },
  };
}

export function isUiNode(value: unknown): value is UiNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}
