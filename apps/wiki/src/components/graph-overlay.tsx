import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { XIcon, LocateFixedIcon } from 'lucide-react';
import { loadGraph } from '../lib/data-source';
import { ForceGraph } from './force-graph';
import { deriveGraphView, type GraphMode } from '../lib/graph-view';
import type { LinkGraph } from '../lib/types';

interface GraphOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Node id of the page to highlight in the full graph. */
  focus?: string;
  mode: GraphMode;
  onModeChange: (mode: GraphMode) => void;
}

const MODES: { id: GraphMode; label: string; hint: string }[] = [
  {
    id: 'proximity',
    label: 'Links',
    hint: 'Draw only hyperlinks; shared tags stay invisible but pull related pages closer',
  },
  { id: 'hubs', label: 'Tags', hint: 'Show each tag as a hub node linking the pages that carry it' },
];

/**
 * Full-screen Obsidian-style graph overlay. Lazy-loads the whole-wiki graph (via
 * the data-source seam — server fn live, `_data/graph.json` static) the first time
 * it opens, then renders it interactively with the current page focused. A segmented
 * control switches between the two tag view modes (see {@link GraphMode}).
 */
export function GraphOverlay({ open, onOpenChange, focus, mode, onModeChange }: GraphOverlayProps) {
  const [graph, setGraph] = useState<LinkGraph | null>(null);
  const [size, setSize] = useState({ w: 960, h: 640 });
  const [recenter, setRecenter] = useState(0);
  const obsRef = useRef<ResizeObserver | null>(null);

  // Size the canvas to the modal's own box (so the graph fills it edge to edge and
  // corner to corner). A callback ref attaches the observer the moment the portal
  // content mounts — an [open] effect would run before Radix mounts it and miss the
  // node, leaving the SVG stuck at its default size.
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    obsRef.current?.disconnect();
    obsRef.current = null;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    obsRef.current = obs;
  }, []);

  // Load the graph once, the first time the overlay is opened.
  useEffect(() => {
    if (!open || graph) return;
    let cancelled = false;
    void loadGraph()
      .then((g) => {
        if (!cancelled) setGraph(g);
      })
      .catch(() => {
        if (!cancelled) setGraph({ nodes: [], edges: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [open, graph]);

  // Re-project the base graph for the selected mode (stable identity per graph+mode).
  const view = useMemo(() => (graph ? deriveGraphView(graph, mode) : null), [graph, mode]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 h-[86vh] w-[92vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-background shadow-2xl focus:outline-none">
          {/* Title/description are for assistive tech only — no visible header bar. */}
          <Dialog.Title className="sr-only">Knowledge graph</Dialog.Title>
          <Dialog.Description className="sr-only">
            Interactive graph of every page and the links between them. Click a node to open that page.
          </Dialog.Description>

          {/* Graph fills the whole modal, to its rounded edges and corners. */}
          <div ref={measureRef} className="absolute inset-0 flex items-center justify-center bg-background">
            {view ? (
              view.nodes.length > 0 ? (
                <ForceGraph
                  nodes={view.nodes}
                  edges={view.edges}
                  focus={focus}
                  width={size.w}
                  height={size.h}
                  labels
                  interactive
                  recenterSignal={recenter}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No links between pages yet.</p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">Loading graph…</p>
            )}
          </div>

          {/* Controls float over the graph on the right with a transparent background. */}
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
            <div
              role="radiogroup"
              aria-label="Graph mode"
              className="flex rounded-md border border-border/70 p-0.5 backdrop-blur-sm"
            >
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  title={m.hint}
                  onClick={() => onModeChange(m.id)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                    mode === m.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRecenter((c) => c + 1)}
              title="Recenter on the current page and reset zoom"
              aria-label="Recenter on the current page"
              className="rounded-md p-1 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <LocateFixedIcon className="size-4" />
            </button>
            <Dialog.Close
              className="rounded-md p-1 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Close graph"
            >
              <XIcon className="size-4" />
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
