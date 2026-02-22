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
    console.error("Error: URL is required");
    console.error("Usage: rax discover <url>");
    process.exit(1);
  }

  const agentCardUrl = url.endsWith("/") ? `${url}agent/card` : `${url}/agent/card`;

  console.log(`Fetching Agent Card from: ${agentCardUrl}\n`);

  fetch(agentCardUrl)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return res.json();
    })
    .then((card) => {
      if (asJson) {
        console.log(JSON.stringify(card, null, 2));
      } else {
        console.log("Agent Card:");
        console.log("===========");
        console.log(`Name:        ${card.name}`);
        console.log(`Description: ${card.description || "N/A"}`);
        console.log(`Version:     ${card.version}`);
        console.log(`URL:         ${card.url}`);
        console.log(`Provider:    ${card.provider?.organization || "N/A"}`);
        console.log("\nCapabilities:");
        console.log(`  Streaming:               ${card.capabilities?.streaming ? "✓" : "✗"}`);
        console.log(`  Push Notifications:      ${card.capabilities?.pushNotifications ? "✓" : "✗"}`);
        console.log(`  State Transition History: ${card.capabilities?.stateTransitionHistory ? "✓" : "✗"}`);
        
        if (card.skills?.length) {
          console.log("\nSkills:");
          for (const skill of card.skills) {
            console.log(`  - ${skill.name}: ${skill.description || "No description"}`);
          }
        }
      }
    })
    .catch((err) => {
      console.error(`Error fetching Agent Card: ${err.message}`);
      process.exit(1);
    });
}
