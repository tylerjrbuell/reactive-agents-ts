# Cortex docs screenshots

Generates the Cortex images for the docs and the README from a hermetic demo Cortex.
No keys, no network, no real data: the agents run on the scripted `test` provider, and everything
lives in a temp directory. `~/.reactive-agents` and your real `.cortex/` are never read or written.

## Run

```bash
bun run --cwd apps/cortex build:ui                         # the shots show ui/build: rebuild first after UI changes
bun run --cwd apps/cortex screenshots:docs                 # every stable shot
bun run --cwd apps/cortex screenshots:docs --only tools-lab,channels-hub
bun run --cwd apps/cortex screenshots:docs --include-pending   # also shots whose UI is still moving
bun run --cwd apps/cortex screenshots:docs --out /tmp/a   # write somewhere else
bun run --cwd apps/cortex screenshots:docs --out /tmp/b --compare /tmp/a   # determinism check
```

Output: `apps/docs/public/screens/cortex/<id>.webp` and `manifest.json` (file, status, caption, alt text,
route, size, sha256, note; Cortex version from `VERSION`, capture date). A run only rewrites the shots it
captured; other manifest entries keep their last values.

## What it does

1. Wipes the demo dir (`/tmp/cortex-docs-demo`, `DEMO_DIR`). Every process is spawned with `HOME` set to it:
   Bun reads `HOME` for `os.homedir()` once, at start, so setting it later does nothing. `demo-server.ts` and
   `seed.ts` refuse to run unless `homedir()` is the demo dir (fail closed). Provider key env vars are removed.
2. Shots are grouped by dataset, each wiped and seeded on its own: `empty` (no data: the Beacon first-run view and
   Settings), `demo`, `board` (the `demo` seed in a separate run, so the plan Execute shot's runs cannot change what Beacon
   lists) and `chat` (`seed-chat.ts`: two chats, one finished turn with a tool call and one empty, kept apart so the
   other chat shots' sidebar does not change).
3. For `demo` and `board`: `seed.ts` writes chat states BEFORE the server starts (a pending approval is restored from the durable
   store when the server boots), then `demo-server.ts` starts Cortex on port 4399 (`DEMO_PORT`), then `seed-http.ts` adds
   what needs the API: two MCP servers that connect (`fake-mcp.ts` over stdio) and one that fails, a webhook channel that
   runs plus Telegram and Signal channels saved switched off.
4. `run.ts` drives the built UI with Playwright at 1440x900 @2x, dark theme, UTC, a frozen browser clock, then writes
   WebP downscaled to 1440 wide (sharp, quality 82, budget 200 KB).

Readability crops: a shot with `crop: { x, y, width, height, shows }` (CSS px at 1x, about 960x600) also writes
`<id>--crop.webp`, cut from the 2x capture and shown at the crop's own width, so text stays legible when a page shows it at
480 to 820 px wide (the home and README galleries). The manifest gets a `<id>--crop` entry with the shot's alt and caption plus
`shows`, `variantOf` and the crop box. Full shots stay. Each file is held to 200 KB.

Seeded chat states (`seed.ts`): a plan-mode chat (run for real by the Execute shot), a durable run the person stopped
(a real Stop through the chat control), a run that spent its step budget (real, the framework's own stop), and a
durable turn paused on a `file-write` approval.

The manifest is written to a temp file and renamed, so an interrupted run never leaves a half file.

Shots that replace the old hand-taken docs images: `beacon-board`, `beacon-field`, `chat-session`, `chat-composer`,
`chat-config-popover` (Config opens the composer's slash-command list, the same one typing `/` opens) and `settings-voice`
(default settings, no keys).

## Prerequisites

- A built UI (`build:ui`).
- `playwright-core` (a devDependency of `apps/cortex`, pinned to 1.61.1; `bun install` provides it, no browser is
  downloaded) and a Chromium from `~/.cache/ms-playwright` (`bunx playwright-core install chromium` if missing). The bun
  cache copy is only a fallback when the package is not installed. Nothing is downloaded by the script.
- `sharp` (already in the repo's `node_modules`).

## Determinism rules

- Fixed viewport, scale, scheme, locale, timezone; caret hidden; toasts hidden (they carry run ids).
- Reduced motion on and animations disabled, except a shot with `motion: "full"`: its capture freezes every CSS animation
  at a fixed time (`freezeAnimations`, the Beacon uses 2.0 s). JS-driven motion would not be frozen: `--compare` catches it.
- Browser clock frozen after the seed, so relative times read "just now".
- The chat list order is pinned at the end of `seed.ts` (`last_used_at`, one second apart): the seed's own turns finish in a
  racy order, which reordered the sidebar between runs. The chat speed readout (`data-testid="turn-speed"`) and the run view's
  Speed tile exist only when timing resolved, so both are hidden.
- Text that varies between runs (random ids, pids, secret tails, measured ms, event numbers) is replaced with fixed
  text by `MASKS` in `shots.ts`; a readout that exists only some of the time is hidden with a shot's `hideText`.
  If `--compare` reports a changed image, find the region (`magick compare ... -threshold`), add a rule, run again.
- Never add a shot that needs a real key, a real network call or a personal path.

## Add a shot

Add an entry to `SHOTS` in `shots.ts`: `id`, `route`, `caption`, `alt`, optional `width`/`height`/`scheme`/`dataset`/
`motion`/`note`, and `capture({ page, base, sessionId, runId })` that navigates and waits for the state (wait on text,
never on timeouts alone). Seed anything new in `seed.ts` (chat state) or `seed-http.ts` (API). Mark it `status: "pending"`
until its UI is final; pending shots are skipped unless named with `--only` or `--include-pending`. Then run `--only <id>`
twice with `--compare`.

## Captions must stay true

- State only what the shot shows. "On by default" is used only where the code says so: durable runs
  (`server/services/durable-default.ts`, `ui/src/lib/durable-runs.ts`; the framework default stays off) and learned and community
  calibration being OFF by default (`packages/runtime/src/builder/withers/calibration.ts`).
- The plan, stop, budget and approval shots use the scripted provider: step results are scripted, so captions describe the
  UI, not model quality.

## Refresh at release

Rebuild the UI, run `screenshots:docs`, read every image back (no keys, tokens, usernames or personal paths), run it twice with
`--compare`, commit the images and `manifest.json` together.

## Known limits

- `chat-plan-executed` runs the plan with Plan-execute-reflect: with the scripted provider, Auto ran as a plain Execute turn
  and Blueprint returned no per-step results. The plan card does not stay in the thread after the run in this flow; the shot
  shows the reply and the to-do list ticked off.
- `model-calibration` shows `ollama/qwen3:14b`, a model with a shipped calibration. `seed.ts` writes 8 synthetic run observations
  (`appendObservation`) and one `calibration.db` row (`CalibrationStore.save`) into the demo home, never the real
  `~/.reactive-agents`, so three settings read "Learned" and the page shows "applied only when learned calibration is on".
  The values are made up to show the label; they say nothing about the model.
- The run-cause diagnosis on a step-budget stop reads "At fault: Harness: tool call dropped" (the call the cap cut off). That is the
  framework's own answer, not a script artifact, but check the wording before using the image beside a claim.
- Dark theme only.
