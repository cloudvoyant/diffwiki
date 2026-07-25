import { useEffect, useMemo, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { ForceGraph } from './force-graph';
import { GraphOverlay } from './graph-overlay';
import { deriveGraphView, toGraphMode, DEFAULT_GRAPH_MODE, type GraphMode } from '../lib/graph-view';
import type { LocalGraph } from '../lib/types';

interface KnowledgeGraphProps {
  /** The current page's local neighbourhood (from `page.graph`). */
  graph: LocalGraph;
}

const MODE_KEY = 'diffwiki:graph-mode';

function readStoredMode(): GraphMode {
  if (typeof window === 'undefined') return DEFAULT_GRAPH_MODE;
  return toGraphMode(window.localStorage.getItem(MODE_KEY));
}

/**
 * Right-sidebar knowledge-graph panel, shown above the TOC. Renders the current
 * page's local neighbourhood as a small force-directed preview; clicking it (or the
 * expand button) opens the full-screen Obsidian-style overlay of the whole wiki.
 * The view mode (links-with-tag-proximity / tag hubs) is shared with the overlay
 * and persisted, so the preview and the expanded graph always agree.
 */
export function KnowledgeGraph({ graph }: KnowledgeGraphProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<GraphMode>(readStoredMode);

  useEffect(() => {
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* private mode / storage disabled — the mode just won't persist */
    }
  }, [mode]);

  const view = useMemo(() => deriveGraphView({ nodes: graph.nodes, edges: graph.edges }, mode), [graph, mode]);

  return (
    <div className="group relative mb-6">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open knowledge graph"
        className="block w-full overflow-hidden rounded-lg border border-border bg-background transition-colors hover:bg-muted/40"
      >
        {view.nodes.length > 0 ? (
          <ForceGraph nodes={view.nodes} edges={view.edges} focus={graph.focus} width={256} height={180} />
        ) : (
          <div className="flex h-[180px] items-center justify-center px-3 text-center text-xs text-muted-foreground">
            No links on this page yet.
          </div>
        )}
      </button>
      {/* Expand affordance floats in the widget's top-right corner. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute right-1.5 top-1.5 rounded-md bg-background/70 p-1 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring group-hover:opacity-100"
        aria-label="Expand knowledge graph"
      >
        <Maximize2 className="size-3.5" />
      </button>
      <GraphOverlay open={open} onOpenChange={setOpen} focus={graph.focus} mode={mode} onModeChange={setMode} />
    </div>
  );
}
