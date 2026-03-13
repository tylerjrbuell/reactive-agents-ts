import { section, info, success, fail, warn, kv, spinner, box, muted } from "../ui.js";
import chalk from "chalk";

const HELP = `
  Usage: rax discover <url>

  Fetch and display a remote agent's Agent Card

  Arguments:
    <url>              URL of the remote agent (e.g., https://agent.example.com)

  Options:
    --json             Output as JSON
    --help             Show this help
`.trimEnd();

export function runDiscover(argv: string[]) {
  const args = argv.slice();

  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }

  let asJson = false;
  let url: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--json":
        asJson = true;
        break;
      default:
        if (!arg.startsWith("--") && !url) {
          url = arg;
        }
    }
  }

  if (!url) {
    console.error(fail("Error: URL is required"));
    console.error(muted("Usage: rax discover <url>"));
    process.exit(1);
  }

  const agentCardUrl = url.endsWith("/") ? `${url}agent/card` : `${url}/agent/card`;
  const spin = spinner(`Fetching Agent Card from ${agentCardUrl}`);

  fetch(agentCardUrl)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return res.json();
    })
    .then((card) => {
      spin.succeed("Agent Card retrieved");

      if (asJson) {
        console.log(JSON.stringify(card, null, 2));
        return;
      }

      console.log(section("Agent Card"));
      console.log(kv("Name", chalk.bold(card.name ?? "N/A")));
      console.log(kv("Description", card.description ?? "N/A"));
      console.log(kv("Version", card.version ?? "N/A"));
      console.log(kv("URL", card.url ?? "N/A"));
      console.log(kv("Provider", card.provider?.organization ?? "N/A"));

      console.log(section("Capabilities"));
      const cap = card.capabilities ?? {};
      const check = (v: unknown) => (v ? success("yes") : fail("no"));
      console.log(kv("Streaming", check(cap.streaming)));
      console.log(kv("Push Notifications", check(cap.pushNotifications)));
      console.log(kv("State Transition History", check(cap.stateTransitionHistory)));

      if (card.skills?.length) {
        console.log(section("Skills"));
        for (const skill of card.skills) {
          console.log(info(`${chalk.bold(skill.name)}: ${skill.description ?? "No description"}`));
        }
      }

      if (card.defaultInputModes?.length || card.defaultOutputModes?.length) {
        console.log(section("I/O Modes"));
        if (card.defaultInputModes?.length) {
          console.log(kv("Input", card.defaultInputModes.join(", ")));
        }
        if (card.defaultOutputModes?.length) {
          console.log(kv("Output", card.defaultOutputModes.join(", ")));
        }
      }
    })
    .catch((err: Error) => {
      spin.fail(`Failed to fetch Agent Card: ${err.message}`);
      process.exit(1);
    });
}
