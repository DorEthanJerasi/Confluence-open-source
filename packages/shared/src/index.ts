// Contracts shared by the server and the web app: roles, request bodies
// (zod schemas, validated on the server) and the shapes the API returns.
import { z } from 'zod';

// ---------- Roles ----------

export const ROLES = ['viewer', 'editor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

/** true when `have` is at least `need` (viewer < editor < admin). */
export function roleAtLeast(have: Role | null | undefined, need: Role): boolean {
  return !!have && RANK[have] >= RANK[need];
}

export function minRole(a: Role, b: Role): Role {
  return RANK[a] <= RANK[b] ? a : b;
}

export const roleSchema = z.enum(ROLES);
export const visibilitySchema = z.enum(['open', 'restricted']);
export type Visibility = z.infer<typeof visibilitySchema>;

// ---------- Auth ----------

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, 'Use at least 8 characters').max(200);
const personName = z.string().trim().min(1).max(100);

export const signupBody = z.object({ email, name: personName, password });
export const loginBody = z.object({ email, password: z.string().min(1).max(200) });
export const createUserBody = z.object({ email, name: personName, password, role: roleSchema });
export const updateUserBody = z
  .object({ role: roleSchema.optional(), disabled: z.boolean().optional(), name: personName.optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export interface AuthConfig {
  allowSignup: boolean;
  hasUsers: boolean;
}

// ---------- Spaces ----------

export const spaceKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'At least 2 characters')
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Letters, numbers and dashes only');

export const createSpaceBody = z.object({
  key: spaceKeySchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(''),
  visibility: visibilitySchema.default('open'),
  defaultRole: roleSchema.default('viewer'),
});

export const updateSpaceBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    visibility: visibilitySchema.optional(),
    defaultRole: roleSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

export const setMemberBody = z.object({ role: roleSchema });

export interface Space {
  id: string;
  key: string;
  name: string;
  description: string;
  visibility: Visibility;
  defaultRole: Role;
  createdAt: string;
  /** The signed-in user's effective role in this space. */
  myRole: Role;
}

export interface SpaceMember {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

// ---------- Pages ----------

/**
 * A page body is ProseMirror JSON (ARCHITECTURE.md §3). Only the outer shape
 * is checked here; the editor schema package owns the node types.
 */
export const docSchema = z
  .object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() })
  .passthrough();
export type Doc = z.infer<typeof docSchema>;

export const EMPTY_DOC: Doc = { type: 'doc', content: [] };

const pageTitle = z.string().trim().max(200);

export const createPageBody = z
  .object({
    title: pageTitle.default(''),
    parentId: z.string().uuid().nullable().default(null),
    doc: docSchema.optional(),
    /** A built-in (`builtin:<slug>`) or a template of this space; the page starts as a copy of it. */
    templateId: z.string().min(1).max(100).optional(),
  })
  .refine((v) => !(v.doc !== undefined && v.templateId !== undefined), 'Send either a doc or a templateId, not both');

export const savePageBody = z
  .object({ baseVersion: z.number().int().min(1), title: pageTitle.optional(), doc: docSchema.optional() })
  .refine((v) => v.title !== undefined || v.doc !== undefined, 'Nothing to save');

export const movePageBody = z.object({
  parentId: z.string().uuid().nullable(),
  /** Position among the new siblings, 0 = first. Clamped to the end. */
  index: z.number().int().min(0),
});

export interface PageTreeItem {
  id: string;
  parentId: string | null;
  title: string;
  position: string;
}

export interface Crumb {
  id: string;
  title: string;
}

export interface Page {
  id: string;
  spaceId: string;
  spaceKey: string;
  parentId: string | null;
  title: string;
  doc: Doc;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: { id: string; name: string } | null;
  /** Ancestors from the top of the space down to the parent. */
  breadcrumbs: Crumb[];
  myRole: Role;
}

// ---------- Page history ----------

/** One entry of GET /api/pages/:id/versions (newest first, no doc body). */
export interface PageVersionSummary {
  version: number;
  title: string;
  /** null when the author's account was removed. */
  author: { id: string; name: string } | null;
  /** The last save folded into this snapshot. */
  savedAt: string;
  /** Set when this snapshot was made by restoring that earlier version. */
  restoredFrom: number | null;
}

/** GET /api/pages/:id/versions?before=N. Pass `nextBefore` as `before` for the next page; null means no more. */
export interface PageVersionList {
  versions: PageVersionSummary[];
  nextBefore: number | null;
}

/** GET /api/pages/:id/versions/:version. */
export interface PageVersion extends PageVersionSummary {
  doc: Doc;
}

export const versionListQuery = z.object({ before: z.coerce.number().int().min(1).optional() });

/** POST /api/pages/:id/versions/:version/restore. */
export const restoreVersionBody = z.object({ baseVersion: z.number().int().min(1) });

// ---------- Page templates (docs/done-checks/08-templates.md) ----------

export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_DESCRIPTION_MAX = 200;
/** Ids of the templates shipped with the app start with this. */
export const BUILTIN_TEMPLATE_PREFIX = 'builtin:';

const templateName = z
  .string()
  .trim()
  .min(1, 'Give the template a name')
  .max(TEMPLATE_NAME_MAX, `Keep the name under ${TEMPLATE_NAME_MAX} characters`);
const templateDescription = z
  .string()
  .trim()
  .max(TEMPLATE_DESCRIPTION_MAX, `Keep the description under ${TEMPLATE_DESCRIPTION_MAX} characters`);

/** POST /api/spaces/:key/templates: from a doc, or from a page of the same space (exactly one). */
export const createTemplateBody = z
  .object({
    name: templateName,
    description: templateDescription.default(''),
    doc: docSchema.optional(),
    fromPageId: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => (v.doc === undefined) !== (v.fromPageId === undefined), 'Send either a doc or a fromPageId');

/** PATCH /api/spaces/:key/templates/:id. A stale baseVersion is refused with 409. */
export const updateTemplateBody = z
  .object({
    baseVersion: z.number().int().min(1),
    name: templateName.optional(),
    description: templateDescription.optional(),
    doc: docSchema.optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.description !== undefined || v.doc !== undefined, 'Nothing to save');

/** One entry of GET /api/spaces/:key/templates (no doc). Built-ins first, then the space's own by name. */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  /** null for built-ins. */
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

/** GET /api/spaces/:key/templates/:id, and what create and edit return. */
export interface PageTemplate extends TemplateSummary {
  version: number;
  doc: Doc;
  createdAt: string | null;
}

// ---------- Page comments (docs/done-checks/07-comments.md) ----------

/** Longest comment body, in characters (after trimming). */
export const COMMENT_MAX_LENGTH = 4000;

const commentBodyText = z
  .string()
  .trim()
  .min(1, 'Write something first')
  .max(COMMENT_MAX_LENGTH, `Keep comments under ${COMMENT_MAX_LENGTH} characters`);

/** POST /api/pages/:id/comments. `blockId` is ignored when `parentId` is set (a reply takes its thread's block). */
export const createCommentBody = z
  .object({
    body: commentBodyText,
    blockId: z.string().min(1).max(100).nullable().optional(),
    parentId: z.string().uuid().nullable().optional(),
  })
  .strict();

/** PATCH /api/comments/:id. */
export const editCommentBody = z.object({ body: commentBodyText }).strict();

export interface CommentPerson {
  id: string;
  name: string;
}

/** A reply in a thread (one level only). */
export interface CommentReply {
  id: string;
  body: string;
  author: CommentPerson | null;
  createdAt: string;
  editedAt: string | null;
}

/** A thread: a root comment on the page (blockId null) or on one top-level block, with its replies. */
export interface CommentThread extends CommentReply {
  blockId: string | null;
  resolvedAt: string | null;
  resolvedBy: CommentPerson | null;
  /** The root was deleted but live replies remain: body is '' and author is null. */
  deleted: boolean;
  /** blockId is set but that block is no longer in the current page. */
  blockMissing: boolean;
  replies: CommentReply[];
}

/** GET /api/pages/:id/comments: open threads oldest first, then resolved threads newest resolved first. */
export interface CommentList {
  threads: CommentThread[];
}

/** One comment as returned by create, edit, resolve and reopen. */
export interface Comment extends CommentReply {
  pageId: string;
  parentId: string | null;
  blockId: string | null;
  resolvedAt: string | null;
  resolvedBy: CommentPerson | null;
}

/** An uploaded file, as returned by POST /api/pages/:id/attachments. */
export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
}

/**
 * A link preview card, as returned by GET /api/link-preview. When the page
 * could not be fetched (refused, failed, or not HTML) every field but `url`
 * is null and the card shows as a plain link.
 */
export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
}

// ---------- Search ----------

/**
 * Hit markers in a search snippet. They are private-use characters that the
 * server strips from page text before highlighting, so they can never come
 * from a page. The client splits on them and renders every part as plain
 * text (hits inside <mark>); a snippet is never inserted as HTML.
 */
export const HIT_START = '';
export const HIT_END = '';

export interface SearchResult {
  pageId: string;
  title: string;
  spaceKey: string;
  spaceName: string;
  /** Plain page text with hits wrapped in HIT_START / HIT_END. */
  snippet: string;
  /** Ancestors from the top of the space down to the parent. */
  breadcrumbs: Crumb[];
}

/** Split a snippet into plain-text parts, each marked as a hit or not. */
export function splitSnippet(snippet: string): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  let hit = false;
  let text = '';
  for (const ch of snippet) {
    if (ch === HIT_START || ch === HIT_END) {
      if (text) parts.push({ text, hit });
      text = '';
      hit = ch === HIT_START;
    } else {
      text += ch;
    }
  }
  if (text) parts.push({ text, hit });
  return parts;
}

// ---------- AI ----------

/** GET /api/ai/status. Only whether AI is on: no provider name, no model, never the key. */
export const aiStatusReply = z.object({ enabled: z.boolean() }).strict();
export type AiStatus = z.infer<typeof aiStatusReply>;

/** POST /api/pages/:id/summary. Plain text: the client renders it as text, never as HTML. */
export const pageSummaryReply = z.object({ summary: z.string() }).strict();
export type PageSummary = z.infer<typeof pageSummaryReply>;

/** POST /api/ai/ask body: 1 to 500 characters after trimming. */
export const askBody = z.object({ question: z.string().trim().min(1, 'Ask a question').max(500, 'Keep the question under 500 characters') });
export type AskBody = z.infer<typeof askBody>;

/** One page section the answer cites as [n]. `url` is the link a search result opens. */
export const askSource = z
  .object({
    n: z.number().int().min(1),
    pageId: z.string(),
    title: z.string(),
    spaceKey: z.string(),
    spaceName: z.string(),
    url: z.string(),
  })
  .strict();
export type AskSource = z.infer<typeof askSource>;

/**
 * POST /api/ai/ask reply. `answer` is plain text: the client renders it as
 * text and turns only the [n] markers listed in `sources` into links.
 */
export const askReply = z.object({ answer: z.string(), sources: z.array(askSource) }).strict();
export type AskReply = z.infer<typeof askReply>;

/** The sentence the server answers with when no page the asker can see matches. */
export const ASK_NO_SOURCES_ANSWER = "I couldn't find anything about that in the pages you can see.";

/** One piece of an answer: plain text, or an [n] marker that names a source in the reply's list. */
export type AnswerPart = { text: string; source?: AskSource };

/**
 * Splits an ask answer into plain-text parts and citation parts, so the
 * client can render text as text and only turn [n] markers that are in
 * `sources` into links. A marker not in the list stays plain text. The
 * result never contains HTML: callers render every part as a text node.
 */
export function splitAnswer(answer: string, sources: AskSource[]): AnswerPart[] {
  const byN = new Map(sources.map((s) => [s.n, s]));
  const parts: AnswerPart[] = [];
  let text = '';
  let last = 0;
  for (const m of answer.matchAll(/\[(\d{1,3})\]/g)) {
    const source = byN.get(Number(m[1]));
    if (!source) continue;
    text += answer.slice(last, m.index);
    if (text) parts.push({ text });
    text = '';
    parts.push({ text: m[0], source });
    last = m.index + m[0].length;
  }
  text += answer.slice(last);
  if (text) parts.push({ text });
  return parts;
}

export interface ApiError {
  error: string;
  message: string;
}

export { videoEmbedUrl } from './video.js';
