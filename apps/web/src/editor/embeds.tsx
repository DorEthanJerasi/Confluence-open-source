// Embed blocks in the editor (done-check 02-editor.md, 2b): image, file, video
// and link card. The nodes themselves live in packages/editor-schema and hold
// only an attachment id or an allow-listed URL; this file draws them, does the
// uploading (slash menu, paste, drag-drop) and turns pasted links into embeds.
import { useEffect, useReducer, useState } from 'react';
import { createPortal } from 'react-dom';
import { Extension, type Editor, type JSONContent } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { attachmentUrl, formatBytes, isVideoEmbedUrl, newBlockId, VIDEO_MIMES } from '@stillwater/editor-schema';
import { videoEmbedUrl, type LinkPreview } from '@stillwater/shared';
import { Download, Link2, Paperclip } from 'lucide-react';
import { api, errorMessage, type Attachment } from '../api';

export type UploadKind = 'image' | 'file' | 'video';

/** A short line under the page while a file uploads, or after one failed. */
export interface UploadNote {
  tone: 'busy' | 'error';
  text: string;
}

function ImageView({ node, editor, selected, updateAttributes }: NodeViewProps) {
  const id = node.attrs.attachmentId as string | null;
  const caption = (node.attrs.caption as string) ?? '';
  const [broken, setBroken] = useState(false);
  return (
    <NodeViewWrapper as="figure" className={`embed embed-image${selected ? ' is-selected' : ''}`} data-image="" contentEditable={false}>
      {id && !broken ? (
        <img
          src={attachmentUrl(id)}
          alt={(node.attrs.alt as string) || caption}
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="embed-missing">This image could not be loaded.</div>
      )}
      {editor.isEditable ? (
        <input
          className="embed-caption-input"
          type="text"
          value={caption}
          placeholder="Add a caption (optional)"
          aria-label="Image caption"
          onChange={(e) => updateAttributes({ caption: e.target.value })}
        />
      ) : (
        caption && <figcaption>{caption}</figcaption>
      )}
    </NodeViewWrapper>
  );
}

function FileView({ node, selected }: NodeViewProps) {
  const id = node.attrs.attachmentId as string | null;
  const name = String(node.attrs.filename || 'file');
  const size = formatBytes(Number(node.attrs.size) || 0);
  return (
    <NodeViewWrapper className={`embed embed-file${selected ? ' is-selected' : ''}`} data-file="" contentEditable={false}>
      <span className="embed-file-icon" aria-hidden="true">
        <Paperclip size={18} />
      </span>
      <span className="embed-file-text">
        <span className="embed-file-name">{name}</span>
        <span className="embed-file-size">{size}</span>
      </span>
      {id && (
        <a className="btn btn-quiet btn-sm embed-file-download" href={attachmentUrl(id)} download={name} aria-label={`Download ${name}`}>
          <Download size={15} aria-hidden="true" />
          Download
        </a>
      )}
    </NodeViewWrapper>
  );
}

const isPlayable = (mime: string) => (VIDEO_MIMES as readonly string[]).includes(mime);

function playerTitle(src: string): string {
  return src.includes('vimeo.com') ? 'Vimeo video' : 'YouTube video';
}

function VideoView({ node, selected }: NodeViewProps) {
  const id = node.attrs.attachmentId as string | null;
  const src = node.attrs.embedUrl as string | null;
  const name = String(node.attrs.filename || '');
  return (
    <NodeViewWrapper className={`embed embed-video${selected ? ' is-selected' : ''}`} data-video="" contentEditable={false}>
      {id ? (
        <video src={attachmentUrl(id)} controls preload="metadata" aria-label={name || 'Video'} />
      ) : isVideoEmbedUrl(src) ? (
        <div className="embed-video-frame">
          <iframe
            src={src}
            title={playerTitle(src)}
            loading="lazy"
            allow="fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        </div>
      ) : (
        <div className="embed-missing">This video could not be shown.</div>
      )}
    </NodeViewWrapper>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function LinkCardView({ node, selected }: NodeViewProps) {
  const { url, title, description, siteName, imageUrl } = node.attrs as {
    url: string | null;
    title: string;
    description: string;
    siteName: string;
    imageUrl: string | null;
  };
  const [imageOk, setImageOk] = useState(true);
  const href = url ?? '#';
  const rich = !!(title || description);
  return (
    <NodeViewWrapper
      className={`embed embed-link${rich ? '' : ' is-plain'}${selected ? ' is-selected' : ''}`}
      data-link-preview=""
      contentEditable={false}
    >
      <a className="embed-link-card" href={href} target="_blank" rel="noopener noreferrer nofollow">
        {rich ? (
          <>
            <span className="embed-link-text">
              <span className="embed-link-site">{siteName || hostOf(href)}</span>
              {title && <span className="embed-link-title">{title}</span>}
              {description && <span className="embed-link-desc">{description}</span>}
            </span>
            {imageUrl && imageOk && (
              <img
                className="embed-link-image"
                src={imageUrl}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                draggable={false}
                onError={() => setImageOk(false)}
              />
            )}
          </>
        ) : (
          <>
            <span className="embed-link-icon" aria-hidden="true">
              <Link2 size={16} />
            </span>
            <span className="embed-link-url">{href}</span>
          </>
        )}
      </a>
    </NodeViewWrapper>
  );
}

/** Views passed to getExtensions({ nodeViews }) for both the editor and the read-only render. */
export const embedViews = {
  image: ReactNodeViewRenderer(ImageView),
  file: ReactNodeViewRenderer(FileView),
  video: ReactNodeViewRenderer(VideoView),
  linkPreview: ReactNodeViewRenderer(LinkCardView),
};

function blockFor(a: Attachment, kind: UploadKind): JSONContent {
  if (kind === 'image' && a.mime.startsWith('image/')) {
    return { type: 'image', attrs: { attachmentId: a.id, alt: '', caption: '' } };
  }
  if (kind === 'video' && isPlayable(a.mime)) {
    return { type: 'video', attrs: { attachmentId: a.id, filename: a.filename, mime: a.mime } };
  }
  return { type: 'file', attrs: { attachmentId: a.id, filename: a.filename, size: a.size, mime: a.mime } };
}

export interface UploadOptions {
  /** The page that keeps uploaded files; empty in the template editor, where uploads are refused with a note. */
  pageId: string;
  onNote: (note: UploadNote | null) => void;
}

/** Upload each file in turn and put its block at `pos`, one after another. */
async function uploadAll(editor: Editor, files: File[], pos: number, kind: UploadKind | 'auto', opts: UploadOptions) {
  // A template has no page to keep files on (attachments belong to a page).
  if (!opts.pageId) {
    opts.onNote({
      tone: 'error',
      text: 'Files cannot be uploaded into a template yet. Add them to a page, then save that page as a template.',
    });
    return;
  }
  let at = pos;
  let failed = false;
  for (const file of files) {
    opts.onNote({ tone: 'busy', text: `Uploading ${file.name}…` });
    try {
      const a = await api.uploadAttachment(opts.pageId, file);
      if (editor.isDestroyed) return;
      const k: UploadKind =
        kind !== 'auto' ? kind : file.type.startsWith('image/') ? 'image' : isPlayable(file.type) ? 'video' : 'file';
      at = Math.min(at, editor.state.doc.content.size);
      editor.chain().insertContentAt(at, blockFor(a, k)).run();
      at = editor.state.selection.to;
    } catch (err) {
      failed = true;
      opts.onNote({ tone: 'error', text: `Could not upload ${file.name}: ${errorMessage(err)}` });
    }
  }
  if (!failed) opts.onNote(null);
}

const uploadKey = new PluginKey('attachmentUpload');

/** A pasted bare web address, nothing else on the clipboard text. */
const BARE_URL = /^https?:\/\/[^\s<>"]+$/i;

/** "Show as preview card" is on offer for the paragraph at `pos`, which holds just `url`. */
export interface CardOffer {
  pos: number;
  url: string;
}
export const cardOfferKey = new PluginKey<CardOffer | null>('cardOffer');

export function cardOffer(state: EditorState): CardOffer | null {
  return cardOfferKey.getState(state) ?? null;
}

interface EmbedStorage {
  pick: (kind: UploadKind) => void;
  note: (note: UploadNote | null) => void;
}

/**
 * Editors only: paste or drop files to upload them, paste a link to embed it,
 * and `pick` for the slash menu. Viewers never get this extension, so they
 * have no way to upload or to change a block.
 */
export const AttachmentUpload = Extension.create<UploadOptions, EmbedStorage>({
  name: 'attachmentUpload',
  addOptions() {
    return { pageId: '', onNote: () => {} };
  },
  addStorage() {
    return { pick: () => {}, note: () => {} };
  },
  onCreate() {
    const editor = this.editor;
    const opts = this.options;
    this.storage.note = opts.onNote;
    this.storage.pick = (kind) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (kind === 'image') input.accept = 'image/*';
      if (kind === 'video') input.accept = VIDEO_MIMES.join(',');
      input.multiple = true;
      input.addEventListener('change', () => {
        const files = Array.from(input.files ?? []);
        if (files.length) void uploadAll(editor, files, editor.state.selection.from, kind, opts);
      });
      input.click();
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const opts = this.options;
    return [
      new Plugin({
        key: uploadKey,
        props: {
          handlePaste: (view, event) => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (!files.length) return false;
            void uploadAll(editor, files, view.state.selection.from, 'auto', opts);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (moved || !files.length) return false;
            event.preventDefault();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
            void uploadAll(editor, files, pos, 'auto', opts);
            return true;
          },
        },
      }),
      // A bare link pasted on an empty line: a YouTube or Vimeo link becomes a
      // player straight away; any other link goes in as a link, with
      // "Show as preview card" on offer until the line changes or the caret leaves.
      new Plugin<CardOffer | null>({
        key: cardOfferKey,
        state: {
          init: () => null,
          apply(tr, prev) {
            const meta = tr.getMeta(cardOfferKey) as CardOffer | null | undefined;
            if (meta !== undefined) return meta;
            if (!prev) return null;
            const pos = tr.mapping.map(prev.pos);
            const block = tr.doc.nodeAt(pos);
            if (!block || block.type.name !== 'paragraph' || block.textContent !== prev.url) return null;
            const { $from } = tr.selection;
            if ($from.depth < 1 || $from.before(1) !== pos) return null;
            return pos === prev.pos ? prev : { ...prev, pos };
          },
        },
        props: {
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
            if (!BARE_URL.test(text) || text.length > 2048 || event.clipboardData?.files.length) return false;
            const { $from, empty } = view.state.selection;
            if (!empty || $from.depth !== 1 || $from.parent.type.name !== 'paragraph' || $from.parent.content.size) return false;
            const pos = $from.before(1);
            const embed = videoEmbedUrl(text);
            if (embed) {
              editor
                .chain()
                .insertContentAt({ from: pos, to: pos + $from.parent.nodeSize }, { type: 'video', attrs: { embedUrl: embed } })
                .run();
              return true;
            }
            const link = view.state.schema.marks.link!.create({ href: text });
            const tr = view.state.tr.insert($from.pos, view.state.schema.text(text, [link]));
            view.dispatch(tr.setMeta(cardOfferKey, { pos, url: text }));
            return true;
          },
          handleKeyDown: (view, event) => {
            if (event.key !== 'Escape' || !cardOffer(view.state)) return false;
            view.dispatch(view.state.tr.setMeta(cardOfferKey, null));
            return true;
          },
        },
      }),
    ];
  },
});

function storage(editor: Editor): EmbedStorage | undefined {
  return (editor.storage as Record<string, EmbedStorage | undefined>).attachmentUpload;
}

/** Open the file picker from the slash menu (must run inside the click/Enter). */
export function pickAttachment(editor: Editor, kind: UploadKind) {
  storage(editor)?.pick(kind);
}

const emptyCard = (url: string): LinkPreview => ({ url, title: null, description: null, siteName: null, imageUrl: null });

function cardAttrs(p: LinkPreview) {
  return {
    url: p.url,
    title: p.title ?? '',
    description: p.description ?? '',
    siteName: p.siteName ?? '',
    imageUrl: p.imageUrl && /^https?:\/\//i.test(p.imageUrl) ? p.imageUrl : null,
  };
}

/**
 * Put a link card for `url` over `range` at once (a plain link card), then
 * fill in the title, description, site name and image when the server has
 * fetched them. A refused or failed fetch leaves the plain link card.
 */
export async function insertLinkCard(editor: Editor, url: string, range: { from: number; to: number }) {
  const id = newBlockId();
  editor
    .chain()
    .insertContentAt(range, { type: 'linkPreview', attrs: { id, ...cardAttrs(emptyCard(url)) } })
    .run();
  let card: LinkPreview;
  try {
    card = await api.linkPreview(url);
  } catch {
    card = emptyCard(url);
  }
  if (editor.isDestroyed || !(card.title || card.description || card.siteName || card.imageUrl)) return;
  let at = -1;
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === 'linkPreview' && node.attrs.id === id) at = offset;
  });
  if (at < 0) return;
  const node = editor.state.doc.nodeAt(at)!;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, ...cardAttrs({ ...card, url }) }));
}

/** "Show as preview card": swap the pasted link's line for a card. */
export function acceptCardOffer(editor: Editor) {
  const offer = cardOffer(editor.state);
  if (!offer) return;
  const block = editor.state.doc.nodeAt(offer.pos);
  editor.view.dispatch(editor.state.tr.setMeta(cardOfferKey, null));
  if (!block) return;
  void insertLinkCard(editor, offer.url, { from: offer.pos, to: offer.pos + block.nodeSize });
}

function ask(question: string): string | null {
  const v = window.prompt(question, 'https://');
  const t = v?.trim() ?? '';
  return t && t !== 'https://' ? t : null;
}

/** Slash menu → Video link: a YouTube or Vimeo address becomes a player; any other site is refused. */
export function promptVideoLink(editor: Editor) {
  const url = ask('YouTube or Vimeo link');
  if (!url) return;
  const embed = videoEmbedUrl(url);
  if (!embed) {
    storage(editor)?.note({ tone: 'error', text: 'Only YouTube and Vimeo links can be shown as a video. Other sites are not embedded.' });
    return;
  }
  storage(editor)?.note(null);
  const { from, to } = editor.state.selection;
  editor.chain().focus().insertContentAt({ from, to }, { type: 'video', attrs: { embedUrl: embed } }).run();
}

/** Slash menu → Link card: ask for the address, then show it as a preview card. */
export function promptLinkCard(editor: Editor) {
  const url = ask('Link to show as a card');
  if (!url) return;
  if (!BARE_URL.test(url)) {
    storage(editor)?.note({ tone: 'error', text: 'That is not a web address. Links start with http:// or https://.' });
    return;
  }
  storage(editor)?.note(null);
  const { from, to } = editor.state.selection;
  void insertLinkCard(editor, url, { from, to });
}

/** The small "Show as preview card" button under a freshly pasted link. */
export function CardOfferButton({ editor }: { editor: Editor }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    editor.on('transaction', rerender);
    window.addEventListener('scroll', rerender, true);
    window.addEventListener('resize', rerender);
    return () => {
      editor.off('transaction', rerender);
      window.removeEventListener('scroll', rerender, true);
      window.removeEventListener('resize', rerender);
    };
  }, [editor]);
  const offer = editor.isDestroyed ? null : cardOffer(editor.state);
  if (!offer) return null;
  let rect: { left: number; bottom: number };
  try {
    rect = editor.view.coordsAtPos(offer.pos + 1);
  } catch {
    return null;
  }
  return createPortal(
    <div className="card-offer fade-in" style={{ left: rect.left, top: rect.bottom + 6 }}>
      <button
        type="button"
        className="btn btn-quiet btn-sm"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => acceptCardOffer(editor)}
      >
        <Link2 size={14} aria-hidden="true" />
        Show as preview card
      </button>
    </div>,
    document.body,
  );
}
