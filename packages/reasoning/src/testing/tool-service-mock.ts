// File: src/testing/tool-service-mock.ts
//
// One canonical partial `ToolService` test double, so the widening cast exists
// exactly ONCE in the repo instead of five times.
//
// `packages/runtime/test/as-unknown-as-ceiling.test.ts` §5.5 prefers "design it
// out" over bumping the ceiling. Five integration tests each carried an
// identical `… as unknown as Parameters<typeof ToolService.of>[0]` mock; the
// ceiling doc had already absorbed two of them as separate documented bumps.
// They are now one helper with one cast, and the ceiling drops rather than rises.
//
// The cast is irreducible and lives here on purpose: `ToolService` is a large
// interface and a test double implements only the handful of methods the kernel
// actually calls. The test owns the absorbing side of that widening — which is
// exactly the "canonical test-double boundary" the ceiling doc sanctions.
//
// NOT exported from the package index: test support, not public API.

import { Effect, Layer } from "effect";
import { ToolService } from "@reactive-agents/tools";

/**
 * The handful of `ToolService` methods kernel integration tests actually drive.
 *
 * The error channel is `Error`, not `unknown`: a test double that can fail with
 * anything is a silent-swallow site (see `packages/runtime/test/silent-swallow-*`).
 * Every existing mock failed with `new Error(...)`, so `Error` is faithful.
 */
export interface ToolServiceMock {
  readonly execute?: (req: { toolName: string; args?: unknown }) => Effect.Effect<unknown, Error>;
  readonly getTool?: (name: string) => Effect.Effect<unknown, Error>;
  readonly listTools?: () => Effect.Effect<readonly unknown[], Error>;
  readonly register?: () => Effect.Effect<void>;
  readonly deregister?: () => Effect.Effect<void>;
}

/**
 * A `ToolService` layer backed by a partial mock. Unspecified methods get inert
 * defaults, so a test declares only the behavior it depends on.
 */
export function mockToolServiceLayer(mock: ToolServiceMock): Layer.Layer<ToolService> {
  const impl = {
    execute: mock.execute ?? (() => Effect.succeed({ success: true, result: {} })),
    getTool:
      mock.getTool ??
      ((name: string) => Effect.succeed({ name, description: "test", parameters: [] })),
    listTools: mock.listTools ?? (() => Effect.succeed([])),
    register: mock.register ?? (() => Effect.void),
    deregister: mock.deregister ?? (() => Effect.void),
  };
  // The single sanctioned widening. Do not add another.
  return Layer.succeed(ToolService, ToolService.of(impl as unknown as Parameters<typeof ToolService.of>[0]));
}

/** A tool layer whose every call returns `result`. */
export function succeedingToolLayer(result: unknown, parameters: readonly unknown[] = []) {
  return mockToolServiceLayer({
    execute: () => Effect.succeed({ success: true, result }),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters }),
  });
}

/** A tool layer whose every call fails with `message`. */
export function failingToolLayer(message: string) {
  return mockToolServiceLayer({
    execute: () => Effect.fail(new Error(message)),
  });
}
