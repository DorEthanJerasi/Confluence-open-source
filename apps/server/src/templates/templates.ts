// Page templates (docs/done-checks/08-templates.md, 8a). All template logic
// lives here. Every exported function that takes a space key checks access
// through requireSpaceByKey (editor and up), so there is one permission path:
// someone who cannot see the space gets 404, a viewer 403.
//
// Every stored template body goes through normalizeDoc, the same check a page
// body gets. Copies (template -> page, page -> template) always get fresh
// top-level block ids, so no two pages share one. Nothing here writes pages or
// page_versions; a page made from a template is made by createPage.
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { newBlockId } from '@stillwater/editor-schema';
import { BUILTIN_TEMPLATE_PREFIX, createTemplateBody, updateTemplateBody, type Doc, type PageTemplate, type TemplateSummary } from '@stillwater/shared';
import type { Db } from '../db/client.js';
import { pageTemplates, pages, users } from '../db/schema.js';
import { requireSpaceByKey, type SpaceRow } from '../auth/permissions.js';
import type { SessionUser } from '../auth/session.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../http.js';
import { normalizeDoc } from '../pages/docText.js';
import { BUILTIN_TEMPLATES, findBuiltin, type BuiltinTemplate } from './builtin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Check a body against the editor schema, then give every top-level block a new id. */
export function withFreshBlockIds(doc: unknown): Doc {
  const normal = normalizeDoc(doc).doc;
  const content = Array.isArray(normal.content) ? normal.content : [];
  return {
    ...normal,
    content: content.map((block) => {
      const b = block as { attrs?: Record<string, unknown> };
      return { ...b, attrs: { ...(b.attrs ?? {}), id: newBlockId() } };
    }),
  };
}

const isBuiltinId = (id: string) => id.startsWith(BUILTIN_TEMPLATE_PREFIX);

function nameTaken(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const c = e?.code === '23505' ? e : e?.cause?.code === '23505' ? e.cause : null;
  return !!c && (c.constraint === undefined || c.constraint === 'page_templates_space_name_idx');
}
const nameClash = () => conflict('name_taken', 'This space already has a template with that name');

const builtinView = (t: BuiltinTemplate): PageTemplate => ({
  id: t.id,
  name: t.name,
  description: t.description,
  builtIn: true,
  updatedAt: null,
  updatedBy: null,
  version: 1,
  doc: normalizeDoc(t.doc).doc,
  createdAt: null,
});

const columns = {
  id: pageTemplates.id,
  name: pageTemplates.name,
  description: pageTemplates.description,
  version: pageTemplates.version,
  doc: pageTemplates.doc,
  createdAt: pageTemplates.createdAt,
  updatedAt: pageTemplates.updatedAt,
  updatedById: pageTemplates.updatedBy,
  updatedByName: users.name,
};
type Row = {
  id: string;
  name: string;
  description: string;
  version: number;
  doc: Doc;
  createdAt: Date;
  updatedAt: Date;
  updatedById: string | null;
  updatedByName: string | null;
};

function toTemplate(r: Row): PageTemplate {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    builtIn: false,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedById && r.updatedByName !== null ? { id: r.updatedById, name: r.updatedByName } : null,
    version: r.version,
    doc: r.doc,
    createdAt: r.createdAt.toISOString(),
  };
}

async function loadSpaceTemplate(db: Db, spaceId: string, id: string): Promise<Row | undefined> {
  if (!UUID_RE.test(id)) return undefined;
  const [row] = await db
    .select(columns)
    .from(pageTemplates)
    .leftJoin(users, eq(users.id, pageTemplates.updatedBy))
    .where(and(eq(pageTemplates.id, id), eq(pageTemplates.spaceId, spaceId)));
  return row;
}

/** GET /api/spaces/:key/templates: built-ins first in their fixed order, then the space's own by name. No docs. */
export async function listTemplates(db: Db, user: SessionUser, key: string): Promise<TemplateSummary[]> {
  const { space } = await requireSpaceByKey(db, user, key, 'editor');
  const rows = await db
    .select(columns)
    .from(pageTemplates)
    .leftJoin(users, eq(users.id, pageTemplates.updatedBy))
    .where(eq(pageTemplates.spaceId, space.id))
    .orderBy(sql`lower(${pageTemplates.name})`, asc(pageTemplates.id));
  const summary = ({ doc: _doc, version: _v, createdAt: _c, ...rest }: PageTemplate): TemplateSummary => rest;
  return [...BUILTIN_TEMPLATES.map((t) => summary(builtinView(t))), ...rows.map((r) => summary(toTemplate(r)))];
}

/** GET /api/spaces/:key/templates/:id: a built-in or a template of this space; anything else is 404. */
export async function getTemplate(db: Db, user: SessionUser, key: string, id: string): Promise<PageTemplate> {
  const { space } = await requireSpaceByKey(db, user, key, 'editor');
  const builtin = findBuiltin(id);
  if (builtin) return builtinView(builtin);
  const row = await loadSpaceTemplate(db, space.id, id);
  if (!row) throw notFound('Template not found');
  return toTemplate(row);
}

/** POST /api/spaces/:key/templates: from a doc, or from a live page of this space. */
export async function createTemplate(
  db: Db,
  user: SessionUser,
  key: string,
  body: unknown,
): Promise<PageTemplate> {
  const { space } = await requireSpaceByKey(db, user, key, 'editor');
  // Access first, then the body: someone who cannot see the space learns nothing from a 400.
  const input = parse(createTemplateBody, body);
  let source: unknown = input.doc;
  if (input.fromPageId) {
    const [page] = await db
      .select({ doc: pages.doc })
      .from(pages)
      .where(and(eq(pages.id, input.fromPageId), eq(pages.spaceId, space.id), isNull(pages.deletedAt)));
    if (!page) throw badRequest('That page is not in this space');
    source = page.doc;
  }
  const doc = withFreshBlockIds(source);
  let id: string;
  try {
    const [row] = await db
      .insert(pageTemplates)
      .values({ spaceId: space.id, name: input.name, description: input.description, doc, createdBy: user.id, updatedBy: user.id })
      .returning({ id: pageTemplates.id });
    id = row!.id;
  } catch (err) {
    if (nameTaken(err)) throw nameClash();
    throw err;
  }
  return toTemplate((await loadSpaceTemplate(db, space.id, id))!);
}

/** The template row a write may touch: 403 for a built-in, 404 for one not in this space. */
async function requireWritable(db: Db, space: SpaceRow, id: string): Promise<Row> {
  if (isBuiltinId(id)) {
    if (findBuiltin(id)) throw forbidden('Built-in templates cannot be changed');
    throw notFound('Template not found');
  }
  const row = await loadSpaceTemplate(db, space.id, id);
  if (!row) throw notFound('Template not found');
  return row;
}

/** PATCH /api/spaces/:key/templates/:id. A stale baseVersion is refused with 409. */
export async function updateTemplate(
  db: Db,
  user: SessionUser,
  key: string,
  id: string,
  body: unknown,
): Promise<PageTemplate> {
  const { space } = await requireSpaceByKey(db, user, key, 'editor');
  await requireWritable(db, space, id);
  const change = parse(updateTemplateBody, body);
  // A template's own block ids are kept on edit; only copies get new ones.
  const doc = change.doc !== undefined ? normalizeDoc(change.doc).doc : undefined;
  let updated;
  try {
    [updated] = await db
      .update(pageTemplates)
      .set({
        ...(change.name !== undefined ? { name: change.name } : {}),
        ...(change.description !== undefined ? { description: change.description } : {}),
        ...(doc ? { doc } : {}),
        version: sql`${pageTemplates.version} + 1`,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(and(eq(pageTemplates.id, id), eq(pageTemplates.spaceId, space.id), eq(pageTemplates.version, change.baseVersion)))
      .returning({ id: pageTemplates.id });
  } catch (err) {
    if (nameTaken(err)) throw nameClash();
    throw err;
  }
  const row = await loadSpaceTemplate(db, space.id, id);
  if (!row) throw notFound('Template not found');
  if (!updated) {
    throw conflict('stale_version', `This template was changed by someone else (now version ${row.version}). Reload to get the latest.`);
  }
  return toTemplate(row);
}

/** DELETE /api/spaces/:key/templates/:id. A real delete; pages made from it stay as they are. */
export async function deleteTemplate(db: Db, user: SessionUser, key: string, id: string): Promise<void> {
  const { space } = await requireSpaceByKey(db, user, key, 'editor');
  await requireWritable(db, space, id);
  await db.delete(pageTemplates).where(and(eq(pageTemplates.id, id), eq(pageTemplates.spaceId, space.id)));
}

/**
 * The body for a new page made from a template: a copy with fresh block ids.
 * `space` must come from the caller's requireSpaceByKey(…, 'editor') check
 * (POST /api/spaces/:key/pages). An unknown id, or another space's template, is 400.
 */
export async function pageDocFromTemplate(db: Db, space: SpaceRow, templateId: string): Promise<Doc> {
  const builtin = findBuiltin(templateId);
  if (builtin) return withFreshBlockIds(builtin.doc);
  const row = await loadSpaceTemplate(db, space.id, templateId);
  if (!row) throw badRequest('That template is not in this space');
  return withFreshBlockIds(row.doc);
}
