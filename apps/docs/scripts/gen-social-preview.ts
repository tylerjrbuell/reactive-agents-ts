// Generates .github/social-preview.png (1280x640) — GitHub repo social card.
// GitHub can't set this via API/CLI; upload manually at
// Settings -> General -> Social preview. Run: bun run scripts/gen-social-preview.ts
import sharp from "sharp";

const W = 1280,
  H = 640;
const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b0a16"/>
      <stop offset="0.55" stop-color="#160f2e"/>
      <stop offset="1" stop-color="#241548"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.85" cy="0.15" r="0.65">
      <stop offset="0" stop-color="#7c3aed" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="16" height="${H}" fill="#7c3aed"/>
  <text x="96" y="150" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="26" font-weight="bold" letter-spacing="3" fill="#7c3aed">EFFECT-TS &#183; OPEN SOURCE &#183; MIT</text>
  <text x="94" y="248" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="92" font-weight="bold" fill="#ffffff">Reactive Agents</text>
  <text x="96" y="318" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="40" fill="#c4bbe6">The TypeScript AI agent framework built for control, not magic</text>
  <text x="96" y="404" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="30" fill="#9a8fc7">Type-safe &#183; observable &#183; durable &#8212; 12-phase execution engine,</text>
  <text x="96" y="446" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="30" fill="#9a8fc7">6 reasoning strategies, MCP-native tools, A2A multi-agent.</text>
  <text x="96" y="492" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="30" fill="#9a8fc7">One codebase from local 4B Ollama to frontier APIs.</text>
  <rect x="96" y="552" width="430" height="56" rx="28" fill="#7c3aed"/>
  <text x="311" y="589" text-anchor="middle" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="25" font-weight="bold" fill="#ffffff">github.com/tylerjrbuell/reactive-agents-ts</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile("../../.github/social-preview.png");
console.log(".github/social-preview.png written");
