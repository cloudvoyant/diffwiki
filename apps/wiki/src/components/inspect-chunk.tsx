import { ScanText } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import type { SearchResultItem } from '../lib/types';

interface InspectChunkProps {
  /** The search hit to inspect. Renders nothing when it carries no raw chunk. */
  result: SearchResultItem;
  /** Human label for the engine/mode that produced this hit (e.g. "Semantic"). */
  engineLabel: string;
}

/**
 * A popover that reveals how a search hit was matched: the verbatim engine chunk,
 * plus either the cleaned chunk or — when the matched chunk was metadata-only —
 * the body-preview snippet actually shown on the row, labelled honestly.
 */
export function InspectChunk({ result, engineLabel }: InspectChunkProps) {
  if (!result.rawChunk) return null;
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Inspect matched chunk"
        title="Inspect matched chunk"
        data-testid="inspect-chunk"
        className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ScanText className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end">
        <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-border pb-2">
          <span className="truncate text-sm font-medium text-foreground">{result.title}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {engineLabel}
            {typeof result.score === 'number' ? ` · ${result.score.toFixed(2)}` : ''}
          </span>
        </div>
        <p className="mb-2 font-mono text-xs text-muted-foreground">
          source: {result.coll}/{result.slug}
          {typeof result.line === 'number' ? ` · L${result.line}` : ''}
        </p>
        <p className="mb-1 text-[0.65rem] font-semibold tracking-wide text-muted-foreground/70 uppercase">
          Raw chunk (verbatim)
        </p>
        <pre className="mb-3 max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-foreground">
          {result.rawChunk}
        </pre>
        {result.snippetFromBody ? (
          <>
            <p className="mb-1 text-[0.65rem] font-semibold tracking-wide text-muted-foreground/70 uppercase">
              Displayed snippet — body preview
            </p>
            <p className="mb-1 text-xs text-muted-foreground/80">
              qmd matched this doc on its title/frontmatter, so the chunk above is metadata. The row shows the
              document&rsquo;s opening body instead (not derived from the chunk).
            </p>
            <p className="text-sm text-muted-foreground">{result.snippet ?? '—'}</p>
          </>
        ) : (
          <>
            <p className="mb-1 text-[0.65rem] font-semibold tracking-wide text-muted-foreground/70 uppercase">
              Cleaned chunk (full)
            </p>
            <p className="max-h-48 overflow-auto text-sm text-muted-foreground">
              {result.cleanedChunk ?? result.snippet ?? '—'}
            </p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
