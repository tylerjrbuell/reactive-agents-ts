// Scroll-reveal choreography for the docs landing page.
// IntersectionObserver tags each .ra-stats-panel / .ra-section-card / .ra-bench
// with `.is-visible` when it enters the viewport. CSS handles the actual
// fade-up + child stagger. Stat values count up via rAF.

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

function animateCounter(el: HTMLElement, delayMs: number) {
    const raw = (el.textContent ?? '').trim()
    const target = parseInt(raw.replace(/,/g, ''), 10)
    if (!Number.isFinite(target) || target === 0) return

    if (reduced) {
        el.textContent = target.toLocaleString()
        return
    }

    const duration = 1100
    let startedAt: number | null = null
    el.textContent = '0'

    function tick(now: number) {
        if (startedAt === null) startedAt = now + delayMs
        const elapsed = now - startedAt
        if (elapsed < 0) {
            requestAnimationFrame(tick)
            return
        }
        const t = Math.min(1, elapsed / duration)
        const eased = 1 - Math.pow(1 - t, 3)
        const value = Math.floor(target * eased)
        el.textContent = value.toLocaleString()
        if (t < 1) {
            requestAnimationFrame(tick)
        } else {
            el.textContent = target.toLocaleString()
        }
    }
    requestAnimationFrame(tick)
}

function setup() {
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue
                const el = entry.target as HTMLElement
                el.classList.add('is-visible')

                if (el.classList.contains('ra-stats-panel')) {
                    const values = el.querySelectorAll<HTMLElement>('.ra-stat-value')
                    values.forEach((v, i) => animateCounter(v, 100 + i * 80))
                }

                observer.unobserve(el)
            }
        },
        {
            threshold: 0.12,
            rootMargin: '0px 0px -8% 0px',
        },
    )

    const targets = document.querySelectorAll<HTMLElement>(
        '.ra-stats-panel, .ra-section-card, .ra-bench',
    )
    targets.forEach((el) => observer.observe(el))
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup, { once: true })
} else {
    setup()
}
