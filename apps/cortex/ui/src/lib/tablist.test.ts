import { describe, expect, test } from "bun:test";
import { nextTabIndex, tabId, tabPanelId } from "./tablist.js";

describe("nextTabIndex", () => {
  test("arrows move and wrap", () => {
    expect(nextTabIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextTabIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextTabIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(nextTabIndex(1, "ArrowUp", 3)).toBe(0);
    expect(nextTabIndex(1, "ArrowDown", 3)).toBe(2);
  });

  test("Home and End jump; other keys and empty lists do nothing", () => {
    expect(nextTabIndex(1, "Home", 4)).toBe(0);
    expect(nextTabIndex(1, "End", 4)).toBe(3);
    expect(nextTabIndex(1, "Enter", 4)).toBeNull();
    expect(nextTabIndex(0, "ArrowRight", 0)).toBeNull();
  });
});

test("tab and panel ids pair up", () => {
  expect(tabId("run", "events")).toBe("run-tab-events");
  expect(tabPanelId("run", "events")).toBe("run-panel-events");
});
