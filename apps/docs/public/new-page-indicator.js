(function () {
  function apply() {
    var data = window.__ra_new_pages_data__;
    if (!Array.isArray(data) || data.length === 0) return;
    var norm = data.map(function (s) {
      return String(s).replace(/\/$/, "") || "/";
    });
    // Sidebar links live inside Starlight's <nav>. We tag matching <a> hrefs.
    var links = document.querySelectorAll(
      'nav[aria-labelledby="starlight__sidebar"] a, .sidebar a, sl-sidebar-state-persist a',
    );
    links.forEach(function (a) {
      var href = a.getAttribute("href");
      if (!href) return;
      var url;
      try {
        url = new URL(href, window.location.origin);
      } catch (_) {
        return;
      }
      var path = url.pathname.replace(/\/$/, "") || "/";
      if (norm.indexOf(path) !== -1) {
        a.setAttribute("data-ra-new", "true");
      }
    });
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    apply();
  } else {
    document.addEventListener("DOMContentLoaded", apply);
  }
  // Starlight uses client-side navigation; re-apply after view transitions.
  document.addEventListener("astro:page-load", apply);
})();
