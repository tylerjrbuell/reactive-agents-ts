---
type: debrief
status: completed
created: 2026-09-28
tags: [execute-backlog, bundle, gateway-generic-adapter-coverage, gateway, testing, webhook, hmac, coverage, retro]
---

# Execution Retro: gateway-generic-adapter-coverage

Date: 2026-09-28
Budget: 45 min | Actual: ~30 min
Branch: `bundle/gateway-generic-adapter-coverage` → merged to local `dev`
Commit: `6d09767f` (test)
Warden: none — `packages/gateway/**` is not in the AGENTS.md warden table. Parent executed.

## Outcomes

- Issues closed: **#227**
- Issues descoped: none (singleton)
- Net test delta: gateway **+14 tests** (123 → 137 pass; 0 fail both)
- Net LOC delta: +229 (single new test file; no source change)

## What worked

- **The sibling test was a complete template.** `github-adapter.test.ts` gave the
  helper shape (HMAC builder + request builder) and the assertion style; adapting it to
  the generic adapter's differences (bare-hex signature vs `sha256=` prefix; no
  GitHub-specific metadata) took one pass.
- **The invalid-algorithm path was reachable and tested.** `crypto.createHmac("bogus", …)`
  throws, so `Effect.try`'s `catch` produces `WebhookValidationError`; `Effect.flip`
  asserts it without a cast. That covers the adapter's only error branch.
- **Red-on-cut spot-check proved the coverage is real, not shape-only.** Temporarily
  replacing `return crypto.timingSafeEqual(...)` with `return true` made the
  wrong-same-length-signature test fail (the decisive security assertion); restored
  cleanly (0 mutation markers, no diff). This is the same "red-on-cut" discipline the
  wither batches use, applied to a coverage bundle.
- **`GatewayEvent` is a plain interface**, so fixtures needed no casts — the new file is
  0 `as unknown as` sites.

## What didn't

- **Only one test catches the timing-safe mutation.** The mutation run showed 1 fail
  (wrong same-length signature); the missing-header, length-mismatch, custom-header, and
  custom-algorithm tests all pass under it because they short-circuit before the
  comparison. That is expected, but it means the *comparison* itself has a single
  guardian. A follow-up could add a second same-length-wrong-value case for the custom
  algorithm; not worth expanding this bundle.
- **`transform`'s error branch is untestable from a normal request** (JSON-parse failure
  is swallowed by design into `payload = req.body`). Disclosed in the plan rather than
  faked.

## Skill improvements (apply on next pass)

1. **Red-on-cut spot-check for security-sensitive coverage bundles (Phase 5).** For a
   coverage bundle that protects a security-critical invariant (signature/HMAC/redaction/
   auth), do not stop at "the tests pass". Mutate the guarded line (via a `/tmp` file-swap
   or a one-line `sed`), confirm the suite goes red, then restore. This upgrades "we added
   tests" to "the tests would catch a regression". Record the fail count + which test fired
   in the retro. (Reason: 2026-09-28 #227 — mutating `crypto.timingSafeEqual(...)` → `true`
   failed the wrong-signature test, proving the assertion is load-bearing.)
2. **Sibling-file mirroring is the fastest coverage path.** When an uncovered module has a
   tested sibling (same directory, same interface), diff the two and mirror the sibling's
   test shape; the deltas (here: signature format + metadata) are the only genuinely new
   cases to design. Worth naming in the PLAN when applicable.

## Process inflation guard (HS-18/22/31 lesson)

No inflation. The issue's verified-by (grep + `ls` showing no test reference) was exact;
the "zero coverage" claim was literally true and closed by adding the missing file. No
behavioral claim was made beyond what the red-on-cut check demonstrated.
