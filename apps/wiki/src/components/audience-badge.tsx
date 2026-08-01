import { Globe, Lock, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Audience } from '@/lib/types';

const META = {
  public: { Icon: Globe, label: 'Public', hint: 'Public — published to the static site' },
  private: { Icon: Lock, label: 'Private', hint: 'Private — never published to the static site' },
  system: { Icon: Shield, label: 'System', hint: 'System — diffwiki-internal; hidden unless showSystem is enabled' },
} as const;

// ── Page badge (shown above the article title) ───────────────────────────────

/** Audience pill for the article page: a muted icon pill — globe/lock/shield. */
export function AudienceBadge({ audience = 'public', className }: { audience?: Audience; className?: string }) {
  const { Icon, label, hint } = META[audience] ?? META.public;
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

/** Subtle sidebar marker: a muted lock for private, shield for system; nothing for public. */
export function AudienceIcon({ audience, className }: { audience?: Audience; className?: string }) {
  if (audience !== 'private' && audience !== 'system') return null;
  const { Icon, label, hint } = META[audience];
  return (
    <span
      role="img"
      aria-label={label}
      title={hint}
      className={cn('ml-1.5 inline-flex shrink-0 items-center text-muted-foreground/70', className)}
    >
      <Icon className="size-3" aria-hidden />
    </span>
  );
}
