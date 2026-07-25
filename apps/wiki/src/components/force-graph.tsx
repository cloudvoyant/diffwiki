import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { GraphNode } from '../lib/types';
import type { ViewEdge } from '../lib/graph-view';

/** A node with mutable simulation coordinates (added by d3-force). */
interface SimNode extends GraphNode {
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimEdge {
  source: SimNode | string;
  target: SimNode | string;
  kind: 'link' | 'tag';
  weight: number;
  render: boolean;
}

export interface ForceGraphProps {
  nodes: GraphNode[];
  edges: ViewEdge[];
  /** Node id to highlight as the current page (optional). */
  focus?: string;
  /** SVG width/height in px. */
  width: number;
  height: number;
  /** Show node titles as labels (off for the tiny sidebar preview). */
  labels?: boolean;
  /** Enable wheel-zoom + background pan (on for the overlay). */
  interactive?: boolean;
  /** Bump this to recenter on the focus node and reset zoom (same as double-click). */
  recenterSignal?: number;
}

/** Read theme colours from CSS custom properties on <html>. */
function readColors(): { node: string; focus: string; tag: string; muted: string; edge: string; text: string } {
  if (typeof window === 'undefined') {
    return { node: '#888', focus: '#3b82f6', tag: '#c08a3e', muted: '#aaa', edge: '#8a8a8a', text: '#111' };
  }
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    node: v('--muted-foreground', '#888'),
    focus: v('--primary', '#3b82f6'),
    // Tag hubs: a distinct amber that reads on both light and dark themes.
    tag: '#c08a3e',
    muted: v('--muted-foreground', '#aaa'),
    // Edges use muted-foreground, not --border: --border is near-background (invisible).
    edge: v('--muted-foreground', '#8a8a8a'),
    text: v('--foreground', '#111'),
  };
}

interface Transform {
  k: number;
  x: number;
  y: number;
}

/**
 * Compute a transform that frames the graph inside the viewport with padding —
 * Obsidian's auto-fit. When a `focus` node is given, the view is **centred on the
 * focus** (the current article) and scaled by the largest offset from it, so the
 * focus sits dead-centre while every node still fits. Without a focus it falls back
 * to framing the bounding box. `maxK` caps how far a tiny graph is scaled up so a
 * one-node neighbourhood does not blow up to fill the canvas. Returns the identity
 * transform until the sim has assigned coordinates.
 */
function fitTransform(
  nodes: SimNode[],
  width: number,
  height: number,
  pad: number,
  maxK: number,
  focusId?: string,
): Transform {
  const pts = nodes.filter((n) => n.x != null && n.y != null);
  if (pts.length === 0) return { k: 1, x: 0, y: 0 };

  const focus = focusId ? pts.find((n) => n.id === focusId) : undefined;
  if (focus) {
    // Symmetric frame around the focus: radius = farthest node offset on each axis,
    // so the focus is centred and all nodes remain within the padded viewport.
    let rx = 1;
    let ry = 1;
    for (const n of pts) {
      rx = Math.max(rx, Math.abs(n.x! - focus.x!));
      ry = Math.max(ry, Math.abs(n.y! - focus.y!));
    }
    const k = Math.min(maxK, (width - 2 * pad) / (2 * rx), (height - 2 * pad) / (2 * ry));
    return { k, x: width / 2 - k * focus.x!, y: height / 2 - k * focus.y! };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of pts) {
    if (n.x! < minX) minX = n.x!;
    if (n.x! > maxX) maxX = n.x!;
    if (n.y! < minY) minY = n.y!;
    if (n.y! > maxY) maxY = n.y!;
  }
  const gw = Math.max(maxX - minX, 1);
  const gh = Math.max(maxY - minY, 1);
  const k = Math.min(maxK, (width - 2 * pad) / gw, (height - 2 * pad) / gh);
  return { k, x: width / 2 - k * ((minX + maxX) / 2), y: height / 2 - k * ((minY + maxY) / 2) };
}

/**
 * Presentational force-directed graph. Runs a d3-force simulation client-side
 * (dynamically imported so it never enters the SSR/initial bundle) and renders the
 * result as an SVG. CSP-safe: d3-force is pure math and we build the SVG ourselves,
 * so there is no eval. On the server it renders an empty sized SVG shell.
 */
export function ForceGraph({
  nodes,
  edges,
  focus,
  width,
  height,
  labels = false,
  interactive = false,
  recenterSignal,
}: ForceGraphProps) {
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simEdgesRef = useRef<SimEdge[]>([]);
  const simRef = useRef<{ stop: () => void; alphaTarget: (n: number) => unknown; restart: () => void } | null>(null);
  const [, setTick] = useState(0);
  const [colors, setColors] = useState(readColors);
  const [hover, setHover] = useState<string | null>(null);
  // User pan/zoom. While `userMoved` is false the view auto-fits the graph every
  // frame (so it frames itself as the sim settles); the first pan/zoom/drag hands
  // control to this stored transform, seeded from the current auto-fit so nothing jumps.
  const [transform, setTransform] = useState<Transform>({ k: 1, x: 0, y: 0 });
  const [userMoved, setUserMoved] = useState(false);
  // Mirror of the EFFECTIVE transform (auto-fit or user) for handlers that must read
  // the CURRENT pan/zoom mid-gesture rather than the value captured when it started.
  const transformRef = useRef<Transform>(transform);

  // Recenter on the focus node + reset zoom when the parent bumps `recenterSignal`
  // (the overlay's recenter button); handing control back to auto-fit does both.
  useEffect(() => {
    setUserMoved(false);
  }, [recenterSignal]);

  // Recolour on dark-mode toggle (same pattern as ArticleBody's mermaid observer).
  useEffect(() => {
    setColors(readColors());
    const obs = new MutationObserver(() => setColors(readColors()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  // Build + run the simulation whenever the data changes.
  useEffect(() => {
    let cancelled = false;
    // New data (or a resize): re-enable auto-fit so the fresh layout re-frames itself.
    setUserMoved(false);
    const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const simEdges: SimEdge[] = edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({
        source: byId.get(e.source)!,
        target: byId.get(e.target)!,
        kind: e.kind,
        weight: e.weight,
        render: e.render,
      }));
    simNodesRef.current = simNodes;
    simEdgesRef.current = simEdges;

    void (async () => {
      const d3 = await import('d3-force');
      if (cancelled) return;
      const sim = d3
        .forceSimulation(simNodes as never)
        .force(
          'link',
          d3
            .forceLink(simEdges as never)
            .id((d) => (d as SimNode).id)
            // Heavier edges (more shared tags / a link + tags) rest shorter and pull harder,
            // so more-connected pages cluster closer together.
            .distance((e) => (labels ? 90 : 46) / Math.sqrt((e as SimEdge).weight))
            .strength((e) => Math.min(0.7, 0.16 + 0.14 * (e as SimEdge).weight)),
        )
        .force('charge', d3.forceManyBody().strength(labels ? -240 : -90))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collide', d3.forceCollide(labels ? 28 : 14))
        .on('tick', () => {
          if (!cancelled) setTick((t) => t + 1);
        });
      simRef.current = sim as unknown as typeof simRef.current;
      // Cleanup happens in the outer effect's return via simRef.current?.stop();
      // this async IIFE's return value is discarded, so nothing is returned here.
    })();

    return () => {
      cancelled = true;
      simRef.current?.stop();
      simRef.current = null;
    };
  }, [nodes, edges, width, height, labels]);

  // Drag a node: pin it under the pointer, warm the simulation, release on pointerup.
  const onNodePointerDown = useCallback(
    (e: React.PointerEvent, node: SimNode) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const svg = svgRef.current;
      if (!svg) return;
      // Freeze the view at the current auto-fit so it doesn't re-frame around the
      // node while it is being dragged.
      setTransform(transformRef.current);
      setUserMoved(true);
      const toLocal = (clientX: number, clientY: number) => {
        const rect = svg.getBoundingClientRect();
        // Undo the CURRENT pan/zoom transform (read from the ref, so a wheel-zoom or
        // background-pan mid-drag keeps the pointer→simulation mapping correct).
        const t = transformRef.current;
        const sx = ((clientX - rect.left) / rect.width) * width;
        const sy = ((clientY - rect.top) / rect.height) * height;
        return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k };
      };
      const start = toLocal(e.clientX, e.clientY);
      node.fx = start.x;
      node.fy = start.y;
      simRef.current?.alphaTarget(0.3);
      simRef.current?.restart();
      const move = (ev: PointerEvent) => {
        const p = toLocal(ev.clientX, ev.clientY);
        node.fx = p.x;
        node.fy = p.y;
      };
      const up = () => {
        node.fx = null;
        node.fy = null;
        simRef.current?.alphaTarget(0);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [width, height],
  );

  const onNodeClick = useCallback(
    (node: SimNode) => {
      // Tag hubs are not pages — clicking one never navigates.
      if (node.kind === 'tag') return;
      void navigate({ to: '/$coll/$', params: { coll: node.coll, _splat: node.slug } });
    },
    [navigate],
  );

  // Wheel/trackpad-pinch zoom, anchored on the pointer so the point under the
  // cursor stays put (overlay only). macOS pinch arrives as a ctrl+wheel event.
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!interactive) return;
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const cur = transformRef.current;
      const k = Math.min(6, Math.max(0.1, cur.k * Math.exp(-e.deltaY * 0.0016)));
      const rect = svg.getBoundingClientRect();
      // Pointer in viewBox (local) units.
      const px = ((e.clientX - rect.left) / rect.width) * width;
      const py = ((e.clientY - rect.top) / rect.height) * height;
      // Keep the graph point under the cursor fixed: solve p = k*g + offset for offset.
      const x = px - (px - cur.x) * (k / cur.k);
      const y = py - (py - cur.y) * (k / cur.k);
      setUserMoved(true);
      setTransform({ k, x, y });
    },
    [interactive, width, height],
  );

  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!interactive) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      // Convert client-px drag deltas into viewBox units (the SVG may be CSS-scaled).
      const scaleX = width / rect.width;
      const scaleY = height / rect.height;
      const startX = e.clientX;
      const startY = e.clientY;
      const t0 = transformRef.current;
      const move = (ev: PointerEvent) => {
        setUserMoved(true);
        setTransform({ k: t0.k, x: t0.x + (ev.clientX - startX) * scaleX, y: t0.y + (ev.clientY - startY) * scaleY });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [interactive, width, height],
  );

  const simNodes = simNodesRef.current;
  const simEdges = simEdgesRef.current;
  // Effective transform: auto-fit (centred on the current article) until the user
  // pans/zooms/drags, then their view. A generous zoom cap + small padding lets even
  // a tiny graph fill the modal to its edges rather than sit in fat margins.
  const autoFit = fitTransform(simNodes, width, height, labels ? 24 : 12, interactive ? 4 : 2.6, focus);
  const eff = userMoved ? transform : autoFit;
  transformRef.current = eff;
  // Labels are noisy at a glance, so the default (auto-fit) view labels only the
  // current article and the hovered node. Once the user zooms in past a threshold,
  // every title appears. Gating on `userMoved` keeps the initial view sparse even
  // for a small graph that auto-fits at a high zoom.
  const showAllLabels = interactive && userMoved && eff.k >= 1.4;

  // Derive per-node view state once — shapes render in the scaled layer, labels in a
  // separate non-scaled layer so text stays a constant pixel size at any zoom.
  const labelSize = labels ? 10 : 8;
  // A node's on-screen size grows with zoom only up to this factor, then holds — so
  // nodes never balloon when zoomed far in, while keeping their relative sizes (focus
  // vs regular vs tag). Below the factor they still scale down with zoom-out.
  const nodeZoom = Math.min(eff.k, labels ? 1.25 : 1.5);
  const nodeView = simNodes.map((n) => {
    const isFocus = n.id === focus;
    const isTag = n.kind === 'tag';
    const baseR = isTag ? (labels ? 5 : 3.5) : isFocus ? (labels ? 9 : 6) : labels ? 6 : 4;
    const r = (baseR * nodeZoom) / eff.k; // graph-unit radius → on-screen baseR*nodeZoom
    const x = n.x ?? width / 2;
    const y = n.y ?? height / 2;
    return {
      n,
      isFocus,
      isTag,
      r,
      visualR: baseR * nodeZoom, // on-screen radius, for placing the (non-scaled) label below
      x,
      y,
      fill: isTag ? colors.tag : isFocus ? colors.focus : colors.node,
      showLabel: n.id === hover || (interactive && isFocus) || showAllLabels,
    };
  });

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Knowledge graph"
      className="block max-w-full touch-none select-none font-sans"
      onWheel={onWheel}
      onPointerDown={onBackgroundPointerDown}
      onDoubleClick={interactive ? () => setUserMoved(false) : undefined}
    >
      {/* Zoomed layer: edges + node shapes scale with the view transform. */}
      <g transform={`translate(${eff.x} ${eff.y}) scale(${eff.k})`}>
        {simEdges.map((e, i) => {
          if (!e.render) return null; // force-only edge (proximity mode's shared-tag pull)
          const s = e.source as SimNode;
          const t = e.target as SimNode;
          const isTag = e.kind === 'tag';
          // Thicker line for a heavier edge (more shared tags), capped so it stays legible.
          const sw = Math.min(4, 1.1 + 0.8 * (e.weight - 1));
          return (
            <line
              key={i}
              x1={s.x ?? width / 2}
              y1={s.y ?? height / 2}
              x2={t.x ?? width / 2}
              y2={t.y ?? height / 2}
              stroke={isTag ? colors.tag : colors.edge}
              strokeWidth={sw}
              strokeDasharray={isTag ? '3 3' : undefined}
              opacity={isTag ? Math.min(0.75, 0.35 + 0.12 * e.weight) : 0.45}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {nodeView.map(({ n, isFocus, isTag, r, x, y, fill }) => {
          const shared = {
            fill,
            opacity: n.id === hover || isFocus ? 1 : 0.85,
            stroke: colors.text,
            strokeWidth: 0.75,
            vectorEffect: 'non-scaling-stroke' as const,
            style: { cursor: isTag ? 'default' : 'pointer' },
            onPointerDown: (ev: React.PointerEvent) => onNodePointerDown(ev, n),
            onClick: () => onNodeClick(n),
            onPointerEnter: () => setHover(n.id),
            onPointerLeave: () => setHover((h) => (h === n.id ? null : h)),
          };
          return (
            <g key={n.id} transform={`translate(${x} ${y})`}>
              {isTag ? (
                // Tag hubs render as a diamond (rotated square) so they read as a
                // different kind of thing from the round article nodes.
                <rect x={-r} y={-r} width={r * 2} height={r * 2} transform="rotate(45)" rx={1} {...shared}>
                  <title>{n.title}</title>
                </rect>
              ) : (
                <circle r={r} {...shared}>
                  <title>{n.title}</title>
                </circle>
              )}
            </g>
          );
        })}
      </g>
      {/* Non-scaled layer: labels sit below each node at a constant screen size,
          so text does not grow or shrink when zooming/pinching. */}
      <g>
        {nodeView
          .filter((v) => v.showLabel)
          .map(({ n, isTag, visualR, x, y }) => (
            <text
              key={n.id}
              x={eff.x + x * eff.k}
              y={eff.y + y * eff.k + visualR + labelSize + 1}
              textAnchor="middle"
              fontSize={labelSize}
              fill={isTag ? colors.tag : colors.text}
              style={{ pointerEvents: 'none' }}
            >
              {n.title}
            </text>
          ))}
      </g>
    </svg>
  );
}
