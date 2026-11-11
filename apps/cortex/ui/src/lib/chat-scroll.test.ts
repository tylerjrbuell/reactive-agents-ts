import { describe, expect, test } from "bun:test";
import { FOLLOW_THRESHOLD_PX, followAfterScroll, isNearBottom, shouldFollow, showJumpToLatest } from "./chat-scroll.js";

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

describe("followAfterScroll (land at the latest turn on open)", () => {
  test("a pinned reader stays pinned when the thread grows under it (late markdown, entrance animation)", () => {
    // Opened at the bottom (top 600 of 1000); the rendered markdown then grows the thread to 1800
    // before the scroll event lands. The reader did not move, so the thread keeps following.
    const next = followAfterScroll({ atBottom: true, lastTop: 600 }, { scrollHeight: 1800, scrollTop: 600, clientHeight: 400 });
    expect(next.atBottom).toBe(true);
  });
  test("scrolling up leaves the bottom; scrolling back down to it pins again", () => {
    const up = followAfterScroll({ atBottom: true, lastTop: 1400 }, { scrollHeight: 1800, scrollTop: 900, clientHeight: 400 });
    expect(up).toEqual({ atBottom: false, lastTop: 900 });
    const down = followAfterScroll(up, { scrollHeight: 1800, scrollTop: 1390, clientHeight: 400 });
    expect(down.atBottom).toBe(true);
  });
  test("a reader who scrolled away stays away while new turns arrive", () => {
    const next = followAfterScroll({ atBottom: false, lastTop: 200 }, { scrollHeight: 2400, scrollTop: 200, clientHeight: 400 });
    expect(next.atBottom).toBe(false);
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
