import type { PageTreeItem } from '@stillwater/shared';

export interface TreeNode extends PageTreeItem {
  children: TreeNode[];
}

/** Builds the nested tree from the flat list (already sorted by position). */
export function buildTree(items: PageTreeItem[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const it of items) byId.set(it.id, { ...it, children: [] });
  const roots: TreeNode[] = [];
  for (const it of items) {
    const node = byId.get(it.id)!;
    const parent = it.parentId ? byId.get(it.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Ids of a page and everything under it (it cannot be moved into these). */
export function subtreeIds(items: PageTreeItem[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const it of items) {
      if (it.parentId && out.has(it.parentId) && !out.has(it.id)) {
        out.add(it.id);
        grew = true;
      }
    }
  }
  return out;
}

export const pageTitle = (t: string) => t.trim() || 'Untitled';
