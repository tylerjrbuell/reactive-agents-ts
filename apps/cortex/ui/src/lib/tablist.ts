/**
 * Keyboard rules and ids for `kit/Tabs.svelte` (WAI-ARIA tabs pattern):
 * arrows move between tabs and wrap, Home/End jump to the ends, and each tab
 * and panel gets a stable id so a panel can point back at its tab.
 */

/** The index a key moves the focus to, or `null` when the key is not a tab key. */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** DOM id of a tab button. */
export const tabId = (base: string, id: string): string => `${base}-tab-${id}`;

/** DOM id of a tab panel (the consumer renders the panel with this id). */
export const tabPanelId = (base: string, id: string): string => `${base}-panel-${id}`;
