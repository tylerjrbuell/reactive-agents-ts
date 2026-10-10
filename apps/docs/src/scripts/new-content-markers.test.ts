// Run: bun test apps/docs/src/scripts/new-content-markers.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { isRecentPageUpdate } from "../content/git-page-metadata.js";
import {
  applyPageMapMarkers,
  applyTocSectionMarkers,
  getNewContentPagePaths,
  isChangedSectionLink,
  isNewContentBadgeVariant,
  isNewContentPageLink,
  pagePathFromDocId,
} from "./new-content-markers.js";

function makeLink(href: string, textContent: string, badgeVariants: readonly string[] = []) {
  const attributes = new Map<string, string>();
  return {
    href,
    textContent,
    querySelector: (selector: string) => selector === ".sl-badge" && badgeVariants.length > 0
      ? { classList: { contains: (variant: string) => badgeVariants.includes(variant) } }
      : null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    getAttribute: (name: string) => attributes.get(name) ?? null,
  };
}

describe("new content navigation markers", () => {
  it("maps recent content pages even when stability overrides the visible badge", () => {
    const paths = getNewContentPagePaths([
      { id: "guides/new", data: { recentlyChanged: true, badge: { text: "New", __auto: "1" } } },
      { id: "features/updated", data: { recentlyChanged: true, badge: { text: "Updated", __auto: "1" } } },
      { id: "features/experimental", data: { recentlyChanged: true, badge: { text: "Experimental", __auto: "1" } } },
      { id: "guides/manual", data: { recentlyChanged: false, badge: { text: "New" } } },
      { id: "guides/old", data: {} },
    ]);

    expect(paths).toEqual(["/guides/new/", "/features/updated/", "/features/experimental/"]);
  });

  it("uses a separate recent-content window even when stability overrides the badge", () => {
    const now = new Date("2026-10-10T12:00:00Z");

    expect(isRecentPageUpdate("2026-09-25", now)).toBe(true);
    expect(isRecentPageUpdate("2026-09-24", now)).toBe(false);
    expect(isRecentPageUpdate(null, now)).toBe(false);
  });

  it("normalizes root and index document IDs to their navigation URLs", () => {
    expect(pagePathFromDocId("index")).toBe("/");
    expect(pagePathFromDocId("concepts/architecture/index")).toBe("/concepts/architecture/");
    expect(pagePathFromDocId("guides/quickstart")).toBe("/guides/quickstart/");
  });

  it("marks only same-site links to recently changed pages", () => {
    const paths = ["/features/new-page/"];

    expect(isNewContentPageLink("/features/new-page/?ref=sidebar", "https://docs.test", paths)).toBe(true);
    expect(isNewContentPageLink("https://other.test/features/new-page/", "https://docs.test", paths)).toBe(false);
    expect(isNewContentPageLink("/features/old-page/", "https://docs.test", paths)).toBe(false);
  });

  it("applies page dots to recent sidebar links and clears stale dots", () => {
    const recent = makeLink("https://docs.test/guides/new/", "New guide");
    const curated = makeLink("https://docs.test/features/manual/", "Featured", ["success"]);
    const old = makeLink("https://docs.test/guides/old/", "Old guide");
    old.setAttribute("data-ra-new-content", "page");

    applyPageMapMarkers([recent, curated, old], "https://docs.test", ["/guides/new/"]);

    expect(recent.getAttribute("data-ra-new-content")).toBe("page");
    expect(curated.getAttribute("data-ra-new-content")).toBe("page");
    expect(old.getAttribute("data-ra-new-content")).toBeNull();
  });

  it("applies section dots only to changed TOC headings", () => {
    const changed = makeLink("#local-judgment", "Local judgment");
    const unchanged = makeLink("#overview", "Overview");
    unchanged.setAttribute("data-ra-new-content", "section");

    applyTocSectionMarkers([changed, unchanged], ["## Local judgment"]);

    expect(changed.getAttribute("data-ra-new-content")).toBe("section");
    expect(unchanged.getAttribute("data-ra-new-content")).toBeNull();
  });

  it("recognizes Starlight's visible New and Updated badge variants only", () => {
    expect(isNewContentBadgeVariant("success")).toBe(true);
    expect(isNewContentBadgeVariant("note")).toBe(true);
    expect(isNewContentBadgeVariant("caution")).toBe(false);
  });

  it("matches changed TOC headings exactly after markdown and whitespace normalization", () => {
    const changed = ["## Local judgment", "### Budget and run results"];

    expect(isChangedSectionLink("Local judgment", changed)).toBe(true);
    expect(isChangedSectionLink("  budget   and run results ", changed)).toBe(true);
    expect(isChangedSectionLink("Local", changed)).toBe(false);
    expect(isChangedSectionLink("", changed)).toBe(false);
  });
});
