// The editor side of templates (done-check 08, 8b). A template body is the
// same ProseMirror JSON as a page body, so both views here use the one editor
// schema (getExtensions) and the same block views as pages. Loaded lazily, like
// the page screen, because it brings in the editor.
import { useRef, useState } from 'react';
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import { getExtensions } from '@stillwater/editor-schema';
import type { Doc } from '@stillwater/shared';
import { AttachmentUpload, CardOfferButton, embedViews, type UploadNote } from '../editor/embeds';
import { MarksMenu, TableMenu } from '../editor/PageEditor';
import { SlashCommand } from '../editor/slash';

/** A template body, read-only, in the page styles (the picker and the Templates tab preview). */
export function TemplatePreview({ doc, label }: { doc: Doc; label: string }) {
  const editor = useEditor(
    {
      extensions: getExtensions({ history: false, nodeViews: embedViews }),
      content: doc as JSONContent,
      editable: false,
      editorProps: { attributes: { class: 'doc', 'aria-label': label } },
      shouldRerenderOnTransaction: false,
    },
    [doc],
  );
  return (
    <div className="page-editor is-readonly template-preview-doc">
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * A template body in the block editor, with slash commands and embeds.
 * Nothing is saved from here: `onChange` hands every edit up, and the
 * Templates tab saves with its Save button.
 */
export function TemplateBodyEditor({ doc, onChange }: { doc: Doc; onChange: (doc: Doc) => void }) {
  const [note, setNote] = useState<UploadNote | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const editor = useEditor(
    {
      extensions: [
        ...getExtensions({ history: true, nodeViews: embedViews }),
        SlashCommand,
        AttachmentUpload.configure({ pageId: '', onNote: setNote }),
        Placeholder.configure({
          placeholder: ({ node }) => (node.type.name === 'paragraph' ? 'Write, or type / for blocks' : ''),
          showOnlyCurrent: true,
        }),
      ],
      content: doc as JSONContent,
      editable: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: { class: 'doc', 'aria-label': 'Template content', 'aria-multiline': 'true', role: 'textbox' },
      },
      onUpdate: ({ editor: e }) => change.current(e.getJSON() as Doc),
    },
    // A new body (after a reload) makes a fresh editor.
    [doc],
  );
  return (
    <div className="page-editor is-editable template-editor-doc">
      {/* Always-present slot: Tippy moves the bubble menus out of this div, so
          React must never insert a node before them. */}
      <div className="conflict-slot">
        {note && (
          <p className={`upload-note fade-in upload-${note.tone}`} aria-live="polite">
            {note.text}
            {note.tone === 'error' && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setNote(null)}>
                Dismiss
              </button>
            )}
          </p>
        )}
      </div>
      {editor && <TableMenu editor={editor} />}
      {editor && <MarksMenu editor={editor} />}
      {editor && <CardOfferButton editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
