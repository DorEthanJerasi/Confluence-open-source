// Stillwater database schema (ARCHITECTURE.md §4). Migrations are generated
// from this file with `npm run db:generate -w apps/server` and committed.
import { sql } from 'drizzle-orm';
import {
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
import type { Doc, Role, Visibility } from '@stillwater/shared';

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
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('pages_space_parent_idx').on(t.spaceId, t.parentId, t.position),
    index('pages_search_idx').using('gin', t.search),
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

// Open Graph data fetched by the server for link preview cards, cached by URL.
export const linkPreviews = pgTable('link_previews', {
  url: text('url').primaryKey(),
  title: text('title'),
  description: text('description'),
  imageUrl: text('image_url'),
  siteName: text('site_name'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});
