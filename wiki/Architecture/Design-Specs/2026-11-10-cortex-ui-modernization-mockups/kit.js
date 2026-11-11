// Mockup kit: icon sprite, shared top bar, theme switch. Static demo only.
(() => {
  const icons = {
    beacon: '<circle cx="12" cy="12" r="2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    runs: '<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="18" cy="6" r="2"/><circle cx="15" cy="18" r="2"/>',
    lab: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 15h9"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    retry: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>',
    trace: '<path d="M4 6h6v4H4zM14 14h6v4h-6zM7 10v6h7"/>',
    fork: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 12v5"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17v.5"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>',
    model: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    strategy: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7.5 7.5 11 16M16.5 7.5 13 16M8 6h8"/>',
    shell: '<path d="m5 8 4 4-4 4M12 17h7"/>',
    folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
    steps: '<path d="M4 7h10l-3-3M20 17H10l3 3"/>',
    think: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
    agents: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M12 7v4M12 11l-6 5.5M12 11l6 5.5"/>',
    goal: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    filter: '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
    pin: '<path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/>',
    dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  };
  const sprite = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${Object.entries(icons)
    .map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join("")}</svg>`;
  document.body.insertAdjacentHTML("afterbegin", sprite);

  // The Cortex neural mark: the same geometry as static/favicon.svg and the
  // current header logo (8 outer nodes on an octagon, 8 spokes, one core).
  // Modernized: no feGaussianBlur (mush at 22px), theme-aware node colors,
  // a flat halo instead of the glow filter. `hero` adds a soft radial halo
  // and a slow staggered twinkle (7s, reduced motion: still).
  let markN = 0;
  const NODES = [[14, 6, "violet", 2.8], [34, 6, "cyan", 2.8], [42, 20, "pale", 2.4], [42, 34, "violet", 2.4],
    [30, 44, "cyan", 2.8], [18, 44, "lilac", 2.8], [6, 34, "cyan", 2.4], [6, 20, "lilac", 2.4]];
  function mark(size, hero = false) {
    const id = `mk${++markN}`;
    const ring = NODES.map(([x, y], i) => { const [nx, ny] = NODES[(i + 1) % NODES.length]; return `M${x} ${y}L${nx} ${ny}`; }).join("");
    const spokes = NODES.map(([x, y]) => `M24 24L${x} ${y}`).join("");
    const nodes = NODES.map(([x, y, c, r], i) =>
      `<circle cx="${x}" cy="${y}" r="${r}"${hero ? ` class="tw"` : ""} style="fill:var(--mk-${c})${hero ? `;animation-delay:${-(i * 0.9).toFixed(1)}s` : ""}"/>`).join("");
    return `<svg class="mark" viewBox="${hero ? "-8 -8 64 64" : "0 0 48 48"}" width="${size}" height="${size}" aria-hidden="true">
      <defs>
        <linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--mk-violet);stop-opacity:.75"/><stop offset="1" style="stop-color:var(--mk-cyan);stop-opacity:.35"/></linearGradient>
        <linearGradient id="${id}b" x1="1" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--mk-cyan);stop-opacity:.6"/><stop offset="1" style="stop-color:var(--mk-violet);stop-opacity:.25"/></linearGradient>
        <radialGradient id="${id}h"><stop offset="0" style="stop-color:var(--mk-violet);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--mk-violet);stop-opacity:0"/></radialGradient>
      </defs>
      ${hero ? `<circle cx="24" cy="24" r="30" fill="url(#${id}h)"/>` : ""}
      <path d="${ring}" fill="none" stroke="url(#${id}a)" stroke-width="${size < 32 ? 1.6 : 1.2}" stroke-linecap="round"/>
      <path d="${spokes}" fill="none" stroke="url(#${id}b)" stroke-width="${size < 32 ? 1.6 : 1.3}" stroke-linecap="round"/>
      ${nodes}
      <circle cx="24" cy="24" r="8.5" style="fill:var(--mk-violet)" opacity=".18"/>
      <circle cx="24" cy="24" r="5.2" style="fill:var(--mk-violet)"/>
      <circle cx="24" cy="24" r="8" fill="none" style="stroke:var(--mk-cyan)" stroke-width=".6" opacity=".45"/>
    </svg>`;
  }
  window.cortexMark = mark;
  const logo = mark(22);

  // Entropy line: data-spark="0.2,0.4,…" (0..1). Signal gradient stroke over
  // an accent-tint area. 3.9:1 against surface-1 dark (graphical object).
  function spark(el) {
    const v = el.dataset.spark.split(",").map(Number);
    const w = Number(el.dataset.w || 120), h = Number(el.dataset.h || 28), id = `sp${++markN}`;
    const pts = v.map((y, i) => [((i / (v.length - 1)) * w).toFixed(1), (h - 2 - y * (h - 4)).toFixed(1)]);
    const line = pts.map((p) => p.join(",")).join(" ");
    el.outerHTML = `<svg class="spark-e" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${el.dataset.label || "Entropy per step"}">
      <defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
      <polygon points="0,${h} ${line} ${w},${h}" fill="var(--accent-tint)"/>
      <polyline points="${line}" fill="none" stroke="url(#${id})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="2.6" fill="#22d3ee"/></svg>`;
  }

  const page = document.body.dataset.page;
  const bar = document.querySelector("[data-topbar]");
  if (document.body.dataset.ambient !== undefined) document.querySelector(".app")?.insertAdjacentHTML("afterbegin", `<div class="ambient" aria-hidden="true"></div>`);
  if (bar) {
    const items = [["beacon", "Beacon", "/"], ["chat", "Chat", "/chat"], ["runs", "Runs", "/runs"], ["lab", "Lab", "/lab"]];
    bar.outerHTML = `<header class="topbar" data-live>
      <a class="brand" href="beacon.html">${logo}<span>Cortex</span></a>
      <nav class="nav" aria-label="Primary">${items.map(([k, label]) =>
        `<a href="${k}.html" ${page === k ? 'aria-current="page"' : ""}><svg class="i"><use href="#i-${k}"/></svg>${label}${k === "runs" ? ' <span class="count">2 live</span>' : ""}</a>`).join("")}</nav>
      <div class="right">
        <span class="live-pill"><span class="status tone-running"><span class="dot"></span></span>2 agents running</span>
        <button class="btn ghost sm" aria-label="Command palette"><svg class="i sm"><use href="#i-search"/></svg>Search or run a command <span class="kbd">Ctrl K</span></button>
        <button class="iconbtn" aria-label="Switch theme" data-theme-toggle><svg class="i"><use href="#i-sun"/></svg></button>
        <a class="iconbtn" href="settings.html" aria-label="Settings"><svg class="i"><use href="#i-settings"/></svg></a>
      </div></header>`;
  }
  const root = document.documentElement;
  const saved = localStorage.getItem("bench-theme");
  if (saved) root.dataset.theme = saved;
  const flip = () => { root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light"; localStorage.setItem("bench-theme", root.dataset.theme); };
  document.addEventListener("click", (e) => { if (e.target.closest("[data-theme-toggle]")) flip(); });
  document.body.insertAdjacentHTML("beforeend", `<button class="btn sm theme-switch" data-theme-toggle>Toggle light / dark</button>`);
  const params = new URLSearchParams(location.search);
  const q = params.get("theme");
  if (q) root.dataset.theme = q;

  // Placeholders: <span data-mark="96" data-hero></span>, <span data-spark="…">.
  document.querySelectorAll("[data-mark]").forEach((el) => { el.outerHTML = mark(Number(el.dataset.mark), el.hasAttribute("data-hero")); });
  document.querySelectorAll("[data-spark]").forEach(spark);

  // Page states (?state=empty) and Beacon views (?view=field). Static demo.
  const states = [...document.querySelectorAll("[data-state]")];
  if (states.length) {
    let cur = params.get("state") || "default";
    const show = () => {
      states.forEach((el) => { el.hidden = el.dataset.state !== cur; });
      const amb = document.querySelector(".ambient");
      if (document.body.dataset.ambientEmptyOnly !== undefined) {
        if (cur === "empty" && !amb) document.querySelector(".app").insertAdjacentHTML("afterbegin", `<div class="ambient" aria-hidden="true"></div>`);
        if (cur !== "empty" && amb) amb.remove();
      }
    };
    show();
    document.body.insertAdjacentHTML("beforeend", `<button class="btn sm state-switch" data-state-toggle>Toggle empty state</button>`);
    document.addEventListener("click", (e) => { if (e.target.closest("[data-state-toggle]")) { cur = cur === "empty" ? "default" : "empty"; show(); } });
  }
  const views = [...document.querySelectorAll("[data-view]")];
  if (views.length) {
    const setView = (v) => {
      views.forEach((el) => { el.hidden = el.dataset.view !== v; });
      document.querySelectorAll("[data-view-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.viewBtn === v)));
    };
    setView(params.get("view") || "board");
    document.addEventListener("click", (e) => { const b = e.target.closest("[data-view-btn]"); if (b) setView(b.dataset.viewBtn); });
  }
})();
