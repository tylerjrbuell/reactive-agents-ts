import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import skills from 'astro-skills'
import starlightLinksValidator from 'starlight-links-validator'
import starlightLlmsTxt from 'starlight-llms-txt'
import starlightImageZoom from 'starlight-image-zoom'
import starlightScrollToTop from 'starlight-scroll-to-top'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
    listDocsPages,
    llmsDescription,
    llmsDetails,
} from './src/agent-docs/llms-entry.ts'
import { CURRENT_VERSION } from './src/content/indicators.ts'

// llms.txt is the agent entry point: description, agent guidance and a page
// index of markdown twins (src/agent-docs/llms-entry.ts). Counts come from
// metrics.json, never typed by hand.
const docsMetrics = JSON.parse(
    readFileSync(new URL('./src/data/metrics.json', import.meta.url), 'utf8'),
)
const docsPages = listDocsPages(
    fileURLToPath(new URL('./src/content/docs', import.meta.url)),
)

export default defineConfig({
    // Docs now deploy to a custom domain at the root path.
    site: 'https://docs.reactiveagents.dev',
    base: '/',
    // Cortex owns :4321 (its API port, wired into .withCortex()) and :5173 (Vite UI);
    // docs dev and preview use :4300 so both run side by side.
    server: { port: 4300 },
    // Starlight 0.43 no longer sets :where() scoping for us, so Astro's default
    // (data-attribute, +1 specificity) would apply. Keep the pre-0.43 :where()
    // behavior so our component-scoped overrides (Header, PageSidebar,
    // EmailSubscribe, HeroStarBadge, Feedback*) keep their existing cascade
    // against Starlight's layered CSS. Astro-level option, not a starlight() one.
    scopedStyleStrategy: 'where',
    integrations: [
        skills(),
        starlight({
            title: 'Reactive Agents',
            description:
                'TypeScript agents that can finish the job on a 4B local model or a frontier API, with an evidence receipt for every run (Ed25519-signable) and a trace you can diagnose a failed run from. Built on Effect-TS.',
            social: [
                {
                    icon: 'github',
                    label: 'GitHub',
                    href: 'https://github.com/tylerjrbuell/reactive-agents-ts',
                },
                {
                    icon: 'discord',
                    label: 'Discord',
                    href: 'https://discord.gg/Mp99vQam3Q',
                },
                {
                    icon: 'npm',
                    label: 'npm',
                    href: 'https://www.npmjs.com/package/reactive-agents',
                },
            ],
            favicon: '/favicon.svg',
            logo: {
                light: './src/assets/logo-light.svg',
                dark: './src/assets/logo-dark.svg',
                replacesTitle: false,
            },
            lastUpdated: true,
            // "Edit this page on GitHub" link — community PR funnel
            editLink: {
                baseUrl:
                    'https://github.com/tylerjrbuell/reactive-agents-ts/edit/main/apps/docs/',
            },
            // Pagination is on by default in Starlight; explicit for clarity
            pagination: true,
            // Plugins — each chosen for engagement, integrity, or LLM-friendliness
            plugins: [
                // Build-time check for broken internal links. Fails the build if any
                // doc references a path that no longer exists. Free retention safety net.
                starlightLinksValidator({
                    errorOnRelativeLinks: false, // Starlight uses many relative paths; only block hard breaks
                    errorOnInvalidHashes: false, // anchors get added/renamed often; warn but don't block
                    // /playground/ is a plain Astro page (src/pages/), not a
                    // content/docs entry, so the validator can't resolve it.
                    exclude: ['/playground/'],
                }),
                // Click-to-zoom on every image. Cortex screenshots are large and
                // unreadable inline; zoom modal makes the actual UI visible.
                starlightImageZoom(),
                // Generates /llms.txt + /llms-full.txt — a flat plain-text view of
                // the entire docs site, optimized for LLM ingestion. On-brand for an
                // AI agent framework: the docs are themselves consumable by agents.
                // Per-page markdown twins (<page>.md) come from src/pages/[...slug].md.ts.
                starlightLlmsTxt({
                    projectName: 'Reactive Agents',
                    description: llmsDescription(docsMetrics.providers),
                    details: llmsDetails({
                        pages: docsPages,
                        version: CURRENT_VERSION,
                    }),
                    optionalLinks: [
                        {
                            label: 'GitHub repo',
                            url: 'https://github.com/tylerjrbuell/reactive-agents-ts',
                            description: 'Source code, issues, releases',
                        },
                        {
                            label: 'Discord',
                            url: 'https://discord.gg/Mp99vQam3Q',
                            description: 'Community support and discussion',
                        },
                    ],
                }),
                // Scroll-to-top button — zero-config, appears on long pages
                starlightScrollToTop(),
            ],
            expressiveCode: {
                themes: ['github-dark', 'github-light'],
                defaultProps: {
                    // bash/sh/shell blocks get the terminal frame by default
                    overridesByLang: {
                        bash: { frame: 'terminal' },
                        sh: { frame: 'terminal' },
                        shell: { frame: 'terminal' },
                    },
                },
            },
            customCss: ['./src/styles/custom.css'],
            // Sidebar badges (stability, New/Updated) come from page frontmatter.
            routeMiddleware: './src/route-middleware.ts',
            head: [
                // "Highlight what's new" preference, applied before first paint so
                // hidden markers never flash. Key/attribute mirror
                // src/scripts/whats-new-toggle.ts (a test pins them together).
                {
                    tag: 'script',
                    content:
                        "try{if(localStorage.getItem('ra-whats-new')==='off')document.documentElement.setAttribute('data-ra-whats-new','off')}catch(e){}",
                },
                // MUST be first + non-deferred: a service worker that injects
                // COOP/COEP client-side so the page is crossOriginIsolated. GitHub
                // Pages can't send these headers, and the StackBlitz WebContainer
                // playground iframe refuses to boot without isolation. Uses COEP
                // credentialless (Chrome) to avoid breaking cross-origin analytics.
                {
                    tag: 'script',
                    attrs: {
                        src: '/coi-serviceworker.js',
                    },
                },
                {
                    tag: 'script',
                    attrs: {
                        defer: true,
                        src: 'https://analytics.reactiveagents.dev/script.js',
                        'data-website-id':
                            '4d58acb5-d15f-428c-8e0d-9f992fc5ba91',
                        'data-domains': 'docs.reactiveagents.dev',
                    },
                },
                // Deep tracking — custom events for code copies, outbound clicks,
                // CTAs, tab switches, search queries, scroll depth, and the
                // "Was this helpful?" feedback widget. See public/umami-deep.js.
                {
                    tag: 'script',
                    attrs: {
                        defer: true,
                        src: '/umami-deep.js',
                    },
                },
                {
                    tag: 'script',
                    attrs: {
                        defer: true,
                        src: 'https://context7.com/widget.js',
                        'data-library': '/tylerjrbuell/reactive-agents-ts',
                        'data-color': '#7c3aed',
                        'data-position': 'bottom-right',
                        'data-placeholder': 'Ask about Reactive Agents...',
                    },
                },
            ],
            components: {
                // Adds per-page og:image/twitter:image + Schema.org JSON-LD on top of
                // Starlight's default head (SEO rich snippets + AEO answer-engine grounding).
                Head: './src/components/Head.astro',
                // Adds a "Playground" button to the header's right-hand group,
                // linking straight to the full-page StackBlitz editor.
                Header: './src/components/Header.astro',
                // Custom splash hero on the home page: a "code → proof" visual
                // (builder snippet resolving into a real verdict) with the brand
                // glyph kept as a small accent. Falls back to Starlight's default
                // Hero on any other splash page.
                Hero: './src/components/Hero.astro',
                PageTitle: './src/components/PageTitle.astro',
                Footer: './src/components/Footer.astro',
                // Append the release-subscribe form under the right-hand TOC on every page.
                PageSidebar: './src/components/PageSidebar.astro',
            },
            // Curated, progressive information architecture. The onboarding path
            // ("Start Here") is ordered, not alphabetical, so a new reader is never
            // dropped into a flat A–Z dump. Badges are never written here: stability
            // and New/Updated come from page frontmatter via route-middleware.ts.
            sidebar: [
                {
                    label: 'Get Started',
                    items: [
                        { label: 'Introduction', link: 'guides/introduction/' },
                        { label: 'Installation', link: 'guides/installation/' },
                        { label: 'Quickstart', link: 'guides/quickstart/' },
                        {
                            label: 'Create Reactive Agent',
                            link: 'features/create-reactive-agent/',
                        },
                        {
                            label: 'Your First Agent',
                            link: 'guides/your-first-agent/',
                        },
                        {
                            label: 'Choosing a Stack',
                            link: 'guides/choosing-a-stack/',
                        },
                        {
                            label: 'Build AI Agents in TypeScript',
                            link: 'guides/build-ai-agents-typescript/',
                        },
                    ],
                },
                {
                    label: 'Build',
                    items: [
                        {
                            label: 'LLM Providers',
                            link: 'features/llm-providers/',
                        },
                        {
                            label: 'Reasoning Strategies',
                            link: 'guides/reasoning/',
                        },
                        {
                            label: 'Choosing a Strategy',
                            link: 'guides/choosing-strategies/',
                        },
                        {
                            label: 'Plan Review',
                            link: 'guides/plan-then-execute/',
                        },
                        {
                            label: 'Tools',
                            collapsed: true,
                            items: [
                                { label: 'Overview', link: 'guides/tools/' },
                                { label: 'Built-in Tools', link: 'guides/tools/built-in-tools/' },
                                { label: 'Custom Tools', link: 'guides/tools/custom-tools/' },
                                { label: 'MCP Tools', link: 'guides/tools/mcp-tools/' },
                                { label: 'Scoping and Policy', link: 'guides/tools/scoping-and-policy/' },
                                { label: 'Execution and Results', link: 'guides/tools/execution-and-results/' },
                            ],
                        },
                        { label: 'Code Action', link: 'features/code-action/' },
                        { label: 'Prompts', link: 'features/prompts/' },
                        { label: 'Memory', link: 'guides/memory/' },
                        {
                            label: 'Typed Structured Output',
                            link: 'guides/structured-output/',
                        },
                        {
                            label: 'Multimodal Input',
                            link: 'guides/multimodal/',
                        },
                        {
                            label: 'Streaming Responses',
                            link: 'features/streaming/',
                        },
                        {
                            label: 'The Process Model',
                            link: 'features/process-model/',
                        },
                        {
                            label: 'Chat & Sessions',
                            link: 'cookbook/chat-and-sessions/',
                        },
                        { label: 'Lifecycle Hooks', link: 'guides/hooks/' },
                        {
                            label: 'Context Engineering',
                            link: 'guides/context-engineering/',
                        },
                        { label: 'Sub-Agents', link: 'guides/sub-agents/' },
                        { label: 'Agent Skills', link: 'guides/agent-skills/' },
                        { label: 'Local Models', link: 'guides/local-models/' },
                        {
                            label: 'Local Model Performance',
                            link: 'features/local-model-performance/',
                        },
                        {
                            label: 'Messaging Channels',
                            collapsed: true,
                            items: [
                                { label: 'Overview', link: 'guides/messaging-channels/' },
                                { label: 'Telegram (bot)', link: 'guides/messaging-channels/telegram/' },
                                { label: 'Signal (native)', link: 'guides/messaging-channels/signal/' },
                                { label: 'Webhook Channel', link: 'guides/messaging-channels/webhook/' },
                                { label: 'Routes', link: 'guides/messaging-channels/routes/' },
                                { label: 'Reliability and Conversations', link: 'guides/messaging-channels/reliability/' },
                                { label: 'Security and Troubleshooting', link: 'guides/messaging-channels/security-and-troubleshooting/' },
                                { label: 'Legacy MCP Setups', link: 'guides/messaging-channels/legacy-mcp-setups/' },
                            ],
                        },
                        {
                            label: 'Channel Adapters',
                            link: 'guides/channel-adapters/',
                        },
                        { label: 'Gateway', link: 'features/gateway/' },
                        {
                            label: 'A2A Protocol',
                            link: 'features/a2a-protocol/',
                        },
                        {
                            label: 'Web Integration',
                            link: 'guides/web-integration/',
                        },
                        {
                            label: 'Agentic UI Core',
                            link: 'features/agentic-ui-core/',
                        },
                    ],
                },
                {
                    label: 'Ship to Production',
                    items: [
                        {
                            label: 'Production Checklist',
                            link: 'guides/production-checklist/',
                        },
                        {
                            label: 'Deploying Agents',
                            link: 'guides/deploying-agents/',
                        },
                        {
                            label: 'Durable Execution',
                            link: 'guides/durable-execution/',
                        },
                        {
                            label: 'Durable Human-in-the-Loop',
                            link: 'guides/durable-hitl/',
                        },
                        {
                            label: 'Interaction Modes',
                            link: 'features/interaction/',
                        },
                        {
                            label: 'Cost Optimization',
                            link: 'guides/cost-optimization/',
                        },
                        {
                            label: 'Cost Tracking',
                            link: 'features/cost-tracking/',
                        },
                        { label: 'Evaluation', link: 'features/eval/' },
                        { label: 'Guardrails', link: 'guides/guardrails/' },
                        {
                            label: 'Judgment Layer',
                            link: 'features/judgment-layer/',
                        },
                        {
                            label: 'Security Hardening',
                            link: 'guides/security-hardening/',
                        },
                        {
                            label: 'Observability',
                            link: 'features/observability/',
                        },
                        { label: 'Telemetry', link: 'telemetry/' },
                        { label: 'Observe (OTel)', link: 'features/observe/' },
                        {
                            label: 'Snapshot & Replay',
                            link: 'features/snapshot-replay/',
                        },
                    ],
                },
                {
                    label: 'How It Works',
                    collapsed: true,
                    items: [
                        {
                            label: 'Architecture',
                            link: 'concepts/architecture/',
                        },
                        {
                            label: 'Agent Lifecycle',
                            link: 'concepts/agent-lifecycle/',
                        },
                        {
                            label: 'Composable Kernel',
                            link: 'concepts/composable-kernel/',
                        },
                        {
                            label: 'Layer System',
                            link: 'concepts/layer-system/',
                        },
                        {
                            label: 'Decision Tracing',
                            link: 'concepts/decision-tracing/',
                        },
                        { label: 'Effect-TS', link: 'concepts/effect-ts/' },
                        {
                            label: 'Reactive Intelligence',
                            link: 'features/reactive-intelligence/',
                        },
                        {
                            label: 'Harness Control Surface',
                            link: 'features/harness-control/',
                        },
                        {
                            label: 'Harness Control Flow',
                            link: 'features/harness-control-flow/',
                        },
                        {
                            label: 'Context Synthesis',
                            link: 'features/intelligent-context-synthesis/',
                        },
                        { label: 'Resilience', link: 'features/resilience/' },
                        {
                            label: 'Verification',
                            link: 'features/verification/',
                        },
                        {
                            label: 'Cortex Studio',
                            collapsed: true,
                            items: [
                                { label: 'Overview', link: 'features/cortex/' },
                                { label: 'Tour', link: 'features/cortex/tour/' },
                                {
                                    label: 'Chat and composer',
                                    collapsed: true,
                                    items: [
                                        { label: 'Overview', link: 'features/cortex/chat-and-composer/' },
                                        { label: 'Sessions and turns', link: 'features/cortex/chat-and-composer/sessions-and-turns/' },
                                        { label: 'Composer, Config and attachments', link: 'features/cortex/chat-and-composer/composer-and-config/' },
                                        { label: 'Plan and Execute', link: 'features/cortex/chat-and-composer/plan-and-execute/' },
                                        { label: 'Stop, compact and control', link: 'features/cortex/chat-and-composer/stop-compact-and-control/' },
                                    ],
                                },
                                { label: 'Goals, plans and loops', link: 'features/cortex/goals-plans-loops/' },
                                { label: 'Run view and traces', link: 'features/cortex/run-view-and-traces/' },
                                { label: 'Lab builder', link: 'features/cortex/lab-builder/' },
                                { label: 'Gateway and channels', link: 'features/cortex/gateway-and-channels/' },
                                { label: 'Memory and skills', link: 'features/cortex/memory-and-skills/' },
                                { label: 'Judgments and evals', link: 'features/cortex/judgments-and-evals/' },
                                { label: 'Approvals and questions', link: 'features/cortex/approvals-and-questions/' },
                                { label: 'Voice', link: 'features/cortex/voice/' },
                                { label: 'Settings and keys', link: 'features/cortex/settings-and-keys/' },
                                { label: 'Local setup recipes', link: 'features/cortex/local-setup-recipes/' },
                                { label: 'Connect your app', link: 'features/cortex/connect-your-app/' },
                            ],
                        },
                        {
                            label: 'Debrief Chat',
                            link: 'features/debrief-chat/',
                        },
                    ],
                },
                {
                    label: 'vs. Alternatives',
                    collapsed: true,
                    items: [
                        { label: 'Benchmarks', link: 'features/benchmarks/' },
                        {
                            label: 'Migrating from LangChain',
                            link: 'guides/migrating-from-langchain/',
                        },
                        {
                            label: 'vs. LangGraph',
                            link: 'guides/reactive-agents-vs-langgraph/',
                        },
                        {
                            label: 'vs. Mastra',
                            link: 'guides/reactive-agents-vs-mastra/',
                        },
                        {
                            label: 'vs. Vercel AI SDK',
                            link: 'guides/reactive-agents-vs-vercel-ai-sdk/',
                        },
                        {
                            label: 'vs. Agent SDKs (OpenAI/Claude)',
                            link: 'guides/reactive-agents-vs-agent-sdks/',
                        },
                    ],
                },
                {
                    label: 'Cookbook',
                    collapsed: true,
                    items: [{ autogenerate: { directory: 'cookbook' } }],
                },
                {
                    label: 'API Reference',
                    collapsed: true,
                    items: [
                        { label: 'Cheatsheet', link: 'reference/cheatsheet/' },
                        {
                            label: 'Builder API',
                            collapsed: true,
                            items: [
                                { label: 'Overview', link: 'reference/builder-api/' },
                                { label: 'Core, Model and Profiles', link: 'reference/builder-api/core-and-model/' },
                                { label: 'Reasoning, Tools and Skills', link: 'reference/builder-api/reasoning-and-tools/' },
                                { label: 'Memory, Learning and Context', link: 'reference/builder-api/memory-and-context/' },
                                { label: 'Safety, Quality and Approval', link: 'reference/builder-api/safety-and-quality/' },
                                { label: 'Limits, Cost and Resilience', link: 'reference/builder-api/limits-cost-resilience/' },
                                { label: 'Observability, Lifecycle and Testing', link: 'reference/builder-api/observability-and-lifecycle/' },
                                { label: 'Multi-Agent, MCP and Gateway', link: 'reference/builder-api/integrations/' },
                                { label: 'Agent: Running and Streaming', link: 'reference/builder-api/agent-runtime/' },
                                { label: 'Agent: Chat, Sessions and Run Control', link: 'reference/builder-api/agent-sessions-and-control/' },
                                { label: 'AgentResult and Debrief', link: 'reference/builder-api/agent-result/' },
                            ],
                        },
                        { label: 'Configuration Reference', link: 'reference/configuration/' },
                        { label: 'Compose API', link: 'reference/compose-api/' },
                        { label: 'Harness Tag Reference', link: 'reference/harness-tags/' },
                        { label: 'API Stability & Versioning', link: 'reference/stability/' },
                    ],
                },
                {
                    label: 'Rax CLI',
                    items: [
                        { label: 'Meet Rax CLI', link: 'guides/cli-artisan/' },
                        { label: 'Command Reference', link: 'reference/cli/' },
                        { label: 'rax diagnose', link: 'reference/cli/diagnose/' },
                    ],
                },
                {
                    label: 'Help & More',
                    items: [
                        { label: 'FAQ', link: 'guides/faq/' },
                        {
                            label: 'Troubleshooting',
                            link: 'guides/troubleshooting/',
                        },
                        { label: 'Examples Catalog', link: 'guides/examples/' },
                        {
                            label: 'Interactive Playground',
                            link: 'guides/playground/',
                        },
                        {
                            label: "What's New",
                            collapsed: true,
                            items: [
                                { label: 'Latest', link: 'guides/whats-new/' },
                                { label: 'v0.19 security and Cortex', link: 'guides/whats-new/v0-19-details/' },
                                { label: 'v0.18', link: 'guides/whats-new/v0-18/' },
                                { label: 'v0.17', link: 'guides/whats-new/v0-17/' },
                                { label: 'v0.15 and v0.16', link: 'guides/whats-new/v0-15-to-v0-16/' },
                                { label: 'v0.13 and v0.14', link: 'guides/whats-new/v0-13-to-v0-14/' },
                                { label: 'v0.11 and v0.12', link: 'guides/whats-new/v0-11-to-v0-12/' },
                                { label: 'v0.5 to v0.10', link: 'guides/whats-new/v0-5-to-v0-10/' },
                            ],
                        },
                        { label: 'Contributing', link: 'guides/contributing/' },
                    ],
                },
            ],
        }),
    ],
})
