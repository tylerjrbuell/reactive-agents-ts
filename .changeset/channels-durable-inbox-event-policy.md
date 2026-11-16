---
"@reactive-agents/channels": minor
---

Channel router: an opt-in SQLite `RouterStore` (`openSqliteRouterStore` / `makeSqliteRouterStore`) keeps every accepted message in a durable inbox (`received`, `running`, `done`, `failed`, `dropped`). Dedupe and turn caps survive a restart, turns a crash left running retry up to `maxAttempts` then fail with a `channel.inbox.failed` event, and finished rows are pruned by age and count. Router status gains `inbox` counts. Routes gain `batchWindowMs` (join one sender's burst into one turn) and `midRun` (`queue` default, `fold`, `interrupt`); `RoutedTurn.takeFolded` lets a resolver drain folded text. Defaults are unchanged. `@reactive-agents/channels` now depends on `@reactive-agents/runtime-shim`.
