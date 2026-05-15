# Security Policy

## Supported versions

Active development happens on `main`. Only the latest minor (currently `v0.10.x` → `v0.11.x`) receives security fixes.

| Version | Supported |
|---------|-----------|
| 0.11.x  | ✅ |
| 0.10.x  | ✅ |
| < 0.10  | ❌ |

## Reporting a vulnerability

**Do not open a public issue.** Instead, file privately via [GitHub Security Advisory](https://github.com/tylerjrbuell/reactive-agents-ts/security/advisories/new).

Include:
- Affected package + version
- Reproduction (minimal, runnable)
- Impact: what an attacker can do
- Suggested fix if you have one

## Response timeline

- Acknowledgement within **72 hours**
- Triage + initial assessment within **7 days**
- Fix + coordinated disclosure for confirmed criticals within **30 days**

## Out of scope

- Self-inflicted footguns (e.g. shipping API keys via `withTask()` content)
- Vulnerabilities in third-party LLM providers — report to the provider
- Sandbox escapes from `code-action` running with `unsafelyAllowFsAccess: true`
