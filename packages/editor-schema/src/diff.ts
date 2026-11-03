// Block-level diff between two page bodies (docs/done-checks/03-search-history.md, 3c).
// Pure: plain JSON in, ids out. No DOM and no editor, so the history screen and,
// later, the co-editing server can both use it.

/** A top-level block as stored in a page body: its `attrs.id` is the stable block id. */
export interface BlockJson {
  type?: string;
  attrs?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/** A page body as stored (`{ type: 'doc', content: [...] }`). */
export interface DocJson {
  type?: string;
  content?: BlockJson[] | null;
  [key: string]: unknown;
}

/**
 * Ids of the blocks that differ between two versions. `added` and `changed`
 * follow the order of the new doc, `removed` the order of the old doc.
 */
export interface BlockDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

function blockId(block: BlockJson): string | null {
  const id = block?.attrs?.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** First block for each id (a repeated id is a copy; parseDoc gives it a fresh id). */
function blocksById(doc: DocJson | null | undefined): Map<string, BlockJson> {
  const out = new Map<string, BlockJson>();
  const content = Array.isArray(doc?.content) ? doc.content : [];
  for (const block of content) {
    const id = blockId(block);
    if (id !== null && !out.has(id)) out.set(id, block);
  }
  return out;
}

/** Deep equality on JSON values. Key order does not matter, and a missing key equals null. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => sameJson(v, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!sameJson(ao[k], bo[k])) return false;
  return true;
}

/**
 * Compare two page bodies block by block, matching top-level blocks by their
 * `id`. A block only in `newDoc` is added, one only in `oldDoc` is removed,
 * and one in both whose type, attrs, content or marks differ is changed.
 * Unchanged blocks are left out, and moving a block does not count as a change.
 * Blocks without an id cannot be matched and are skipped (stored pages always
 * have ids: `parseDoc` fills them in).
 */
export function diffBlocks(oldDoc: DocJson | null | undefined, newDoc: DocJson | null | undefined): BlockDiff {
  const before = blocksById(oldDoc);
  const after = blocksById(newDoc);
  const added: string[] = [];
  const changed: string[] = [];
  for (const [id, block] of after) {
    const old = before.get(id);
    if (old === undefined) added.push(id);
    else if (!sameJson(old, block)) changed.push(id);
  }
  const removed = [...before.keys()].filter((id) => !after.has(id));
  return { added, removed, changed };
}
