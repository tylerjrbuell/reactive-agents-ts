import { join } from "node:path";
import { generateProject, type ProjectTemplate } from "../generators/project-generator.js";
import { banner, fail, info, kv, section, success } from "../ui.js";

const VALID_TEMPLATES: ProjectTemplate[] = ["minimal", "standard", "full"];

export function runInit(args: string[]): void {
  const name = args[0];
  if (!name) {
    console.error(fail("Usage: rax init <project-name> [--template minimal|standard|full]"));
    process.exit(1);
  }

  let template: ProjectTemplate = "standard";
  const templateIdx = args.indexOf("--template");
  if (templateIdx !== -1 && args[templateIdx + 1]) {
    const t = args[templateIdx + 1] as ProjectTemplate;
    if (!VALID_TEMPLATES.includes(t)) {
      console.error(fail(`Invalid template: ${t}. Valid options: ${VALID_TEMPLATES.join(", ")}`));
      process.exit(1);
    }
    template = t;
  }

  const targetDir = join(process.cwd(), name);
  banner("rax init", `Creating "${name}" with template "${template}"`);
  console.log(info(`Creating project "${name}" with template "${template}"...`));

  const result = generateProject({ name, template, targetDir });

  console.log(success(`Created ${result.files.length} files:`));
  for (const file of result.files) {
    console.log(`  - ${file}`);
  }
  console.log(section("Next Steps"));
  console.log(kv("1", `cd ${name}`));
  console.log(kv("2", "bun install"));
  console.log(kv("3", "cp .env.example .env  # Add your API keys"));
  console.log(kv("4", "bun run dev"));
}
