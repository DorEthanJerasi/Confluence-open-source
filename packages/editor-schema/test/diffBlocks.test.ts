// Stage 3c unit check (docs/done-checks/03-search-history.md): diffBlocks gives the
// right added, removed and changed ids, leaves unchanged blocks out, and does
// not report a block that only moved.
import { describe, expect, it } from 'vitest';
import { diffBlocks, parseDoc, type BlockJson, type DocJson } from '../src/index.js';

const para = (id: string, text: string): BlockJson => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'text', text }],
});
const doc = (...content: BlockJson[]): DocJson => ({ type: 'doc', content });

describe('diffBlocks', () => {
  it('reports nothing for identical docs', () => {
    const d = doc(para('a', 'one'), para('b', 'two'));
    expect(diffBlocks(d, structuredClone(d))).toEqual({ added: [], removed: [], changed: [] });
  });

  it('gives added, removed and changed ids and leaves unchanged blocks out', () => {
    const before = doc(para('a', 'same'), para('b', 'first text'), para('c', 'gone'));
    const after = doc(para('a', 'same'), para('b', 'second text'), para('d', 'new'));
    expect(diffBlocks(before, after)).toEqual({ added: ['d'], removed: ['c'], changed: ['b'] });
  });

  it('does not report a reordered block', () => {
    const before = doc(para('a', 'one'), para('b', 'two'), para('c', 'three'));
    const after = doc(para('c', 'three'), para('a', 'one'), para('b', 'two'));
    expect(diffBlocks(before, after)).toEqual({ added: [], removed: [], changed: [] });
  });

  it('reports a moved block only when its content also changed', () => {
    const before = doc(para('a', 'one'), para('b', 'two'));
    const after = doc(para('b', 'two, edited'), para('a', 'one'));
    expect(diffBlocks(before, after)).toEqual({ added: [], removed: [], changed: ['b'] });
  });

  it('counts a change of type, attrs or marks as changed', () => {
    const before = doc(
      para('t', 'title'),
      { type: 'heading', attrs: { id: 'h', level: 2 }, content: [{ type: 'text', text: 'h' }] },
      para('m', 'plain'),
    );
    const after = doc(
      { type: 'heading', attrs: { id: 't', level: 1 }, content: [{ type: 'text', text: 'title' }] },
      { type: 'heading', attrs: { id: 'h', level: 3 }, content: [{ type: 'text', text: 'h' }] },
      { type: 'paragraph', attrs: { id: 'm' }, content: [{ type: 'text', text: 'plain', marks: [{ type: 'bold' }] }] },
    );
    expect(diffBlocks(before, after).changed).toEqual(['t', 'h', 'm']);
  });

  it('sees a change deep inside a nested block (a table cell)', () => {
    const table = (cellText: string): BlockJson => ({
      type: 'table',
      attrs: { id: 'tbl' },
      content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: cellText }] }] }] }],
    });
    expect(diffBlocks(doc(table('x')), doc(table('x'))).changed).toEqual([]);
    expect(diffBlocks(doc(table('x')), doc(table('y'))).changed).toEqual(['tbl']);
  });

  it('ignores key order and treats a missing attr as null', () => {
    const before = doc({ attrs: { textAlign: null, id: 'a' }, type: 'paragraph', content: [{ text: 'x', type: 'text' }] });
    const after = doc({ type: 'paragraph', attrs: { id: 'a' }, content: [{ type: 'text', text: 'x' }] });
    expect(diffBlocks(before, after)).toEqual({ added: [], removed: [], changed: [] });
  });

  it('lists added and changed in new-doc order and removed in old-doc order', () => {
    const before = doc(para('r1', 'x'), para('c2', 'x'), para('r2', 'x'), para('c1', 'x'));
    const after = doc(para('n2', 'x'), para('c1', 'y'), para('n1', 'x'), para('c2', 'y'));
    expect(diffBlocks(before, after)).toEqual({ added: ['n2', 'n1'], removed: ['r1', 'r2'], changed: ['c1', 'c2'] });
  });

  it('handles empty, missing and id-less input without throwing', () => {
    expect(diffBlocks(null, doc(para('a', 'x')))).toEqual({ added: ['a'], removed: [], changed: [] });
    expect(diffBlocks(doc(para('a', 'x')), { type: 'doc' })).toEqual({ added: [], removed: ['a'], changed: [] });
    expect(diffBlocks(doc({ type: 'paragraph' }), doc({ type: 'paragraph', attrs: { id: null } }))).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });

  it('uses the first block when an id repeats', () => {
    const before = doc(para('a', 'x'));
    const after = doc(para('a', 'x'), para('a', 'copy'));
    expect(diffBlocks(before, after)).toEqual({ added: [], removed: [], changed: [] });
  });

  it('works on stored docs as parseDoc writes them', () => {
    const before = parseDoc(doc(para('a', 'first text'), para('b', 'kept'))).toJSON() as DocJson;
    const after = parseDoc(doc(para('b', 'kept'), para('a', 'second text'), { type: 'horizontalRule', attrs: { id: 'hr' } })).toJSON() as DocJson;
    expect(diffBlocks(before, after)).toEqual({ added: ['hr'], removed: [], changed: ['a'] });
  });
});
