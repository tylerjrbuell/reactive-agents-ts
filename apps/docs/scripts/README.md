# Docs build scripts

Small utilities that the Astro pipeline uses to keep stats and metadata in sync. Most run automatically; some are CI gates.

## `generate-metrics.ts`

Single source of truth for drift-prone numbers ("30 packages", "5,028 tests", "12 phases", etc.).

**Auto-runs** as `prebuild` and `predev` on `apps/docs/package.json`, so every Astro build refreshes `apps/docs/src/data/metrics.json`.

**Run manually:**

```bash
bun run --cwd apps/docs metrics
```

**Output:** `apps/docs/src/data/metrics.json` (gitignored — regenerated every build).

**Inputs:**

| Stat | Derived from |
|------|-------------|
| `packages` / `packagesTotal` / `packagesPrivate` | `packages/*/package.json` (`"private": true` flag) |
| `apps` | `apps/*/package.json` |
| `testFiles` | Recursive walk for `*.test.ts` / `*.spec.ts` |
| `tests` | `apps/docs/src/data/metrics-cache.json` snapshot (committed) |
| `phases` | Paren-balanced parse of `LifecyclePhase = Schema.Literal(…)` in `packages/runtime/src/types.ts` |
| `strategies` | `packages/reasoning/src/strategies/*.ts` (filtered) |
| `providers` | `packages/llm-provider/src/providers/*.ts` (filtered) +1 for the test provider |

**Refresh the test-count snapshot** after a local `bun test`:

```bash
# After bun test reports e.g. "5,128 pass / 26 skip / 0 fail"
$EDITOR apps/docs/src/data/metrics-cache.json   # bump "tests": 5128
bun run --cwd apps/docs metrics                 # rebuild metrics.json
```

CI should refresh `metrics-cache.json` automatically on PR merge to main.

## `sync-readme-metrics.ts`

Updates the repo `README.md` stat table from the same `metrics.json`. Conservative — only rewrites lines that match expected patterns; logs a warning if a line was reworded.

**Manual sync** (writes to README.md):

```bash
bun run --cwd apps/docs metrics:sync-readme
```

**CI gate** (exits non-zero if README would change):

```bash
bun run --cwd apps/docs metrics:check
```

Add `metrics:check` to CI to fail PRs that drift the README from the docs site numbers.
