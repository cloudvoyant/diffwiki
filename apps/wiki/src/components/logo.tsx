import type { SVGProps } from 'react';

/**
 * diffwiki logo — the diffbook git-branch mark (a curved branch joining two
 * nodes) set inside a globe (circle + equator + longitude meridians). Kept in
 * sync with `public/favicon.svg` (that file is the source of truth for the art +
 * draw order — the globe circle is drawn last, over the mark).
 *
 * Strokes use `currentColor` so the mark follows the surrounding text color and
 * adapts to light/dark and the active theme. Two deliberate deviations from the
 * static favicon, for the themed UI:
 *   - the equator + meridians pick up the theme accent (`--primary`) at low
 *     opacity for a subtle themed tint (the favicon leaves them neutral);
 *   - the two branch nodes are filled with the page background (`--background`)
 *     so they read as hollow at any theme.
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
      {/* Globe interior: equator + meridians, tinted with the theme accent. */}
      <path d="M2.9 12h18.2" strokeWidth="1.2" opacity="0.65" style={{ stroke: 'var(--primary)' }} />
      <path
        d="m 11.944467,2.8055333 c -6.7249682,3.9262858 -6.7249682,14.4626477 0,18.3889337"
        strokeWidth="1.31107"
        opacity="0.55"
        style={{ stroke: 'var(--primary)' }}
      />
      <path
        d="m 12.038506,2.7885061 c 6.368356,3.9335569 6.368356,14.4894309 0,18.4229879"
        strokeWidth="1.27701"
        opacity="0.55"
        style={{ stroke: 'var(--primary)' }}
      />

      {/* Git-branch mark: vertical stem, two hollow nodes, then the curved branch. */}
      <path d="M 11.957819,14.860823 V 3.7621879" strokeWidth="1.42809" />
      <ellipse
        cx="16.583239"
        cy="12.085664"
        rx="1.4253384"
        ry="1.4504645"
        strokeWidth="0.845792"
        style={{ fill: 'var(--background)' }}
      />
      <ellipse
        cx="11.909781"
        cy="16.824411"
        rx="1.4253384"
        ry="1.4504645"
        strokeWidth="0.845792"
        style={{ fill: 'var(--background)' }}
      />
      <path
        d="m 11.960033,2.713621 c 0,0 2.373317,1.5266573 3.467405,3.567909 1.192413,2.2246978 1.256306,4.170937 1.256306,4.170937"
        strokeWidth="1.2"
      />

      {/* Globe outline — drawn last so it sits over the mark (matches favicon.svg). */}
      <circle cx="12" cy="12" r="9.25" strokeWidth="1.6" />
    </svg>
  );
}
