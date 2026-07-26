import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { GitBranch, ArrowDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SidebarMenu, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar';
import { cn } from '../lib/utils';
import type { TreeNode } from '../lib/types';
import { AudienceIcon } from './audience-badge';
import { DraftMark } from './draft-mark';

const BASE_PL_REM = 0.5; // base left inset for row content (the hover bg still spans edge-to-edge)
const INDENT_REM = 0.75; // horizontal indent added per nesting level
const CARET_REM = 1.125; // caret width (1rem) + caret→label gap (mr-0.5), so leaves align under branch labels

// The highlight lives on the ROW container so hovering anywhere (including the
// caret) lights it up, and the ACTIVE page is detected from the link's
// aria-current via :has — a selected/hover background, no bottom underline.
// Rows span the full sidebar width (indent is padding on the link, not the row).
const ROW =
  'group/row relative flex w-full items-start text-[0.8125rem] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground has-[[aria-current=page]]:bg-accent has-[[aria-current=page]]:font-medium has-[[aria-current=page]]:text-foreground';

const NAV_LABEL = 'min-w-0 whitespace-normal leading-tight line-clamp-2';

/** Filled caret: points right when collapsed, rotates down when open. */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 8 8"
      fill="currentColor"
      aria-hidden="true"
      className={cn('size-2.5 transition-transform duration-200', open && 'rotate-90')}
    >
      <path d="M2.5 1 6 4 2.5 7Z" />
    </svg>
  );
}

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
 * The full-width nav link. Transparent background — the ROW container shows the
 * hover / active highlight; the link only carries text + trailing markers.
 * `whitespace-normal` overrides the shadcn nowrap so long titles wrap (clamped to
 * 2 lines); `style.paddingLeft` sets per-depth indent.
 */
function NavLink({
  to,
  label,
  showLock,
  showDraft,
  extra,
  style,
  onClick,
}: {
  to: string;
  label: string;
  showLock: boolean;
  showDraft: boolean;
  extra?: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: true }}
      activeProps={{ 'aria-current': 'page' }}
      className="flex min-h-6 w-full min-w-0 items-start gap-1.5 py-1.5 pr-2"
      style={style}
      onClick={onClick}
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
        <span className={NAV_LABEL}>{label}</span>
        {extra}
        {showLock && <AudienceIcon audience="private" />}
      </span>
      {showDraft && <DraftMark className="shrink-0 self-center" />}
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
    <SidebarMenu className="gap-0 px-0">
      {nodes.map((node) => (
        <Node
          key={node.name + (node.path ?? '')}
          node={node}
          inherit={{ audienceHidden: false, draftAncestor: false }}
          depth={0}
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

function Node({ node, inherit, depth }: { node: TreeNode; inherit: Inherit; depth: number }) {
  const isBranch = Array.isArray(node.children) && (node.children.length > 0 || !node.path);
  return isBranch ? (
    <BranchNode node={node} inherit={inherit} depth={depth} />
  ) : (
    <LeafNode node={node} inherit={inherit} depth={depth} />
  );
}

function BranchNode({ node, inherit, depth }: { node: TreeNode; inherit: Inherit; depth: number }) {
  // Top-level collections start expanded so their articles are visible by default;
  // nested folders stay collapsed. (Per-user sidebar state will be remembered later.)
  const [open, setOpen] = useState(depth === 0);
  const label = node.title ?? node.name;
  const { showLock, showDraft } = markers(node, inherit);
  return (
    <SidebarMenuItem>
      <Collapsible open={open} onOpenChange={setOpen}>
        {/* Caret toggles collapse; the label link navigates to the folder index. */}
        <div className={ROW}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={open ? 'Collapse' : 'Expand'}
              className="mt-1.5 mr-0.5 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
              style={{ marginLeft: `${BASE_PL_REM + depth * INDENT_REM}rem` }}
            >
              <Caret open={open} />
            </button>
          </CollapsibleTrigger>
          {/* Clicking the label navigates AND expands the folder (never collapses —
              the caret handles collapse). */}
          <NavLink
            to={node.path ?? '/'}
            label={label}
            showLock={showLock}
            showDraft={showDraft}
            extra={node.meta?.branch && <GitBadge branch={node.meta.branch} behind={node.meta.behind} />}
            onClick={() => setOpen(true)}
          />
        </div>
        <CollapsibleContent>
          {/* No indent/border on the sub-list — rows stay full width, depth is
              expressed as padding on each link. */}
          <SidebarMenuSub className="m-0 min-w-0 translate-x-0 flex-col gap-0 border-0 p-0">
            {(node.children ?? []).map((child) => (
              <Node
                key={child.name + (child.path ?? '')}
                node={child}
                inherit={childInherit(node, inherit)}
                depth={depth + 1}
              />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

function LeafNode({ node, inherit, depth }: { node: TreeNode; inherit: Inherit; depth: number }) {
  const label = node.title ?? node.name;
  const { showLock, showDraft } = markers(node, inherit);
  return (
    <SidebarMenuItem>
      <div className={ROW}>
        {/* No caret — pad the text to align under branch labels (past the caret gutter). */}
        <NavLink
          to={node.path ?? '/'}
          label={label}
          showLock={showLock}
          showDraft={showDraft}
          style={{ paddingLeft: `${BASE_PL_REM + depth * INDENT_REM + CARET_REM}rem` }}
        />
      </div>
    </SidebarMenuItem>
  );
}
