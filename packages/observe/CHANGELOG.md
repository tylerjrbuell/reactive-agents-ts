# @reactive-agents/observe

## 1.0.0

### Minor Changes

-   179a25c: Initial release of `@reactive-agents/observe`. Bridges the `EventBus` `AgentEvent` stream to OpenInference-compliant OpenTelemetry spans. Covers workflow spans (`AgentStarted`/`AgentCompleted`), LLM child spans (`LLMRequestStarted`/`LLMRequestCompleted`), and tool child spans (`ToolCallStarted`/`ToolCallCompleted`). Zero-config: auto-exports if `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Ships `OpenInferenceTracerLayer` (Effect Layer), `setupOpenInferenceExporter`, and `autoConfigureExporter`.

### Patch Changes

-   Updated dependencies [d3ffc25]
-   Updated dependencies [d3ffc25]
-   Updated dependencies [1081024]
    -   @reactive-agents/core@1.0.0
