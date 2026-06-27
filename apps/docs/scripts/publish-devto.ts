// Publish the launch article to Dev.to as a DRAFT (published: false) so you
// can review it in the Dev.to editor and hit publish yourself.
//
// Setup (key stays out of git + out of chat):
//   echo 'DEV_TO_API_KEY=your_key_from_dev.to/settings/extensions' >> .env
// Run:
//   bun run apps/docs/scripts/publish-devto.ts
//
// Re-running updates the same draft (matched by title) instead of duplicating.
const KEY = process.env.DEV_TO_API_KEY;
if (!KEY) {
  console.error("DEV_TO_API_KEY not set. Add it to .env (dev.to → Settings → Extensions → API keys).");
  process.exit(1);
}

const path = "wiki/Research/2026-06-26-devto-article.md";
const raw = await Bun.file(path).text();

// Split YAML front matter from the markdown body.
const fm = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
if (!fm) {
  console.error("Could not parse front matter from " + path);
  process.exit(1);
}
const meta = fm[1];
const body = fm[2].trim();

const pick = (k: string): string | undefined => {
  const m = meta.match(new RegExp(`^${k}:\\s*"?(.+?)"?\\s*$`, "m"));
  return m?.[1];
};

const title = pick("title")!;
const tags = (pick("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
const canonical = pick("canonical_url");
const cover = pick("cover_image");

const article = {
  title,
  body_markdown: body,
  published: false, // DRAFT — review + publish from the Dev.to editor
  tags,
  ...(canonical ? { canonical_url: canonical } : {}),
  ...(cover ? { main_image: cover } : {}),
};

// Update the existing draft (avoid duplicates). Match by canonical_url first —
// it's stable across title changes — then fall back to the title.
const mine = await fetch("https://dev.to/api/articles/me/all?per_page=200", {
  headers: { "api-key": KEY },
}).then((r) => (r.ok ? r.json() : []));
const existing = Array.isArray(mine)
  ? mine.find((a: { title: string; canonical_url?: string }) =>
      (canonical && a.canonical_url === canonical) || a.title === title,
    )
  : null;

const res = await fetch(
  existing ? `https://dev.to/api/articles/${existing.id}` : "https://dev.to/api/articles",
  {
    method: existing ? "PUT" : "POST",
    headers: { "api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ article }),
  },
);

if (!res.ok) {
  console.error(`Dev.to API ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const out = await res.json();
console.log(`${existing ? "Updated" : "Created"} draft: ${out.title}`);
console.log(`Edit/publish: https://dev.to/dashboard  (or ${out.url ?? "see dashboard"})`);
