---
type: implementation-plan
status: completed
created: 2026-09-28
completed: 2026-09-28
tags: [execute-backlog, health-sweep, gateway, testing, webhook, hmac, coverage, bundle]
---

# Bundle: gateway-generic-adapter-coverage

Date: 2026-09-28
Budget: 45 min
Issues: #227
Branch: `bundle/gateway-generic-adapter-coverage` (off local `dev`)
Warden: none — `packages/gateway/**` is not in the AGENTS.md warden table. Parent executes.

## Why this bundle

`packages/gateway/src/adapters/generic-adapter.ts` (`createGenericAdapter`) is an
exported, security-sensitive webhook adapter (HMAC signature validation + payload
transform) with **zero** test-file references. Its sibling `createGitHubAdapter`
has `packages/gateway/tests/adapters/github-adapter.test.ts`; the generic adapter
has none. HMAC validation is exactly the surface that must not regress silently.

## SCAN grounding

- `grep -rln "createGenericAdapter" packages/gateway/src` → self, `services/webhook-service.ts`, `index.ts` (production only; no tests).
- `ls packages/gateway/tests/adapters/` → only `github-adapter.test.ts`.
- Baseline `bun test packages/gateway` → 123 pass / 0 fail (18 files).

## Acceptance criteria (per issue)

- **#227:** a `packages/gateway/tests/adapters/generic-adapter.test.ts` exists covering
  `createGenericAdapter`'s `source`, `validateSignature` (valid/missing/wrong/length-mismatch,
  custom header/algorithm, and the invalid-algorithm error path), `transform`
  (JSON + non-JSON body, metadata, custom sourceName), and `classify` (category + default).

## Execution units (ordered)

1. **Unit 1 — coverage (parent, ≤30 min).**
   - New `packages/gateway/tests/adapters/generic-adapter.test.ts`, mirroring the
     `github-adapter.test.ts` shape (helpers for HMAC + request construction; pure
     `Effect.runPromise` tests — no network/DOM).
   - Behavioral asserts, not implementation-detail asserts: e.g. `validateSignature`
     returns `false` for a wrong same-length signature, `false` for a length-mismatched
     one, and surfaces `WebhookValidationError` (via `Effect.flip`) when the algorithm
     is invalid; `transform` parses JSON, falls back to the raw string, and stamps
     `adapter`/`category`/`contentType`.

## Risk register

- **Tests assert current behavior incl. bugs** → acceptable for a coverage bundle; the
  goal is a regression net. Any bug found is filed, not fixed here (keeps scope clean).
- **Cast ceiling** → new test must add 0 `as unknown as` sites; construct `GatewayEvent`
  literals directly (it is a plain interface).
- **`transform` error path unreachable** → `transform` swallows JSON-parse failures by
  design (`payload = req.body`), so `WebhookTransformError` cannot be forced from a
  normal request; documented, not tested.

## Verification protocol (cross-cutting)

- `bun test packages/gateway` — ≥123 + N pass / 0 fail
- `bunx turbo run typecheck --filter=@reactive-agents/gateway` — green
- `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts` — new test contributes 0
- `bun run build` — 38/38

## Baseline

- `bun test packages/gateway` → 123 pass / 0 fail (18 files)

## Out-of-scope (explicit)

- Fixing any bug the tests may surface (file separately)
- Non-generic adapters, webhook-service integration
- `#214` cast ceiling

## Outcome

- Commit `6d09767f` (14 tests) merged to local `dev`.
- gateway `137 pass / 0 fail` (baseline 123 + 14); targeted `14/0`; gateway
  typecheck green; workspace typecheck `68/68`; build `38/38`.
- New file contributes **0** `as unknown as` sites (tests-scope ratchet unchanged at 266).
- **Red-on-cut spot-check:** mutating `crypto.timingSafeEqual(...)` → `true` failed the
  wrong-same-length-signature test (1 fail), proving the assertion is load-bearing;
  restored cleanly.
- `bun run test` red is the pre-existing `@reactive-agents/runtime#test` (#214 cast
  ceiling) — unrelated.
- Retro: [[Research/Debriefs/2026-09-28-gateway-generic-adapter-coverage-execution-debrief]]
