// Ctrl+End (Cmd+Down on a Mac) on a page whose last block is a card: an
// image, file, video, link card or divider. The browser's own "go to end"
// can only stop where text can be typed, so it left the caret at the end of
// the text above the card, and Enter then opened a line above the card
// (item #154, found in the final walk). Here the caret goes to the gap
// below the card instead (ProseMirror's gap cursor, already in the
// editor), so Enter or typing starts a new line under it. Selection only:
// the document is not changed until the person types.
import { Extension } from '@tiptap/react';
import { GapCursor } from '@tiptap/pm/gapcursor';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export const DocEndKey = Extension.create({
  name: 'docEndKey',
  addKeyboardShortcuts() {
    const toEnd = () => {
      const { state, view } = this.editor;
      const last = state.doc.lastChild;
      // A last block with text in it: the browser already does the right thing.
      // After a block that holds no text, the gap below it is always a valid place for the caret.
      if (!last || !last.isAtom || last.isInline) return false;
      const $end = state.doc.resolve(state.doc.content.size);
      view.dispatch(state.tr.setSelection(new GapCursor($end)).scrollIntoView());
      return true;
    };
    const keys: Record<string, () => boolean> = { 'Ctrl-End': toEnd };
    if (isMac) keys['Meta-ArrowDown'] = toEnd;
    return keys;
  },
});
