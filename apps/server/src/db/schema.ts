// Stillwater database schema (ARCHITECTURE.md §4). Migrations are generated
// from this file with `npm run db:generate -w apps/server` and committed.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { Doc, NotificationKind, Role, Visibility } from '@stillwater/shared';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// Kept from the self-host skeleton (migration 0000); harmless.
export const instanceMeta = pgTable('instance_meta', {
  id: id(),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').$type<Role>().notNull().default('editor'),
    createdAt: createdAt(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sessions_token_hash_unique').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const spaces = pgTable(
  'spaces',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    visibility: text('visibility').$type<Visibility>().notNull().default('open'),
    defaultRole: text('default_role').$type<Role>().notNull().default('viewer'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    // Trash (docs/done-checks/11-trash.md): set while the space is in the
    // trash. A trashed space is hidden everywhere; its key stays taken.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('spaces_key_unique').on(t.key)],
);

export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<Role>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.userId] }), index('space_members_user_idx').on(t.userId)],
);

export const pages = pgTable(
  'pages',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => pages.id, { onDelete: 'cascade' }),
    position: text('position').notNull(),
    title: text('title').notNull().default(''),
    doc: jsonb('doc').$type<Doc>().notNull(),
    docText: text('doc_text').notNull().default(''),
    search: tsvector('search').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("doc_text", '')), 'B')`,
    ),
    version: integer('version').notNull().default(1),
    // Reserved for real-time co-editing (ARCHITECTURE.md §3). Unused today.
    ydocState: bytea('ydoc_state'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Trash (docs/done-checks/11-trash.md). One delete = one trash item: the
    // page deleted and every live page under it share deleted_at, deleted_by
    // and trash_root_id (the deleted page's id). Set only while deleted_at is.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
    trashRootId: uuid('trash_root_id'),
    // Page locks (docs/done-checks/17-locks.md). Lock and unlock set or clear
    // both together. locked_by is never set without locked_at, but may become
    // null on its own when that person's row is deleted: the page stays locked
    // ("Locked"). While locked_at is set, savePage refuses every change to
    // title and body (423). Written only by pages/locks.ts; trash, restore and
    // the purges leave them as they are.
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('pages_space_parent_idx').on(t.spaceId, t.parentId, t.position),
    index('pages_search_idx').using('gin', t.search),
    index('pages_trash_idx').on(t.spaceId, t.trashRootId).where(sql`${t.deletedAt} is not null`),
    check('pages_lock_check', sql`${t.lockedBy} is null or ${t.lockedAt} is not null`),
  ],
);

// Page history (ARCHITECTURE.md §5). Written only by createPage and savePage,
// in the same transaction as the page row. created_at is when the snapshot was
// opened; saved_at is the last save folded into it (the time the screen shows).
// restored_from is set when the snapshot is a restore; such rows are never
// folded into.
export const pageVersions = pgTable(
  'page_versions',
  {
    id: id(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    doc: jsonb('doc').$type<Doc>().notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
    restoredFrom: integer('restored_from'),
  },
  (t) => [uniqueIndex('page_versions_page_version_idx').on(t.pageId, t.version.desc())],
);

// Uploaded files (ARCHITECTURE.md §4, "Files"). The bytes live in FileStorage
// under storage_key; the row only says what the file is and whose space it is in.
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    storageKey: text('storage_key').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_page_idx').on(t.pageId), index('attachments_space_idx').on(t.spaceId)],
);

// Page comments (done-check 07). Kept out of pages.doc and page_versions on
// purpose: comments anchor to a top-level block id (or to the whole page when
// block_id is null), never to a position, so a later Yjs document holds only
// page content and comments need no change. One level of replies: a reply's
// parent_id is a root; only roots are resolved. Deleting is soft and clears body.
export const pageComments = pgTable(
  'page_comments',
  {
    id: id(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => pageComments.id, { onDelete: 'cascade' }),
    blockId: text('block_id'),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull().default(''),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('page_comments_page_idx').on(t.pageId, t.createdAt),
    check('page_comments_reply_not_resolved', sql`${t.parentId} is null or ${t.resolvedAt} is null`),
  ],
);

// Open Graph data fetched by the server for link preview cards, cached by URL.
export const linkPreviews = pgTable('link_previews', {
  url: text('url').primaryKey(),
  title: text('title'),
  description: text('description'),
  imageUrl: text('image_url'),
  siteName: text('site_name'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// Page templates (docs/done-checks/08-templates.md). A template body is the
// same ProseMirror JSON as pages.doc, checked by the same normalizeDoc. Only a
// space's own templates live here; the built-ins are in code
// (src/templates/builtin.ts). A page made from a template is a copy, so no
// page points back here. No ydoc_state: templates are never co-edited.
export const pageTemplates = pgTable(
  'page_templates',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    doc: jsonb('doc').$type<Doc>().notNull(),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('page_templates_space_name_idx').on(t.spaceId, sql`lower(${t.name})`)],
);

// Favourites and recently viewed (docs/done-checks/09-favourites-recent.md).
// Personal lists: each row is only a person, a page and a time. Lists are
// filtered when read (pages.deleted_at, visibleSpaceIds), never cleaned up when
// access changes. They never touch pages.doc or ydoc_state, so co-editing
// needs no change here. A person keeps at most 50 view rows (me/personal.ts).
export const pageFavourites = pgTable(
  'page_favourites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] }), index('page_favourites_user_idx').on(t.userId, t.createdAt.desc())],
);

export const pageViews = pgTable(
  'page_views',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] }), index('page_views_user_idx').on(t.userId, t.viewedAt.desc())],
);

// Task index (docs/done-checks/12-tasks.md). The page document is the truth: a
// task's person, due day and tick are attrs on its taskItem in pages.doc. This
// table is rebuilt from the doc by createPage and savePage in the same
// transaction as the page row, and nothing else writes it, so a history
// restore, a template or a later co-editing server keep it right for free.
// My tasks filters it when read (pages.deleted_at, visibleSpaceIds).
export const pageTasks = pgTable(
  'page_tasks',
  {
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    due: date('due', { mode: 'string' }),
    checked: boolean('checked').notNull(),
    text: text('text').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.pageId, t.taskId] }),
    index('page_tasks_open_idx').on(t.assigneeId, t.due).where(sql`${t.checked} = false`),
  ],
);

// Labels (docs/done-checks/13-labels.md). A label is a named tag kept beside a
// page, never in pages.doc: adding or removing one does not change the doc,
// its version, updated_at or page history, so it never causes a save conflict
// and co-editing can be added without touching labels. One row per name, for
// the whole wiki, with an id that never changes (the row stays when no page
// uses it). page_labels is a set keyed by (page, label). Every read filters it
// by live pages in visibleSpaceIds; trash and restore leave it alone, purge
// removes it by cascade.
export const labels = pgTable('labels', {
  id: id(),
  name: text('name').notNull().unique(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const pageLabels = pgTable(
  'page_labels',
  {
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.labelId] }), index('page_labels_label_idx').on(t.labelId)],
);

// Following and notifications (docs/done-checks/15-mentions.md). Both hold only
// ids and times, never page text or titles: the screen reads titles and names
// when it lists them. Notifications are written by createPage, savePage and
// createComment in their own transaction (notifications/notifications.ts) and
// filtered when read (live pages in visibleSpaceIds), never cleaned up when
// access changes; purge removes them by cascade. Nothing here writes pages or
// page_versions, so co-editing can be added without touching these tables.
export const pageFollows = pgTable(
  'page_follows',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] }), index('page_follows_page_idx').on(t.pageId)],
);

// An unread edit notification folds further saves into itself (count, actor,
// created_at move on): the partial unique index is the upsert's target.
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<NotificationKind>().notNull(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    commentId: uuid('comment_id').references(() => pageComments.id, { onDelete: 'cascade' }),
    count: integer('count').notNull().default(1),
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt.desc()),
    uniqueIndex('notifications_edit_unread_idx')
      .on(t.userId, t.pageId)
      .where(sql`kind = 'edit' and read_at is null`),
    check('notifications_kind_check', sql`${t.kind} in ('mention', 'comment', 'edit')`),
  ],
);
