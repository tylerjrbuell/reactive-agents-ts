import { ReactiveAgents } from "reactive-agents";

// ─── Production-Grade Persistent Gateway Agent ─────────────────────────────
// Multi-purpose autonomous agent that delivers contextual Signal messages
// based on a sophisticated cron schedule throughout the workday and week.
//
// Cron Schedule:
//   - 09:00 on Mon-Fri: Good Morning Brief (commits + PR status)
//   - 11:30 on Mon-Fri: PR Review Reminder (active PRs needing review)
//   - 17:00 on Mon-Fri: Daily Wrap-up (commits summary + metrics)
//   - 10:00 on Saturday: Weekend Review (weekly stats)
//   - 09:30 on Monday: Weekly Metrics (cumulative progress)
//
// Environment Requirements:
//   - SIGNAL_PHONE_NUMBER: Your Signal phone number (e.g., +1234567890)
//   - GITHUB_PERSONAL_ACCESS_TOKEN: GitHub PAT with repo read access
//   - RECIPIENT_PHONE: Target recipient for Signal messages (e.g., +1234567890)
// ─────────────────────────────────────────────────────────────────────────

const RECIPIENT = process.env.RECIPIENT_PHONE

const agent = await ReactiveAgents.create()
  .withName("production-gateway-agent")
  .withProvider("ollama")
  .withModel({ model: "cogito:14b", temperature: 0.7, maxTokens: 2048 })
  .withMCP({
    name: "signal",
    transport: "stdio",
    command: "docker",
    args: [
      "run",
      "-i",
      "--rm",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--memory",
      "512m",
      "-v",
      "./signal-data:/data:rw",
      "-e",
      `SIGNAL_USER_ID=${process.env.SIGNAL_PHONE_NUMBER}`,
      "signal-mcp:local",
    ],
  })
  .withMCP({
    name: "github",
    transport: "stdio",
    command: "docker",
    args: [
      "run",
      "-i",
      "--rm",
      "-e",
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      "ghcr.io/github/github-mcp-server",
    ],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN:
        process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "",
    },
  })
  .withTools()
  .withReasoning({ defaultStrategy: "adaptive" })
  .withObservability({ verbosity: "debug", live: true, logModelIO: false })
  .withGateway({
    timezone: "America/New_York",
    heartbeat: {
      intervalMs: 30_000, // 30 seconds
      policy: "adaptive",
    },
    crons: [
      // ─── TEST CRON: Fires every minute for verification ───
      {
        schedule: "* * * * *", // Every minute
        instruction: `Test cron verification. Send a test message every minute to ${RECIPIENT} saying: "✅ Test cron fired at [current time]". Use signal/send_message_to_user with recipient '${RECIPIENT}'.`,
        enabled: false, // Set to true to enable testing
      },

      // ─── Monday-Friday Morning Briefing ───
      {
        schedule: "* * * * *", // 9:39 AM Mon-Fri
        instruction: `Your task is to send a Good morning briefing for ${RECIPIENT}. Use github/list_commits (owner: 'tylerjrbuell', repo: 'reactive-agents-ts', perPage: 10) to fetch recent commits since yesterday. Create a summary of the recent activity that includes:
1. Total commits landed overnight
2. Any major features or fixes
3. A motivational note to start the day
Then lastly, Send the morning briefing to the user using the tool signal/send_message_to_user with recipient '${RECIPIENT}'. Keep tone professional yet conversational.`,
      },

      // ─── Weekday Mid-Morning PR Review Reminder ───
      {
        schedule: "30 11 * * 1-5", // 11:30 AM Mon-Fri
        instruction: `Accountability nudge for PR reviews. Use github/list_pull_requests (owner: 'tylerjrbuell', repo: 'reactive-agents-ts', state: 'open') to fetch open PRs. Craft a message for ${RECIPIENT} that:
1. States the number of open PRs awaiting review
2. Highlights any PRs in draft status
3. Suggests a review session cadence

Send via signal/send_message_to_user with recipient '${RECIPIENT}'. Example: "🔍 PR Check: 3 PRs waiting. Review window: 12-1pm? Let's keep velocity high!"`,
      },

      // ─── Weekday Evening Wrap-up ───
      {
        schedule: "0 17 * * 1-5", // 5:00 PM Mon-Fri
        instruction: `Daily wrap-up summary for ${RECIPIENT}. Use github/list_commits (owner: 'tylerjrbuell', repo: 'reactive-agents-ts', perPage: 20) to get today's work. Summarize:
1. Total commits landed today
2. Most active contributor/category
3. Suggested next-day priority

Send via signal/send_message_to_user with recipient '${RECIPIENT}'. Keep it concise (2-3 sentences). Example: "✅ Day wrap: 8 commits to core + memory. Now at v0.5.6. Tomorrow: integration testing on A2A layer."`,
      },

      // ─── Saturday Weekend Review ───
      {
        schedule: "0 10 * * 6", // 10:00 AM Saturday
        instruction: `Weekly code review snapshot for ${RECIPIENT}. Use github/list_commits (owner: 'tylerjrbuell', repo: 'reactive-agents-ts', perPage: 50) to analyze the week. Create a "coffee-time" reflection:
1. How many commits this week vs. last week?
2. Which layers saw the most activity?
3. A celebratory note or challenge for the coming week

Send via signal/send_message_to_user with recipient '${RECIPIENT}'. Tone: encouraging + insightful. Example: "☕ Week recap: 45 commits across 5 layers. Memory + Reasoning dominated. Next week: Scout layer launch? Let's do it! 🚀"`,
      },

      // ─── Monday Weekly Metrics Dashboard ───
      {
        schedule: "30 9 * * 1", // 9:30 AM Monday
        instruction: `Cumulative progress dashboard for ${RECIPIENT}. Use github/list_commits (owner: 'tylerjrbuell', repo: 'reactive-agents-ts', perPage: 200) to compute:
1. Commits this month vs. last month
2. Test count (estimate from recent commits mentioning "tests")
3. Upcoming milestone forecast

Send via signal/send_message_to_user with recipient '${RECIPIENT}'. Make it inspiring with metrics. Example: "📊 Monday Metrics: +120 commits YTD. Tests: 1179+ across 160 files. Scout layer: 2 weeks away. Shipping Scout = $0.50→$0.10 cost ratio realized! 🎯"`,
      },
    ],

    policies: {
      dailyTokenBudget: 100_000,
      maxActionsPerHour: 50,
    },

    channels: {
      accessPolicy: "allowlist",
      allowedSenders: [RECIPIENT || ""],
      unknownSenderAction: "skip",
    },
  })
  .build();

// ─── Startup & Lifecycle Management ───────────────────────────────────────

const handle = agent.start();

console.log("🚀 Production Gateway Agent Started");
console.log(`   Recipient: ${RECIPIENT}`);
console.log("   Timezone: America/New_York (EST/EDT)");
console.log("   Scheduled Runs:");
console.log("     • 09:00 AM Mon-Fri  → Morning Brief");
console.log("     • 11:30 AM Mon-Fri  → PR Review Reminder");
console.log("     • 5:00 PM Mon-Fri   → Daily Wrap-up");
console.log("     • 10:00 AM Saturday  → Weekend Review");
console.log("     • 9:30 AM Monday     → Weekly Metrics");
console.log("   Heartbeat: Every 2 minutes (adaptive)");
console.log("");
console.log("   Press Ctrl+C to gracefully shutdown.");
console.log("");

// Graceful shutdown on SIGINT/SIGTERM
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("\n⏹️  Graceful shutdown initiated...");
  const summary = await handle.stop();

  console.log("📊 Gateway Statistics:");
  console.log(`   Total Runs: ${summary.totalRuns}`);
  console.log(`   Heartbeats Fired: ${summary.heartbeatsFired}`);
  console.log(`   Final Status: Stopped`);
  console.log("");

  await agent.dispose();
  console.log("✅ Gateway agent disposed. Goodbye!");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep alive until stopped
await handle.done;
