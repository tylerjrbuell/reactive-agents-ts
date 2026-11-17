<script lang="ts">
  import { calibrationTierHint, calibrationTiersOn, rawConfigForCalibrationTier, type CalibrationTier } from "$lib/calibration-tiers.js";
  import type { PanelAgentConfig } from "./types.js";

  interface Props {
    config: PanelAgentConfig;
  }
  let { config = $bindable() }: Props = $props();

  const tiers = $derived(calibrationTiersOn(config.rawConfig));
  const ROWS: { key: CalibrationTier; label: string; desc: string }[] = [
    { key: "learned", label: "Learned calibration", desc: "Adapt to this model from the runs recorded on this machine" },
    { key: "community", label: "Community calibration", desc: "Fetch a shared profile for this model at run start" },
  ];
</script>

{#each ROWS as row (row.key)}
  <label class="acp-check">
    <input type="checkbox"
      checked={tiers[row.key]}
      onchange={(e) => (config = { ...config, rawConfig: rawConfigForCalibrationTier(config.rawConfig, row.key, (e.currentTarget as HTMLInputElement).checked) })} />
    <span>
      <span class="acp-check-t">{row.label}</span>
      <span class="acp-hint">{row.desc}</span>
    </span>
  </label>
{/each}
<p class="acp-hint">{calibrationTierHint(config.rawConfig)}</p>
