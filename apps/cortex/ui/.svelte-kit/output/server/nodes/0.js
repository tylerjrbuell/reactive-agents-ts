

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_layout.svelte.js')).default;
export const universal = {
  "prerender": false,
  "ssr": false
};
export const universal_id = "src/routes/+layout.ts";
export const imports = ["_app/immutable/nodes/0.BLM50r22.js","_app/immutable/chunks/DoA4ZXDq.js","_app/immutable/chunks/DcYH6ZLs.js","_app/immutable/chunks/CGXFW_Hb.js","_app/immutable/chunks/uMs3N5ls.js","_app/immutable/chunks/Bb9npD4X.js","_app/immutable/chunks/Dw3jJXSh.js","_app/immutable/chunks/BAmVDMWh.js","_app/immutable/chunks/DzWUwLD2.js","_app/immutable/chunks/DMN-gTPG.js","_app/immutable/chunks/DRJhFpfT.js"];
export const stylesheets = ["_app/immutable/assets/0.VVm3AY1V.css"];
export const fonts = ["_app/immutable/assets/geist-cyrillic-wght-normal.CHSlOQsW.woff2","_app/immutable/assets/geist-latin-ext-wght-normal.DMtmJ5ZE.woff2","_app/immutable/assets/geist-latin-wght-normal.Dm3htQBi.woff2"];
