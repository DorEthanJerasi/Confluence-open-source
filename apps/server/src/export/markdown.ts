// Export, part 2: the saved document as Markdown, and the zip that holds a
// tree of pages and their files (docs/done-checks/16-export.md, Decisions,
// "Markdown"). Pure functions of the bundle collectExport made: they read
// nothing and write nothing. Every piece of page text is escaped, so text that
// looks like Markdown or HTML stays text.
import { posix } from 'node:path';
import { zipSync, strToU8, type Zippable } from 'fflate';
import { formatBytes } from '@stillwater/editor-schema';
import { cleanFilename } from '../files/attachments.js';
import { downloadName, resolveLink, type ExportBundle, type ExportFile, type ExportPage, type PmNode } from './collect.js';

export interface ExportOutput {
  filename: string;
  contentType: string;
  body: Buffer;
}

/** The tone word that opens a callout, the same in Markdown and PDF. */
export const CALLOUT_WORDS: Record<string, string> = { info: 'Note', success: 'Tip', warning: 'Warning', danger: 'Caution' };

export const NOT_AVAILABLE = { image: 'Image not available', file: 'File not available', video: 'Video not available' } as const;

// ---------- names and paths ----------

/** A file or folder name from a page title: lower-case, spaces to "-", unsafe characters dropped. */
export function slug(title: string): string {
  const s = title
    .toLowerCase()
    .normalize('NFC')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 80)
    .replace(/[-_]+$/g, '');
  return s || 'untitled';
}

function unique(base: string, used: Set<string>): string {
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
  used.add(name);
  return name;
}

/**
 * Where each page's .md file sits in the zip. A page with sub-pages also gets
 * a folder of the same name holding them. Names clash only among siblings;
 * "attachments" is kept free at the top for the files.
 */
export function planPaths(root: ExportPage): Map<string, string> {
  const paths = new Map<string, string>();
  const place = (page: ExportPage, dir: string, used: Set<string>) => {
    const name = unique(slug(page.title), used);
    paths.set(page.id, `${dir}${name}.md`);
    const inner = new Set<string>();
    for (const child of page.children) place(child, `${dir}${name}/`, inner);
  };
  place(root, '', new Set(['attachments']));
  return paths;
}

/** attachments/<id>-<clean file name>. */
export function attachmentPath(file: ExportFile): string {
  const name = cleanFilename(file.filename)
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '');
  return `attachments/${file.id}-${name || 'file'}`;
}

/** A relative path written as a link target: each part percent-encoded. */
function relativeLink(fromFile: string, to: string): string {
  return posix
    .relative(posix.dirname(fromFile), to)
    .split('/')
    .map((part) => (part === '..' ? part : encodeURIComponent(part)))
    .join('/');
}

/** An address as a link target: brackets, spaces and angle brackets encoded so the link cannot break. */
function linkTarget(url: string): string {
  return url.replace(/[()<>\s]/g, (c) => encodeURIComponent(c));
}

// ---------- text ----------

/** Escape page text so Markdown and HTML in it stay text. */
export function escapeText(s: string): string {
  return s.replace(/[\\`*_[\]<>#|~&]/g, (c) => `\\${c}`);
}

/** Escape what would start a block at the beginning of a line (lists, setext lines). */
function escapeLineStarts(s: string): string {
  return s
    .split('\n')
    .map((line) => line.replace(/^[ \t]+/, '').replace(/^([-+=])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2'))
    .join('\n');
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  const pad = /^[` ]|[` ]$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'code'];
const DELIMS: Record<string, string> = { bold: '**', italic: '*', strike: '~~' };

interface Ctx {
  bundle: ExportBundle;
  /** The .md file being written, for relative links. */
  file: string;
  paths: Map<string, string>;
}

function hrefFor(ctx: Ctx, href: string): string {
  const target = resolveLink(ctx.bundle, href);
  if ('page' in target) return relativeLink(ctx.file, ctx.paths.get(target.page.id)!);
  return linkTarget(target.url);
}

function personName(ctx: Ctx, id: unknown, saved: unknown): string {
  const name = typeof id === 'string' ? ctx.bundle.people.get(id.toLowerCase()) : undefined;
  return name ?? String(saved ?? '');
}

type Mark = PmNode['marks'][number];

/** Inline content (text with marks, mentions, hard breaks) as Markdown. */
function inline(node: PmNode, ctx: Ctx): string {
  let out = '';
  let active: Mark[] = [];
  const close = (from: number) => {
    const trailing = /\s+$/.exec(out)?.[0] ?? '';
    if (trailing) out = out.slice(0, -trailing.length);
    for (let i = active.length - 1; i >= from; i--) {
      const m = active[i]!;
      if (m.type.name === 'link') out += `](${hrefFor(ctx, String(m.attrs.href ?? ''))})`;
      else if (DELIMS[m.type.name]) out += DELIMS[m.type.name];
    }
    out += trailing;
    active = active.slice(0, from);
  };
  node.forEach((child) => {
    const marks = child.marks
      .filter((m) => MARK_ORDER.includes(m.type.name))
      .sort((a, b) => MARK_ORDER.indexOf(a.type.name) - MARK_ORDER.indexOf(b.type.name));
    let keep = 0;
    while (keep < active.length && keep < marks.length && active[keep]!.eq(marks[keep]!)) keep++;
    if (keep < active.length) close(keep);
    let text: string;
    if (child.isText) {
      const isCode = marks.some((m) => m.type.name === 'code');
      text = isCode ? codeSpan(child.text ?? '') : escapeText(child.text ?? '');
    } else if (child.type.name === 'mention') {
      text = `@${escapeText(personName(ctx, child.attrs.userId, child.attrs.label))}`;
    } else if (child.type.name === 'hardBreak') {
      text = '\\\n';
    } else {
      text = '';
    }
    if (keep < marks.length) {
      const leading = /^\s+/.exec(text)?.[0] ?? '';
      out += leading;
      text = text.slice(leading.length);
      for (const m of marks.slice(keep)) {
        if (m.type.name === 'link') out += '[';
        else if (DELIMS[m.type.name]) out += DELIMS[m.type.name];
        active.push(m);
      }
    }
    out += text;
  });
  close(0);
  return out;
}

function prefixLines(text: string, first: string, rest: string): string {
  return text
    .split('\n')
    .map((line, i) => (line === '' ? (i === 0 ? first : rest).trimEnd() : (i === 0 ? first : rest) + line))
    .join('\n');
}

function quote(text: string): string {
  return prefixLines(text, '> ', '> ');
}

function blocks(parent: PmNode, ctx: Ctx, sep = '\n\n'): string {
  const parts: string[] = [];
  parent.forEach((child) => {
    const md = block(child, ctx);
    if (md !== '') parts.push(md);
  });
  return parts.join(sep);
}

function listItem(item: PmNode, marker: string, ctx: Ctx, suffix = ''): string {
  let body = blocks(item, ctx, '\n');
  if (suffix) {
    const nl = body.indexOf('\n');
    body = nl === -1 ? body + suffix : body.slice(0, nl) + suffix + body.slice(nl);
  }
  return prefixLines(body || '', `${marker} `, ' '.repeat(marker.length + 1));
}

function taskSuffix(item: PmNode, ctx: Ctx): string {
  const parts: string[] = [];
  const who = typeof item.attrs.assignee === 'string' ? ctx.bundle.people.get(item.attrs.assignee.toLowerCase()) : undefined;
  if (who) parts.push(`@${escapeText(who)}`);
  if (typeof item.attrs.due === 'string') parts.push(`due ${item.attrs.due}`);
  return parts.length ? ` — ${parts.join(', ')}` : '';
}

function tableCell(cell: PmNode, ctx: Ctx): string {
  const parts: string[] = [];
  cell.forEach((child) => {
    const md = block(child, ctx);
    if (md !== '') parts.push(md.replace(/\\\n/g, '<br>').replace(/\n+/g, '<br>'));
  });
  return parts.join('<br>').replace(/(?<!\\)\|/g, '\\|') || ' ';
}

function table(node: PmNode, ctx: Ctx): string {
  const rows: string[][] = [];
  node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(tableCell(cell, ctx)));
    rows.push(cells);
  });
  if (rows.length === 0) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: cols }, (_, i) => cells[i] ?? ' ').join(' | ')} |`;
  return [line(rows[0]!), line(Array(cols).fill('---')), ...rows.slice(1).map(line)].join('\n');
}

function fileFor(ctx: Ctx, id: unknown): ExportFile | undefined {
  return typeof id === 'string' ? ctx.bundle.files.get(id.toLowerCase()) : undefined;
}

function block(node: PmNode, ctx: Ctx): string {
  const a = node.attrs;
  switch (node.type.name) {
    case 'paragraph':
      return escapeLineStarts(inline(node, ctx));
    case 'heading':
      return `${'#'.repeat(Math.min(6, Number(a.level) + 1))} ${inline(node, ctx).replace(/\\\n/g, ' ')}`;
    case 'bulletList': {
      const items: string[] = [];
      node.forEach((item) => items.push(listItem(item, '-', ctx)));
      return items.join('\n');
    }
    case 'orderedList': {
      const items: string[] = [];
      let n = Number(a.start) || 1;
      node.forEach((item) => items.push(listItem(item, `${n++}.`, ctx)));
      return items.join('\n');
    }
    case 'taskList': {
      const items: string[] = [];
      node.forEach((item) => items.push(listItem(item, item.attrs.checked ? '- [x]' : '- [ ]', ctx, taskSuffix(item, ctx))));
      return items.join('\n');
    }
    case 'listItem':
    case 'taskItem':
      return listItem(node, '-', ctx);
    case 'blockquote':
      return quote(blocks(node, ctx));
    case 'horizontalRule':
      return '---';
    case 'codeBlock': {
      const text = node.textContent;
      const longest = Math.max(0, ...(text.match(/`{3,}/g) ?? []).map((r) => r.length));
      const fence = '`'.repeat(Math.max(3, longest + 1));
      const lang = typeof a.language === 'string' ? a.language.replace(/[^\w+#.-]/g, '') : '';
      return `${fence}${lang}\n${text}\n${fence}`;
    }
    case 'table':
      return table(node, ctx);
    case 'callout': {
      const word = CALLOUT_WORDS[String(a.tone)] ?? CALLOUT_WORDS.info;
      const body = blocks(node, ctx);
      return quote(body ? `**${word}**\n\n${body}` : `**${word}**`);
    }
    case 'image': {
      const file = fileFor(ctx, a.attachmentId);
      if (!file) return NOT_AVAILABLE.image;
      const caption = String(a.caption ?? '').trim();
      const alt = String(a.alt || caption || '').replace(/\s+/g, ' ').trim();
      const img = `![${escapeText(alt)}](${relativeLink(ctx.file, attachmentPath(file))})`;
      return caption ? `${img}\n\n*${escapeText(caption.replace(/\s+/g, ' '))}*` : img;
    }
    case 'file': {
      const file = fileFor(ctx, a.attachmentId);
      if (!file) return NOT_AVAILABLE.file;
      const name = String(a.filename || file.filename);
      return `[${escapeText(name)}](${relativeLink(ctx.file, attachmentPath(file))}) (${formatBytes(file.size)})`;
    }
    case 'video': {
      if (typeof a.embedUrl === 'string' && a.embedUrl) return `[Video](${linkTarget(a.embedUrl)})`;
      const file = fileFor(ctx, a.attachmentId);
      if (!file) return NOT_AVAILABLE.video;
      const name = String(a.filename || file.filename);
      return `[Video: ${escapeText(name)}](${relativeLink(ctx.file, attachmentPath(file))})`;
    }
    case 'linkPreview': {
      const url = String(a.url ?? '');
      const title = String(a.title || url).replace(/\s+/g, ' ').trim();
      const link = `[${escapeText(title)}](${linkTarget(url)})`;
      const description = String(a.description ?? '').replace(/\s+/g, ' ').trim();
      return description ? `${link}\n\n${escapeLineStarts(escapeText(description))}` : link;
    }
    default:
      // Any other block with inline content is written as text; others are skipped.
      return node.inlineContent ? escapeLineStarts(inline(node, ctx)) : node.childCount ? blocks(node, ctx) : '';
  }
}

/** One page as a Markdown file: its title, then its blocks. */
export function pageToMarkdown(page: ExportPage, bundle: ExportBundle, paths: Map<string, string>): string {
  const ctx: Ctx = { bundle, file: paths.get(page.id) ?? `${slug(page.title)}.md`, paths };
  const title = page.title.trim() || 'Untitled';
  const body = blocks(page.doc, ctx);
  return `# ${escapeText(title.replace(/\s+/g, ' '))}\n${body ? `\n${body}\n` : ''}`;
}

/** One .md file, or a .zip of the tree and its files (see Decisions). */
export function buildMarkdownExport(bundle: ExportBundle): ExportOutput {
  const paths = planPaths(bundle.root);
  const used = [...bundle.files.values()].filter((f) => f.data);
  if (bundle.pages.length === 1 && used.length === 0) {
    const page = bundle.root;
    return { filename: downloadName(page.title, 'md'), contentType: 'text/markdown; charset=utf-8', body: Buffer.from(pageToMarkdown(page, bundle, paths), 'utf8') };
  }
  const mtime = bundle.exportedAt;
  const entries: Zippable = {};
  for (const page of bundle.pages) {
    entries[paths.get(page.id)!] = [strToU8(pageToMarkdown(page, bundle, paths)), { level: 6, mtime }];
  }
  for (const file of used) {
    entries[attachmentPath(file)] = [new Uint8Array(file.data!), { level: 0, mtime }];
  }
  return { filename: downloadName(bundle.root.title, 'zip'), contentType: 'application/zip', body: Buffer.from(zipSync(entries)) };
}
