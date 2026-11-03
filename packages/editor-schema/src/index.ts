// The one editor schema (ARCHITECTURE.md §3). The web editor, the server's
// validation and text extraction, and (later) the co-editing server all build
// their schema from getExtensions(). A node type not listed here does not exist.
import { Extension, Node, getSchema, mergeAttributes, type AnyExtension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Fragment, Node as PmNode, type Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Link from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';

/** Node types that may sit directly under `doc`; each carries a stable block `id`. */
export const TOP_LEVEL_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'horizontalRule',
  'codeBlock',
  'table',
  'callout',
] as const;

export const CALLOUT_TONES = ['info', 'success', 'warning', 'danger'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/** Link targets we keep. Anything else (javascript:, data:, …) is refused. */
const SAFE_HREF = /^(https?:|mailto:|\/|#)/i;

/** UUID v4 from getRandomValues, which (unlike randomUUID) works on plain-http self-hosts. */
export function newBlockId(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the current block(s) in a callout. */
      setCallout: (attrs?: { tone?: CalloutTone }) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() {
    return {
      tone: {
        default: 'info',
        parseHTML: (el) => {
          const t = el.getAttribute('data-tone');
          return (CALLOUT_TONES as readonly string[]).includes(t ?? '') ? t : 'info';
        },
        renderHTML: (attrs) => ({ 'data-tone': attrs.tone }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'callout' }), 0];
  },
  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
    };
  },
});

const blockIdKey = new PluginKey('blockId');

/**
 * Gives every top-level block a stable, unique `id`. A split or a paste that
 * copies an id gets a fresh one for the second copy.
 */
export const BlockId = Extension.create({
  name: 'blockId',
  addGlobalAttributes() {
    return [
      {
        types: [...TOP_LEVEL_TYPES],
        attributes: {
          id: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-block-id'),
            renderHTML: (attrs) => (attrs.id ? { 'data-block-id': attrs.id } : {}),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockIdKey,
        appendTransaction: (_trs, _old, state) => {
          const seen = new Set<string>();
          let tr: Transaction | null = null;
          state.doc.forEach((node, offset) => {
            if (!('id' in node.attrs)) return;
            const id = node.attrs.id as string | null;
            if (id && !seen.has(id)) {
              seen.add(id);
              return;
            }
            const fresh = newBlockId();
            seen.add(fresh);
            tr = (tr ?? state.tr).setNodeMarkup(offset, undefined, { ...node.attrs, id: fresh });
          });
          return tr ? (tr as Transaction).setMeta('addToHistory', false) : null;
        },
      }),
    ];
  },
});

export const lowlight = createLowlight(common);

export interface ExtensionOptions {
  /**
   * Tiptap's own undo history. The one switch to flip when the Yjs undo
   * manager takes over for co-editing (ARCHITECTURE.md §3, rule 4).
   */
  history?: boolean;
}

/** The single list of nodes and marks. */
export function getExtensions(opts: ExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
      history: opts.history === false ? false : {},
    }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ['http', 'https', 'mailto'],
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
    Callout,
    BlockId,
  ];
}

let cached: Schema | null = null;
/** The ProseMirror schema, for code with no editor (the server). */
export function getDocSchema(): Schema {
  return (cached ??= getSchema(getExtensions({ history: false })));
}

export class InvalidDocError extends Error {}

type Json = { [k: string]: unknown };

/** Walk every attr of every node and mark; refuse inline data and unsafe links. */
function checkAttrs(node: Json, path: string) {
  const attrs = node.attrs;
  if (attrs && typeof attrs === 'object') {
    for (const [k, v] of Object.entries(attrs as Json)) {
      if (typeof v === 'string' && /^\s*data:/i.test(v)) {
        throw new InvalidDocError(`${path}.${k}: files must be uploaded, not pasted into the page`);
      }
      if (k === 'href' && typeof v === 'string' && !SAFE_HREF.test(v.trim())) {
        throw new InvalidDocError(`${path}.${k}: only http, https and mailto links are allowed`);
      }
    }
  }
  if (Array.isArray(node.marks)) node.marks.forEach((m, i) => m && typeof m === 'object' && checkAttrs(m as Json, `${path}.marks[${i}]`));
  if (Array.isArray(node.content)) node.content.forEach((c, i) => c && typeof c === 'object' && checkAttrs(c as Json, `${path}.content[${i}]`));
}

/**
 * Parse and check a stored/incoming page body against the schema. Throws
 * InvalidDocError on anything the schema does not define, on inline `data:`
 * URLs and on unsafe link targets. Returns the parsed node with ids filled in.
 */
export function parseDoc(json: unknown): PmNode {
  if (!json || typeof json !== 'object' || (json as Json).type !== 'doc') {
    throw new InvalidDocError('The page body must be a document');
  }
  checkAttrs(json as Json, 'doc');
  const schema = getDocSchema();
  const content = (json as Json).content;
  if (content === undefined || (Array.isArray(content) && content.length === 0)) {
    // An empty page is one empty paragraph, as the editor itself would make it.
    return withBlockIds(schema.topNodeType.createAndFill()!);
  }
  let node: PmNode;
  try {
    node = PmNode.fromJSON(schema, json);
    node.check();
  } catch (err) {
    throw new InvalidDocError(`The page body does not fit the editor schema: ${(err as Error).message}`);
  }
  return withBlockIds(node);
}

/** Fill in missing or repeated top-level block ids. */
export function withBlockIds(doc: PmNode): PmNode {
  const seen = new Set<string>();
  let changed = false;
  const children: PmNode[] = [];
  doc.forEach((child) => {
    const id = child.attrs.id as string | null | undefined;
    if (id === undefined || (id && !seen.has(id))) {
      if (id) seen.add(id);
      children.push(child);
      return;
    }
    const fresh = newBlockId();
    seen.add(fresh);
    changed = true;
    children.push(child.type.create({ ...child.attrs, id: fresh }, child.content, child.marks));
  });
  return changed ? doc.copy(Fragment.fromArray(children)) : doc;
}

/** Plain text of a page: blocks and table cells separated by newlines, no attrs. */
export function nodeToText(doc: PmNode): string {
  return doc
    .textBetween(0, doc.content.size, '\n', (leaf) => (leaf.type.name === 'hardBreak' ? '\n' : ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
