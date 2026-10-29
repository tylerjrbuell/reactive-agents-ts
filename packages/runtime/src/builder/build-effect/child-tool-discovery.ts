/**
 * Sub-agent child tool-discovery gate (D-2026-10-29-CHILD-DISCOVER).
 *
 * `discover-tools` is a lazy-disclosure escape hatch: it surfaces a permitted
 * tool that was pruned from view. A child with nothing discoverable (no
 * allowlist, no proxied parent MCP tools, no spawn tools) has nothing to
 * surface, yet a weak model burned its whole budget calling it ("No tools
 * registered") and hit max_iterations. Turn it off for exactly those children;
 * children with real tools keep their surface byte-for-byte.
 */
import type { ReasoningOptions } from "../../types.js";

export interface ChildDiscoverableToolsInput {
  /** Effective allowlist after auto-scoping (`undefined`/empty = none). */
  readonly allowedTools: readonly string[] | undefined;
  /** Count of parent MCP tools proxied into the child. */
  readonly proxiedToolCount: number;
  /** Whether the child receives its own spawn tools. */
  readonly hasSpawnTools: boolean;
}

/** True when the child has at least one tool beyond the kernel meta-tools. */
export const childHasDiscoverableTools = (i: ChildDiscoverableToolsInput): boolean =>
  (i.allowedTools?.length ?? 0) > 0 || i.proxiedToolCount > 0 || i.hasSpawnTools;

/**
 * Derive the child's reasoning options from the parent's: identical when the
 * child has discoverable tools, else `harness.toolDiscovery: false`.
 */
export const childReasoningOptions = (
  parent: ReasoningOptions | undefined,
  hasDiscoverableTools: boolean,
): ReasoningOptions | undefined => {
  if (hasDiscoverableTools) return parent;
  return { ...parent, harness: { ...parent?.harness, toolDiscovery: false } };
};
