---
type: reference
tags: [analytics, umami, docs-site]
created: 2026-05-06
updated: 2026-05-06
---

# Umami Events — Docs Site Tracking Catalog

The docs site at `docs.reactiveagents.dev` runs Umami self-hosted at `analytics.reactiveagents.dev` (website-id `4d58acb5-d15f-428c-8e0d-9f992fc5ba91`). On top of automatic pageview + referrer + screen-size data, custom events are emitted by `apps/docs/public/umami-deep.js` (loaded site-wide via `astro.config.mjs`).

This page is the canonical catalog of those events — what they capture, when they fire, and how to query them.

## Events

### `outbound_click`

Fires when a user clicks any external link (anything that isn't `/...` or `#...`).

| Field | Type | Notes |
|-------|------|-------|
| `host` | string | Destination hostname (e.g. `github.com`, `discord.gg`, `npmjs.com`) |
| `path` | string | First 80 chars of destination path |
| `label` | string | Anchor text (first 60 chars), `"(no-text)"` if empty |
| `from` | string | Page path the click happened on |

**Use it for:** measuring which CTAs route to GitHub vs Discord vs npm; identifying high-intent pages that drive repo stars.

---

### `code_copy`

Fires when a user clicks the copy button on any expressive-code code block.

| Field | Type | Notes |
|-------|------|-------|
| `path` | string | Page where the copy happened |
| `lang` | string | Detected language class (`typescript`, `bash`, `unknown`, etc.) |

**Use it for:** finding the most-copied code samples (those are the patterns users actually adopt). High `code_copy` count on `quickstart` confirms onboarding works.

---

### `hero_cta`

Fires when a user clicks the splash hero buttons (currently only on the home page).

| Field | Type | Notes |
|-------|------|-------|
| `label` | string | Button text — "Get Started", "View on GitHub", etc. |
| `variant` | string | `"primary"` / `"secondary"` / `"default"` |
| `path` | string | Page path |

**Use it for:** proving the home page hero is doing its job. Compare `hero_cta` count to home pageviews → conversion rate.

---

### `linkcard_click`

Fires when a user clicks any Starlight `<LinkCard>` (used in the home Start Here grid and elsewhere).

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | Card title |
| `target` | string | Card href |
| `from` | string | Page path |

**Use it for:** identifying which "next step" cards users actually click. If the new "Browse 30+ examples" card outperforms "Migrating from LangChain", that says something about the audience.

---

### `tab_switch`

Fires when a user clicks a tab in any Starlight `<Tabs>` group (Common Patterns on home, install guide tabs, etc).

| Field | Type | Notes |
|-------|------|-------|
| `label` | string | Tab text |
| `group` | string | DOM `id` of the tablist (often empty) |
| `path` | string | Page path |

**Use it for:** seeing whether users explore beyond the default tab. Common Patterns tab distribution shows whether streaming, chat, or gateway is the bigger draw.

---

### `search_query`

Fires 800 ms after a user types in the Pagefind search dialog (debounced, min 3 chars).

| Field | Type | Notes |
|-------|------|-------|
| `q` | string | Query (truncated to 80 chars) |
| `len` | number | Original query length |

**Use it for:** finding terms users search for that have no good landing page. Repeated searches for missing concepts → content gap. Typos in feature names → naming friction.

---

### `anchor_click`

Fires when a user clicks an in-page heading anchor (Starlight's `#`-prefix copy-link or any in-page `#hash` link).

| Field | Type | Notes |
|-------|------|-------|
| `path` | string | Page path |
| `hash` | string | Anchor name |

**Use it for:** detecting deep-share intent. High `anchor_click` count on a section means people are sharing it → that section is reference-worthy and could be its own page.

---

### `scroll_depth`

Fires once per page load when the user reaches 25 / 50 / 75 / 100% of the page. Skipped on pages shorter than ~600px scroll height.

| Field | Type | Notes |
|-------|------|-------|
| `path` | string | Page path |
| `depth` | number | Bucket reached (25, 50, 75, 100) |

**Use it for:** the classic "did they read it" question. If 100% reach on Quickstart is high but 100% on Production-Checklist is low, the latter is too long or buried.

---

### `feedback`

Fires when a user clicks 👍 Yes or 👎 No on the auto-injected "Was this page helpful?" widget at the bottom of every prose page (skipped on splash hero + 404).

| Field | Type | Notes |
|-------|------|-------|
| `path` | string | Page path |
| `vote` | string | `"yes"` or `"no"` |

**Use it for:** the most direct content-quality signal. Sort all pages by no-vote ratio → that's your prioritized improvement list.

---

## Query patterns (Umami SQL / dashboard)

Most-shared sections (deep-share intent):
```
SELECT event_data->>'path' AS path,
       event_data->>'hash' AS hash,
       count(*) AS shares
FROM event_data
WHERE event_name = 'anchor_click'
GROUP BY path, hash
ORDER BY shares DESC
LIMIT 25
```

Lowest-rated pages (content quality):
```
SELECT event_data->>'path' AS path,
       count(*) FILTER (WHERE event_data->>'vote' = 'no') AS no_votes,
       count(*) FILTER (WHERE event_data->>'vote' = 'yes') AS yes_votes,
       round(
         100.0 * count(*) FILTER (WHERE event_data->>'vote' = 'no')
         / nullif(count(*), 0), 1
       ) AS no_pct
FROM event_data
WHERE event_name = 'feedback'
GROUP BY path
HAVING count(*) >= 5
ORDER BY no_pct DESC
LIMIT 25
```

Most-copied code samples (real adoption signal):
```
SELECT event_data->>'path' AS page,
       event_data->>'lang' AS lang,
       count(*) AS copies
FROM event_data
WHERE event_name = 'code_copy'
GROUP BY page, lang
ORDER BY copies DESC
LIMIT 25
```

Search gap (queries that landed on no helpful page → users left after the search):
```
SELECT event_data->>'q' AS query,
       count(*) AS searches
FROM event_data
WHERE event_name = 'search_query'
GROUP BY query
ORDER BY searches DESC
LIMIT 50
```

Outbound destination ranking (where the traffic actually goes after docs):
```
SELECT event_data->>'host' AS host,
       count(*) AS clicks
FROM event_data
WHERE event_name = 'outbound_click'
GROUP BY host
ORDER BY clicks DESC
```

## Updating

When adding a new event:

1. Implement the listener in `apps/docs/public/umami-deep.js`
2. Add a new section to this catalog with field schema + use-case
3. Bump the file's `updated:` frontmatter

When removing a field, mark it deprecated here for one release before deleting the listener — old data in Umami still references the old shape.

## Privacy

Umami is GDPR-compliant by design (no cookies, no IP storage, no fingerprinting, all data on `analytics.reactiveagents.dev`). All custom event payloads above are non-PII (no user identifiers, only page paths and click destinations). Search queries are stored in plaintext — if a user pastes sensitive content into search, it would be logged. This is consistent with site-search analytics elsewhere.
