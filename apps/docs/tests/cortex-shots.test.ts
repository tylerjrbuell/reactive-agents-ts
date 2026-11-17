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

const contentFiles = walk(join(DOCS, "src/content/docs")).filter((p) => /\.mdx?$/.test(p));
const referenced = new Map<string, string[]>();
for (const f of contentFiles) {
  const text = readFileSync(f, "utf8");
  const ids = [
    ...[...text.matchAll(/<CortexShot[^>]*\bid=["']([^"']+)["']/g)].map((m) => m[1]!),
    ...[...text.matchAll(/<CortexGallery[^>]*ids=\{\[([^\]]*)\]\}/g)].flatMap((m) =>
      [...m[1]!.matchAll(/["']([^"']+)["']/g)].map((x) => x[1]!),
    ),
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

  it("README cortex image paths exist", () => {
    const readme = readFileSync(join(REPO, "README.md"), "utf8");
    const paths = [...readme.matchAll(/src="(apps\/docs\/public\/screens\/cortex\/[^"]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(existsSync(join(REPO, p))).toBe(true);
  });
});
