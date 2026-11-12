---
type: decision
status: proposed
created: 2026-11-12
tags: [decision, channels, routing, security, cortex]
---

# Channel routing: the five open questions

**Status: proposed (adviser-reviewed), owner may override.** Spec: [[../Architecture/Design-Specs/2026-11-12-channel-routing]]. Each answer below is the default the spec is written against.

## 1. Tool access for senders
New routes default non-owner senders to `ReadOnly` (a tool classification, not a name list). Migrated routes keep full tools only for senders already in the legacy allowlist; everyone else is `ReadOnly`. A visible "unrestricted senders" flag and a warning list mark every migrated route that keeps full tools.

## 2. Agent spin-up
On-demand: build the (route, role) agent on the first turn, persist history, dispose after idle. Warm pool is deferred. No idle number is set until it is measured in the first slice.

## 3. Risky-tool approval
Route owners only, by DM, `approve <id>` / `deny <id>`; random id of at least 32 bits bound to (route, requester, tool, argsHash); denied after 10 minutes; summary generated deterministically from tool args. No owner configured means risky tools are blocked. Owners are added only from a local surface (builder code or Cortex behind loopback/token), never from a message.

## 4. Durable router state
In-memory by default. Seen-ids and in-flight markers persist automatically whenever a `Database` is available (Cortex always); otherwise the router warns at startup that dedupe and budgets reset on restart.

## 5. Legacy config and API
`.withChannels` is permanent. `config.channels` is removed one minor release after the migration and its rollback test ship.

## Also recorded (adviser changes)
Account lease per credential fingerprint (second owner fails with `ChannelAlreadyOwned`); `open` routes require cost and turn caps; scope cut to a minimal first slice in `packages/channels`; workflow alignment moves to the workflows spec.
