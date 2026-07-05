/**
 * Framework-agnostic generative-UI tree: node schema, registry-driven output
 * schema, and a pure progressive-render reconcile. No DOM, no framework deps.
 * Bindings (react/vue/svelte) provide the render surface; this owns the logic.
 */
export interface UiNode {
  readonly type: string;
  readonly props?: Record<string, unknown>;
  readonly children?: readonly UiNode[];
  readonly key?: string;
}

export const isUiNode = (value: unknown): value is UiNode =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

/**
 * A JSON-schema-ish descriptor whose `type` field is an enum over the
 * registry's keys — pass to `.withOutputSchema(uiTreeSchema(registry))` on the
 * server so the model can only emit registered node types (hallucinated
 * components are unrepresentable, not merely rejected). Accepts any
 * registry-like object; a binding's typed `ComponentRegistry` is assignable.
 */
export function uiTreeSchema(registry: Record<string, unknown>): {
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

/**
 * Merge a streamed partial tree onto the accumulated tree. Partial's fields
 * win; `props` shallow-merge; `children` merge positionally and recursively.
 * A non-node partial leaves `prev` untouched (tolerant of noise mid-stream).
 */
export const reconcileUiTree = (
  prev: UiNode | undefined,
  partial: unknown,
): UiNode | undefined => {
  if (!isUiNode(partial)) return prev;
  if (prev === undefined) return partial;

  const prevKids = prev.children ?? [];
  const partialKids = partial.children ?? [];
  const len = Math.max(prevKids.length, partialKids.length);
  const children: UiNode[] = [];
  for (let i = 0; i < len; i++) {
    const merged = reconcileUiTree(prevKids[i], partialKids[i]);
    if (merged !== undefined) children.push(merged);
  }

  const key = partial.key ?? prev.key;
  const merged: UiNode = {
    type: partial.type,
    props: { ...prev.props, ...partial.props },
    ...(children.length > 0 ? { children } : {}),
    ...(key !== undefined ? { key } : {}),
  };
  return merged;
};
