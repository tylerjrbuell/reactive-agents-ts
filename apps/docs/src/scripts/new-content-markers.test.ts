// Run: bun run repo test apps/docs/src/scripts/new-content-markers.test.ts
import { describe, expect, it } from "bun:test";
import { applyHubMarkers, applyTocSectionMarkers, docsPathOf, parseMarkIndex, parseTocMarks } from "./new-content-markers.js";

function link(href: string) {
  const attrs = new Map<string, string>([["href", href]]);
  return {
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => void attrs.set(n, v),
    removeAttribute: (n: string) => void attrs.delete(n),
  };
}

const marks = (o: Record<string, unknown>) => parseTocMarks(JSON.stringify(o));

describe("TOC section markers", () => {
  it("parses only well-formed entries, with kind and label", () => {
    const m = marks({ a: { kind: "new", label: "New in 0.19" }, b: { kind: "bogus", label: "x" }, c: { kind: "new" }, d: { kind: "updated", label: "Updated in 0.19" } });
    expect([...m.keys()]).toEqual(["a", "d"]);
    expect(m.get("d")).toEqual({ kind: "updated", label: "Updated in 0.19" });
    expect(parseTocMarks("not json").size).toBe(0);
    expect(parseTocMarks(null).size).toBe(0);
  });

  it("marks TOC links by kind and clears stale ones", () => {
    const a = link("#a");
    const b = link("#b");
    b.setAttribute("data-ra-new-content", "new");
    applyTocSectionMarkers([a, b, link("/other/#a")], marks({ a: { kind: "updated", label: "Updated in 0.19" } }));
    expect(a.getAttribute("data-ra-new-content")).toBe("updated");
    expect(a.getAttribute("data-ra-marker-label")).toBe("Updated in 0.19");
    expect(b.getAttribute("data-ra-new-content")).toBeNull();
  });

  it("decodes encoded hashes", () => {
    const l = link("#caf%C3%A9");
    applyTocSectionMarkers([l], new Map([["café", { kind: "new", label: "New" }]]));
    expect(l.getAttribute("data-ra-new-content")).toBe("new");
  });
});

describe("hub child markers", () => {
  const index = {
    "/guides/memory/": { kind: "updated", label: "Updated in 0.19: Inspecting and Editing Memory" },
    "/guides/multimodal/": { kind: "new", label: "New in 0.19" },
  } as const;
  const hubLink = (href: string) => {
    const attrs = new Map<string, string>([["href", href]]);
    const after: unknown[] = [];
    return {
      after,
      getAttribute: (n: string) => attrs.get(n) ?? null,
      setAttribute: (n: string, v: string) => void attrs.set(n, v),
      // The decorator calls `after(node)`.
      afterFn: (node: unknown) => void after.push(node),
    };
  };
  const wrap = (l: ReturnType<typeof hubLink>) => ({ ...l, after: l.afterFn });

  it("normalises hrefs to docs paths and rejects external and hash-only links", () => {
    expect(docsPathOf("/guides/memory#x")).toBe("/guides/memory/");
    expect(docsPathOf("/guides/memory/?a=1")).toBe("/guides/memory/");
    expect(docsPathOf("https://docs.reactiveagents.dev/guides/memory/", "https://docs.reactiveagents.dev")).toBe("/guides/memory/");
    expect(docsPathOf("https://example.com/guides/memory/", "https://docs.reactiveagents.dev")).toBeNull();
    expect(docsPathOf("#top")).toBeNull();
    expect(docsPathOf("mailto:a@b.c")).toBeNull();
    expect(docsPathOf("relative/path")).toBeNull();
  });

  it("decorates marked children once, with the section-bearing label, and skips self", () => {
    const a = hubLink("/guides/memory/");
    const b = hubLink("/guides/multimodal/#x");
    const c = hubLink("/guides/tools/");
    const self = hubLink("/guides/memory/");
    const made: Array<[string, string]> = [];
    const mk = (kind: "new" | "updated", label: string) => (made.push([kind, label]), { kind });
    const links = [wrap(a), wrap(b), wrap(c)];
    expect(applyHubMarkers(links, index, "/guides/hub/", mk)).toBe(2);
    expect(made).toEqual([
      ["updated", "Updated in 0.19: Inspecting and Editing Memory"],
      ["new", "New in 0.19"],
    ]);
    expect(applyHubMarkers(links, index, "/guides/hub/", mk)).toBe(0); // idempotent
    expect(applyHubMarkers([wrap(self)], index, "/guides/memory/", mk)).toBe(0);
  });

  it("parses the embedded index defensively", () => {
    expect(parseMarkIndex(null)).toEqual({});
    expect(parseMarkIndex("not json")).toEqual({});
    expect(parseMarkIndex('{"/a/":{"kind":"new","label":"x"}}')).toEqual({ "/a/": { kind: "new", label: "x" } });
  });
});
