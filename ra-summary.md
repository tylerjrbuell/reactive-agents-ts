# Reactive Agents TS Commit Summary (May 14, 2026)

## Key Changes

### Runtime Shim Integration
1. **Added runtime-shim package** across multiple packages:
   - Ensures compatibility with Bun and Node.js environments
   - Updated bun.lock to reflect new dependencies
2. **Cross-runtime adapter implementation**:
   - Detects runtime at module load
   - Dispatches to native Bun.* or node:* primitives (Database, spawn, writeFile, etc.)
3. **Version bump**: Runtime-shim release 0.12.0 for all packages

### Skill Persistence Enhancements
1. **SkillFragmentToSkillRecord export**:
   - Added functionality from reactive-intelligence package
2. **Dual-store implementation**:
   - Wires SkillStoreService alongside ProceduralMemoryService in local-learning.ts
   - Enables synthesized skill fragments to persist as SkillRecords

### Stackblitz Configuration Updates
1. **Node runtime support**:
   - Restored Node.js compatibility via runtime-shim
   - Updated package.json with npm@10.9.0 and engines.node>20
2. **Environment configuration**:
   - Added env block in .stackblitzrc to surface PROVIDER/API keys/MODEL/TASK
3. **Installation dependencies**:
   - Set installDependencies=true explicitly for Stackblitz demos

### Testing Improvements
1. **E2E test implementation**:
   - Proved cross-session chain: store SkillRecord via SkillStoreService
   - Reopened DB, resolver.resolve() returns the learned skill with correct metadata