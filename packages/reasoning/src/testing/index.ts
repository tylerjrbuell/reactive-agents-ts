// File: src/testing/index.ts
//
// `@reactive-agents/reasoning/testing` — typed test support for kernel
// consumers. Not part of the main package API.

export {
  FIXTURE_TASK,
  makeKernelContext,
  makeKernelHooks,
  makeKernelInput,
  makeKernelRunOptions,
  makeKernelState,
  makePlan,
  makePlanStep,
  makeRunAssessment,
  makeRunContract,
  makeStrategyServices,
  type RunAssessmentOverrides,
} from "./kernel-fixtures.js";
export {
  mockToolServiceLayer,
  succeedingToolLayer,
  failingToolLayer,
  type ToolServiceMock,
} from "./tool-service-mock.js";
