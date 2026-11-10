// Done-check 12a (docs/done-checks/12-tasks.md): task attrs on taskItem, task
// ids filled in by parseDoc, bad due/assignee refused, and docTasks.
import { describe, expect, it } from 'vitest';
import { getDocSchema, InvalidDocError, docTasks, parseDoc, withTaskIds, TASK_TEXT_MAX } from '../src/index.js';

const B = '3f2b8c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b';
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const task = (text: string, attrs: Record<string, unknown> = {}, nested?: unknown) => ({
  type: 'taskItem',
  attrs: { checked: false, ...attrs },
  content: nested ? [p(text), nested] : [p(text)],
});
const list = (...items: unknown[]) => ({ type: 'taskList', content: items });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

/** Every taskId in the doc JSON, in order. */
function ids(json: any): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n?.type === 'taskItem') out.push(n.attrs.taskId);
    (n?.content ?? []).forEach(walk);
  };
  walk(json);
  return out;
}

describe('taskItem attrs', () => {
  it('keeps taskId, assignee and due through parse and toJSON', () => {
    const json = parseDoc(doc(list(task('Write it', { taskId: 't1', assignee: B, due: '2026-12-01' })))).toJSON();
    const item = json.content[0].content[0];
    expect(item.attrs).toMatchObject({ taskId: 't1', assignee: B, due: '2026-12-01', checked: false });
  });

  it('defaults to null', () => {
    const item = getDocSchema().nodes.taskItem!.create(null, getDocSchema().nodes.paragraph!.create());
    expect(item.attrs).toMatchObject({ taskId: null, assignee: null, due: null, checked: false });
  });

  it('renders as data- attributes', () => {
    const spec = getDocSchema().nodes.taskItem!.spec.toDOM!(
      getDocSchema().nodes.taskItem!.create({ taskId: 't1', assignee: B, due: '2026-12-01' }, getDocSchema().nodes.paragraph!.create()),
    ) as unknown as [string, Record<string, unknown>];
    expect(spec[1]).toMatchObject({ 'data-task-id': 't1', 'data-assignee': B, 'data-due': '2026-12-01' });
  });
});

describe('task ids', () => {
  it('gives every task an id, nested tasks too', () => {
    const json = parseDoc(doc(list(task('a', {}, list(task('a.1'), task('a.2'))), task('b')))).toJSON();
    const got = ids(json);
    expect(got).toHaveLength(4);
    expect(new Set(got).size).toBe(4);
    got.forEach((id) => expect(id).toMatch(/^[0-9a-f-]{36}$/));
  });

  it('gives a fresh id to a repeated one and keeps the first', () => {
    const got = ids(parseDoc(doc(list(task('a', { taskId: 'same' }), task('b', { taskId: 'same' })))).toJSON());
    expect(got[0]).toBe('same');
    expect(got[1]).not.toBe('same');
  });

  it('keeps ids when the same doc is parsed again', () => {
    const once = parseDoc(doc(list(task('a', {}, list(task('a.1'))), task('b')))).toJSON();
    const twice = parseDoc(once).toJSON();
    expect(twice).toEqual(once);
  });

  it('replaces a malformed id', () => {
    const got = ids(parseDoc(doc(list(task('a', { taskId: 'not ok/..' }), task('b', { taskId: 42 })))).toJSON());
    got.forEach((id) => expect(id).toMatch(/^[0-9a-f-]{36}$/));
  });

  it('withTaskIds returns the same node when nothing is missing', () => {
    const node = parseDoc(doc(list(task('a'))));
    expect(withTaskIds(node)).toBe(node);
  });
});

describe('bad task attrs', () => {
  for (const due of ['2026-02-30', 'tomorrow', '2026-1-5', '2026-13-01', 12]) {
    it(`refuses due ${JSON.stringify(due)}`, () => {
      expect(() => parseDoc(doc(list(task('a', { due }))))).toThrow(InvalidDocError);
    });
  }
  it('accepts a leap day', () => {
    expect(() => parseDoc(doc(list(task('a', { due: '2028-02-29' }))))).not.toThrow();
  });
  for (const assignee of ['bob', '', 7]) {
    it(`refuses assignee ${JSON.stringify(assignee)}`, () => {
      expect(() => parseDoc(doc(list(task('a', { assignee }))))).toThrow(InvalidDocError);
    });
  }
});

describe('docTasks', () => {
  it('lists every task in order with its own text only', () => {
    const tasks = docTasks(
      doc(
        p('intro'),
        list(
          task('Plan the trip', { taskId: 'a', assignee: B, due: '2026-12-01' }, list(task('Book a train', { taskId: 'a1', checked: true }))),
          task('Pack', { taskId: 'b' }),
        ),
      ),
    );
    expect(tasks).toEqual([
      { taskId: 'a', assignee: B, due: '2026-12-01', checked: false, text: 'Plan the trip', position: 0 },
      { taskId: 'a1', assignee: null, due: null, checked: true, text: 'Book a train', position: 1 },
      { taskId: 'b', assignee: null, due: null, checked: false, text: 'Pack', position: 2 },
    ]);
  });

  it('takes a parsed node too, and cuts long text', () => {
    const node = parseDoc(doc(list(task('x'.repeat(400)))));
    const [t] = docTasks(node);
    expect(t!.text).toHaveLength(TASK_TEXT_MAX);
    expect(t!.taskId).toBe(ids(node.toJSON())[0]);
  });

  it('is empty for a page with no tasks', () => {
    expect(docTasks(doc(p('hello')))).toEqual([]);
  });
});
