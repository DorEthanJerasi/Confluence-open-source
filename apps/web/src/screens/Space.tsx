import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronRight, CornerDownRight, FileText, Lock, MoreHorizontal, Plus, Settings, Trash2 } from 'lucide-react';
import { roleAtLeast, type PageTreeItem, type Space } from '@stillwater/shared';
import { api, ApiFailure } from '../api';
import { buildTree, pageTitle, subtreeIds, type TreeNode } from '../tree';
import { ErrorNote, Field, Loading, Modal, ROLE_LABEL } from '../ui';
import { TemplatePicker } from '../templates/TemplatePicker';
import { NotFound } from './NotFound';

export interface SpaceCtx {
  space: Space;
  items: PageTreeItem[];
  canEdit: boolean;
  /** Open the template picker for a new page under `parentId` (null = top level). */
  newPage: (parentId: string | null) => void;
  /** Ask, then soft-delete a page and its sub-pages. */
  deletePage: (id: string) => void;
}

export const useSpace = () => useOutletContext<SpaceCtx>();

/** Shared mutations for the tree, used by the sidebar and the page screen. */
function useTreeActions(spaceKey: string) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => qc.invalidateQueries({ queryKey: ['tree', spaceKey] });

  // The picker closes itself (onDone) before the new page opens, so focus lands on its title.
  const create = useMutation({
    mutationFn: (v: { parentId: string | null; templateId: string | null; onDone: () => void }) =>
      api.createPage(spaceKey, { title: '', parentId: v.parentId, ...(v.templateId ? { templateId: v.templateId } : {}) }),
    onSuccess: async ({ page }, v) => {
      await refresh();
      v.onDone();
      navigate(`/s/${spaceKey}/p/${page.id}`, { state: { focusTitle: true } });
    },
  });
  const move = useMutation({
    mutationFn: (v: { id: string; parentId: string | null; index: number }) =>
      api.movePage(v.id, { parentId: v.parentId, index: v.index }),
    onSettled: async (_d, _e, v) => {
      await refresh();
      await qc.invalidateQueries({ queryKey: ['page', v.id] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deletePage(id),
    onSuccess: refresh,
  });
  return { create, move, remove };
}

function MoveDialog(props: {
  item: PageTreeItem;
  items: PageTreeItem[];
  onMove: (parentId: string | null, index: number) => void;
  onClose: () => void;
}) {
  const blocked = useMemo(() => subtreeIds(props.items, props.item.id), [props.items, props.item.id]);
  const [parentId, setParentId] = useState<string>(props.item.parentId ?? '');
  const [where, setWhere] = useState<'first' | 'last'>('last');

  // Indented list of possible parents, in tree order.
  const options: { id: string; label: string }[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      if (blocked.has(n.id)) continue;
      options.push({ id: n.id, label: `${' '.repeat(depth)}${pageTitle(n.title)}` });
      walk(n.children, depth + 1);
    }
  };
  walk(buildTree(props.items), 1);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    props.onMove(parentId || null, where === 'first' ? 0 : 1_000_000);
    props.onClose();
  };
  return (
    <Modal title={`Move “${pageTitle(props.item.title)}”`} onClose={props.onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Put it under">
          <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Top level of the space</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Position">
          <select className="input" value={where} onChange={(e) => setWhere(e.target.value as 'first' | 'last')}>
            <option value="first">First</option>
            <option value="last">Last</option>
          </select>
        </Field>
        <div className="row row-end">
          <button type="button" className="btn btn-quiet" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary">Move</button>
        </div>
      </form>
    </Modal>
  );
}

function TreeRow(props: {
  node: TreeNode;
  siblings: TreeNode[];
  depth: number;
  ctx: SpaceCtx;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onMove: (id: string, parentId: string | null, index: number) => void;
  onMoveTo: (item: PageTreeItem) => void;
}) {
  const { node, siblings, depth, ctx, expanded } = props;
  const [menu, setMenu] = useState(false);
  const open = expanded.has(node.id);
  const index = siblings.indexOf(node);
  const hasKids = node.children.length > 0;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  return (
    <li>
      <div className="tree-row" style={{ paddingLeft: `calc(var(--space-3) * ${depth})` }}>
        <button
          className={`tree-twist${hasKids ? '' : ' tree-twist-empty'}${open ? ' is-open' : ''}`}
          onClick={() => props.toggle(node.id)}
          aria-label={open ? 'Collapse' : 'Expand'}
          aria-expanded={hasKids ? open : undefined}
          tabIndex={hasKids ? 0 : -1}
        >
          <ChevronRight size={14} />
        </button>
        <NavLink to={`/s/${ctx.space.key}/p/${node.id}`} className="tree-link">
          {pageTitle(node.title)}
        </NavLink>
        {ctx.canEdit && (
          <span className="tree-actions">
            <button className="icon-btn icon-btn-sm" title="Add a sub-page" aria-label="Add a sub-page" onClick={() => ctx.newPage(node.id)}>
              <Plus size={14} />
            </button>
            <span className="menu-anchor">
              <button
                className="icon-btn icon-btn-sm"
                title="More"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu((m) => !m);
                }}
              >
                <MoreHorizontal size={14} />
              </button>
              {menu && (
                <div className="menu" role="menu">
                  <button role="menuitem" disabled={index <= 0} onClick={() => props.onMove(node.id, node.parentId, index - 1)}>
                    <ArrowUp size={14} /> Move up
                  </button>
                  <button
                    role="menuitem"
                    disabled={index >= siblings.length - 1}
                    onClick={() => props.onMove(node.id, node.parentId, index + 1)}
                  >
                    <ArrowDown size={14} /> Move down
                  </button>
                  <button role="menuitem" onClick={() => props.onMoveTo(node)}>
                    <CornerDownRight size={14} /> Move to…
                  </button>
                  <button role="menuitem" className="danger" onClick={() => ctx.deletePage(node.id)}>
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              )}
            </span>
          </span>
        )}
      </div>
      {hasKids && open && (
        <ul className="tree-children">
          {node.children.map((c) => (
            <TreeRow key={c.id} {...props} node={c} siblings={node.children} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SpaceLayout() {
  const { key = '', pageId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const spaceQ = useQuery({ queryKey: ['space', key], queryFn: () => api.space(key) });
  const treeQ = useQuery({ queryKey: ['tree', key], queryFn: () => api.tree(key), enabled: spaceQ.isSuccess });
  const actions = useTreeActions(key);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState<PageTreeItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // The template picker is open for a new page under this parent (null = top level).
  const [picking, setPicking] = useState<{ parentId: string | null } | null>(null);

  const items = treeQ.data?.pages ?? [];

  // Keep the open page's ancestors expanded so it is visible in the tree.
  useEffect(() => {
    if (!pageId || !items.length) return;
    const parent = new Map(items.map((i) => [i.id, i.parentId]));
    setExpanded((prev) => {
      const next = new Set(prev);
      let p = parent.get(pageId) ?? null;
      while (p) {
        next.add(p);
        p = parent.get(p) ?? null;
      }
      return next.size === prev.size ? prev : next;
    });
  }, [pageId, items]);

  if (spaceQ.isPending) return <Loading />;
  if (spaceQ.error) {
    if (spaceQ.error instanceof ApiFailure && spaceQ.error.status === 404) return <NotFound what="space" />;
    return <ErrorNote error={spaceQ.error} />;
  }
  const space = spaceQ.data.space;
  const canEdit = roleAtLeast(space.myRole, 'editor');
  const tree = buildTree(items);
  const deleting = confirmDelete ? items.find((i) => i.id === confirmDelete) : undefined;
  const deletingKids = confirmDelete ? subtreeIds(items, confirmDelete).size - 1 : 0;

  const ctx: SpaceCtx = {
    space,
    items,
    canEdit,
    newPage: (parentId) => {
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      setPicking({ parentId });
    },
    deletePage: (id) => setConfirmDelete(id),
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-layout">
      <aside className="sidebar" aria-label="Pages in this space">
        <Link to={`/s/${space.key}`} className="sidebar-space">
          <span className="space-mark" aria-hidden="true">
            {space.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="sidebar-space-name">{space.name}</span>
          {space.visibility === 'restricted' && <Lock size={13} className="faint" aria-label="Members only" />}
        </Link>
        <div className="sidebar-head">
          <span className="sidebar-label">Pages</span>
          {canEdit && (
            <button className="icon-btn icon-btn-sm" onClick={() => ctx.newPage(null)} title="New page" aria-label="New page">
              <Plus size={15} />
            </button>
          )}
        </div>
        {treeQ.isPending ? (
          <Loading />
        ) : tree.length === 0 ? (
          <p className="sidebar-empty muted">No pages yet.</p>
        ) : (
          <ul className="tree">
            {tree.map((n) => (
              <TreeRow
                key={n.id}
                node={n}
                siblings={tree}
                depth={0}
                ctx={ctx}
                expanded={expanded}
                toggle={toggle}
                onMove={(id, parentId, index) => actions.move.mutate({ id, parentId, index })}
                onMoveTo={setMoving}
              />
            ))}
          </ul>
        )}
        <ErrorNote error={actions.move.error ?? actions.remove.error} />
        <div className="sidebar-foot">
          <NavLink to={`/s/${space.key}/settings`} className="sidebar-foot-link">
            <Settings size={15} aria-hidden="true" /> Space settings
          </NavLink>
          <span className="pill">{ROLE_LABEL[space.myRole]}</span>
        </div>
      </aside>
      <main className="space-main">
        <Outlet context={ctx} />
      </main>
      {picking && canEdit && (
        <TemplatePicker
          spaceKey={space.key}
          parentTitle={picking.parentId ? pageTitle(items.find((i) => i.id === picking.parentId)?.title ?? '') : null}
          onClose={() => setPicking(null)}
          onCreate={(templateId) =>
            actions.create.mutateAsync({ parentId: picking.parentId, templateId, onDone: () => setPicking(null) })
          }
        />
      )}
      {moving && (
        <MoveDialog
          item={moving}
          items={items}
          onClose={() => setMoving(null)}
          onMove={(parentId, index) => {
            if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
            actions.move.mutate({ id: moving.id, parentId, index });
          }}
        />
      )}
      {deleting && (
        <Modal title={`Delete “${pageTitle(deleting.title)}”?`} onClose={() => setConfirmDelete(null)}>
          <p className="muted">
            {deletingKids > 0
              ? `This also deletes ${deletingKids} sub-page${deletingKids === 1 ? '' : 's'} under it.`
              : 'This page will be removed from the space.'}
          </p>
          <div className="row row-end">
            <button className="btn btn-quiet" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                const id = deleting.id;
                setConfirmDelete(null);
                actions.remove.mutate(id, {
                  onSuccess: () => {
                    qc.removeQueries({ queryKey: ['page', id] });
                    if (pageId && subtreeIds(items, id).has(pageId)) {
                      navigate(deleting.parentId ? `/s/${space.key}/p/${deleting.parentId}` : `/s/${space.key}`);
                    }
                  },
                });
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function SpaceHome() {
  const { space, items, canEdit, newPage } = useSpace();
  const top = items.filter((i) => !i.parentId);
  return (
    <div className="content fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">{space.name}</h1>
          {space.description && <p className="muted lead">{space.description}</p>}
        </div>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => newPage(null)}>
            <Plus size={16} aria-hidden="true" /> New page
          </button>
        )}
      </div>
      {top.length === 0 ? (
        <div className="empty">
          <p className="empty-title">This space is empty</p>
          <p className="muted">{canEdit ? 'Add a first page to get going.' : 'Nobody has written anything here yet.'}</p>
        </div>
      ) : (
        <ul className="list">
          {top.map((p) => (
            <li key={p.id}>
              <Link to={`/s/${space.key}/p/${p.id}`} className="list-link">
                <FileText size={16} className="faint" aria-hidden="true" />
                {pageTitle(p.title)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
