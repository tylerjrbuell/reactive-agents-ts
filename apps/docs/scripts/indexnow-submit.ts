// Submit all docs URLs to IndexNow (Bing, Yandex, Seznam, and others share the
// IndexNow protocol — instant "please (re)crawl these" ping, no account needed).
// Feeds Bing's index, which also grounds Copilot/ChatGPT answers (AEO).
//
// Run AFTER a deploy (so the verification key file is live):
//   bun run apps/docs/scripts/indexnow-submit.ts
//
// The key is a public verification token (served at /<key>.txt), not a secret.
const HOST = "docs.reactiveagents.dev";
const KEY = "a9b8b996f048a46d68b9d359d9251072";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const SITEMAP = `https://${HOST}/sitemap-index.xml`;

async function locs(xmlUrl: string): Promise<string[]> {
  const xml = await (await fetch(xmlUrl)).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

const indexes = await locs(SITEMAP);
const urlSet = new Set<string>();
for (const idx of indexes) {
  if (idx.endsWith(".xml")) {
    for (const u of await locs(idx)) urlSet.add(u);
  } else {
    urlSet.add(idx);
  }
}
const urlList = [...urlSet];
console.log(`Collected ${urlList.length} URLs from ${SITEMAP}`);
if (urlList.length === 0) {
  console.error("No URLs found — is the site deployed?");
  process.exit(1);
}

// Verify the key file is reachable before submitting (IndexNow rejects otherwise).
const keyOk = (await fetch(KEY_LOCATION)).ok;
if (!keyOk) {
  console.error(`Key file not reachable at ${KEY_LOCATION} — deploy first.`);
  process.exit(1);
}

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
});
console.log(`IndexNow responded: ${res.status} ${res.statusText}`);
// 200 = accepted, 202 = accepted/queued. Both are success.
process.exit(res.status === 200 || res.status === 202 ? 0 : 1);
