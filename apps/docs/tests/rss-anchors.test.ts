import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { headingId, releaseItemLink } from "../src/rss-anchor";

const DOCS = resolve(import.meta.dir, "..");
const SITE = "https://docs.reactiveagents.dev";
const releaseHeadings = readFileSync(resolve(DOCS, "src/content/docs/guides/whats-new.mdx"), "utf8")
  .split("\n")
  .filter((l) => /^##\s+(v\d|Current)/.test(l))
  .map((l) => l.replace(/^##\s+/, ""));

describe("rss anchors", () => {
  it("whats-new has release headings", () => {
    expect(releaseHeadings.length).toBeGreaterThan(0);
  });

  it("slugs match Starlight for a dotted version heading", () => {
    expect(headingId("v0.19.0 - Opt-in defaults (November 2026)")).toBe("v0190---opt-in-defaults-november-2026");
  });

  it("keeps the fragment last, with no trailing slash", () => {
    for (const h of releaseHeadings) {
      const link = releaseItemLink(SITE, h);
      expect(link.startsWith(`${SITE}/guides/whats-new/#`)).toBe(true);
      expect(link.endsWith("/")).toBe(false);
    }
  });

  const built = resolve(DOCS, "dist/guides/whats-new/index.html");
  it.skipIf(!existsSync(built))("every release link fragment is a heading id in the built page", () => {
    const html = readFileSync(built, "utf8");
    for (const h of releaseHeadings) {
      const id = new URL(releaseItemLink(SITE, h)).hash.slice(1);
      expect(html).toContain(`id="${id}"`);
    }
  });

  const rssFile = resolve(DOCS, "dist/rss.xml");
  it.skipIf(!existsSync(built) || !existsSync(rssFile))("built rss.xml item links resolve to ids in the built page", () => {
    const html = readFileSync(built, "utf8");
    const links = [...readFileSync(rssFile, "utf8").matchAll(/<link>([^<]*#[^<]*)<\/link>/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(html).toContain(`id="${new URL(l).hash.slice(1)}"`);
  });
});
