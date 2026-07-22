import { Link } from '@tanstack/react-router';
import { FileText, Folder } from 'lucide-react';
import type { ListingEntry } from '../lib/types';

/**
 * Generated directory page — shown for a collection/folder that has no authored
 * index file. Lists its immediate child folders and articles as links.
 */
export function DirListing({ title, entries }: { title: string; entries: ListingEntry[] }) {
  return (
    <div>
      <h1 className="mb-6 text-3xl font-bold tracking-tight">{title}</h1>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">This collection is empty.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {entries.map((e) => (
            <li key={e.path}>
              <Link
                to={e.path}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-background p-3 transition-colors hover:bg-muted"
              >
                {e.isDir ? (
                  <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="truncate text-sm font-medium">{e.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
