import type { SiteCopyright } from '@/lib/types';

/**
 * Global footer — the copyright notice comes entirely from `diffwiki.yaml`
 * (`site.copyright`); there is no default, so the footer is nothing when unset.
 * This notice covers the site/software — article content stays © its authors.
 * `mt-auto` pins it to the bottom of the content column even on short pages.
 */
export function SiteFooter({ copyright }: { copyright?: SiteCopyright }) {
  if (!copyright?.text) return null;
  return (
    <footer className="mt-auto px-4 pt-12 pb-6 text-center text-xs text-muted-foreground">
      <p>
        {copyright.url ? (
          <a
            href={copyright.url}
            target="_blank"
            rel="noreferrer noopener"
            className="underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            {copyright.text}
          </a>
        ) : (
          copyright.text
        )}
      </p>
    </footer>
  );
}
