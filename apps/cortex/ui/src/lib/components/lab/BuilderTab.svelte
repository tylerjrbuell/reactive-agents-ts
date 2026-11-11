<script lang="ts">
  import AgentConfigPanel from "$lib/components/AgentConfigPanel.svelte";
  import LaunchPanel from "./LaunchPanel.svelte";
  import type { BuilderAdHocAction, BuilderAgentConfig } from "$lib/lab-builder.js";

  interface Props {
    config: BuilderAgentConfig;
    agentType?: "ad-hoc" | "persistent";
    name?: string;
    schedule?: string;
    adHocAction?: BuilderAdHocAction;
    running: boolean;
    saving: boolean;
    onExecute: () => void | Promise<void>;
    onCreatePersistent: () => void | Promise<void>;
    onExport: () => void;
  }
  let {
    config = $bindable(), agentType = $bindable("ad-hoc"), name = $bindable(""), schedule = $bindable(""), adHocAction = $bindable("save-run"),
    running, saving, onExecute, onCreatePersistent, onExport,
  }: Props = $props();
</script>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-6 sm:pb-10 sm:pt-5">
      <div class="mx-auto w-full max-w-5xl space-y-6 xl:max-w-6xl 2xl:max-w-7xl">
        <div class="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] lg:items-start lg:gap-8">
          <!-- Task + identity (narrow column on large screens — uses width instead of one skinny center column) -->
          <LaunchPanel
            bind:config
            bind:agentType
            bind:name
            bind:schedule
            bind:adHocAction
            {running}
            {saving}
            {onExecute}
            {onCreatePersistent}
            {onExport}
          />

          <div class="min-w-0">
            <AgentConfigPanel bind:config />
          </div>
        </div>
      </div>
    </div>
