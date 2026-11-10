// Page body checks and plain text, built on the one editor schema
// (packages/editor-schema, ARCHITECTURE.md §3 and §6).
import { InvalidDocError, docTasks, nodeToText, parseDoc, type DocTask } from '@stillwater/editor-schema';
import type { Doc } from '@stillwater/shared';
import { badRequest } from '../http.js';

/**
 * Check an incoming page body against the schema and return the stored form:
 * normalised JSON (unknown attrs dropped, top-level block ids and task ids
 * filled in), its plain text and its tasks (for page_tasks). Anything the
 * schema does not define is a 400.
 */
export function normalizeDoc(doc: unknown): { doc: Doc; text: string; tasks: DocTask[] } {
  try {
    const node = parseDoc(doc);
    return { doc: node.toJSON() as Doc, text: nodeToText(node), tasks: docTasks(node) };
  } catch (err) {
    if (err instanceof InvalidDocError) throw badRequest(err.message);
    throw err;
  }
}

/** Plain text of a page body for search: blocks and table cells on their own lines, no attrs. */
export function docToText(doc: unknown): string {
  return normalizeDoc(doc).text;
}
