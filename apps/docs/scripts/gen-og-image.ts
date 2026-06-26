// Generates the branded static social-preview image (public/og-default.png).
// Run manually after changing branding: `bun run scripts/gen-og-image.ts`.
// Referenced site-wide as og:image / twitter:image via src/components/Head.astro.
import sharp from "sharp";

const W = 1200,
  H = 630;
const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b0a16"/>
      <stop offset="0.55" stop-color="#160f2e"/>
      <stop offset="1" stop-color="#241548"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.82" cy="0.18" r="0.6">
      <stop offset="0" stop-color="#7c3aed" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="14" height="${H}" fill="#7c3aed"/>
  <text x="86" y="160" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="26" font-weight="bold" letter-spacing="3" fill="#7c3aed">EFFECT-TS &#183; OPEN SOURCE &#183; MIT</text>
  <text x="84" y="250" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="84" font-weight="bold" fill="#ffffff">Reactive Agents</text>
  <text x="86" y="320" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="38" fill="#c4bbe6">The TypeScript AI agent framework built on Effect-TS</text>
  <text x="86" y="404" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="30" fill="#9a8fc7">Type-safe &#183; composable &#183; observable &#8212; 12-phase execution,</text>
  <text x="86" y="446" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="30" fill="#9a8fc7">6 reasoning strategies, local Ollama to frontier APIs.</text>
  <rect x="86" y="520" width="290" height="56" rx="28" fill="#7c3aed"/>
  <text x="231" y="557" text-anchor="middle" font-family="Liberation Sans, DejaVu Sans, sans-serif" font-size="26" font-weight="bold" fill="#ffffff">docs.reactiveagents.dev</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile("public/og-default.png");
console.log("public/og-default.png written");
