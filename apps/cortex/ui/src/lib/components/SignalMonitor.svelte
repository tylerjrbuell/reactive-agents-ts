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

  const TRACK_PROPORTIONS = [0.3, 0.2, 0.24, 0.26] as const;
  const TRACK_LABELS = [
    "01 // Entropy",
    "02 // Tokens",
    "03 // Tools",
    "04 // LLM Latency (ms)",
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
    const LABEL_W = 120;
    const TRACK_W = Math.max(40, W - LABEL_W - 16);

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
        .attr("y", trackH / 2 + 4)
        .attr("fill", "#8b5cf6")
        .attr("font-family", "ui-monospace, monospace")
        .attr("font-size", "9px")
        .attr("letter-spacing", "0.05em")
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
            .text("awaiting LLM requests…");
        } else {
        const maxTok = Math.max(...data.tokens.map((d) => d.tokens), 1);
        const yScale = d3.scaleLinear().domain([0, maxTok]).range([trackH - 4, 4]);
        const barW = Math.max(2, Math.min(20, TRACK_W / (data.tokens.length + 1) - 2));

        trackG
          .selectAll("rect.bar")
          .data(data.tokens)
          .join("rect")
          .attr("class", "bar")
          .attr("x", (d) => xScale(d.ts))
          .attr("y", (d) => yScale(d.tokens))
          .attr("width", barW)
          .attr("height", (d) => trackH - yScale(d.tokens))
          .attr("fill", "#d0bcff")
          .attr("fill-opacity", 0.8)
          .attr("rx", 1)
          .style("cursor", "pointer")
          .on("click", (_e, d) => onselectIteration?.(d.iteration));
        } // end tokens.length > 0
      }

      if (trackIdx === 2) {
        if (data.tools.length === 0) {
          trackG.append("text")
            .attr("x", TRACK_W / 2).attr("y", trackH / 2 + 4)
            .attr("text-anchor", "middle").attr("fill", "#494454")
            .attr("font-size", "9px").attr("font-family", "ui-monospace, monospace")
            .text("no tool calls yet");
        } else {
        const spanH = 14;
        const labelH = 13; // label above span
        const totalH = spanH + labelH + 2;
        const topPad = Math.max(0, (trackH - totalH) / 2);
        const rectY = topPad + labelH + 2;

        trackG
          .selectAll("g.tool")
          .data(data.tools)
          .join("g")
          .attr("class", "tool")
          .each(function toolEach(d) {
            const gg = d3.select(this);
            const x1 = xScale(d.tStart);
            const x2 = d.tEnd !== undefined ? xScale(d.tEnd) : Math.min(TRACK_W, x1 + 40);
            const w = Math.max(12, x2 - x1);
            const color = d.status === "active" ? "#f7be1d" : d.status === "error" ? "#ffb4ab" : "#4cd7f6";

            // Span rect
            gg.append("rect")
              .attr("x", x1)
              .attr("y", rectY)
              .attr("width", w)
              .attr("height", spanH)
              .attr("rx", 3)
              .attr("fill", color)
              .attr("fill-opacity", d.status === "active" ? 0.9 : 1);

            // Tool name label — rendered ABOVE the rect, always readable
            const label = d.name.length > 16 ? d.name.slice(0, 14) + "…" : d.name;
            gg.append("text")
              .attr("x", x1 + w / 2)
              .attr("y", rectY - 3)
              .attr("text-anchor", "middle")
              .attr("fill", "#e2e2e8")
              .attr("font-size", "10px")
              .attr("font-family", "ui-monospace, monospace")
              .attr("font-weight", "500")
              .text(label);

            // Latency badge inside wide spans
            if (d.latencyMs && w > 50) {
              gg.append("text")
                .attr("x", x1 + w / 2)
                .attr("y", rectY + spanH - 3)
                .attr("text-anchor", "middle")
                .attr("fill", d.status === "active" ? "#3f2e00" : "#001f26")
                .attr("font-size", "9px")
                .attr("font-family", "ui-monospace, monospace")
                .text(`${d.latencyMs}ms`);
            }
          });
        } // end tools.length > 0
      }

      if (trackIdx === 3) {
        if (data.latency.length === 0) {
          trackG.append("text")
            .attr("x", TRACK_W / 2).attr("y", trackH / 2 + 4)
            .attr("text-anchor", "middle").attr("fill", "#494454")
            .attr("font-size", "9px").attr("font-family", "ui-monospace, monospace")
            .text("awaiting LLM requests…");
        } else {

        const maxMs = Math.max(...data.latency.map((d) => d.value), 1);
        const yScale = d3.scaleLinear().domain([0, maxMs]).range([trackH - 4, 4]);

        const area = d3
          .area<(typeof data.latency)[0]>()
          .x((d) => xScale(d.ts))
          .y0(trackH)
          .y1((d) => yScale(d.value))
          .curve(d3.curveMonotoneX);

        const line = d3
          .line<(typeof data.latency)[0]>()
          .x((d) => xScale(d.ts))
          .y((d) => yScale(d.value))
          .curve(d3.curveMonotoneX);

        trackG.append("path").datum(data.latency).attr("d", area).attr("fill", "#4cd7f6").attr("fill-opacity", 0.15);
        trackG
          .append("path")
          .datum(data.latency)
          .attr("d", line)
          .attr("fill", "none")
          .attr("stroke", "#4cd7f6")
          .attr("stroke-width", 1.5);

        if (data.latency.length === 1) {
          trackG
            .append("circle")
            .attr("cx", xScale(data.latency[0]!.ts))
            .attr("cy", yScale(data.latency[0]!.value))
            .attr("r", 3)
            .attr("fill", "#4cd7f6");
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
    <!-- Event count badges — green when data present, muted when empty -->
    <div class="flex gap-3 text-[9px] font-mono">
      <span class="{data.entropy.length > 0 ? 'text-primary/70' : 'text-outline/30'}" title="Entropy samples">
        η {data.entropy.length}
      </span>
      <span class="{data.tokens.length > 0 ? 'text-primary/70' : 'text-outline/30'}" title="Token bars">
        tok {data.tokens.length}
      </span>
      <span class="{data.tools.length > 0 ? 'text-tertiary/70' : 'text-outline/30'}" title="Tool spans">
        tools {data.tools.length}
      </span>
      <span class="{data.latency.length > 0 ? 'text-secondary/70' : 'text-outline/30'}" title="Latency points">
        lat {data.latency.length}
      </span>
    </div>
  </div>

  <div bind:this={container} class="flex-1 relative px-4 pb-4 min-h-0">
    <svg bind:this={svgEl} {width} {height} class="w-full h-full overflow-visible block"></svg>
  </div>
</div>
