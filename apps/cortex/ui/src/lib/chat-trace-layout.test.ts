import { describe, expect, test } from "bun:test";
import { traceLayout } from "./chat-trace-layout.js";

describe("traceLayout", () => {
  test("wide window docks at desired width", () => {
    expect(traceLayout(1440, 1200, 448)).toEqual({ mode: "docked", width: 448 });
  });
  test("docked width shrinks so conversation keeps 420px", () => {
    expect(traceLayout(1200, 800, 600)).toEqual({ mode: "docked", width: 380 });
  });
  test("narrow window overlays", () => {
    expect(traceLayout(913, 700, 448).mode).toBe("overlay");
  });
  test("not enough room for min drawer overlays", () => {
    expect(traceLayout(1200, 700, 448).mode).toBe("overlay");
  });
  test("overlay never exceeds 92% of the row", () => {
    expect(traceLayout(900, 500, 760).width).toBe(460);
  });
});
