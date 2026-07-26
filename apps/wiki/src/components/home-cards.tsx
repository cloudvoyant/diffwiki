import type { LucideIcon } from 'lucide-react';
import {
  Rocket,
  BookOpen,
  Code,
  Compass,
  Search,
  GitBranch,
  Sparkles,
  FileText,
  Boxes,
  Database,
  Terminal,
  Map as MapIcon,
} from 'lucide-react';
import type { HomeCard } from '@/lib/types';

/**
 * Curated icon set for home cards. `diffwiki.yaml` card `icon:` values are matched
 * here by kebab-case name; an unknown/missing name renders no icon (never a crash).
 * Keep this list small and intentional — it is the allow-list, not all of lucide.
 */
const ICONS: Record<string, LucideIcon> = {
  rocket: Rocket,
  'book-open': BookOpen,
  code: Code,
  compass: Compass,
  search: Search,
  'git-branch': GitBranch,
  sparkles: Sparkles,
  'file-text': FileText,
  boxes: Boxes,
  database: Database,
  terminal: Terminal,
  map: MapIcon,
};

/** Base-aware href for an in-site card link (e.g. "/getting-started"). */
function href(link: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${link.startsWith('/') ? link : `/${link}`}`;
}

export function HomeCards({ cards }: { cards: HomeCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
      {cards.map((card) => {
        const Icon = card.icon ? ICONS[card.icon] : undefined;
        return (
          <a
            key={card.link}
            href={href(card.link)}
            className="group flex items-start gap-3 rounded-xl border border-border bg-background p-4 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {Icon && (
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
            )}
            <span className="min-w-0">
              <span className="block font-semibold text-foreground">{card.title}</span>
              {card.subtitle && <span className="mt-0.5 block text-sm text-muted-foreground">{card.subtitle}</span>}
            </span>
          </a>
        );
      })}
    </div>
  );
}
