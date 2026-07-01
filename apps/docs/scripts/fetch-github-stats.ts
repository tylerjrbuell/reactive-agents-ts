#!/usr/bin/env bun
/**
 * fetch-github-stats.ts
 *
 * Fetches star count from GitHub API at build time.
 * Falls back gracefully if API is unavailable (no token, rate limit).
 * Writes src/data/github-stats.json.
 */

import { writeFileSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT = join(import.meta.dir, "../src/data/github-stats.json");
const REPO = "tylerjrbuell/reactive-agents-ts";

async function fetchStats(): Promise<{ stars: number; fetchedAt: string }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${REPO}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);

  const json = (await res.json()) as { stargazers_count: number };
  return {
    stars: json.stargazers_count,
    fetchedAt: new Date().toISOString().slice(0, 10),
  };
}

async function main() {
  try {
    const stats = await fetchStats();
    writeFileSync(OUTPUT, JSON.stringify(stats, null, 2) + "\n");
    console.log(`fetch-github-stats: ${stats.stars} stars`);
  } catch (err) {
    // Graceful fallback — keep existing file if present, otherwise write default
    if (existsSync(OUTPUT)) {
      console.warn(`fetch-github-stats: API unavailable, keeping cached stats. (${err})`);
    } else {
      writeFileSync(OUTPUT, JSON.stringify({ stars: 0, fetchedAt: "unknown" }, null, 2) + "\n");
      console.warn(`fetch-github-stats: API unavailable, wrote fallback. (${err})`);
    }
  }
}

main();
