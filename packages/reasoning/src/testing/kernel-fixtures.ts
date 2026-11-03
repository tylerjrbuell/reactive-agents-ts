// File: src/testing/kernel-fixtures.ts
//
// Typed fixture builders for the kernel's core shapes.
//
// Tests used to hand-build partial `KernelInput` / `KernelState` /
// `KernelRunOptions` / `KernelContext` / `KernelHooks` literals and widen them
// with a double cast. Each builder here returns a COMPLETE, valid object built
// from the kernel's own defaults (`initialKernelState`, `noopHooks`,
// `CONTEXT_PROFILES`, the real `NativeFCDriver`), so a test states only the
// fields it depends on and the compiler checks the rest.
//
// This file must stay free of double casts: that is the point of the design
// (enforced by tests/testing/kernel-fixtures.test.ts).
//
// Exported via the `@reactive-agents/reasoning/testing` subpath — test support,
// not part of the main package API.

import { Option } from "effect";
import { NativeFCDriver } from "@reactive-agents/tools";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import { CONTEXT_PROFILES } from "../context/context-profile.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelHooks,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
} from "../kernel/state/kernel-state.js";

/** Default task text used by {@link makeKernelInput}. */
export const FIXTURE_TASK = "test task";

/**
 * Build a `KernelInput`. Only `task` is required by the type; it defaults to
 * {@link FIXTURE_TASK}. Every other field stays absent unless overridden.
 */
export function makeKernelInput(overrides: Partial<KernelInput> = {}): KernelInput {
  return { task: FIXTURE_TASK, ...overrides };
}

/**
 * Build `KernelRunOptions` with the three required fields defaulted
 * (`maxIterations: 10`, `strategy: "reactive"`, `kernelType: "react"`).
 */
export function makeKernelRunOptions(
  overrides: Partial<KernelRunOptions> = {},
): KernelRunOptions {
  return { maxIterations: 10, strategy: "reactive", kernelType: "react", ...overrides };
}

/**
 * Build a `KernelState` from the kernel's own `initialKernelState` (seeded with
 * {@link makeKernelRunOptions} defaults), then apply `overrides`.
 */
export function makeKernelState(overrides: Partial<KernelState> = {}): KernelState {
  return { ...initialKernelState(makeKernelRunOptions()), ...overrides };
}

/** Build `KernelHooks`: every hook is the real `noopHooks` entry unless overridden. */
export function makeKernelHooks(overrides: Partial<KernelHooks> = {}): KernelHooks {
  return { ...noopHooks, ...overrides };
}

/** Default result-compression config, mirroring the runner's profile-derived default. */
const DEFAULT_COMPRESSION: ResultCompressionConfig = {
  budget: CONTEXT_PROFILES.mid.toolResultMaxChars ?? 800,
  previewItems: CONTEXT_PROFILES.mid.toolResultPreviewItems ?? 5,
  autoStore: true,
  codeTransform: true,
};

/**
 * Build a `KernelContext`: mid-tier profile, runner-default compression, no
 * tool or memory service, no-op hooks, and the real native-FC driver.
 */
export function makeKernelContext(overrides: Partial<KernelContext> = {}): KernelContext {
  return {
    input: makeKernelInput(),
    profile: CONTEXT_PROFILES.mid,
    compression: DEFAULT_COMPRESSION,
    toolService: Option.none(),
    hooks: noopHooks,
    toolCallingDriver: new NativeFCDriver(),
    memoryService: Option.none(),
    ...overrides,
  };
}
