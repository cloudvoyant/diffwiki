import { cn } from '@/lib/utils';

/**
 * Draft marker used on both the sidebar and the article page: a small, heavy,
 * all-caps yellow "DRAFT" label — distinct from the audience lock, and pushed to
 * the far right by the caller.
 */
export function DraftMark({ className }: { className?: string }) {
  return (
    <span
      title="Draft — not yet published"
      className={cn(
        // no-underline so it doesn't pick up the nav link's hover underline.
        'shrink-0 text-[0.625rem] font-bold uppercase tracking-wide text-amber-500 no-underline hover:no-underline',
        className,
      )}
    >
      Draft
    </span>
  );
}
