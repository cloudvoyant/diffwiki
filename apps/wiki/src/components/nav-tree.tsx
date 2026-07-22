import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuSub } from '@/components/ui/sidebar';
import { cn } from '../lib/utils';
import type { TreeNode } from '../lib/types';

// Active = primary + bold + underline. Hover mirrors it (underline) but in a
// muted color, with no background change.
const ACTIVE = 'font-semibold !text-primary underline underline-offset-4 decoration-2';
const LINK =
  'block w-full whitespace-normal leading-snug line-clamp-2 text-muted-foreground transition-colors hover:text-foreground hover:underline hover:underline-offset-4 hover:decoration-2';
const NO_BG = 'hover:bg-transparent active:bg-transparent';

export function NavTree({ nodes }: { nodes: TreeNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <SidebarMenu>
      {nodes.map((node) => (
        <Node key={node.name + (node.path ?? '')} node={node} />
      ))}
    </SidebarMenu>
  );
}

function Node({ node }: { node: TreeNode }) {
  const isBranch = Array.isArray(node.children) && (node.children.length > 0 || !node.path);
  return isBranch ? <BranchNode node={node} /> : <LeafNode node={node} />;
}

function BranchNode({ node }: { node: TreeNode }) {
  const [open, setOpen] = useState(false); // collapsed by default
  const label = node.title ?? node.name;
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
            <Link
              to={node.path ?? '/'}
              activeOptions={{ exact: true }}
              activeProps={{ className: ACTIVE, 'aria-current': 'page' }}
              className={LINK}
            >
              {label}
            </Link>
          </SidebarMenuButton>
        </div>
        <CollapsibleContent>
          {/* Tight, single indent per level (override shadcn's wider mx-3.5/px-2.5)
              so deep nesting doesn't push items off the right edge. */}
          <SidebarMenuSub className="mx-0 ml-2 px-0 pl-2">
            {(node.children ?? []).map((child) => (
              <Node key={child.name + (child.path ?? '')} node={child} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

function LeafNode({ node }: { node: TreeNode }) {
  const label = node.title ?? node.name;
  return (
    <SidebarMenuItem>
      {/* pl-4 aligns leaf text under the branch labels (past the chevron gutter). */}
      <SidebarMenuButton
        asChild
        className={cn('h-auto min-h-6 items-start py-1 pr-1 pl-4 text-[0.8125rem]', NO_BG)}
        tooltip={label}
      >
        <Link
          to={node.path ?? '/'}
          activeOptions={{ exact: true }}
          activeProps={{ className: ACTIVE, 'aria-current': 'page' }}
          className={LINK}
        >
          {label}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
