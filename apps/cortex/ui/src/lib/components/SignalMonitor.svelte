<script lang="ts">
  /**
   * The inspector's Signal tab: three D3 tracks (entropy η per step with the
   * signal gradient, tokens per loop, model latency) and the tool calls row.
   * Colours come from the semantic `--cortex-*` tokens read at draw time, so
   * both themes are right with no attribute overrides (spec A13); the chart
   * redraws when the theme changes. Clicking a point selects its loop.
   */
  import { onMount } from "svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import * as d3 from "d3";
  import Icon from "$lib/components/kit/Icon.svelte";
  import type { SignalData } from "$lib/stores/signal-store.js";

  interface Props {
    data: SignalData;
    onselectIteration?: (n: number) => void;
  }
  let { data, onselectIteration }: Props = $props();

  let container = $state<HTMLDivElement | undefined>(undefined);
  let svgEl = $state<SVGSVGElement | undefined>(undefined);
  let width = $state(380);
  const height = 260;
  /** Bumped when html.dark flips, so the chart re-reads the tokens. */
  let themeTick = $state(0);

  const TRACKS = [
    { label: "Entropy η", share: 0.4 },
    { label: "Tokens", share: 0.28 },
    { label: "Latency", share: 0.32 },
  ] as const;
  const TRACK_GAP = 10;
  const LABEL_W = 72;
  const uid = $props.id();
  const GRAD_ID = `${uid}-signal`;

  function token(name: string, fallback: string): string {
    if (typeof document === "undefined") return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--cortex-${name}`).trim();
    return v || fallback;
  }

  function renderChart() {
    const svg = svgEl;
    if (!svg || !data) return;
    const c = {
      track: token("surface-2", "#23262e"),
      line: token("line", "#2b2e37"),
      label: token("text-3", "#9599a5"),
      bar: token("text-3", "#9599a5"),
      accent: token("accent", "#a78bfa"),
      io: token("io", "#22d3ee"),
    };
    const font = token("font-data", "ui-monospace, monospace");

    const s = d3.select(svg);
    s.selectAll("*").remove();
    const TRACK_W = Math.max(40, width - LABEL_W);

    const allTs = [...data.entropy.map((d) => d.ts), ...data.latency.map((d) => d.ts)];
    const tMin = allTs.length > 0 ? Math.min(...allTs) : 0;
    const tMax = allTs.length > 0 ? Math.max(...allTs, tMin + 1) : 1;
    const x = d3.scaleLinear().domain([tMin, tMax]).range([4, TRACK_W - 4]);

    const defs = s.append("defs");
    const grad = defs.append("linearGradient").attr("id", GRAD_ID).attr("x1", "0%").attr("x2", "100%");
    // The signal gradient (spec section 6): violet to cyan, the agent's own signal.
    grad.append("stop").attr("offset", "0%").attr("stop-color", "#8b5cf6");
    grad.append("stop").attr("offset", "100%").attr("stop-color", "#22d3ee");

    const text = (g: d3.Selection<SVGGElement, unknown, null, undefined>, tx: number, ty: number, str: string, anchor = "start") =>
      g.append("text").attr("x", tx).attr("y", ty).attr("fill", c.label).attr("font-family", font).attr("font-size", "11px").attr("text-anchor", anchor).text(str);

    let y0 = 0;
    TRACKS.forEach((track, i) => {
      const h = Math.max(32, Math.floor(height * track.share) - TRACK_GAP);
      const g = s.append("g").attr("transform", `translate(0, ${y0})`);
      text(g, 0, h / 2 + 4, track.label);
      const tg = g.append("g").attr("transform", `translate(${LABEL_W}, 0)`);
      tg.append("rect").attr("width", TRACK_W).attr("height", h).attr("rx", 6).attr("fill", c.track).attr("stroke", c.line);

      if (i === 0) {
        const y = d3.scaleLinear().domain([0, 1]).range([h - 5, 5]);
        if (data.entropy.length === 0) {
          text(tg, TRACK_W / 2, h / 2 + 4, "no entropy yet", "middle");
        } else if (data.entropy.length === 1) {
          // One sample is still a reading (B7): a dot at its value.
          const p = data.entropy[0]!;
          tg.append("circle").attr("cx", TRACK_W / 2).attr("cy", y(p.value)).attr("r", 3.5).attr("fill", "#22d3ee");
          text(tg, TRACK_W / 2 + 8, y(p.value) + 4, `η ${p.value.toFixed(2)}`);
        } else {
          const area = d3.area<(typeof data.entropy)[0]>().x((d) => x(d.ts)).y0(h).y1((d) => y(d.value)).curve(d3.curveMonotoneX);
          const line = d3.line<(typeof data.entropy)[0]>().x((d) => x(d.ts)).y((d) => y(d.value)).curve(d3.curveMonotoneX);
          tg.append("path").datum(data.entropy).attr("d", area).attr("fill", c.accent).attr("fill-opacity", 0.12);
          tg.append("path").datum(data.entropy).attr("d", line).attr("fill", "none").attr("stroke", `url(#${GRAD_ID})`).attr("stroke-width", 2.2).attr("stroke-linecap", "round");
          tg.append("rect")
            .attr("width", TRACK_W)
            .attr("height", h)
            .attr("fill", "transparent")
            .style("cursor", "crosshair")
            .on("click", (event: MouseEvent) => {
              const [mx] = d3.pointer(event);
              const t = x.invert(mx);
              let best = data.entropy[0]!;
              for (const pt of data.entropy) if (Math.abs(pt.ts - t) < Math.abs(best.ts - t)) best = pt;
              onselectIteration?.(best.iteration ?? data.entropy.indexOf(best) + 1);
            });
        }
      } else if (i === 1) {
        if (data.tokens.length === 0) {
          text(tg, TRACK_W / 2, h / 2 + 4, "no token data", "middle");
        } else {
          const max = Math.max(...data.tokens.map((d) => d.tokens), 1);
          const y = d3.scaleLinear().domain([0, max]).range([h - 4, 4]);
          const slot = TRACK_W / data.tokens.length;
          const barW = Math.max(3, Math.min(slot * 0.6, 22));
          tg.selectAll("rect.bar")
            .data(data.tokens)
            .join("rect")
            .attr("class", "bar")
            .attr("x", (_d, k) => k * slot + (slot - barW) / 2)
            .attr("y", (d) => y(d.tokens))
            .attr("width", barW)
            .attr("height", (d) => Math.max(2, h - 4 - y(d.tokens)))
            .attr("rx", 2)
            .attr("fill", c.bar)
            .attr("fill-opacity", 0.55)
            .style("cursor", "pointer")
            .on("click", (_e, d) => onselectIteration?.(d.iteration));
          text(tg, TRACK_W - 6, 14, max >= 1000 ? `${(max / 1000).toFixed(1)}k max` : `${Math.round(max)} max`, "end");
        }
      } else {
        if (data.latency.length === 0) {
          text(tg, TRACK_W / 2, h / 2 + 4, "no latency data", "middle");
        } else {
          const max = Math.max(...data.latency.map((d) => d.value), 1);
          const y = d3.scaleLinear().domain([0, max]).range([h - 5, 5]);
          const ix = d3.scaleLinear().domain([0, Math.max(data.latency.length - 1, 1)]).range([4, TRACK_W - 4]);
          if (data.latency.length === 1) {
            tg.append("circle").attr("cx", TRACK_W / 2).attr("cy", y(data.latency[0]!.value)).attr("r", 3.5).attr("fill", c.io);
          } else {
            const line = d3.line<(typeof data.latency)[0]>().x((_d, k) => ix(k)).y((d) => y(d.value)).curve(d3.curveMonotoneX);
            tg.append("path").datum(data.latency).attr("d", line).attr("fill", "none").attr("stroke", c.io).attr("stroke-width", 1.5).attr("stroke-dasharray", "3 3");
          }
          text(tg, TRACK_W - 6, 14, max >= 1000 ? `${(max / 1000).toFixed(1)}s max` : `${Math.round(max)}ms max`, "end");
        }
      }
      y0 += h + TRACK_GAP;
    });
  }

  $effect(() => {
    void data;
    void width;
    void svgEl;
    void themeTick;
    renderChart();
  });

  onMount(() => {
    if (!container) return;
    const ro = new ResizeObserver(() => {
      if (container) width = container.clientWidth;
    });
    ro.observe(container);
    const mo = new MutationObserver(() => themeTick++);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  });

  const summary = $derived(
    `Per loop: ${data.entropy.length} entropy samples, ${data.tokens.length} token bars, ${data.latency.length} latency points, ${data.tools.length} tool calls`,
  );
</script>

<section class="sec">
  <div class="head">
    <h3>Signal</h3>
    <span class="meta">η {data.entropy.length} · tokens {data.tokens.length} · latency {data.latency.length}</span>
  </div>
  <div bind:this={container} class="chart">
    <svg bind:this={svgEl} {width} {height} role="img" aria-label={summary}></svg>
  </div>
  <p class="hint">Gradient line: entropy η (lower is more settled). Bars: tokens per loop. Dashed: model latency. Click a point to select its loop.</p>

  <h3>Tool calls</h3>
  {#if data.tools.length === 0}
    <p class="hint">No tool calls yet.</p>
  {:else}
    <div class="tools">
      {#each data.tools as tool, i (tool.tStart + i)}
        <span class="tool" data-status={tool.status} use:tooltip={`${tool.name}${tool.latencyMs ? ` · ${tool.latencyMs} ms` : ""}`}>
          {#if tool.status === "active"}<span class="dot" aria-hidden="true"></span>{:else}<Icon name={tool.status === "error" ? "alert-circle" : "check"} size="sm" />{/if}
          {tool.name}
          {#if tool.latencyMs && tool.status !== "active"}<span class="ms">{tool.latencyMs} ms</span>{/if}
        </span>
      {/each}
    </div>
  {/if}
</section>

<style>
  .sec { display: grid; gap: 8px; }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  h3 { margin: 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .meta { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .chart { width: 100%; }
  svg { display: block; width: 100%; overflow: visible; }
  .hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); line-height: var(--cortex-lh-ui); }
  .tools { display: flex; flex-wrap: wrap; gap: 6px; }
  .tool { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px; border-radius: var(--cortex-r-chip); background: var(--cortex-io-tint); color: var(--cortex-io); font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); white-space: nowrap; }
  .tool[data-status="error"] { background: var(--cortex-bad-tint); color: var(--cortex-bad); }
  .tool[data-status="active"] { background: var(--cortex-accent-tint); color: var(--cortex-accent); }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--cortex-signal); animation: sig-pulse 1.6s var(--cortex-ease-out) infinite; }
  .ms { color: var(--cortex-text-3); }
  @keyframes sig-pulse { 50% { opacity: 0.4; } }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
  :global(html[data-motion="reduce"]) .dot { animation: none; }
</style>
