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

export const createPageBody = z.object({
  title: pageTitle.default(''),
  parentId: z.string().uuid().nullable().default(null),
  doc: docSchema.optional(),
});

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

export interface ApiError {
  error: string;
  message: string;
}

export { videoEmbedUrl } from './video.js';
