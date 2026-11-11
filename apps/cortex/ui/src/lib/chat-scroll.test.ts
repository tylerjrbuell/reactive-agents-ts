import { describe, expect, test } from "bun:test";
import { FOLLOW_THRESHOLD_PX, isNearBottom, shouldFollow, showJumpToLatest } from "./chat-scroll.js";

describe("isNearBottom", () => {
  test("within the threshold counts as at the bottom", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 600 - FOLLOW_THRESHOLD_PX + 1, clientHeight: 400 })).toBe(true);
  });
  test("at or past the threshold does not", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 600 - FOLLOW_THRESHOLD_PX, clientHeight: 400 })).toBe(false);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 0, clientHeight: 400 })).toBe(false);
  });
});

describe("shouldFollow", () => {
  test("follows only with turns and while pinned", () => {
    expect(shouldFollow(3, true)).toBe(true);
    expect(shouldFollow(3, false)).toBe(false);
    expect(shouldFollow(0, true)).toBe(false);
  });
});

describe("showJumpToLatest", () => {
  test("shows when scrolled away from a non-empty thread with no menu open", () => {
    expect(showJumpToLatest({ atBottom: false, turnCount: 2, menuOpen: false })).toBe(true);
    expect(showJumpToLatest({ atBottom: true, turnCount: 2, menuOpen: false })).toBe(false);
    expect(showJumpToLatest({ atBottom: false, turnCount: 0, menuOpen: false })).toBe(false);
    expect(showJumpToLatest({ atBottom: false, turnCount: 2, menuOpen: true })).toBe(false);
  });
});
