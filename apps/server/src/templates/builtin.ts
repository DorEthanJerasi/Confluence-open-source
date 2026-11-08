// The templates shipped with the app (docs/done-checks/08-templates.md).
// They live in code, not in the database: nothing to seed, and an upgrade can
// improve them. Ids are fixed `builtin:<slug>` strings. Nobody can edit or
// delete them. Bodies are ordinary page JSON with no block ids; ids are filled
// in fresh every time a page is made from one.
import { BUILTIN_TEMPLATE_PREFIX, type Doc } from '@stillwater/shared';

export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  doc: Doc;
}

type Json = Record<string, unknown>;

const text = (t: string): Json => ({ type: 'text', text: t });
const p = (t = ''): Json => (t ? { type: 'paragraph', content: [text(t)] } : { type: 'paragraph' });
const h = (level: 1 | 2 | 3, t: string): Json => ({ type: 'heading', attrs: { level }, content: [text(t)] });
const bullets = (...items: string[]): Json => ({
  type: 'bulletList',
  content: items.map((t) => ({ type: 'listItem', content: [p(t)] })),
});
const numbered = (...items: string[]): Json => ({
  type: 'orderedList',
  content: items.map((t) => ({ type: 'listItem', content: [p(t)] })),
});
const tasks = (...items: string[]): Json => ({
  type: 'taskList',
  content: items.map((t) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(t)] })),
});
const callout = (tone: 'info' | 'success' | 'warning' | 'danger', t: string): Json => ({
  type: 'callout',
  attrs: { tone },
  content: [p(t)],
});
const table = (header: string[], ...rows: string[][]): Json => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: header.map((t) => ({ type: 'tableHeader', content: [p(t)] })) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((t) => ({ type: 'tableCell', content: [p(t)] })) })),
  ],
});
const doc = (...content: Json[]): Doc => ({ type: 'doc', content });

/** In this order in every space's list. */
export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  {
    id: `${BUILTIN_TEMPLATE_PREFIX}meeting-notes`,
    name: 'Meeting notes',
    description: 'Who came, what was talked about, what was decided and who does what next.',
    doc: doc(
      h(2, 'Details'),
      table(['Date', 'Facilitator', 'Note taker'], ['', '', '']),
      h(2, 'People'),
      bullets(''),
      h(2, 'Agenda'),
      numbered(''),
      h(2, 'Notes'),
      p(),
      h(2, 'Decisions'),
      bullets(''),
      h(2, 'Next steps'),
      tasks('Owner: what, by when'),
    ),
  },
  {
    id: `${BUILTIN_TEMPLATE_PREFIX}project-brief`,
    name: 'Project brief',
    description: 'One page that says why a project exists, what it will deliver and how you will know it worked.',
    doc: doc(
      callout('info', 'Keep this short. Link out to longer documents instead of copying them here.'),
      h(2, 'Why'),
      p('The problem, who has it, and why now.'),
      h(2, 'Goals'),
      bullets(''),
      h(2, 'Out of scope'),
      bullets(''),
      h(2, 'People'),
      table(['Role', 'Name'], ['Lead', ''], ['Team', ''], ['Stakeholders', '']),
      h(2, 'Milestones'),
      table(['Milestone', 'Target date', 'Status'], ['', '', '']),
      h(2, 'How we will know it worked'),
      bullets(''),
      h(2, 'Open questions'),
      tasks(''),
    ),
  },
  {
    id: `${BUILTIN_TEMPLATE_PREFIX}how-to-guide`,
    name: 'How-to guide',
    description: 'Step-by-step instructions for one task, with what you need before you start.',
    doc: doc(
      p('In one or two sentences: what this guide helps you do.'),
      h(2, 'Before you start'),
      bullets(''),
      h(2, 'Steps'),
      numbered('', ''),
      callout('warning', 'Anything that is easy to get wrong goes here.'),
      h(2, 'Check that it worked'),
      p(),
      h(2, 'If something goes wrong'),
      bullets(''),
      h(2, 'Related pages'),
      bullets(''),
    ),
  },
  {
    id: `${BUILTIN_TEMPLATE_PREFIX}decision-record`,
    name: 'Decision record',
    description: 'Write down a decision, the options you weighed and why you chose this one.',
    doc: doc(
      table(['Status', 'Decided on', 'Decided by'], ['Proposed', '', '']),
      h(2, 'Context'),
      p('What is the situation, and what forces us to decide?'),
      h(2, 'Options'),
      table(['Option', 'Good', 'Not so good'], ['', '', ''], ['', '', '']),
      h(2, 'Decision'),
      callout('success', 'We will …'),
      h(2, 'What follows'),
      p('What gets easier, what gets harder, and what we will check later.'),
    ),
  },
];

export function findBuiltin(id: string): BuiltinTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}
