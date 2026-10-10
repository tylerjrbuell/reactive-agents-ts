type ContentEntry = {
  readonly id: string;
  readonly data: { readonly recentlyChanged?: boolean };
};

type NavigationLink = {
  readonly href: string;
  readonly textContent: string | null;
  querySelector(selector: string): { readonly classList: { contains(token: string): boolean } } | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

const normalizePathname = (pathname: string): string => {
  const path = pathname.replace(/\/+$/, "");
  return path === "" ? "/" : `${path}/`;
};

/** Collect routes with recent Git-backed content changes, regardless of badge precedence. */
export function getNewContentPagePaths(entries: readonly ContentEntry[]): readonly string[] {
  return entries
    .filter(({ data }) => data.recentlyChanged === true)
    .map(({ id }) => pagePathFromDocId(id));
}

/** Convert a Starlight docs collection ID to its canonical page URL. */
export function pagePathFromDocId(id: string): string {
  const normalizedId = id.replace(/^\/+|\/+$/g, "");
  const slug = normalizedId === "index"
    ? ""
    : normalizedId.replace(/\/index$/, "");
  return normalizePathname(`/${slug}`);
}

/** Test whether a link targets one of the recently changed pages. */
export function isNewContentPageLink(
  href: string,
  origin: string,
  pagePaths: readonly string[],
): boolean {
  try {
    const baseUrl = new URL(origin);
    const linkUrl = new URL(href, baseUrl);
    return linkUrl.origin === baseUrl.origin && pagePaths.includes(normalizePathname(linkUrl.pathname));
  } catch {
    return false;
  }
}

/** Check whether a Starlight badge denotes new or updated content. */
export function isNewContentBadgeVariant(variant: string): boolean {
  return variant === "success" || variant === "note";
}

/** Match a TOC link label to one of the Git-derived changed section headings. */
export function isChangedSectionLink(
  linkText: string,
  changedSections: readonly string[],
): boolean {
  const normalizedLinkText = normalizeHeading(linkText);
  return normalizedLinkText !== "" && changedSections.some(
    (section) => normalizeHeading(section) === normalizedLinkText,
  );
}

/** Apply page-level dots to changed and curated-badge links in the left page map. */
export function applyPageMapMarkers(
  links: Iterable<NavigationLink>,
  origin: string,
  pagePaths: readonly string[],
): void {
  for (const link of links) {
    link.removeAttribute("data-ra-new-content");
    const badge = link.querySelector(".sl-badge");
    const hasRecentBadge = badge !== null && ["note", "success"].some((variant) =>
      badge.classList.contains(variant) && isNewContentBadgeVariant(variant),
    );
    if (hasRecentBadge || isNewContentPageLink(link.href, origin, pagePaths)) {
      link.setAttribute("data-ra-new-content", "page");
    }
  }
}

/** Apply section-level dots to changed heading links in the table of contents. */
export function applyTocSectionMarkers(
  links: Iterable<NavigationLink>,
  changedSections: readonly string[],
): void {
  for (const link of links) {
    link.removeAttribute("data-ra-new-content");
    if (isChangedSectionLink(link.textContent ?? "", changedSections)) {
      link.setAttribute("data-ra-new-content", "section");
    }
  }
}

function normalizeHeading(heading: string): string {
  return heading
    .replace(/^#{1,6}\s*/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
