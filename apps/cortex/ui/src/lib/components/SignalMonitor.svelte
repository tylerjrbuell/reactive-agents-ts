<script lang="ts">
  import { onMount } from "svelte";
  import * as d3 from "d3";
  import type { SignalData } from "$lib/stores/signal-store.js";

  interface Props {
    data: SignalData;
    onselectIteration?: (n: number) => void;
  }
  let { data, onselectIteration }: Props = $props();

  let container = $state<HTMLDivElement | undefined>(undefined);
  let svgEl = $state<SVGSVGElement | undefined>(undefined);
  let width = $state(600);
  let height = $state(400);

  // 3 D3 SVG tracks (tools moved to scrollable HTML row below)
  const TRACK_PROPORTIONS = [0.40, 0.28, 0.32] as const;
  const TRACK_LABELS = [
    "Entropy",
    "Tokens / Iter",
    "LLM Latency",
  ] as const;
  const TRACK_GAP = 8;
  const ENTROPY_GRAD_ID = "cortex-entropy-grad";

  function renderChart() {
    const svg = svgEl;
    if (!svg || !data) return;

    const svgD3 = d3.select(svg);
    svgD3.selectAll("*").remove();

    const W = width;
    const H = height;
    const LABEL_W = 90;
    const TRACK_W = Math.max(40, W - LABEL_W - 12);

    const allTs = [
      ...data.entropy.map((d) => d.ts),
      ...data.tokens.map((d) => d.ts),
      ...data.tools.flatMap((t) => [t.tStart, t.tEnd ?? t.tStart]),
      ...data.latency.map((d) => d.ts),
    ];
    const tMin = allTs.length > 0 ? Math.min(...allTs) : 0;
    const tMax = allTs.length > 0 ? Math.max(...allTs, tMin + 1) : 1;
    const xScale = d3.scaleLinear().domain([tMin, tMax]).range([0, TRACK_W]);

    const defs = svgD3.append("defs");
    const grad = defs.append("linearGradient").attr("id", ENTROPY_GRAD_ID).attr("x1", "0%").attr("x2", "100%");
    grad.append("stop").attr("offset", "0%").attr("stop-color", "#8b5cf6");
    grad.append("stop").attr("offset", "60%").attr("stop-color", "#f7be1d");
    grad.append("stop").attr("offset", "100%").attr("stop-color", "#f7be1d");

    let yOffset = 0;

    TRACK_PROPORTIONS.forEach((prop, trackIdx) => {
      const trackH = Math.max(24, Math.floor(H * prop) - TRACK_GAP);
      const clipId = `clip-track-${trackIdx}`;
      const g = svgD3.append("g").attr("transform", `translate(0, ${yOffset})`);

      // Clip path — prevents tool labels and spans from drawing outside track bounds
      defs.append("clipPath")
        .attr("id", clipId)
        .append("rect")
        .attr("x", 0).attr("y", -14)  // allow label text above rect
        .attr("width", TRACK_W).attr("height", trackH + 16);

      g.append("text")
        .attr("x", 0)
        .attr("y", trackH / 2 + 3)
        .attr("fill", "#888b96")
        .attr("font-family", "ui-monospace, monospace")
        .attr("font-size", "8.5px")
        .attr("text-anchor", "start")
        .text(TRACK_LABELS[trackIdx] ?? "");

      const trackG = g.append("g")
        .attr("transform", `translate(${LABEL_W}, 0)`)
        .attr("clip-path", `url(#${clipId})`);

      trackG
        .append("rect")
        .attr("width", TRACK_W)
        .attr("height", trackH)
        .attr("rx", 2)
        .attr("fill", "#0c0e12")
        .attr("stroke", "rgba(255,255,255,0.05)")
        .attr("stroke-width", 1);

      if (trackIdx === 0 && data.entropy.length > 1) {
        const yScale = d3.scaleLinear().domain([0, 1]).range([trackH - 4, 4]);
        const area = d3
          .area<(typeof data.entropy)[0]>()
          .x((d) => xScale(d.ts))
          .y0(trackH)
          .y1((d) => yScale(d.value))
          .curve(d3.curveCatmullRom);
        const line = d3
          .line<(typeof data.entropy)[0]>()
          .x((d) => xScale(d.ts))
          .y((d) => yScale(d.value))
          .curve(d3.curveCatmullRom);

        trackG
          .append("path")
          .datum(data.entropy)
          .attr("d", area)
          .attr("fill", `url(#${ENTROPY_GRAD_ID})`)
          .attr("fill-opacity", 0.15);

        trackG
          .append("path")
          .datum(data.entropy)
          .attr("d", line)
          .attr("fill", "none")
          .attr("stroke", `url(#${ENTROPY_GRAD_ID})`)
          .attr("stroke-width", 2);

        trackG
          .append("rect")
          .attr("width", TRACK_W)
          .attr("height", trackH)
          .attr("fill", "transparent")
          .style("cursor", "crosshair")
          .on("click", (event: MouseEvent) => {
            const [mx] = d3.pointer(event);
            const tClick = xScale.invert(mx);
            let best = data.entropy[0];
            let bestD = Infinity;
            for (const pt of data.entropy) {
              const d = Math.abs(pt.ts - tClick);
              if (d < bestD) {
                bestD = d;
                best = pt;
              }
            }
            const idx = data.entropy.indexOf(best);
            onselectIteration?.(best.iteration ?? idx + 1);
          });
      }

      if (trackIdx === 1) {
        if (data.tokens.length === 0) {
          trackG.append("text")
            .attr("x", TRACK_W / 2).attr("y", trackH / 2 + 4)
            .attr("text-anchor", "middle").attr("fill", "#494454")
            .attr("font-size", "9px").attr("font-family", "ui-monospace, monospace")
            .text("no token data");
        } else {
        const maxTok = Math.max(...data.tokens.map((d) => d.tokens), 1);
        const yScale = d3.scaleLinear().domain([0, maxTok]).range([trackH - 3, 3]);
        const n = data.tokens.length;
        // Iteration-based x positioning — evenly distribute bars regardless of timestamps.
        // Token bars represent "tokens per iteration", not a time-series, so iteration is
        // the natural axis. This ensures bars are always visible and spread across the track.
        const slotW = TRACK_W / n;
        const barW = Math.max(3, Math.min(slotW * 0.7, 22));

        trackG
          .selectAll("rect.bar")
          .data(data.tokens)
          .join("rect")
          .attr("class", "bar")
          .attr("x", (_d, i) => i * slotW + (slotW - barW) / 2)
          .attr("y", (d) => yScale(d.tokens))
          .attr("width", barW)
          .attr("height", (d) => Math.max(2, trackH - yScale(d.tokens)))
          .attr("fill", "#8b5cf6")
          .attr("fill-opacity", 0.8)
          .attr("rx", 1)
          .style("cursor", "pointer")
          .on("click", (_e, d) => onselectIteration?.(d.iteration));
        } // end tokens.length > 0
      }

      // trackIdx 2 = latency
      if (trackIdx === 2) {
        if (data.latency.length === 0) {
          trackG.append("text")
            .attr("x", TRACK_W / 2).attr("y", trackH / 2 + 4)
            .attr("text-anchor", "middle").attr("fill", "#494454")
            .attr("font-size", "9px").attr("font-family", "ui-monospace, monospace")
            .text("no latency data");
        } else {
        const maxMs = Math.max(...data.latency.map((d) => d.value), 1);
        const yScale = d3.scaleLinear().domain([0, maxMs]).range([trackH - 3, 3]);
        const n = data.latency.length;
        // Use iteration index for x positioning (same reasoning as tokens track)
        const iterXScale = d3.scaleLinear().domain([0, Math.max(n - 1, 1)]).range([0, TRACK_W]);

        const area = d3
          .area<(typeof data.latency)[0]>()
          .x((_d, i) => iterXScale(i))
          .y0(trackH)
          .y1((d) => yScale(d.value))
          .curve(d3.curveMonotoneX);

        const line = d3
          .line<(typeof data.latency)[0]>()
          .x((_d, i) => iterXScale(i))
          .y((d) => yScale(d.value))
          .curve(d3.curveMonotoneX);

        trackG.append("path").datum(data.latency).attr("d", area).attr("fill", "#06b6d4").attr("fill-opacity", 0.12);
        trackG
          .append("path")
          .datum(data.latency)
          .attr("d", line)
          .attr("fill", "none")
          .attr("stroke", "#06b6d4")
          .attr("stroke-width", 1.5);

        if (data.latency.length === 1) {
          trackG
            .append("circle")
            .attr("cx", TRACK_W / 2)
            .attr("cy", yScale(data.latency[0]!.value))
            .attr("r", 3.5)
            .attr("fill", "#06b6d4");
        }
        } // end latency.length > 0
      }

      yOffset += trackH + TRACK_GAP;
    });
  }

  $effect(() => {
    void data;
    void width;
    void height;
    void svgEl;
    renderChart();
  });

  onMount(() => {
    if (!container) return;
    const ro = new ResizeObserver(() => {
      if (container) {
        width = container.clientWidth;
        height = Math.max(280, container.clientHeight);
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  });
</script>

<div class="gradient-border-glow rounded-lg h-full flex flex-col min-h-[320px]">
  <div class="flex justify-between items-center px-6 py-4 flex-shrink-0">
    <h2 class="font-headline text-sm font-bold tracking-tight text-on-surface/90 uppercase">Signal Monitor</h2>
    <div class="flex gap-3 text-[9px] font-mono tabular-nums">
      <span class="{data.entropy.length > 0 ? 'text-primary/60' : 'text-outline/25'}" title="{data.entropy.length} entropy samples">
        η {data.entropy.length}
      </span>
      <span class="{data.tokens.length > 0 ? 'text-primary/60' : 'text-outline/25'}" title="{data.tokens.length} token bars">
        tok {data.tokens.length}
      </span>
      <span class="{data.latency.length > 0 ? 'text-secondary/60' : 'text-outline/25'}" title="{data.latency.length} latency points">
        lat {data.latency.length}
      </span>
    </div>
  </div>

  <!-- D3 SVG tracks (entropy + tokens + latency — no tools) -->
  <div bind:this={container} class="flex-1 relative px-4 min-h-0" style="padding-bottom:0">
    <svg bind:this={svgEl} {width} {height} class="w-full h-full overflow-visible block"></svg>
  </div>

  <!-- Tools track — separate scrollable HTML row (prevents SVG overflow/cramping) -->
  <div class="flex-shrink-0 px-4 pb-3">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-[9px] font-mono text-primary/70 uppercase tracking-widest w-[120px]">Tool Calls</span>
      {#if data.tools.length === 0}
        <span class="text-[9px] font-mono text-outline/30 italic">no tool calls yet</span>
      {/if}
    </div>
    <div
      class="h-9 bg-[#0c0e12] rounded border border-white/5 overflow-x-auto overflow-y-hidden
             scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent"
      style="min-height:36px"
    >
      <div class="flex items-center gap-1.5 h-full px-2" style="min-width: max-content;">
        {#each data.tools as tool, i (tool.tStart + i)}
          {@const isDone = tool.status !== "active"}
          {@const color = tool.status === "active" ? "bg-tertiary/80 border-tertiary/50 text-tertiary" : tool.status === "error" ? "bg-error/20 border-error/40 text-error" : "bg-secondary/20 border-secondary/40 text-secondary"}
          <div
            class="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded border text-[10px] font-mono font-medium {color} whitespace-nowrap"
            title="{tool.name}{tool.latencyMs ? ` — ${tool.latencyMs}ms` : ''}"
          >
            {#if tool.status === "active"}
              <span class="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse flex-shrink-0"></span>
            {:else if tool.status === "error"}
              <span class="material-symbols-outlined text-[11px] flex-shrink-0">error</span>
            {:else}
              <span class="material-symbols-outlined text-[11px] flex-shrink-0">check</span>
            {/if}
            {tool.name}
            {#if tool.latencyMs && isDone}
              <span class="opacity-60 text-[9px] ml-0.5">{tool.latencyMs}ms</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
