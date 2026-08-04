/**
 * P5 — Calibration flywheel live probe (cogito:8b — has community profile w/ 309 samples)
 * Does the community pull actually engage? Does telemetry emit?
 */
import { ReactiveAgents } from "reactive-agents";
import { existsSync, readFileSync, rmSync } from "node:fs";

const cachePath = `${process.env.HOME}/.reactive-agents/community-profiles/cogito-8b.json`;
try { rmSync(cachePath); } catch {}
console.log("cache cleared:", !existsSync(cachePath));

const agent = await ReactiveAgents.create()
  .withName("p5-flywheel")
  .withProvider("ollama")
  .withModel("cogito:8b")
  .withCalibration("auto")
  .withReasoning({ strategy: "reactive" })
  .withTools(["calculator"])
  .withMaxIterations(5)
  .build();

const result: any = await agent.run("Use the calculator to compute 88*44 and report the value.");
console.log("=== P5 FLYWHEEL ===");
console.log("success:", result.success, "| output:", String(result.output).slice(0, 80));
console.log("community cache written:", existsSync(cachePath));
if (existsSync(cachePath)) {
  const prof = JSON.parse(readFileSync(cachePath, "utf8"));
  console.log("cached profile keys:", Object.keys(prof).join(", "));
  console.log("sampleCount:", prof.sampleCount ?? prof.profile?.sampleCount);
}
process.exit(0);
