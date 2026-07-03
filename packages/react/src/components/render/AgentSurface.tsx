import * as React from "react";
import { isUiNode, type ComponentRegistry } from "./registry.js";

export type { UiNode, ComponentRegistry } from "./registry.js";
export { uiTreeSchema } from "./registry.js";

export interface AgentSurfaceProps {
  readonly tree: unknown;
  readonly registry: ComponentRegistry;
  readonly className?: string;
}

function RenderNode({ node, registry }: { node: unknown; registry: ComponentRegistry }): React.ReactElement | null {
  if (!isUiNode(node)) return null;
  const Comp = registry[node.type];
  if (!Comp) return <span data-ra-unknown={node.type} />;
  const rawKids = Array.isArray(node.children) ? node.children : [];
  const kids = rawKids.map((child, i) => (
    <RenderNode key={(isUiNode(child) ? child.key : undefined) ?? i} node={child} registry={registry} />
  ));
  return <Comp node={node}>{kids}</Comp>;
}

export function AgentSurface({ tree, registry, className }: AgentSurfaceProps): React.ReactElement {
  return (
    <div className={className} data-ra-surface>
      <RenderNode node={tree} registry={registry} />
    </div>
  );
}
