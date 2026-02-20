import { join } from "node:path";
import { generateProject, type ProjectTemplate } from "../generators/project-generator.js";

const VALID_TEMPLATES: ProjectTemplate[] = ["minimal", "standard", "full"];

export function runInit(args: string[]): void {
  const name = args[0];
  if (!name) {
    console.error("Usage: reactive-agents init <project-name> [--template minimal|standard|full]");
    process.exit(1);
  }

  let template: ProjectTemplate = "standard";
  const templateIdx = args.indexOf("--template");
  if (templateIdx !== -1 && args[templateIdx + 1]) {
    const t = args[templateIdx + 1] as ProjectTemplate;
    if (!VALID_TEMPLATES.includes(t)) {
      console.error(`Invalid template: ${t}. Valid options: ${VALID_TEMPLATES.join(", ")}`);
      process.exit(1);
    }
    template = t;
  }

  const targetDir = join(process.cwd(), name);
  console.log(`Creating project "${name}" with template "${template}"...`);

  const result = generateProject({ name, template, targetDir });

  console.log(`Created ${result.files.length} files:`);
  for (const file of result.files) {
    console.log(`  ${file}`);
  }
  console.log(`\nNext steps:`);
  console.log(`  cd ${name}`);
  console.log(`  bun install`);
  console.log(`  cp .env.example .env  # Add your API keys`);
  console.log(`  bun run dev`);
}
