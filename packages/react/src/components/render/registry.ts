import type * as React from "react";
import type { UiNode } from "@reactive-agents/ui-core";

// Node schema, guard, and output-schema generator now live in ui-core
// (shared across react/vue/svelte). Re-export to preserve this module's API.
export type { UiNode } from "@reactive-agents/ui-core";
export { isUiNode, uiTreeSchema, reconcileUiTree } from "@reactive-agents/ui-core";

/** React-specific: maps node `type` → the React component that renders it. */
export type ComponentRegistry = Record<
  string,
  React.ComponentType<{ node: UiNode; children?: React.ReactNode }>
>;
