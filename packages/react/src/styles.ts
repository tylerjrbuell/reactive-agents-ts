/**
 * Opt-in class-name presets for the reference components. Consumers pass these
 * to the components' `className` props for a styled default; the components
 * themselves ship unstyled (headless-first). Pair with your own CSS that
 * targets these class names or the `data-ra-*` attributes.
 */
export const raStyles = {
  prompt: "ra-prompt",
  choice: "ra-choice",
  approval: "ra-approval",
  inbox: "ra-inbox",
  cost: "ra-cost",
  timeline: "ra-timeline",
  surface: "ra-surface",
} as const;
