// The one editor schema (ARCHITECTURE.md §3). The web editor, the server's
// validation and text extraction, and (later) the co-editing server all build
// their schema from getExtensions(). A node type not listed here does not exist.
import { Extension, Node, getSchema, mergeAttributes, type AnyExtension, type NodeViewRenderer } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Fragment, Node as PmNode, type DOMOutputSpec, type Schema } from '@tiptap/pm/model';
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
import { videoEmbedUrl } from '@stillwater/shared';

export { diffBlocks, type BlockDiff, type BlockJson, type DocJson } from './diff.js';

// Keep the extensions' command typings (setHeading, insertTable, …) visible to editors.
export type {} from '@tiptap/starter-kit';
export type {} from '@tiptap/extension-task-list';
export type {} from '@tiptap/extension-table';
export type {} from '@tiptap/extension-link';
export type {} from '@tiptap/extension-code-block-lowlight';

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
  'image',
  'file',
  'video',
  'linkPreview',
] as const;

export const CALLOUT_TONES = ['info', 'success', 'warning', 'danger'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/** Link targets we keep. Anything else (javascript:, data:, …) is refused. */
const SAFE_HREF = /^(https?:|mailto:|\/|#)/i;

/** An uploaded file is referenced by its attachment id only (ARCHITECTURE.md §3, rule 3). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where the server hands out an attachment. The only URL an image or file block ever uses. */
export function attachmentUrl(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}`;
}

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

/** A uuid string or null; anything else (a URL, bytes, …) parses to null. */
function attachmentIdAttr() {
  return {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute('data-attachment-id');
      return v && UUID.test(v) ? v : null;
    },
    renderHTML: (attrs: Record<string, unknown>) => (attrs.attachmentId ? { 'data-attachment-id': attrs.attachmentId } : {}),
  };
}

/**
 * An uploaded image with an optional caption. Stores only the attachment id;
 * the picture is always loaded from the permission-checked attachment route.
 */
export const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      attachmentId: attachmentIdAttr(),
      alt: { default: '', parseHTML: (el) => el.querySelector('img')?.getAttribute('alt') ?? '', renderHTML: () => ({}) },
      caption: {
        default: '',
        parseHTML: (el) => el.querySelector('figcaption')?.textContent ?? '',
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-image]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const id = node.attrs.attachmentId as string | null;
    const img: DOMOutputSpec = ['img', { src: id ? attachmentUrl(id) : '', alt: node.attrs.alt || node.attrs.caption || '', loading: 'lazy' }];
    const caption = node.attrs.caption as string;
    const figure = mergeAttributes(HTMLAttributes, { 'data-image': '', class: 'embed embed-image' });
    return caption ? ['figure', figure, img, ['figcaption', {}, caption]] : ['figure', figure, img];
  },
});

/** An uploaded file of any kind: name, size and a download link. Stores the attachment id only. */
export const FileBlock = Node.create({
  name: 'file',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      attachmentId: attachmentIdAttr(),
      filename: { default: 'file', parseHTML: (el) => el.getAttribute('data-filename') ?? 'file', renderHTML: (a) => ({ 'data-filename': a.filename }) },
      size: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-size')) || 0,
        renderHTML: (a) => ({ 'data-size': String(a.size) }),
      },
      mime: { default: '', parseHTML: (el) => el.getAttribute('data-mime') ?? '', renderHTML: (a) => ({ 'data-mime': a.mime }) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-file]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const id = node.attrs.attachmentId as string | null;
    const name = String(node.attrs.filename);
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-file': '', class: 'embed embed-file' }),
      ['a', { href: id ? attachmentUrl(id) : '#', download: name, rel: 'noopener' }, name],
      ['span', { class: 'embed-file-size' }, formatBytes(Number(node.attrs.size) || 0)],
    ];
  },
});

/** Uploaded videos the browser plays in a `<video>`; any other video upload becomes a file block. */
export const VIDEO_MIMES = ['video/mp4', 'video/webm'] as const;

/**
 * True only for a player URL exactly as `videoEmbedUrl` makes it: a
 * youtube-nocookie.com embed or a player.vimeo.com video. Nothing else may sit
 * in a video block, so no other site is ever framed in a page.
 */
export function isVideoEmbedUrl(v: unknown): v is string {
  return typeof v === 'string' && videoEmbedUrl(v) === v;
}

const WEB_URL = /^https?:\/\/[^\s]+$/i;

/** A plain http(s) address, or null. */
function webUrlAttr(key: string, data = key) {
  return {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute(`data-${data}`);
      return v && WEB_URL.test(v) ? v : null;
    },
    renderHTML: (attrs: Record<string, unknown>) => (attrs[key] ? { [`data-${data}`]: attrs[key] } : {}),
  };
}

/** A short text attr kept on a `data-` attribute. */
function textAttr(key: string, data = key) {
  return {
    default: '',
    parseHTML: (el: HTMLElement) => el.getAttribute(`data-${data}`) ?? '',
    renderHTML: (attrs: Record<string, unknown>) => (attrs[key] ? { [`data-${data}`]: String(attrs[key]) } : {}),
  };
}

/**
 * A video: either an uploaded mp4/webm (attachment id) played in a `<video>`,
 * or a YouTube/Vimeo player URL (`embedUrl`, allow-listed). Exactly one is set.
 */
export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      attachmentId: attachmentIdAttr(),
      embedUrl: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('data-embed-url');
          return isVideoEmbedUrl(v) ? v : null;
        },
        renderHTML: (attrs: Record<string, unknown>) => (attrs.embedUrl ? { 'data-embed-url': attrs.embedUrl } : {}),
      },
      filename: textAttr('filename'),
      mime: textAttr('mime'),
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-video]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const wrap = mergeAttributes(HTMLAttributes, { 'data-video': '', class: 'embed embed-video' });
    const id = node.attrs.attachmentId as string | null;
    if (id) return ['div', wrap, ['video', { src: attachmentUrl(id), controls: '', preload: 'metadata' }]];
    const src = node.attrs.embedUrl as string | null;
    if (isVideoEmbedUrl(src)) {
      return ['div', wrap, ['iframe', { src, title: 'Video', allowfullscreen: '', loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin' }]];
    }
    return ['div', wrap];
  },
});

/**
 * A link shown as a card: the address plus the Open Graph title, description,
 * site name and image the server fetched for it (GET /api/link-preview). When
 * the fetch was refused or failed only `url` is set and the card is a plain link.
 */
export const LinkPreview = Node.create({
  name: 'linkPreview',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      url: webUrlAttr('url'),
      title: textAttr('title'),
      description: textAttr('description'),
      siteName: textAttr('siteName', 'site-name'),
      imageUrl: webUrlAttr('imageUrl', 'image-url'),
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-link-preview]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const url = (node.attrs.url as string | null) ?? '';
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-link-preview': '', class: 'embed embed-link' }),
      ['a', { href: url || '#', rel: 'noopener noreferrer nofollow', target: '_blank' }, String(node.attrs.title || url)],
    ];
  },
});

/** "2.4 MB", "830 KB", "12 bytes". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n || 0))} bytes`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

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
  /**
   * Interactive views for the embed blocks (the web editor's upload and caption
   * UI). They change only how a block is drawn, never its schema.
   */
  nodeViews?: Partial<Record<'image' | 'file' | 'video' | 'linkPreview', NodeViewRenderer>>;
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
    withView(Image, opts.nodeViews?.image),
    withView(FileBlock, opts.nodeViews?.file),
    withView(Video, opts.nodeViews?.video),
    withView(LinkPreview, opts.nodeViews?.linkPreview),
    BlockId,
  ];
}

function withView(node: Node, view: NodeViewRenderer | undefined): Node {
  return view ? node.extend({ addNodeView: () => view }) : node;
}

let cached: Schema | null = null;
/** The ProseMirror schema, for code with no editor (the server). */
export function getDocSchema(): Schema {
  return (cached ??= getSchema(getExtensions({ history: false })));
}

export class InvalidDocError extends Error {}

type Json = { [k: string]: unknown };

/** Block-level rules the attr walk cannot see: what a video or a link card must hold. */
function checkEmbed(node: Json, path: string) {
  const a = (node.attrs && typeof node.attrs === 'object' ? node.attrs : {}) as Json;
  if (node.type === 'video') {
    const sources = [a.attachmentId, a.embedUrl].filter((v) => v !== null && v !== undefined && v !== '');
    if (sources.length !== 1) {
      throw new InvalidDocError(`${path}: a video is either an uploaded file or a YouTube or Vimeo link`);
    }
  }
  if (node.type === 'linkPreview' && !(typeof a.url === 'string' && a.url)) {
    throw new InvalidDocError(`${path}.url: a link card needs its address`);
  }
}

/** Walk every attr of every node and mark; refuse inline data and unsafe links. */
function checkAttrs(node: Json, path: string) {
  const attrs = node.attrs;
  if (attrs && typeof attrs === 'object') {
    for (const [k, v] of Object.entries(attrs as Json)) {
      if (typeof v === 'string' && /^\s*data:/i.test(v)) {
        throw new InvalidDocError(`${path}.${k}: files must be uploaded, not pasted into the page`);
      }
      if (k === 'attachmentId' && v !== null && v !== undefined && !(typeof v === 'string' && UUID.test(v))) {
        throw new InvalidDocError(`${path}.${k}: must be the id of an uploaded file`);
      }
      if (k === 'href' && typeof v === 'string' && !SAFE_HREF.test(v.trim())) {
        throw new InvalidDocError(`${path}.${k}: only http, https and mailto links are allowed`);
      }
      if ((k === 'url' || k === 'imageUrl') && v !== null && v !== undefined && !(typeof v === 'string' && WEB_URL.test(v))) {
        throw new InvalidDocError(`${path}.${k}: only http and https addresses are allowed`);
      }
      if (k === 'embedUrl' && v !== null && v !== undefined && !isVideoEmbedUrl(v)) {
        throw new InvalidDocError(`${path}.${k}: only YouTube and Vimeo videos can be embedded`);
      }
    }
  }
  checkEmbed(node, path);
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

/** Text of a leaf block for search: an image's caption, a file's or video's name, a card's title and address. */
function leafText(leaf: PmNode): string {
  if (leaf.type.name === 'hardBreak') return '\n';
  if (leaf.type.name === 'image') return String(leaf.attrs.caption ?? '');
  if (leaf.type.name === 'file') return String(leaf.attrs.filename ?? '');
  if (leaf.type.name === 'video') return String(leaf.attrs.filename ?? '');
  if (leaf.type.name === 'linkPreview') {
    const { title, siteName, url } = leaf.attrs as Record<string, string | null>;
    return [title, siteName, url].filter(Boolean).join(' ');
  }
  return '';
}

/** Plain text of a page: blocks and table cells separated by newlines, no attrs. */
export function nodeToText(doc: PmNode): string {
  return doc
    .textBetween(0, doc.content.size, '\n', leafText)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
