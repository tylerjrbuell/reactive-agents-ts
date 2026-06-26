// Search-engine site-verification tokens. Rendered as <meta> tags by
// src/components/Head.astro ONLY when non-empty (empty = nothing rendered).
//
// HOW TO FILL:
//   Google Search Console — https://search.google.com/search-console
//     Add a URL-prefix property for https://docs.reactiveagents.dev, choose
//     the "HTML tag" method, copy the token from
//     <meta name="google-site-verification" content="THIS_VALUE" />
//     into `google` below, redeploy, then click Verify. After verifying,
//     submit the sitemap: sitemap-index.xml
//     (Prefer DNS verification? Add the TXT record instead and leave this "".)
//
//   Bing Webmaster Tools — https://www.bing.com/webmasters
//     Easiest: "Import from Google Search Console" (one click, no token).
//     Or add a property and copy the <meta name="msvalidate.01" content="..."/>
//     token into `bing` below.
export const siteVerification = {
  google: "",
  bing: "",
} as const;
