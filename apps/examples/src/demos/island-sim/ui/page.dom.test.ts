// Run: bun test apps/examples/src/demos/island-sim/ui/page.dom.test.ts --timeout 15000
import { describe, it, expect, afterEach } from "bun:test";
import { Window } from "happy-dom";
import { renderPage } from "./page.js";
import { makeFallbackWorld } from "../world/fallback.js";
import { viewerSafeState } from "../index.js";
import { initializeIslandGameplay } from "../engine/gameplay.js";

let window: InstanceType<typeof Window> | undefined;

afterEach(async () => {
  // @ts-expect-error cleanup test globals
  delete globalThis.window;
  // @ts-expect-error cleanup test globals
  delete globalThis.document;
  // @ts-expect-error cleanup test globals
  delete globalThis.fetch;
  await window?.happyDOM.close();
  window = undefined;
});

function bootPage(): { document: Document } {
  window = new Window({ url: "http://localhost/" });
  const html = renderPage().replace(/<script>[\s\S]*?<\/script>/, "");
  window.document.write(html);
  const script = renderPage().match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("missing embedded script");

  const world = viewerSafeState(initializeIslandGameplay(makeFallbackWorld(20261006)));
  (globalThis as Record<string, unknown>).window = window;
  (globalThis as Record<string, unknown>).document = window.document;
  (globalThis as Record<string, unknown>).SVGTextElement = window.SVGTextElement;
  (globalThis as Record<string, unknown>).fetch = async (input: string) => {
    const url = new URL(input, "http://localhost");
    if (url.pathname === "/api/state") {
      return { ok: true, json: async () => ({ ...world, simulation: { running: false, speed: 1, gameOver: false } }) };
    }
    if (url.pathname === "/api/events") {
      return { ok: true, json: async () => ({ events: [], latestSequence: 0 }) };
    }
    if (url.pathname === "/api/chronicle") {
      return { ok: true, json: async () => [] };
    }
    return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
  };

  new Function(script)();
  return { document: window.document as unknown as Document };
}

describe("island map markers", () => {
  it("renders every castaway marker with a real portrait inside, and no swallowed render errors", async () => {
    const { document } = bootPage();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (document.querySelectorAll("#island-svg .map-agent").length === 8) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(document.querySelector("#error-message")?.textContent ?? "").toBe("");
    const markers = [...document.querySelectorAll("#island-svg .map-agent")];
    expect(markers).toHaveLength(8);
    for (const marker of markers) {
      expect(marker.getAttribute("transform")).toContain("translate(");
      const portrait = marker.querySelector(".map-portrait");
      expect(portrait).not.toBeNull();
      expect(portrait!.childElementCount).toBeGreaterThan(0);
    }
  }, 15000);
});
