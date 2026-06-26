# Awesome-List PR Drafts — Reactive Agents

**Date:** 2026-06-26 · Companion to `2026-06-26-awesome-list-submission-campaign.md`. Insertion points verified against live `main` branches 2026-06-26. **Nothing submitted.**

Each block = a complete PR package: where to edit, exact text to insert, PR title, PR body. Submit via GitHub web UI (edit file → "Create a new branch" → PR) or `gh`. Consistent description across all: *type-safe TypeScript AI agent framework on Effect-TS, MCP-native, runs the same code on local Ollama 4B+ and frontier APIs.*

Recommended order (clean + high-value first): **#1 MCP servers → #2 Jenqyang → #3 awesome-effect → #4 punkpeye → #5 kaushikb11 (caution)**.

---

## #1 — modelcontextprotocol/servers  ⭐~87.7k  (highest authority — official Anthropic)

- **File:** `ADDITIONAL.md` · **Branch:** `main`
- **Location:** section `## 📚 Frameworks` → `### For clients`. **Append as the new last line**, immediately after the `Runbear` entry (which is followed by `## 📚 Resources`).
- **Format:** `*` bullet, bold link, trailing period.

**Insert this line after the Runbear entry:**
```
* **[Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts)** - A type-safe TypeScript AI agent framework built on Effect-TS; an MCP-native client/host that runs the same code on local Ollama and frontier APIs.
```

- **PR title:** `Add Reactive Agents to Frameworks → For clients`
- **PR body:**
  ```
  Adds Reactive Agents — a type-safe TypeScript AI agent framework built on
  Effect-TS with native MCP client/host support (stdio + streamable-http).
  It connects MCP servers alongside custom tools in one registry and runs the
  same agent code on local Ollama models and frontier APIs.

  Repo: https://github.com/tylerjrbuell/reactive-agents-ts
  Docs: https://docs.reactiveagents.dev · License: MIT
  ```

---

## #2 — Jenqyang/Awesome-AI-Agents  ⭐~1.1k  (low barrier, active)

- **File:** `README.md` · **Branch:** `main`
- **Location:** section `## Frameworks`. **Append as new last entry**, after the `Aeon` entry (followed by `## Benchmark/Evaluator`).
- **Format:** `-` bullet, single line, trailing GitHub-stars badge, no period.

**Insert this line after the Aeon entry:**
```
- [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) - Type-safe, observable TypeScript AI agent framework on Effect-TS; MCP-native, A2A multi-agent, 6 reasoning strategies, runs the same code on local Ollama 4B+ and frontier APIs. ![GitHub Repo stars](https://img.shields.io/github/stars/tylerjrbuell/reactive-agents-ts?style=social)
```

- **PR title:** `Add Reactive Agents`
- **PR body:**
  ```
  Adds Reactive Agents to Frameworks — a type-safe, observable TypeScript
  agent framework on Effect-TS. MCP-native tools, A2A multi-agent, six
  reasoning strategies, and local-to-frontier portability (same code on a
  4B Ollama model and Claude/GPT/Gemini). MIT licensed.

  https://github.com/tylerjrbuell/reactive-agents-ts
  ```

---

## #3 — m9tdev/awesome-effect  ⭐~56  (near-zero competition, strong topical fit)

- **File:** `README.md` · **Branch:** `main`
- **Location:** section `## Libraries`. **Append** after the last entry (`rjdellecese/confect`).
- **Format:** `-` bullet, link text is `owner/repo`, no badge, no trailing period.

**Insert this line after the confect entry:**
```
- [tylerjrbuell/reactive-agents-ts](https://github.com/tylerjrbuell/reactive-agents-ts) - A type-safe AI agent framework built on Effect, with a 12-phase execution engine, 6 reasoning strategies, and MCP-native tool use
```

- **PR title:** `Add reactive-agents-ts`
- **PR body:**
  ```
  Adds reactive-agents-ts to Libraries — an AI agent framework built on
  Effect (Effect-TS) end to end: typed service boundaries, tagged errors,
  a 12-phase execution engine with per-phase hooks, and MCP-native tools.

  https://github.com/tylerjrbuell/reactive-agents-ts
  ```

---

## #4 — punkpeye/awesome-mcp-clients  ⭐~6.5k  (HTML-table format; append, NOT alphabetical)

- **File:** `README.md` · **Branch:** `main`
- **Location:** section `## Clients`. **Append** after the last entry (`### PraisonAI`), before `## Servers`.
- **Format:** `###` heading + HTML `<table>` of metadata + description paragraph.

**Insert this block after the PraisonAI entry:**
```
### Reactive Agents

<table>
<tr><th align="left">GitHub</th><td>https://github.com/tylerjrbuell/reactive-agents-ts</td></tr>
<tr><th align="left">Website</th><td>https://docs.reactiveagents.dev</td></tr>
<tr><th align="left">License</th><td>MIT</td></tr>
<tr><th align="left">Type</th><td>TypeScript library, CLI</td></tr>
<tr><th align="left">Platforms</th><td>Windows, MacOS, Linux</td></tr>
<tr><th align="left">Pricing</th><td>Free</td></tr>
<tr><th align="left">Programming Languages</th><td>TypeScript</td></tr>
</table>

Reactive Agents is a type-safe, observable TypeScript AI agent framework built on Effect-TS with native MCP integration (stdio + streamable-http). It features a 12-phase execution engine and 6 reasoning strategies, and runs the same code on local Ollama (4B+) models and frontier APIs, with A2A multi-agent support.
```

- **PR title:** `Add Reactive Agents to Clients`
- **PR body:**
  ```
  Adds Reactive Agents — a TypeScript AI agent framework with native MCP
  client support (stdio + streamable-http). MCP tools land in the same
  registry as custom tools. Built on Effect-TS; runs the same code on local
  Ollama and frontier APIs. MIT licensed.

  https://github.com/tylerjrbuell/reactive-agents-ts
  ```

---

## #5 — kaushikb11/awesome-llm-agents  ⭐~1.5k  ⚠️ CAUTION: machine-generated README

- **File:** `README.md` · **Branch:** `main`
- **Location:** section `## Frameworks`, between `RAI` and `Smolagents`.
- **⚠️ Before submitting:** each entry carries a live `N stars · N forks · N contributors …` line + feature sub-bullets. Checked the repo tree (2026-06-26): **no source data file** — root holds only `.markdownlint.yaml` + `.pre-commit-config.yaml`, so the README is the source of truth and you edit it directly. The stats line is likely CI/pre-commit-refreshed, so a hand-entered count is fine (their tooling updates it). Match the rich multi-line format below and `pre-commit run` locally if you clone (markdownlint is enforced).

**Best-effort entry (match the multi-line format):**
```
- [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) - Type-safe TypeScript agent framework on Effect-TS; runs identically on local Ollama and frontier APIs

  16 stars · 3 forks · TypeScript · MIT

  - 12-phase observable execution engine
  - 6 reasoning strategies (ReAct, Reflexion, Plan-Execute, ToT, Adaptive, Code-Action)
  - MCP-native tools + A2A multi-agent
  - Local-to-frontier model parity
  - End-to-end Effect-TS type safety
```
- **PR title:** `Add Reactive Agents`
- **PR body:** (note in the PR that you matched the generated format / or edited the source file)
  ```
  Adds Reactive Agents to Frameworks. If this README is generated from a
  data file, point me at it and I'll move the entry there.

  https://github.com/tylerjrbuell/reactive-agents-ts
  ```

---

## Submission mechanics (per target)

Web UI (simplest): open the file on github.com → ✏️ edit → paste the entry at the location above → "Create a new branch and start a pull request" → use the title/body above.

Or via `gh` (after forking):
```
gh repo fork <owner>/<repo> --clone
# edit the file, add the entry at the specified location
git checkout -b add-reactive-agents
git commit -am "Add Reactive Agents"
git push -u origin add-reactive-agents
gh pr create --repo <owner>/<repo> --title "<title>" --body "<body>"
```

**Etiquette:** one entry per PR, follow each repo's CONTRIBUTING, don't reopen if closed. These are maintainer-run lists — keep entries factual, no marketing superlatives.
