// One saved version of a page, read-only, compared with the current page.
// It uses the same schema and block views as the reader, plus a decoration
// that tints and labels each block that differs. The diff itself is the pure
// diffBlocks from packages/editor-schema; this file only draws it.
import { useMemo } from 'react';
import { EditorContent, Extension, useEditor, type JSONContent } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { diffBlocks, getExtensions, type BlockJson, type DocJson } from '@stillwater/editor-schema';
import type { Doc } from '@stillwater/shared';
import { embedViews } from '../editor/embeds';

export type DiffKind = 'added' | 'removed' | 'changed';

/** Words shown on each marked block, so the diff never relies on colour alone. */
export const DIFF_LABEL: Record<DiffKind, string> = {
  added: 'Only in this version',
  removed: 'Only in the current page',
  changed: 'Changed since this version',
};

const idOf = (b: BlockJson) => (typeof b?.attrs?.id === 'string' ? (b.attrs.id as string) : null);

/**
 * The version's blocks, with the blocks that exist only in the current page
 * put back in where they sit now (after the nearest block both share), and
 * what kind of difference each marked block is.
 */
export function compareWithCurrent(version: Doc, current: Doc): { doc: DocJson; kinds: Map<string, DiffKind> } {
  const diff = diffBlocks(current as DocJson, version as DocJson);
  const kinds = new Map<string, DiffKind>();
  diff.added.forEach((id) => kinds.set(id, 'added'));
  diff.changed.forEach((id) => kinds.set(id, 'changed'));
  diff.removed.forEach((id) => kinds.set(id, 'removed'));

  const versionBlocks = ((version as DocJson).content ?? []) as BlockJson[];
  const currentBlocks = ((current as DocJson).content ?? []) as BlockJson[];
  const inVersion = new Set(versionBlocks.map(idOf).filter((id): id is string => id !== null));
  const removed = new Set(diff.removed);

  const head: BlockJson[] = [];
  const after = new Map<string, BlockJson[]>();
  let anchor: string | null = null;
  for (const block of currentBlocks) {
    const id = idOf(block);
    if (id !== null && removed.has(id)) {
      if (anchor === null) head.push(block);
      else after.set(anchor, [...(after.get(anchor) ?? []), block]);
    } else if (id !== null && inVersion.has(id)) {
      anchor = id;
    }
  }
  const content: BlockJson[] = [...head];
  for (const block of versionBlocks) {
    content.push(block);
    const id = idOf(block);
    if (id !== null) content.push(...(after.get(id) ?? []));
  }
  return { doc: { ...(version as DocJson), type: 'doc', content }, kinds };
}

const diffKey = new PluginKey('versionDiff');

const DiffMarks = Extension.create<{ kinds: Map<string, DiffKind> }>({
  name: 'versionDiff',
  addOptions() {
    return { kinds: new Map() };
  },
  addProseMirrorPlugins() {
    const kinds = this.options.kinds;
    return [
      new Plugin({
        key: diffKey,
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              const id = node.attrs.id as string | null | undefined;
              const kind = id ? kinds.get(id) : undefined;
              if (!kind) return;
              decos.push(
                Decoration.widget(
                  offset,
                  () => {
                    const label = document.createElement('span');
                    label.className = `diff-label diff-label-${kind}`;
                    label.textContent = DIFF_LABEL[kind];
                    return label;
                  },
                  { side: -1, key: `${id}:${kind}` },
                ),
                Decoration.node(offset, offset + node.nodeSize, { class: `diff-block diff-${kind}`, 'data-diff': kind }),
              );
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

export function VersionDoc({ version, current }: { version: Doc; current: Doc }) {
  const { doc, kinds } = useMemo(() => compareWithCurrent(version, current), [version, current]);
  const editor = useEditor(
    {
      extensions: [...getExtensions({ history: false, nodeViews: embedViews }), DiffMarks.configure({ kinds })],
      content: doc as JSONContent,
      editable: false,
      editorProps: { attributes: { class: 'doc', 'aria-label': 'Version content' } },
    },
    [doc, kinds],
  );

  const counts = { added: 0, removed: 0, changed: 0 };
  kinds.forEach((k) => counts[k]++);
  const parts = (['changed', 'added', 'removed'] as const)
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${counts[k] === 1 ? 'block' : 'blocks'} ${DIFF_LABEL[k].toLowerCase()}`);

  return (
    <div className="version-doc">
      <p className="version-summary muted" data-testid="diff-summary">
        {parts.length ? `Compared with the current page: ${parts.join(', ')}.` : 'Same as the current page.'}
      </p>
      <div className="page-editor is-readonly">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
