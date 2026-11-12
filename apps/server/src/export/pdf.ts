// Export, part 3: the saved document as a PDF (docs/done-checks/16-export.md,
// Decisions, "PDF"). Built in memory with pdfmake and its bundled Roboto
// fonts; always the calm light look, also for people in dark mode. pdfmake
// may never load anything from the internet and may only read its own font
// files: both are refused below. Images are drawn only from bytes the
// collector read through readableAttachment.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Content, ContentText, CustomTableLayout, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { formatBytes } from '@stillwater/editor-schema';
import { downloadName, resolveLink, type ExportBundle, type ExportFile, type ExportPage, type PmNode } from './collect.js';
import { CALLOUT_WORDS, NOT_AVAILABLE, type ExportOutput } from './markdown.js';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake') as typeof import('pdfmake');
const FONT_DIR = join(dirname(require.resolve('pdfmake/fonts/Roboto.js')), 'Roboto');
const COURIER = ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'];

pdfmake.setFonts({
  Roboto: {
    normal: join(FONT_DIR, 'Roboto-Regular.ttf'),
    bold: join(FONT_DIR, 'Roboto-Medium.ttf'),
    italics: join(FONT_DIR, 'Roboto-Italic.ttf'),
    bolditalics: join(FONT_DIR, 'Roboto-MediumItalic.ttf'),
  },
  // One of the PDF standard fonts: built into every reader, nothing to load.
  Courier: { normal: COURIER[0]!, bold: COURIER[1]!, italics: COURIER[2]!, bolditalics: COURIER[3]! },
});
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path) => COURIER.includes(path) || (path.startsWith(FONT_DIR) && !path.includes('..')));

/** The app's light colours (apps/web/src/styles/tokens.css). */
const C = {
  text: '#2b2b28',
  muted: '#635f58',
  faint: '#8d8880',
  border: '#e3dfd8',
  sunken: '#f5f3ef',
  accent: '#3f6f68',
  tones: {
    info: { fg: '#3f6f68', bg: '#e4ede9' },
    success: { fg: '#3c6b4b', bg: '#e5efe6' },
    warning: { fg: '#7d5f26', bg: '#f3ead7' },
    danger: { fg: '#9a3f37', bg: '#f3e3e0' },
  } as Record<string, { fg: string; bg: string }>,
};

const A4_WIDTH = 595.28;
const MARGIN = { side: 64, top: 64, bottom: 72 };
const COLUMN = A4_WIDTH - 2 * MARGIN.side;
const MAX_IMAGE_HEIGHT = 620;

export interface PdfOptions {
  /** Off only in tests, so the text can be read back. */
  compress?: boolean;
}

/** Which readable files the PDF draws (and so needs the bytes of). */
export function pdfWantsBytes(file: { mime: string }): boolean {
  return file.mime === 'image/png' || file.mime === 'image/jpeg';
}

/** Pixel size of a PNG or JPEG from its bytes, or null if it is neither (or broken). */
export function imageSize(data: Buffer): { kind: 'png' | 'jpeg'; width: number; height: number } | null {
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47 && data.readUInt32BE(4) === 0x0d0a1a0a) {
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    return width > 0 && height > 0 ? { kind: 'png', width, height } : null;
  }
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) return null;
      const marker = data[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        const height = data.readUInt16BE(i + 5);
        const width = data.readUInt16BE(i + 7);
        return width > 0 && height > 0 ? { kind: 'jpeg', width, height } : null;
      }
      i += 2 + data.readUInt16BE(i + 2);
    }
  }
  return null;
}

interface Ctx {
  bundle: ExportBundle;
  /** Width left for content here (lists, quotes and boxes take some). */
  width: number;
  drawImages: boolean;
}

const soft = (color = C.border): CustomTableLayout => ({
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => color,
  vLineColor: () => color,
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 4,
  paddingBottom: () => 4,
});

const box = (pad: number): CustomTableLayout => ({
  hLineWidth: () => 0,
  vLineWidth: () => 0,
  paddingLeft: () => pad,
  paddingRight: () => pad,
  paddingTop: () => pad,
  paddingBottom: () => Math.max(0, pad - 6),
});

/** A tinted box holding `inner`, the way code blocks and callouts look in the app. */
function tinted(inner: Content[], fill: string, pad = 10): Content {
  return { table: { widths: ['*'], body: [[{ stack: inner, fillColor: fill }]] }, layout: box(pad), margin: [0, 2, 0, 10] };
}

function attachmentUrl(ctx: Ctx, id: string): string {
  return `${ctx.bundle.publicUrl}/api/attachments/${id}`;
}

function personName(ctx: Ctx, id: unknown, saved: unknown): string {
  const name = typeof id === 'string' ? ctx.bundle.people.get(id.toLowerCase()) : undefined;
  return name ?? String(saved ?? '');
}

/** True when every character is in the code page the standard Courier font covers. */
const courierSafe = (s: string) => /^[\u0009\u000a\u000d -~ -ÿ]*$/.test(s);

function linkProps(ctx: Ctx, href: string): Partial<ContentText> {
  const target = resolveLink(ctx.bundle, href);
  if ('page' in target) return { linkToDestination: `page-${target.page.id}`, color: C.accent };
  return { link: target.url, color: C.accent };
}

function inlines(node: PmNode, ctx: Ctx): ContentText[] {
  const runs: ContentText[] = [];
  node.forEach((child) => {
    let run: ContentText;
    if (child.isText) run = { text: child.text ?? '' };
    else if (child.type.name === 'mention') run = { text: `@${personName(ctx, child.attrs.userId, child.attrs.label)}`, color: C.accent };
    else if (child.type.name === 'hardBreak') run = { text: '\n' };
    else return;
    for (const m of child.marks) {
      if (m.type.name === 'bold') run.bold = true;
      else if (m.type.name === 'italic') run.italics = true;
      else if (m.type.name === 'strike') run.decoration = 'lineThrough';
      else if (m.type.name === 'code') {
        if (courierSafe(String(run.text))) run.font = 'Courier';
        run.fontSize = 9.5;
        run.background = C.sunken;
      } else if (m.type.name === 'link') Object.assign(run, linkProps(ctx, String(m.attrs.href ?? '')));
    }
    runs.push(run);
  });
  return runs;
}

const line = (text: string | ContentText[], extra: Partial<ContentText> = {}): ContentText => ({ text, margin: [0, 0, 0, 8], ...extra });
const quietLine = (text: string): ContentText => line(text, { color: C.muted, italics: true });

function blocks(parent: PmNode, ctx: Ctx): Content[] {
  const out: Content[] = [];
  parent.forEach((child) => out.push(...block(child, ctx)));
  return out;
}

function listItems(node: PmNode, ctx: Ctx, task: boolean): Content[] {
  const inner: Ctx = { ...ctx, width: ctx.width - 18 };
  const items: Content[] = [];
  node.forEach((item) => {
    const content = blocks(item, inner);
    if (task) {
      const box: ContentText = { text: item.attrs.checked ? '[x] ' : '[ ] ', font: 'Courier', fontSize: 9.5, color: C.muted };
      const suffix: string[] = [];
      const who = typeof item.attrs.assignee === 'string' ? ctx.bundle.people.get(item.attrs.assignee.toLowerCase()) : undefined;
      if (who) suffix.push(`@${who}`);
      if (typeof item.attrs.due === 'string') suffix.push(`due ${item.attrs.due}`);
      const first = content[0] as ContentText | undefined;
      const tail: ContentText[] = suffix.length ? [{ text: ` — ${suffix.join(', ')}`, color: C.muted }] : [];
      if (first && Array.isArray(first.text)) first.text = [box, ...(first.text as ContentText[]), ...tail];
      else content.unshift(line([box, ...tail]));
    }
    for (const c of content) if (typeof c === 'object' && 'margin' in c) (c as ContentText).margin = [0, 0, 0, 3];
    items.push({ stack: content });
  });
  return items;
}

function block(node: PmNode, ctx: Ctx): Content[] {
  const a = node.attrs;
  switch (node.type.name) {
    case 'paragraph': {
      const runs = inlines(node, ctx);
      return runs.length ? [line(runs)] : [];
    }
    case 'heading': {
      const size = ({ 1: 17, 2: 14.5, 3: 12.5 } as Record<number, number>)[Number(a.level)] ?? 12.5;
      return [line(inlines(node, ctx), { fontSize: size, bold: true, margin: [0, 10, 0, 6] })];
    }
    case 'bulletList':
      return [{ ul: listItems(node, ctx, false), markerColor: C.muted, margin: [0, 0, 0, 8] }];
    case 'orderedList':
      return [{ ol: listItems(node, ctx, false), start: Number(a.start) || 1, markerColor: C.muted, margin: [0, 0, 0, 8] }];
    case 'taskList':
      return [{ ul: listItems(node, ctx, true), type: 'none', margin: [0, 0, 0, 8] }];
    case 'listItem':
    case 'taskItem':
      return blocks(node, ctx);
    case 'blockquote':
      return [
        {
          table: { widths: ['*'], body: [[{ stack: blocks(node, { ...ctx, width: ctx.width - 14 }), color: C.muted }]] },
          layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 2 : 0), vLineColor: () => C.border, paddingLeft: () => 12, paddingRight: () => 0, paddingTop: () => 2, paddingBottom: () => 0 },
          margin: [0, 0, 0, 8],
        },
      ];
    case 'horizontalRule':
      return [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: ctx.width, y2: 0, lineWidth: 0.75, lineColor: C.border }], margin: [0, 6, 0, 14] }];
    case 'codeBlock': {
      const text = node.textContent || ' ';
      return [tinted([{ text, ...(courierSafe(text) ? { font: 'Courier' } : {}), fontSize: 9, lineHeight: 1.25, preserveLeadingSpaces: true, margin: [0, 0, 0, 6] }], C.sunken)];
    }
    case 'table': {
      const rows: Content[][] = [];
      node.forEach((row, _o, r) => {
        const cells: Content[] = [];
        row.forEach((cell) => {
          const inner = blocks(cell, { ...ctx, width: 120 });
          for (const c of inner) if (typeof c === 'object' && 'margin' in c) (c as ContentText).margin = [0, 0, 0, 3];
          cells.push({ stack: inner, ...(r === 0 ? { bold: true } : {}) });
        });
        rows.push(cells);
      });
      if (rows.length === 0) return [];
      const cols = Math.max(...rows.map((r) => r.length));
      for (const r of rows) while (r.length < cols) r.push('');
      return [
        {
          table: { headerRows: 1, widths: Array(cols).fill('*'), body: rows },
          layout: { ...soft(), fillColor: (row: number) => (row === 0 ? C.sunken : null) },
          margin: [0, 2, 0, 10],
        },
      ];
    }
    case 'callout': {
      const tone = C.tones[String(a.tone)] ?? C.tones.info!;
      const word = CALLOUT_WORDS[String(a.tone)] ?? CALLOUT_WORDS.info!;
      return [tinted([{ text: word, bold: true, color: tone.fg, margin: [0, 0, 0, 4] }, ...blocks(node, { ...ctx, width: ctx.width - 20 })], tone.bg)];
    }
    case 'image':
      return image(node, ctx);
    case 'file': {
      const file = fileFor(ctx, a.attachmentId);
      if (!file) return [quietLine(NOT_AVAILABLE.file)];
      const name = String(a.filename || file.filename);
      return [line([{ text: 'File: ', color: C.muted }, { text: name, link: attachmentUrl(ctx, file.id), color: C.accent }, { text: ` · ${formatBytes(file.size)}`, color: C.muted }])];
    }
    case 'video': {
      if (typeof a.embedUrl === 'string' && a.embedUrl) {
        return [line([{ text: 'Video: ', color: C.muted }, { text: a.embedUrl, link: a.embedUrl, color: C.accent }])];
      }
      const file = fileFor(ctx, a.attachmentId);
      if (!file) return [quietLine(NOT_AVAILABLE.video)];
      return [line([{ text: 'Video: ', color: C.muted }, { text: String(a.filename || file.filename), link: attachmentUrl(ctx, file.id), color: C.accent }])];
    }
    case 'linkPreview': {
      const url = String(a.url ?? '');
      const title = String(a.title || url);
      const description = String(a.description ?? '').trim();
      return [
        {
          stack: [
            { text: title, link: url, color: C.accent, bold: true },
            ...(description ? [{ text: description, color: C.muted, margin: [0, 2, 0, 0] } as ContentText] : []),
            ...(a.title ? [{ text: url, link: url, color: C.faint, fontSize: 8.5, margin: [0, 2, 0, 0] } as ContentText] : []),
          ],
          unbreakable: true,
          margin: [0, 0, 0, 10],
        },
      ];
    }
    default:
      if (node.inlineContent) return [line(inlines(node, ctx))];
      return blocks(node, ctx);
  }
}

function fileFor(ctx: Ctx, id: unknown): ExportFile | undefined {
  return typeof id === 'string' ? ctx.bundle.files.get(id.toLowerCase()) : undefined;
}

function image(node: PmNode, ctx: Ctx): Content[] {
  const a = node.attrs;
  const file = fileFor(ctx, a.attachmentId);
  if (!file) return [quietLine(NOT_AVAILABLE.image)];
  const caption = String(a.caption ?? '').trim();
  const out: Content[] = [];
  const size = ctx.drawImages && file.data ? imageSize(file.data) : null;
  if (size) {
    let width = Math.min(size.width * 0.75, ctx.width);
    let height = (width * size.height) / size.width;
    if (height > MAX_IMAGE_HEIGHT) {
      width = (width * MAX_IMAGE_HEIGHT) / height;
      height = MAX_IMAGE_HEIGHT;
    }
    const mime = size.kind === 'png' ? 'image/png' : 'image/jpeg';
    out.push({ image: `data:${mime};base64,${file.data!.toString('base64')}`, width, height, margin: [0, 2, 0, caption ? 4 : 10] });
  } else {
    out.push(line([{ text: 'Image: ', color: C.muted }, { text: file.filename, link: attachmentUrl(ctx, file.id), color: C.accent }], caption ? { margin: [0, 0, 0, 2] } : {}));
  }
  if (caption) out.push({ text: caption, italics: true, color: C.muted, fontSize: 9.5, margin: [0, 0, 0, 10] });
  return out;
}

function exportedLine(bundle: ExportBundle): string {
  const date = bundle.exportedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `${bundle.space.name} · Exported ${date} by ${bundle.exportedBy}`;
}

const titleOf = (p: ExportPage) => p.title.trim() || 'Untitled';

function definition(bundle: ExportBundle, opts: PdfOptions, drawImages: boolean): TDocumentDefinitions {
  const ctx: Ctx = { bundle, width: COLUMN, drawImages };
  const content: Content[] = [];
  const tree = bundle.pages.length > 1;
  if (tree) {
    content.push(
      { text: titleOf(bundle.root), fontSize: 22, bold: true, margin: [0, 0, 0, 4] },
      { text: exportedLine(bundle), fontSize: 9, color: C.muted, margin: [0, 0, 0, 24] },
      { text: 'Contents', fontSize: 13, bold: true, margin: [0, 0, 0, 10] },
      ...bundle.pages.map(
        (p): Content => ({ text: titleOf(p), linkToDestination: `page-${p.id}`, color: C.text, margin: [p.depth * 16, 0, 0, 5] }),
      ),
    );
  }
  bundle.pages.forEach((page, i) => {
    content.push(
      { text: titleOf(page), id: `page-${page.id}`, fontSize: 22, bold: true, margin: [0, 0, 0, 4], ...(tree || i > 0 ? { pageBreak: 'before' as const } : {}) },
      { text: exportedLine(bundle), fontSize: 9, color: C.muted, margin: [0, 0, 0, 20] },
      ...blocks(page.doc, ctx),
    );
  });
  return {
    pageSize: 'A4',
    pageMargins: [MARGIN.side, MARGIN.top, MARGIN.side, MARGIN.bottom],
    compress: opts.compress ?? true,
    info: { title: titleOf(bundle.root), author: bundle.exportedBy, creator: 'Stillwater', producer: 'Stillwater' },
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.3, color: C.text },
    footer: (current: number, count: number) => ({ text: `${current} / ${count}`, alignment: 'center', fontSize: 8.5, color: C.faint, margin: [0, 32, 0, 0] }),
    content,
  };
}

/** One .pdf. If an image cannot be drawn, the PDF is made again with images as named lines. */
export async function buildPdfExport(bundle: ExportBundle, opts: PdfOptions = {}): Promise<ExportOutput> {
  let body: Buffer;
  try {
    body = await pdfmake.createPdf(definition(bundle, opts, true)).getBuffer();
  } catch {
    body = await pdfmake.createPdf(definition(bundle, opts, false)).getBuffer();
  }
  return { filename: downloadName(bundle.root.title, 'pdf'), contentType: 'application/pdf', body };
}
