import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import skills from 'astro-skills'
import starlightLinksValidator from 'starlight-links-validator'
import starlightLlmsTxt from 'starlight-llms-txt'
import starlightImageZoom from 'starlight-image-zoom'
import starlightScrollToTop from 'starlight-scroll-to-top'
export default defineConfig({
    // Docs now deploy to a custom domain at the root path.
    site: 'https://docs.reactiveagents.dev',
    base: '/',
    integrations: [
        skills(),
        starlight({
            title: 'Reactive Agents',
            description:
                'A composable TypeScript framework for building reliable LLM agents on a harness you fully control. The same code runs the full agent loop from a local 4B model to frontier APIs, on a typed, observable 12-phase engine. Built on Effect-TS.',
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
                }),
                // Click-to-zoom on every image. Cortex screenshots are large and
                // unreadable inline; zoom modal makes the actual UI visible.
                starlightImageZoom(),
                // Generates /llms.txt + /llms-full.txt — a flat plain-text view of
                // the entire docs site, optimized for LLM ingestion. On-brand for an
                // AI agent framework: the docs are themselves consumable by agents.
                starlightLlmsTxt({
                    projectName: 'Reactive Agents',
                    description:
                        'TypeScript AI agent framework — Effect-TS type-safe, 12-phase observable execution engine, 30 packages, runs on local Ollama through frontier APIs.',
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
            head: [
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
                PageTitle: './src/components/PageTitle.astro',
                Footer: './src/components/Footer.astro',
                // Append the release-subscribe form under the right-hand TOC on every page.
                PageSidebar: './src/components/PageSidebar.astro',
            },
            // Curated, progressive information architecture. The onboarding path
            // ("Start Here") is ordered, not alphabetical, so a new reader is never
            // dropped into a flat A–Z dump. Headline v0.12 surfaces carry a "New"
            // badge; the new-page-indicator plugin adds date-based badges on top.
            sidebar: [
                {
                    label: 'Get Started',
                    items: [
                        { label: 'Introduction', link: 'guides/introduction/' },
                        {
                            label: 'Build AI Agents in TypeScript',
                            link: 'guides/build-ai-agents-typescript/',
                        },
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
                        { label: 'Tools', link: 'guides/tools/' },
                        { label: 'Code Action', link: 'features/code-action/' },
                        { label: 'Prompts', link: 'features/prompts/' },
                        { label: 'Memory', link: 'guides/memory/' },
                        {
                            label: 'Typed Structured Output',
                            link: 'guides/structured-output/',
                            badge: { text: 'New', variant: 'success' },
                        },
                        {
                            label: 'Streaming Responses',
                            link: 'features/streaming/',
                        },
                        {
                            label: 'The Process Model',
                            link: 'features/process-model/',
                            badge: { text: 'New', variant: 'success' },
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
                            link: 'guides/messaging-channels/',
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
                            badge: { text: 'New', variant: 'success' },
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
                            label: 'Durable Execution',
                            link: 'guides/durable-execution/',
                            badge: { text: 'New', variant: 'success' },
                        },
                        {
                            label: 'Durable Human-in-the-Loop',
                            link: 'guides/durable-hitl/',
                            badge: { text: 'New ', variant: 'success' },
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
                            label: 'Security Hardening',
                            link: 'guides/security-hardening/',
                        },
                        {
                            label: 'Observability',
                            link: 'features/observability/',
                        },
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
                        { label: 'Cortex Studio', link: 'features/cortex/' },
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
                    autogenerate: { directory: 'cookbook' },
                },
                {
                    label: 'API Reference',
                    collapsed: true,
                    autogenerate: { directory: 'reference' },
                },
                {
                    label: 'Rax CLI',
                    items: [
                        { label: 'Meet Rax CLI', link: 'guides/cli-artisan/' },
                        { label: 'Command Reference', link: 'reference/cli/' },
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
                            link: 'guides/whats-new/',
                            badge: { text: 'v0.13', variant: 'success' },
                        },
                        { label: 'Contributing', link: 'guides/contributing/' },
                    ],
                },
            ],
        }),
    ],
})
