// The page body: the Tiptap editor for space editors, the same schema
// rendered read-only for viewers. Autosaves ~1 s after typing stops.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BubbleMenu, EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import { NodeSelection } from '@tiptap/pm/state';
import { getExtensions } from '@stillwater/editor-schema';
import type { Doc, Page } from '@stillwater/shared';
import { Bold, Code, Italic, Link2, Strikethrough } from 'lucide-react';
import { SlashCommand } from './slash';
import { AttachmentUpload, CardOfferButton, embedViews, type UploadNote } from './embeds';
import type { PageSaver, SaveState } from './saver';

const AUTOSAVE_MS = 1000;

export function useSaveState(saver: PageSaver): SaveState {
  return useSyncExternalStore(saver.subscribe, () => saver.state);
}

export function SaveStatus({ saver }: { saver: PageSaver }) {
  const state = useSaveState(saver);
  const label =
    state === 'pending' || state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved' : '';
  return (
    <span className={`save-status save-${state}`} role="status" aria-live="polite">
      {label}
    </span>
  );
}

export function TableMenu({ editor }: { editor: Editor }) {
  const btn = (label: string, run: () => boolean) => (
    <button type="button" className="bubble-btn" onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {label}
    </button>
  );
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableMenu"
      shouldShow={({ editor: e }) => e.isEditable && e.isActive('table')}
      tippyOptions={{ placement: 'top-start', duration: 140, maxWidth: 'none' }}
      className="bubble-menu table-menu"
    >
      <span role="toolbar" aria-label="Table">
        {btn('Add row', () => editor.chain().focus().addRowAfter().run())}
        {btn('Remove row', () => editor.chain().focus().deleteRow().run())}
        <span className="bubble-sep" aria-hidden="true" />
        {btn('Add column', () => editor.chain().focus().addColumnAfter().run())}
        {btn('Remove column', () => editor.chain().focus().deleteColumn().run())}
        <span className="bubble-sep" aria-hidden="true" />
        {btn('Delete table', () => editor.chain().focus().deleteTable().run())}
      </span>
    </BubbleMenu>
  );
}

const MARKS = ['bold', 'italic', 'strike', 'code', 'link'] as const;

export function MarksMenu({ editor }: { editor: Editor }) {
  // The editor no longer re-renders its parent on every keystroke (see
  // PageEditor), so this menu follows the selection itself, and only
  // re-renders when a mark turns on or off.
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => MARKS.map((m) => e.isActive(m)).join(','),
  }).split(',');
  const isOn = (name: (typeof MARKS)[number]) => active[MARKS.indexOf(name)] === 'true';
  const mark = (name: (typeof MARKS)[number], label: string, Icon: typeof Bold, run: () => boolean) => (
    <button
      type="button"
      className={`bubble-btn icon${isOn(name) ? ' is-on' : ''}`}
      aria-label={label}
      aria-pressed={isOn(name)}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Icon size={15} />
    </button>
  );
  const setLink = () => {
    const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
    const href = window.prompt('Link address', prev || 'https://');
    if (href === null) return false;
    if (!href.trim() || href.trim() === 'https://') return editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="marksMenu"
      // Text selections only: a selected image or file block is a node selection and gets no text menu.
      shouldShow={({ editor: e, from, to }) =>
        e.isEditable && from !== to && !e.isActive('codeBlock') && !(e.state.selection instanceof NodeSelection)
      }
      tippyOptions={{ placement: 'top', duration: 140 }}
      className="bubble-menu"
    >
      <span role="toolbar" aria-label="Text style">
        {mark('bold', 'Bold', Bold, () => editor.chain().focus().toggleBold().run())}
        {mark('italic', 'Italic', Italic, () => editor.chain().focus().toggleItalic().run())}
        {mark('strike', 'Strikethrough', Strikethrough, () => editor.chain().focus().toggleStrike().run())}
        {mark('code', 'Inline code', Code, () => editor.chain().focus().toggleCode().run())}
        {mark('link', 'Link', Link2, setLink)}
      </span>
    </BubbleMenu>
  );
}

function ConflictNote({ onReload }: { onReload: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const el = document.querySelector('.page-editor .ProseMirror') as HTMLElement | null;
    const text = el?.innerText ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="conflict-note fade-in" role="alert">
      <p>
        <strong>This page was changed somewhere else</strong> since you opened it. Your text is still here and has not been
        saved. Copy it if you want to keep it, then reload to get the latest version.
      </p>
      <div className="row">
        <button type="button" className="btn btn-quiet" onClick={copy}>
          {copied ? 'Copied' : 'Copy my text'}
        </button>
        <button type="button" className="btn btn-primary" onClick={onReload}>
          Reload
        </button>
      </div>
    </div>
  );
}

export function PageEditor({
  page,
  editable,
  saver,
  onReload,
  onEditor,
}: {
  page: Page;
  editable: boolean;
  saver: PageSaver;
  onReload: () => void;
  /** Hands the editor to the page (the comment margin reads block positions from it). */
  onEditor?: (editor: Editor | null) => void;
}) {
  const state = useSaveState(saver);
  const timer = useRef<number | null>(null);
  const latest = useRef<Doc | null>(null);
  const [note, setNote] = useState<UploadNote | null>(null);

  const flush = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const doc = latest.current;
    latest.current = null;
    if (doc) saver.save({ doc }).catch(() => {});
  };

  const editor = useEditor(
    {
      extensions: [
        ...getExtensions({ history: true, nodeViews: embedViews }),
        ...(editable
          ? [
              SlashCommand,
              AttachmentUpload.configure({ pageId: page.id, onNote: setNote }),
              Placeholder.configure({
                placeholder: ({ node }) => (node.type.name === 'paragraph' ? 'Write, or type / for blocks' : ''),
                showOnlyCurrent: true,
              }),
            ]
          : []),
      ],
      content: page.doc as JSONContent,
      editable,
      // Tiptap would otherwise re-render this whole component (and both menus)
      // on every keystroke and caret move. Nothing here reads editor state
      // while rendering: the marks menu and the card offer subscribe on their
      // own, and the save status comes from the saver.
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: 'doc',
          'aria-label': 'Page content',
          ...(editable ? { 'aria-multiline': 'true', role: 'textbox' } : {}),
        },
      },
      onUpdate: ({ editor: e }) => {
        if (!e.isEditable) return;
        latest.current = e.getJSON() as Doc;
        saver.markPending();
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, AUTOSAVE_MS);
      },
      onBlur: () => {
        if (latest.current) flush();
      },
    },
    [page.id, editable, saver],
  );

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  // Save what is left when leaving the page; warn before closing the tab with unsaved text.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current || saver.state === 'saving' || saver.state === 'conflict') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saver]);

  return (
    <div className={`page-editor${editable ? ' is-editable' : ' is-readonly'}`}>
      {/* Always-present slot: the bubble menus below are moved out of this div by
          Tippy, so React must never insert a node before them (it would crash). */}
      <div className="conflict-slot">
        {state === 'conflict' && <ConflictNote onReload={onReload} />}
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
      {editor && editable && <TableMenu editor={editor} />}
      {editor && editable && <MarksMenu editor={editor} />}
      {editor && editable && <CardOfferButton editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
