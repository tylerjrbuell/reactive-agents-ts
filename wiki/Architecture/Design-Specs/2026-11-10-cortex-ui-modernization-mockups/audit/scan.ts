// Token-drift scanner for Cortex UI. Read-only. Usage: bun scan.ts <srcDir>
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2]!;
const files: string[] = [];
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".svelte")) files.push(p);
  }
};
walk(root);

type Hit = { file: string; line: number; text: string };
const patterns: Record<string, RegExp> = {
  hex: /#[0-9a-fA-F]{3,8}\b/g,
  arbitraryTextSize: /text-\[\d+(?:\.\d+)?(?:px|rem)\]/g,
  twTextSize: /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl)\b/g,
  rounded: /\brounded(?:-[a-z0-9]+)?(?:-\[[^\]]+\])?/g,
  trackingCaps: /\buppercase\b/g,
  tracking: /tracking-\[[^\]]+\]|tracking-(?:wide|wider|widest)/g,
  arbitraryBg: /bg-\[[^\]]+\]/g,
  arbitraryBorder: /border-\[[^\]]+\]/g,
  material: /material-symbols-outlined/g,
  cortexVar: /var\(--cortex-[a-z-]+\)/g,
  raVar: /var\(--ra-[a-z-]+\)/g,
  rgba: /rgba?\([^)]*\)/g,
  fontDisplay: /font-display/g,
  shadowGlow: /shadow-(?:glow-[a-z]+|neural(?:-strong)?)/g,
  gradientBorder: /gradient-border(?:-glow)?/g,
  textOnSurface: /text-on-surface(?:-variant)?(?:\/\d+)?/g,
  textOpacity: /text-[a-z-]+\/\d+/g,
  zIndex: /\bz-(?:\d+|\[[^\]]+\])/g,
  outlineNone: /outline-none|focus:outline-none/g,
  focusVisible: /focus-visible:/g,
  styleBlock: /<style/g,
};

const counts: Record<string, Map<string, number>> = {};
const perFile: Record<string, Record<string, number>> = {};
const samples: Record<string, Hit[]> = {};
for (const k of Object.keys(patterns)) { counts[k] = new Map(); samples[k] = []; }

for (const f of files) {
  const rel = relative(root, f);
  perFile[rel] = {};
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((ln, i) => {
    for (const [k, re] of Object.entries(patterns)) {
      for (const m of ln.matchAll(re)) {
        const v = m[0].toLowerCase();
        counts[k]!.set(v, (counts[k]!.get(v) ?? 0) + 1);
        perFile[rel]![k] = (perFile[rel]![k] ?? 0) + 1;
        if (samples[k]!.length < 400) samples[k]!.push({ file: rel, line: i + 1, text: ln.trim().slice(0, 140) });
      }
    }
  });
}

const top = (k: string, n = 25) =>
  [...counts[k]!.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

const out: string[] = [`files: ${files.length}`];
for (const k of Object.keys(patterns)) {
  const total = [...counts[k]!.values()].reduce((a, b) => a + b, 0);
  out.push(`\n## ${k}: total ${total}, distinct ${counts[k]!.size}`);
  for (const [v, c] of top(k)) out.push(`  ${c}\t${v}`);
}
const offenders = (k: string, n = 12) =>
  Object.entries(perFile).map(([f, r]) => [f, r[k] ?? 0] as const).sort((a, b) => b[1] - a[1]).slice(0, n);
for (const k of ["hex", "arbitraryTextSize", "rgba", "arbitraryBg", "textOpacity", "material", "outlineNone", "focusVisible"]) {
  out.push(`\n## top files by ${k}`);
  for (const [f, c] of offenders(k)) out.push(`  ${c}\t${f}`);
}
console.log(out.join("\n"));
await Bun.write(process.argv[3] ?? "samples.json", JSON.stringify(samples, null, 1));
