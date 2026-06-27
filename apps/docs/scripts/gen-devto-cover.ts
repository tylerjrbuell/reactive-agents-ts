// Generates apps/docs/src/assets/devto-cover.png — a Dev.to article cover
// (Dev.to crops to ~2.4:1; we render at 1600x668). Branded, readable, static.
// Run: bun run apps/docs/scripts/gen-devto-cover.ts
import sharp from "sharp";

const W = 1600,
  H = 668;
const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b0a16"/>
      <stop offset="0.55" stop-color="#160f2e"/>
      <stop offset="1" stop-color="#241548"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.86" cy="0.16" r="0.7">
      <stop offset="0" stop-color="#7c3aed" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="16" height="${H}" fill="#7c3aed"/>
  <text x="110" y="150" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="27" font-weight="bold" letter-spacing="3" fill="#7c3aed">RELIABLE · TRANSPARENT · COMPOSABLE</text>
  <text x="108" y="268" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="96" font-weight="bold" fill="#ffffff">Reactive Agents</text>
  <text x="110" y="356" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="42" fill="#c4bbe6">TypeScript AI agents that finish the loop —</text>
  <text x="110" y="410" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="42" fill="#c4bbe6">on a 4B local model or Claude, and after a crash.</text>
  <rect x="110" y="500" width="330" height="58" rx="29" fill="#7c3aed"/>
  <text x="275" y="538" text-anchor="middle" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="26" font-weight="bold" fill="#ffffff">docs.reactiveagents.dev</text>
  <text x="470" y="538" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="26" fill="#9a8fc7">· Effect-TS · MIT · early access</text>
</svg>`;

const out = `${import.meta.dir}/../src/assets/devto-cover.png`;
await sharp(Buffer.from(svg)).png().toFile(out);
console.log("written:", out);
