(function () {
  function apply() {
    var data = window.__ra_new_pages_data__;
    if (!Array.isArray(data)) {
      console.warn("[new-page-indicator] window.__ra_new_pages_data__ missing");
      return;
    }
    if (data.length === 0) return;
    var norm = data.map(function (s) {
      return String(s).replace(/\/$/, "") || "/";
    });
    var links = document.querySelectorAll("nav.sidebar a, aside .sidebar a");
    var marked = 0;
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
        marked++;
      }
    });
    console.info(
      "[new-page-indicator] marked " +
        marked +
        " sidebar link(s) (" +
        norm.length +
        " new slugs, " +
        links.length +
        " links scanned)",
    );
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    apply();
  } else {
    document.addEventListener("DOMContentLoaded", apply);
  }
  // Starlight uses client-side navigation; re-apply after view transitions.
  document.addEventListener("astro:page-load", apply);
})();
