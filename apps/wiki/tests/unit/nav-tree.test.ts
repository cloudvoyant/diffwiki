// @vitest-environment jsdom
/**
 * DOM tests for the real GitBadge component from nav-tree.tsx.
 *
 * Renders the actual component with @testing-library/react and asserts on the
 * emitted markup — so a regression in the JSX (e.g. dropping the behind counter,
 * or showing it at 0) is caught, unlike a hand-mirrored copy of the logic.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import type { TreeNode } from 'diffwiki-core';
import { GitBadge } from '../../src/components/nav-tree';
import { AudienceBadge, AudienceIcon } from '../../src/components/audience-badge';
import { DraftMark } from '../../src/components/draft-mark';

afterEach(cleanup);

describe('GitBadge (real component)', () => {
  it('renders the branch name with a branch tooltip', () => {
    render(createElement(GitBadge, { branch: 'main' }));
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.getByTitle('branch: main')).toBeTruthy();
  });

  it('renders the behind counter (and its tooltip) when behind > 0', () => {
    render(createElement(GitBadge, { branch: 'main', behind: 3 }));
    // Branch shown…
    expect(screen.getByText('main')).toBeTruthy();
    // …plus the behind count and its "N behind remote" tooltip.
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByTitle('3 behind remote')).toBeTruthy();
  });

  it('omits the behind counter when behind is 0', () => {
    render(createElement(GitBadge, { branch: 'main', behind: 0 }));
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByTitle('0 behind remote')).toBeNull();
  });

  it('omits the behind counter when behind is undefined', () => {
    render(createElement(GitBadge, { branch: 'feat/x' }));
    expect(screen.getByText('feat/x')).toBeTruthy();
    // No behind tooltip should exist at all.
    expect(document.querySelector('[title$="behind remote"]')).toBeNull();
  });
});

/**
 * TreeNode meta shape — the contract GitBadge consumes via node.meta. Keeps the
 * type wiring honest without re-implementing the render logic.
 */
function makeBranchNode(opts: { branch?: string; behind?: number }): TreeNode {
  return {
    name: 'notes',
    title: 'notes',
    path: '/notes',
    children: [],
    meta: { branch: opts.branch, behind: opts.behind },
  };
}

describe('TreeNode.meta contract', () => {
  it('carries branch and behind through TreeNode.meta', () => {
    const node = makeBranchNode({ branch: 'feat/x', behind: 2 });
    expect(node.meta?.branch).toBe('feat/x');
    expect(node.meta?.behind).toBe(2);
  });

  it('preserves behind: 0 (distinct from undefined)', () => {
    const node = makeBranchNode({ branch: 'main', behind: 0 });
    expect(node.meta?.behind).toBe(0);
  });

  it('allows a node with no meta (static build, no git info)', () => {
    const node: TreeNode = { name: 'notes', title: 'notes', path: '/notes', children: [] };
    expect(node.meta?.branch).toBeUndefined();
  });
});

describe('AudienceBadge (page pill — real component)', () => {
  it('renders a Public pill for public/undefined audience', () => {
    render(createElement(AudienceBadge, { audience: 'public' }));
    expect(screen.getByText('Public')).toBeTruthy();
    cleanup();
    render(createElement(AudienceBadge, {}));
    expect(screen.getByText('Public')).toBeTruthy();
  });

  it('renders a Private pill for private audience', () => {
    render(createElement(AudienceBadge, { audience: 'private' }));
    expect(screen.getByText('Private')).toBeTruthy();
  });
});

describe('AudienceIcon (sidebar — real component)', () => {
  it('renders a muted lock for private audience', () => {
    render(createElement(AudienceIcon, { audience: 'private' }));
    expect(screen.getByLabelText('Private')).toBeTruthy();
  });

  it('renders nothing for public/undefined audience', () => {
    const { container } = render(createElement(AudienceIcon, { audience: 'public' }));
    expect(container.querySelector('svg')).toBeNull();
    cleanup();
    const { container: c2 } = render(createElement(AudienceIcon, {}));
    expect(c2.querySelector('svg')).toBeNull();
  });
});

describe('DraftMark (sidebar — real component)', () => {
  it('renders a "DRAFT" text label', () => {
    render(createElement(DraftMark, {}));
    expect(screen.getByText('Draft')).toBeTruthy();
  });
});
