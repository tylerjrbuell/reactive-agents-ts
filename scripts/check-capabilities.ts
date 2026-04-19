// Usage: bun run scripts/check-capabilities.ts
import { defaultInterventionRegistry } from "@reactive-agents/reactive-intelligence"
import { readFileSync } from "node:fs"

const manifest = readFileSync("CAPABILITIES.md", "utf8")

// Extract dispatched types from the "Reactive Interventions (dispatched)" section only
const dispatchedSection = manifest.match(
  /## Reactive Interventions \(dispatched\)([\s\S]*?)(?=\n##|\s*$)/
)?.[1] ?? ""
const dispatchedFromManifest = (dispatchedSection.match(/- `([\w-]+)` —/g) ?? [])
  .map((l: string) => l.match(/`([\w-]+)`/)?.[1])
  .filter(Boolean) as string[]

const registered = defaultInterventionRegistry.map((h) => h.type)
const manifestOnly = dispatchedFromManifest.filter((t) => !registered.includes(t))
const registryOnly = registered.filter((t) => !dispatchedFromManifest.includes(t))

if (manifestOnly.length > 0 || registryOnly.length > 0) {
  console.error("Capability manifest drift:")
  if (manifestOnly.length) console.error(`  In CAPABILITIES.md but no handler: ${manifestOnly.join(", ")}`)
  if (registryOnly.length) console.error(`  Handler registered but not in CAPABILITIES.md: ${registryOnly.join(", ")}`)
  process.exit(1)
}
console.log(`Capability manifest in sync (${registered.length} dispatched handlers)`)
