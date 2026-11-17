import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const DOCS = resolve(import.meta.dir, "..");
const REPO = resolve(DOCS, "../..");
const SHOTS_DIR = join(DOCS, "public/screens/cortex");

interface Shot {
  id: string;
  file: string | null;
  status: "stable" | "pending";
  alt: string;
  caption: string;
  width: number;
  height: number;
  variantOf?: string;
  crop?: { x: number; y: number; width: number; height: number; shows: string };
}
const manifest = JSON.parse(readFileSync(join(SHOTS_DIR, "manifest.json"), "utf8")) as {
  shots: Shot[];
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** `variant="crop"` on a component selects the `<id>--crop` manifest entry. */
const manifestId = (id: string, tag: string): string =>
  /\bvariant=["']crop["']/.test(tag) ? `${id}--crop` : id;

const contentFiles = walk(join(DOCS, "src/content/docs")).filter((p) => /\.mdx?$/.test(p));
const referenced = new Map<string, string[]>();
for (const f of contentFiles) {
  const text = readFileSync(f, "utf8");
  const ids = [
    ...[...text.matchAll(/<CortexShot\b[^>]*>/g)].flatMap((m) => {
      const id = /\bid=["']([^"']+)["']/.exec(m[0])?.[1];
      return id ? [manifestId(id, m[0])] : [];
    }),
    ...[...text.matchAll(/<CortexGallery\b[^>]*>/g)].flatMap((m) => {
      const list = /ids=\{\[([^\]]*)\]\}/.exec(m[0])?.[1] ?? "";
      return [...list.matchAll(/["']([^"']+)["']/g)].map((x) => manifestId(x[1]!, m[0]));
    }),
  ];
  for (const id of ids) referenced.set(id, [...(referenced.get(id) ?? []), f]);
}

describe("cortex screenshots", () => {
  it("references at least the home page and cortex pages", () => {
    expect(referenced.size).toBeGreaterThan(5);
  });

  it.each([...referenced.keys()])("shot %s exists, is stable and its image exists", (id) => {
    const shot = manifest.shots.find((s) => s.id === id);
    expect(shot).toBeDefined();
    expect(shot!.status).toBe("stable");
    expect(shot!.file).toBeTruthy();
    expect(existsSync(join(SHOTS_DIR, shot!.file!))).toBe(true);
  });

  it("every stable image is at most 200 KB and has dimensions, alt and caption", () => {
    for (const s of manifest.shots.filter((x) => x.status === "stable")) {
      expect(statSync(join(SHOTS_DIR, s.file!)).size).toBeLessThanOrEqual(200 * 1024);
      expect(s.width).toBeGreaterThan(0);
      expect(s.height).toBeGreaterThan(0);
      expect(s.alt.length).toBeGreaterThan(10);
      expect(s.caption.length).toBeGreaterThan(10);
    }
  });

  describe("crop variants", () => {
    const crops = manifest.shots.filter((s) => s.variantOf);

    it("exist for the home page and README shots", () => {
      expect(crops.length).toBeGreaterThanOrEqual(6);
    });

    it.each(crops.map((c) => c.id))("%s: parent exists and the crop box sits inside it", (id) => {
      const crop = manifest.shots.find((s) => s.id === id)!;
      const parent = manifest.shots.find((s) => s.id === crop.variantOf);
      expect(parent).toBeDefined();
      expect(crop.id).toBe(`${parent!.id}--crop`);
      expect(crop.status).toBe(parent!.status);
      expect(crop.crop).toBeDefined();
      const box = crop.crop!;
      expect(box.shows.length).toBeGreaterThan(10);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(parent!.width);
      expect(box.y + box.height).toBeLessThanOrEqual(parent!.height);
      expect(statSync(join(SHOTS_DIR, crop.file!)).size).toBeLessThanOrEqual(200 * 1024);
    });
  });

  it("README cortex image paths exist and use the crop variants", () => {
    const readme = readFileSync(join(REPO, "README.md"), "utf8");
    const paths = [...readme.matchAll(/src="(apps\/docs\/public\/screens\/cortex\/[^"]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(existsSync(join(REPO, p))).toBe(true);
      expect(p).toContain("--crop.webp");
    }
  });

  it("no Cortex page uses a hand-taken image: every Cortex screenshot is a <CortexShot>", () => {
    const offenders: string[] = [];
    for (const f of contentFiles.filter((p) => p.includes("/features/cortex"))) {
      const text = readFileSync(f, "utf8");
      // Markdown or HTML image, or an asset import, of a raster file.
      if (/!\[[^\]]*\]\([^)]*\.(png|jpe?g|gif|webp)\b/i.test(text)) offenders.push(`${f}: markdown image`);
      if (/<img\b/i.test(text)) offenders.push(`${f}: <img>`);
      if (/assets\/cortex-[^\s"')]+/.test(text)) offenders.push(`${f}: assets/cortex-*`);
    }
    expect(offenders).toEqual([]);
    const assetsDir = join(DOCS, "src/assets");
    expect(readdirSync(assetsDir).filter((n) => /^cortex-.*\.(png|jpe?g|gif|webp)$/i.test(n))).toEqual([]);
  });
});
