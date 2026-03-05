# Contributing to Reactive Agents

Thanks for your interest! Here's how to get started.

## Setup

```bash
git clone https://github.com/tylerjrbuell/reactive-agents-ts
cd reactive-agents-ts
bun install
bun run build     # builds all 19 packages
bun test          # 1381 tests, should all pass
```

## Structure

```
packages/          19 composable packages
apps/
  docs/            Starlight docs site
  examples/        24 runnable examples (bun run apps/examples/src/...)
  meta-agent/      Community growth agent (the meta demo)
```

## Making changes

1. Pick an issue or discuss a new feature in GitHub Discussions
2. Create a feature branch
3. Write tests first (`bun test --watch`)
4. Keep package boundaries clean — each package has one job
5. Run `bun test` before opening a PR

## Key patterns

See `CLAUDE.md` for the full architecture guide.
Effect-TS patterns: `@effect-ts-patterns` skill in `.claude/skills/`
