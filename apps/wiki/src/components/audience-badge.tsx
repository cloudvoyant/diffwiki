import { Globe, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Audience } from '@/lib/types';

// ── Page badge (shown above the article title) ───────────────────────────────

/**
 * Audience pill for the article page: a muted (gray) icon pill — globe for
 * public, lock for private. Always renders; an absent audience is public.
 */
export function AudienceBadge({ audience = 'public', className }: { audience?: Audience; className?: string }) {
  const isPrivate = audience === 'private';
  const Icon = isPrivate ? Lock : Globe;
  const label = isPrivate ? 'Private' : 'Public';
  const hint = isPrivate ? 'Private — never published to the static site' : 'Public — published to the static site';
  return (
    <Badge
      variant="outline"
      title={hint}
      className={cn('gap-1 border-muted-foreground/30 font-normal text-muted-foreground', className)}
    >
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

// ── Sidebar marker ───────────────────────────────────────────────────────────

/**
 * Subtle audience marker for the sidebar: a small muted gray lock for private
 * entries; nothing for public. Understated so it doesn't draw the eye.
 */
export function AudienceIcon({ audience, className }: { audience?: Audience; className?: string }) {
  if (audience !== 'private') return null;
  return (
    <span
      role="img"
      aria-label="Private"
      title="Private — never published to the static site"
      className={cn('ml-1.5 inline-flex shrink-0 items-center text-muted-foreground/70', className)}
    >
      <Lock className="size-3" aria-hidden />
    </span>
  );
}
