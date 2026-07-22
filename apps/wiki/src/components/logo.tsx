import type { SVGProps } from 'react';

/**
 * diffwiki logo — the diffbook git-branch mark (commit nodes joined by a branch
 * line) set inside a globe (circle + equator + longitude meridians). Monotone:
 * strokes/fills use `currentColor`, so it follows the surrounding text color and
 * adapts to light/dark and the active theme.
 */
export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="diffwiki"
      {...props}
    >
      {/* Globe */}
      <circle cx="12" cy="12" r="9.25" strokeWidth="1.6" />
      <path d="M2.9 12h18.2" strokeWidth="1.2" opacity="0.5" />
      <path d="M12 2.75c-5.6 3.95-5.6 14.55 0 18.5" strokeWidth="1.2" opacity="0.4" />
      <path d="M12 2.75c5.6 3.95 5.6 14.55 0 18.5" strokeWidth="1.2" opacity="0.4" />

      {/* Git-branch mark (adapted from the diffbook brand) */}
      <path d="M10.4 16.1V7.9" strokeWidth="1.8" />
      <path d="M10.4 12c0-1.55 1.45-2.55 3.35-2.85 0.95-.15 1.45-.65 1.45-1.35" strokeWidth="1.8" />
      <circle cx="10.4" cy="16.5" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="10.4" cy="7.5" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="15.2" cy="7.2" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}
