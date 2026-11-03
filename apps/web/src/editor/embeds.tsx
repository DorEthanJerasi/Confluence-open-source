// Image and file blocks in the editor (done-check 02-editor.md, 2b). The nodes
// themselves live in packages/editor-schema and hold only an attachment id;
// this file draws them and does the uploading (slash menu, paste, drag-drop).
import { useState } from 'react';
import { Extension, type Editor, type JSONContent } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { attachmentUrl, formatBytes } from '@stillwater/editor-schema';
import { Download, Paperclip } from 'lucide-react';
import { api, errorMessage, type Attachment } from '../api';

export type UploadKind = 'image' | 'file';

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

/** Views passed to getExtensions({ nodeViews }) for both the editor and the read-only render. */
export const embedViews = {
  image: ReactNodeViewRenderer(ImageView),
  file: ReactNodeViewRenderer(FileView),
};

function blockFor(a: Attachment, kind: UploadKind): JSONContent {
  if (kind === 'image' && a.mime.startsWith('image/')) {
    return { type: 'image', attrs: { attachmentId: a.id, alt: '', caption: '' } };
  }
  return { type: 'file', attrs: { attachmentId: a.id, filename: a.filename, size: a.size, mime: a.mime } };
}

export interface UploadOptions {
  pageId: string;
  onNote: (note: UploadNote | null) => void;
}

/** Upload each file in turn and put its block at `pos`, one after another. */
async function uploadAll(editor: Editor, files: File[], pos: number, kind: UploadKind | 'auto', opts: UploadOptions) {
  let at = pos;
  let failed = false;
  for (const file of files) {
    opts.onNote({ tone: 'busy', text: `Uploading ${file.name}…` });
    try {
      const a = await api.uploadAttachment(opts.pageId, file);
      if (editor.isDestroyed) return;
      const k: UploadKind = kind === 'auto' ? (file.type.startsWith('image/') ? 'image' : 'file') : kind;
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

/**
 * Editors only: paste or drop files to upload them, and `pick` for the slash
 * menu. Viewers never get this extension, so they have no way to upload.
 */
export const AttachmentUpload = Extension.create<UploadOptions, { pick: (kind: UploadKind) => void }>({
  name: 'attachmentUpload',
  addOptions() {
    return { pageId: '', onNote: () => {} };
  },
  addStorage() {
    return { pick: () => {} };
  },
  onCreate() {
    const editor = this.editor;
    const opts = this.options;
    this.storage.pick = (kind) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (kind === 'image') input.accept = 'image/*';
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
    ];
  },
});

/** Open the file picker from the slash menu (must run inside the click/Enter). */
export function pickAttachment(editor: Editor, kind: UploadKind) {
  const storage = (editor.storage as Record<string, { pick?: (k: UploadKind) => void } | undefined>).attachmentUpload;
  storage?.pick?.(kind);
}
