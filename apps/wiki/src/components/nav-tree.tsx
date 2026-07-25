import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronRight, GitBranch, ArrowDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuSub } from '@/components/ui/sidebar';
import { cn } from '../lib/utils';
import type { TreeNode } from '../lib/types';
import { AudienceIcon } from './audience-badge';
import { DraftMark } from './draft-mark';

// The link owns color/weight; the UNDERLINE lives on the label text only (via the
// `group/nav` + group-hover / group-aria-current variants below), so trailing
// markers like the DRAFT tag never inherit the link's decoration. Active adds
// primary + bold to the whole link, but still only underlines the label.
const ACTIVE = 'font-semibold !text-primary';
const LINK =
  'group/nav block w-full whitespace-normal leading-snug text-muted-foreground transition-colors hover:text-foreground';
// Applied to the label text span; underlines on link hover or when the link is the active page.
// `whitespace-normal` overrides the nowrap that the shadcn menu button forces on
// its last child (`[&>span:last-child]:truncate`), so long titles wrap (clamped to
// 2 lines) instead of overrunning the row and clipping a trailing DRAFT marker.
const NAV_LABEL =
  'min-w-0 whitespace-normal line-clamp-2 underline-offset-4 decoration-2 group-hover/nav:underline group-aria-[current=page]/nav:underline';
const NO_BG = 'hover:bg-transparent active:bg-transparent';

export function GitBadge({ branch, behind }: { branch: string; behind?: number }) {
  return (
    <span className="ml-1.5 inline-flex shrink-0 items-center gap-1 text-[0.6875rem] font-normal text-muted-foreground">
      <span className="inline-flex items-center gap-0.5" title={`branch: ${branch}`}>
        <GitBranch className="size-3" aria-hidden="true" />
        {branch}
      </span>
      {behind !== undefined && behind > 0 && (
        <span
          className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-500"
          title={`${behind} behind remote`}
        >
          <ArrowDown className="size-3" aria-hidden="true" />
          {behind}
        </span>
      )}
    </span>
  );
}

/**
 * The nav link shared by branch and leaf rows: color/weight on the link, an
 * underline scoped to the label only, plus the audience lock and a far-right
 * DRAFT mark. `extra` lets a branch row slot the GitBadge next to the label.
 */
function NavRow({
  to,
  label,
  showLock,
  showDraft,
  extra,
}: {
  to: string;
  label: string;
  showLock: boolean;
  showDraft: boolean;
  extra?: ReactNode;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: true }}
      activeProps={{ className: ACTIVE, 'aria-current': 'page' }}
      className={LINK}
    >
      <span className="flex w-full items-baseline gap-1.5">
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline">
          <span className={NAV_LABEL}>{label}</span>
          {extra}
          {showLock && <AudienceIcon audience="private" />}
        </span>
        {showDraft && <DraftMark className="shrink-0 self-center" />}
      </span>
    </Link>
  );
}

/** Inheritance flags threaded down the tree.
 *  - audienceHidden: a private ancestor already shows the lock, so descendants suppress theirs.
 *  - draftAncestor: a draft ancestor makes the whole subtree draft, so descendants still SHOW "DRAFT". */
interface Inherit {
  audienceHidden: boolean;
  draftAncestor: boolean;
}

export function NavTree({ nodes }: { nodes: TreeNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <SidebarMenu>
      {nodes.map((node) => (
        <Node
          key={node.name + (node.path ?? '')}
          node={node}
          inherit={{ audienceHidden: false, draftAncestor: false }}
        />
      ))}
    </SidebarMenu>
  );
}

/** What this node passes to its children. */
function childInherit(node: TreeNode, inherit: Inherit): Inherit {
  return {
    audienceHidden: inherit.audienceHidden || node.audience === 'private',
    draftAncestor: inherit.draftAncestor || node.status === 'draft',
  };
}

/** The row markers for a node, given its inherited state. */
function markers(node: TreeNode, inherit: Inherit) {
  // Audience lock: only on the top-most private node (children inherit, suppressed).
  const showLock = !inherit.audienceHidden && node.audience === 'private';
  // Draft: on every draft node in the subtree, including inherited children.
  const showDraft = node.status === 'draft' || inherit.draftAncestor;
  return { showLock, showDraft };
}

function Node({ node, inherit }: { node: TreeNode; inherit: Inherit }) {
  const isBranch = Array.isArray(node.children) && (node.children.length > 0 || !node.path);
  return isBranch ? <BranchNode node={node} inherit={inherit} /> : <LeafNode node={node} inherit={inherit} />;
}

function BranchNode({ node, inherit }: { node: TreeNode; inherit: Inherit }) {
  const [open, setOpen] = useState(false); // collapsed by default
  const label = node.title ?? node.name;
  const { showLock, showDraft } = markers(node, inherit);
  return (
    <SidebarMenuItem>
      <Collapsible open={open} onOpenChange={setOpen}>
        {/* Chevron toggles; the label navigates to the folder's index/listing. */}
        <div className="flex items-start">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={open ? 'Collapse' : 'Expand'}
              className="mt-[5px] flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <ChevronRight
                className={cn('size-3.5 transition-transform duration-200', open && 'rotate-90')}
                aria-hidden="true"
              />
            </button>
          </CollapsibleTrigger>
          <SidebarMenuButton
            asChild
            className={cn('h-auto min-h-6 items-start py-1 pr-1 pl-0 text-[0.8125rem] font-medium', NO_BG)}
            tooltip={label}
          >
            <NavRow
              to={node.path ?? '/'}
              label={label}
              showLock={showLock}
              showDraft={showDraft}
              extra={node.meta?.branch && <GitBadge branch={node.meta.branch} behind={node.meta.behind} />}
            />
          </SidebarMenuButton>
        </div>
        <CollapsibleContent>
          {/* Tight, single indent per level (override shadcn's wider mx-3.5/px-2.5)
              so deep nesting doesn't push items off the right edge. */}
          <SidebarMenuSub className="mx-0 ml-2 px-0 pl-2">
            {(node.children ?? []).map((child) => (
              <Node key={child.name + (child.path ?? '')} node={child} inherit={childInherit(node, inherit)} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

function LeafNode({ node, inherit }: { node: TreeNode; inherit: Inherit }) {
  const label = node.title ?? node.name;
  const { showLock, showDraft } = markers(node, inherit);
  return (
    <SidebarMenuItem>
      {/* pl-4 aligns leaf text under the branch labels (past the chevron gutter). */}
      <SidebarMenuButton
        asChild
        className={cn('h-auto min-h-6 items-start py-1 pr-1 pl-4 text-[0.8125rem]', NO_BG)}
        tooltip={label}
      >
        <NavRow to={node.path ?? '/'} label={label} showLock={showLock} showDraft={showDraft} />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
