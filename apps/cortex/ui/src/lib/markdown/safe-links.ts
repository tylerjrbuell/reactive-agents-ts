/**
 * What a link in rendered (untrusted) markdown may do. Model output is not trusted: a
 * link opens only as an external web page in a new tab that cannot reach back
 * (`noopener noreferrer`) or as a `mailto:`; in-page anchors stay; everything else
 * (`javascript:`, `data:`, `file:`, relative paths that would navigate the desk) loses
 * its `href`. Pure; `render-markdown-with-math.ts` applies it in a DOMPurify hook.
 */

/** What to do with an anchor's `href`. */
export interface LinkPolicy {
  /** The href to keep, or null to remove it. */
  readonly href: string | null;
  /** Open in a new tab with `rel="noopener noreferrer nofollow"`. */
  readonly external: boolean;
}

/** Decide an anchor's `href`. */
export function linkPolicy(href: string | null | undefined): LinkPolicy {
  const h = (href ?? "").trim();
  if (h === "") return { href: null, external: false };
  if (h.startsWith("#")) return { href: h, external: false };
  // Control characters hide schemes (`java\nscript:`); a URL with them is not a link.
  if (/[\u0000-\u001f\u007f]/.test(h)) return { href: null, external: false };
  try {
    const u = new URL(h);
    if (u.protocol === "http:" || u.protocol === "https:") return { href: u.href, external: true };
    if (u.protocol === "mailto:") return { href: u.href, external: false };
  } catch {
    /* relative or malformed */
  }
  return { href: null, external: false };
}

/** Attributes an anchor needs when the policy marks it external. */
export const EXTERNAL_LINK_ATTRS = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;
