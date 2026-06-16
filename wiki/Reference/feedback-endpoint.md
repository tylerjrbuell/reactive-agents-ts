---
title: Feedback endpoint (Resend relay)
type: reference
created: 2026-06-16
tags: [docs-site, feedback, resend, api]
---

# Feedback endpoint — `POST /v1/feedback`

The docs-site **Feedback** button (`apps/docs/src/components/FeedbackButton.astro`)
POSTs to `https://api.reactiveagents.dev/v1/feedback`. The docs site is a
**static** Astro build (no SSR), so this handler lives in the external
`api.reactiveagents.dev` service — the same place `/v1/subscribe` lives.

This file is the drop-in handler. It relays each submission to
`tylerjrbuell@gmail.com` via Resend.

## Request contract

```jsonc
// POST /v1/feedback  (Content-Type: application/json)
{
  "message": "string (required, 1–4000 chars)",
  "email":   "string (optional — reply-to)",
  "page":    "string (optional — docs path the feedback came from)",
  "userAgent": "string (optional)",
  "source":  "string (optional — 'feedback-button' | 'page-downvote')"
}
```

`source` distinguishes the sidebar button from a "👎 No" vote on the
"Was this page helpful?" widget (the latter opens the modal pre-tailored). Surface
it in the email subject/body so downvote follow-ups are easy to triage.

Responses: `200` ok · `400` invalid body · `429` rate-limited.

## Handler (Resend)

`RESEND_API_KEY` must be set in the API service env. The "from" address must be
on a Resend-verified domain (e.g. `feedback@reactiveagents.dev`).

```ts
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

const MAX_LEN = 4000;
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );

export async function handleFeedback(req: Request): Promise<Response> {
  let body: { message?: unknown; email?: unknown; page?: unknown; userAgent?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_LEN) {
    return Response.json({ ok: false, error: "message required (1–4000 chars)" }, { status: 400 });
  }

  const email =
    typeof body.email === "string" && /.+@.+\..+/.test(body.email) ? body.email.trim() : undefined;
  const page = typeof body.page === "string" ? body.page.slice(0, 200) : "";
  const ua = typeof body.userAgent === "string" ? body.userAgent.slice(0, 300) : "";
  const source = body.source === "page-downvote" ? "page-downvote" : "feedback-button";

  // (Recommended) rate-limit by IP here → return 429 when exceeded.

  const tag = source === "page-downvote" ? "👎 page-downvote" : "feedback";
  const html = `
    <h2>New Reactive Agents feedback</h2>
    <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
    <hr/>
    <p style="color:#64748b;font-size:13px">
      Source: ${tag}<br/>
      ${email ? `Reply to: <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a><br/>` : "No contact email provided.<br/>"}
      Page: ${escapeHtml(page) || "—"}<br/>
      UA: ${escapeHtml(ua) || "—"}
    </p>`;

  try {
    await resend.emails.send({
      from: "Reactive Agents <feedback@reactiveagents.dev>",
      to: "tylerjrbuell@gmail.com",
      replyTo: email, // lets you reply straight to the user
      subject: `[RA ${source === "page-downvote" ? "👎" : "feedback"}] ${message.slice(0, 56)}${message.length > 56 ? "…" : ""}`,
      html,
      text: `${message}\n\n--\nSource: ${tag}\nReply-to: ${email ?? "none"}\nPage: ${page}\nUA: ${ua}`,
    });
  } catch (err) {
    console.error("feedback send failed", err);
    return Response.json({ ok: false, error: "send failed" }, { status: 502 });
  }

  return Response.json({ ok: true }, { status: 200 });
}
```

## CORS

The handler must allow the docs origin:

```
Access-Control-Allow-Origin: https://docs.reactiveagents.dev
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Handle the `OPTIONS` preflight with a `204`. (The `/v1/subscribe` route already
does this — mirror it.)
