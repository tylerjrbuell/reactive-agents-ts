/**
 * Reactive Agents — deep Umami tracking
 *
 * Loaded site-wide via astro.config.mjs head injection. Runs on every page.
 * Captures user-engagement signals beyond raw pageviews:
 *
 *   outbound_click      Any external link click (with destination + anchor text)
 *   code_copy           Starlight expressive-code copy-button click
 *   hero_cta            Astro Starlight splash-hero action button click
 *   linkcard_click      Starlight <LinkCard> click (catalog navigation)
 *   tab_switch          Starlight <Tabs> tab click
 *   search_query        Pagefind search submitted (debounced)
 *   feedback            "Was this helpful?" widget (yes/no)
 *   anchor_click        In-page heading-link click (deep-share intent)
 *   scroll_depth        Reached 25% / 50% / 75% / 100% of long pages
 *
 * All events are no-ops if window.umami is missing (offline / blocked).
 * Naming convention: lowercase + snake_case event name; data is small
 * { string: scalar } maps for Umami's event-data API.
 */

(() => {
  const DOC_HOST = location.hostname;
  const SCROLL_BUCKETS = [25, 50, 75, 100];
  const FIRED = new Set();
  const SEARCH_DEBOUNCE_MS = 800;

  const track = (name, data) => {
    if (typeof window.umami?.track !== "function") return;
    try {
      data ? window.umami.track(name, data) : window.umami.track(name);
    } catch {
      /* swallow — analytics must never throw */
    }
  };

  /* ---------- Outbound links ---------- */
  document.addEventListener(
    "click",
    (ev) => {
      const a = ev.target?.closest?.("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      // Skip in-page anchors and same-host links (those become anchor_click below)
      if (href.startsWith("#") || href.startsWith("/")) return;
      let url;
      try { url = new URL(href, location.href); } catch { return; }
      if (url.hostname === DOC_HOST) return;

      track("outbound_click", {
        host: url.hostname,
        path: url.pathname.slice(0, 80),
        label: (a.textContent || "").trim().slice(0, 60) || "(no-text)",
        from: location.pathname,
      });
    },
    { capture: true, passive: true },
  );

  /* ---------- In-page heading anchor share intent ---------- */
  document.addEventListener(
    "click",
    (ev) => {
      const a = ev.target?.closest?.('a.anchor-link, a[href^="#"]');
      if (!a) return;
      const hash = (a.getAttribute("href") || "").slice(1);
      if (!hash) return;
      track("anchor_click", { path: location.pathname, hash: hash.slice(0, 60) });
    },
    { capture: true, passive: true },
  );

  /* ---------- Code block copy (Starlight expressive-code) ---------- */
  document.addEventListener(
    "click",
    (ev) => {
      // expressive-code renders a button with class "copy" inside <figure class="expressive-code">
      const btn = ev.target?.closest?.(
        "button.copy, .expressive-code button[data-copy], .copy-code-button",
      );
      if (!btn) return;
      const figure = btn.closest("figure, pre, .expressive-code");
      const lang =
        figure?.querySelector("code")?.className?.match(/language-(\w+)/)?.[1] ||
        "unknown";
      track("code_copy", {
        path: location.pathname,
        lang,
      });
    },
    { capture: true, passive: true },
  );

  /* ---------- Hero CTA buttons (splash template) ---------- */
  document.addEventListener(
    "click",
    (ev) => {
      const a = ev.target?.closest?.(".hero .actions a, .hero a.button");
      if (!a) return;
      const label = (a.textContent || "").trim().slice(0, 40) || "(unlabeled)";
      const variant =
        a.classList.contains("primary") ? "primary"
        : a.classList.contains("secondary") ? "secondary"
        : "default";
      track("hero_cta", { label, variant, path: location.pathname });
    },
    { capture: true, passive: true },
  );

  /* ---------- LinkCard clicks (Starlight component) ---------- */
  document.addEventListener(
    "click",
    (ev) => {
      const card = ev.target?.closest?.(".sl-link-card");
      if (!card) return;
      const title = card.querySelector(".title")?.textContent?.trim().slice(0, 60)
        || card.textContent?.trim().slice(0, 60)
        || "(unknown)";
      const href = card.querySelector("a")?.getAttribute("href") || "";
      track("linkcard_click", { title, target: href, from: location.pathname });
    },
    { capture: true, passive: true },
  );

  /* ---------- Tab switches (Starlight Tabs) ---------- */
  document.addEventListener(
    "click",
    (ev) => {
      const tab = ev.target?.closest?.('[role="tab"]');
      if (!tab) return;
      const label = (tab.textContent || "").trim().slice(0, 40);
      // Try to identify which Tabs group by walking up to the closest container
      const group = tab.closest('starlight-tabs, [role="tablist"]')?.id || "";
      track("tab_switch", { label, group, path: location.pathname });
    },
    { capture: true, passive: true },
  );

  /* ---------- Search queries (Pagefind dialog) ---------- */
  let searchTimer;
  document.addEventListener(
    "input",
    (ev) => {
      const t = ev.target;
      if (!t || t.tagName !== "INPUT") return;
      if (t.type !== "search" && !t.closest?.(".pagefind-ui, dialog")) return;
      const q = (t.value || "").trim();
      if (q.length < 3) return;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        track("search_query", { q: q.slice(0, 80), len: q.length });
      }, SEARCH_DEBOUNCE_MS);
    },
    { capture: true, passive: true },
  );

  /* ---------- Scroll-depth (long pages only) ---------- */
  let scrollTimer;
  const onScroll = () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const doc = document.documentElement;
      const total = doc.scrollHeight - window.innerHeight;
      if (total < 600) return; // ignore short pages
      const pct = Math.round(((doc.scrollTop || window.scrollY) / total) * 100);
      for (const bucket of SCROLL_BUCKETS) {
        const key = `${location.pathname}@${bucket}`;
        if (pct >= bucket && !FIRED.has(key)) {
          FIRED.add(key);
          track("scroll_depth", { path: location.pathname, depth: bucket });
        }
      }
    }, 250);
  };
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- "Was this helpful?" widget ---------- */
  const installFeedback = () => {
    // Skip on splash / 404
    if (document.querySelector(".hero")) return;
    if (location.pathname === "/" || location.pathname === "/404/") return;
    // Find Starlight's article footer or insert at end of main
    const main = document.querySelector("main .sl-markdown-content")
      || document.querySelector("main");
    if (!main || main.querySelector(".ra-feedback")) return;

    const wrap = document.createElement("aside");
    wrap.className = "ra-feedback";
    wrap.setAttribute("aria-label", "Page feedback");
    wrap.innerHTML = `
      <div class="ra-feedback-inner">
        <span class="ra-feedback-q">Was this page helpful?</span>
        <div class="ra-feedback-actions">
          <button type="button" data-vote="yes" class="ra-feedback-btn">👍 Yes</button>
          <button type="button" data-vote="no" class="ra-feedback-btn">👎 No</button>
        </div>
        <span class="ra-feedback-thanks" hidden>Thanks for the signal.</span>
      </div>
    `;
    main.appendChild(wrap);

    wrap.addEventListener("click", (ev) => {
      const btn = ev.target?.closest?.("button[data-vote]");
      if (!btn) return;
      const vote = btn.dataset.vote;
      track("feedback", { path: location.pathname, vote });
      wrap.querySelector(".ra-feedback-actions").hidden = true;
      wrap.querySelector(".ra-feedback-q").hidden = true;
      wrap.querySelector(".ra-feedback-thanks").hidden = false;
      // A "No" vote is a dead-end count on its own. Invite the why: open the
      // global feedback modal (tailored copy + tagged as a page downvote).
      // No-ops gracefully if the modal hasn't mounted.
      if (vote === "no" && typeof window.__raOpenFeedback === "function") {
        setTimeout(() => window.__raOpenFeedback({ reason: "page-unhelpful" }), 250);
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installFeedback, { once: true });
  } else {
    installFeedback();
  }
  // Re-install on Starlight client-side route changes (Astro view-transitions)
  document.addEventListener("astro:page-load", installFeedback);

  /* ---------- GitHub Star CTA clicks ---------- */
  // data-umami-event / data-umami-event-location handled by Umami's auto-collect,
  // but we also fire a named event for consistent naming with other CTA events.
  document.addEventListener(
    "click",
    (ev) => {
      const a = ev.target?.closest?.("a.ra-star-cta");
      if (!a) return;
      const location = a.dataset.umamiEventLocation || "unknown";
      track("github_star_cta", { location, from: location.pathname });
    },
    { capture: true, passive: true },
  );

  /* ---------- Sidebar navigation ---------- */
  document.addEventListener(
    "click",
    (ev) => {
      const a = ev.target?.closest?.("nav.sidebar a[href], .sidebar a[href]");
      if (!a) return;
      const label = (a.textContent || "").trim().slice(0, 60);
      const to = a.getAttribute("href") || "";
      // Try to find the section heading this link is nested under
      const group = a.closest("[data-sl-collapsed], .sidebar-group")
        ?.querySelector?.("summary, .group-label")
        ?.textContent?.trim().slice(0, 40) || "";
      track("sidebar_nav", { label, section: group, to, from: location.pathname });
    },
    { capture: true, passive: true },
  );

  /* ---------- TOC clicks ---------- */
  document.addEventListener(
    "click",
    (ev) => {
      const a = ev.target?.closest?.(".right-sidebar a[href^='#'], .toc a[href^='#']");
      if (!a) return;
      const heading = (a.textContent || "").trim().slice(0, 60);
      track("toc_click", { heading, path: location.pathname });
    },
    { capture: true, passive: true },
  );

  /* ---------- Stability badge hover ---------- */
  document.addEventListener(
    "pointerenter",
    (ev) => {
      const badge = ev.target?.closest?.(".sl-badge, [class*='badge']");
      if (!badge) return;
      const text = (badge.textContent || "").trim().slice(0, 30);
      if (!text) return;
      track("version_badge_hover", { badge: text, path: location.pathname });
    },
    { capture: true, passive: true },
  );

  /* ---------- Updated callout hash link clicks ---------- */
  document.addEventListener(
    "click",
    (ev) => {
      const a = ev.target?.closest?.(".ra-updated-hash");
      if (!a) return;
      const hash = (a.textContent || "").trim().slice(0, 10);
      track("changelog_link", { hash, path: location.pathname });
    },
    { capture: true, passive: true },
  );

  /* ---------- 404 hit ---------- */
  (function () {
    if (
      location.pathname === "/404/" ||
      document.querySelector('meta[name="generator"][content*="404"]') ||
      document.title?.includes("404")
    ) {
      track("404_hit", { referrer: document.referrer.slice(0, 120) });
    }
  })();

  /* ---------- Time on page (capped at 10 min) ---------- */
  (function () {
    const START = Date.now();
    const MAX_SEC = 600;

    function flush() {
      const elapsed = Math.round(Math.min((Date.now() - START) / 1000, MAX_SEC));
      if (elapsed < 5) return; // ignore bounces under 5s
      track("time_on_page", { path: location.pathname, seconds: elapsed });
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });

    // Re-arm on Starlight view-transitions
    document.addEventListener("astro:before-preparation", flush);
  })();

  /* ---------- Pagefind search result click ---------- */
  document.addEventListener(
    "click",
    (ev) => {
      const result = ev.target?.closest?.(".pagefind-ui__result-link, [data-pagefind-result]");
      if (!result) return;
      const title = result.querySelector?.(".pagefind-ui__result-title")?.textContent?.trim().slice(0, 60)
        || (result.textContent || "").trim().slice(0, 60);
      const href = result.getAttribute?.("href") || result.closest?.("a")?.getAttribute?.("href") || "";
      // Find the search input to read current query
      const q = document.querySelector?.(".pagefind-ui__search-input")?.value?.trim().slice(0, 80) || "";
      // Rank is hard to get from DOM; use position in result list
      const allResults = [...(document.querySelectorAll?.(".pagefind-ui__result") ?? [])];
      const resultItem = result.closest?.(".pagefind-ui__result");
      const rank = resultItem ? allResults.indexOf(resultItem) + 1 : 0;
      track("search_result_click", { q, result_title: title, result_path: href, rank });
    },
    { capture: true, passive: true },
  );
})();
