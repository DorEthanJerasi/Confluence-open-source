// One typed client for the Stillwater API. Every call goes through `request`,
// which sends the session cookie and turns error bodies into ApiFailure.
import type {
  AiStatus,
  ApiError,
  AskReply,
  AuthConfig,
  Comment,
  CommentList,
  Doc,
  FavouritePage,
  FollowReply,
  LabelSuggestionList,
  LabelView,
  LinkPreview,
  MarkReadBody,
  MyTaskList,
  NotificationList,
  Page,
  PageSummary,
  PageTemplate,
  PageTreeItem,
  PageVersion,
  PageVersionList,
  PageLabelsReply,
  RecentPage,
  Role,
  SearchResult,
  Space,
  SpaceMember,
  SpacePeopleList,
  TemplateSummary,
  TickTaskReply,
  UnreadCount,
  User,
  Visibility,
} from '@stillwater/shared';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  // A FormData body (file upload) goes as multipart; the browser sets its own content-type.
  const form = body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined && !form ? { 'content-type': 'application/json' } : {},
    body: form ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    throw new ApiFailure(res.status, err.error ?? 'error', err.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const get = <T>(url: string) => request<T>('GET', url);
const enc = encodeURIComponent;

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
}

/** What the server keeps about an uploaded file (POST /api/pages/:id/attachments). */
export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
}

export interface TrashPerson {
  id: string;
  name: string;
}

/** One trash item of a space: the page that was deleted, with `subPages` more under it. */
export interface TrashItem {
  id: string;
  title: string;
  deletedAt: string;
  deletedBy: TrashPerson | null;
  subPages: number;
  /** When it is deleted for good; null when the host keeps the trash forever. */
  purgeAt: string | null;
}

export interface TrashedSpace {
  id: string;
  key: string;
  name: string;
  deletedAt: string;
  deletedBy: TrashPerson | null;
  purgeAt: string | null;
}

export const api = {
  authConfig: () => get<AuthConfig>('/api/auth/config'),
  me: () => get<{ user: User }>('/api/auth/me'),
  signup: (b: { email: string; name: string; password: string }) => request<{ user: User }>('POST', '/api/auth/signup', b),
  login: (b: { email: string; password: string }) => request<{ user: User }>('POST', '/api/auth/login', b),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),

  users: () => get<{ users: User[] }>('/api/users'),
  directory: () => get<{ users: DirectoryUser[] }>('/api/users/directory'),
  createUser: (b: { email: string; name: string; password: string; role: Role }) =>
    request<{ user: User }>('POST', '/api/users', b),
  updateUser: (id: string, b: { role?: Role; disabled?: boolean; name?: string }) =>
    request<{ user: User }>('PATCH', `/api/users/${enc(id)}`, b),

  spaces: () => get<{ spaces: Space[] }>('/api/spaces'),
  space: (key: string) => get<{ space: Space }>(`/api/spaces/${enc(key)}`),
  createSpace: (b: { key: string; name: string; description: string; visibility: Visibility; defaultRole: Role }) =>
    request<{ space: Space }>('POST', '/api/spaces', b),
  updateSpace: (key: string, b: { name?: string; description?: string; visibility?: Visibility; defaultRole?: Role }) =>
    request<{ space: Space }>('PATCH', `/api/spaces/${enc(key)}`, b),
  /** Moves the space to the trash (space admin). */
  deleteSpace: (key: string) => request<null>('DELETE', `/api/spaces/${enc(key)}`),
  members: (key: string) => get<{ members: SpaceMember[] }>(`/api/spaces/${enc(key)}/members`),
  setMember: (key: string, userId: string, role: Role) =>
    request<{ ok: true }>('PUT', `/api/spaces/${enc(key)}/members/${enc(userId)}`, { role }),
  removeMember: (key: string, userId: string) =>
    request<{ ok: true }>('DELETE', `/api/spaces/${enc(key)}/members/${enc(userId)}`),

  tree: (key: string) => get<{ pages: PageTreeItem[] }>(`/api/spaces/${enc(key)}/pages`),
  /** With `templateId` the new page starts as a copy of that template (fresh block ids). */
  createPage: (key: string, b: { title: string; parentId: string | null; templateId?: string }) =>
    request<{ page: Page }>('POST', `/api/spaces/${enc(key)}/pages`, b),
  page: (id: string) => get<{ page: Page }>(`/api/pages/${enc(id)}`),
  savePage: (id: string, b: { baseVersion: number; title?: string; doc?: Doc }) =>
    request<{ version: number }>('PUT', `/api/pages/${enc(id)}`, b),
  movePage: (id: string, b: { parentId: string | null; index: number }) =>
    request<{ ok: true }>('POST', `/api/pages/${enc(id)}/move`, b),
  uploadAttachment: (pageId: string, file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request<Attachment>('POST', `/api/pages/${enc(pageId)}/attachments`, form);
  },
  /** The Open Graph card for a link; only `url` is set when the server refused or could not read it. */
  linkPreview: (url: string) => get<LinkPreview>(`/api/link-preview?url=${encodeURIComponent(url)}`),
  /** Full-text search over the pages this user may read; snippets hold hit markers, never HTML. */
  search: (q: string) => get<{ results: SearchResult[] }>(`/api/search?q=${enc(q)}`),
  /** Page history, newest first, 50 at a time; pass `nextBefore` as `before` for older ones. */
  versions: (id: string, before?: number) =>
    get<PageVersionList>(`/api/pages/${enc(id)}/versions${before !== undefined ? `?before=${before}` : ''}`),
  version: (id: string, version: number) => get<PageVersion>(`/api/pages/${enc(id)}/versions/${version}`),
  /** Writes that version's title and body as a new current version (nothing is deleted). */
  restoreVersion: (id: string, version: number, baseVersion: number) =>
    request<{ version: number }>('POST', `/api/pages/${enc(id)}/versions/${version}/restore`, { baseVersion }),
  /** Moves the page and its sub-pages to the trash (editor and up). */
  deletePage: (id: string) => request<{ ok: true; deleted: number }>('DELETE', `/api/pages/${enc(id)}`),

  /** The space's trash (editor and up): one item per delete, newest first. */
  trash: (key: string) => get<{ retentionDays: number; items: TrashItem[] }>(`/api/spaces/${enc(key)}/trash`),
  /** Brings a whole trash item back (editor and up). */
  restorePage: (id: string) =>
    request<{ page: { id: string; parentId: string | null; title: string } }>('POST', `/api/pages/${enc(id)}/restore`),
  /** Deletes one trash item for good, files included (space admin). */
  purgePage: (id: string) => request<null>('DELETE', `/api/pages/${enc(id)}/purge`),
  /** Deletes every item in the space's trash for good (space admin). */
  emptyTrash: (key: string) => request<{ purged: number }>('DELETE', `/api/spaces/${enc(key)}/trash`),
  /** Trashed spaces this person may restore: their space admins' and, for instance admins, all. */
  trashedSpaces: () => get<{ items: TrashedSpace[] }>('/api/trash/spaces'),
  restoreSpace: (id: string) => request<{ space: { id: string; key: string; name: string } }>('POST', `/api/trash/spaces/${enc(id)}/restore`),
  purgeSpace: (id: string) => request<null>('DELETE', `/api/trash/spaces/${enc(id)}`),

  /** Templates usable in this space (editors and up): built-ins first, then the space's own. No bodies. */
  templates: (key: string) => get<{ templates: TemplateSummary[] }>(`/api/spaces/${enc(key)}/templates`),
  template: (key: string, id: string) => get<{ template: PageTemplate }>(`/api/spaces/${enc(key)}/templates/${enc(id)}`),
  /** From a body, or from a page of this space (`fromPageId`), never both. A name clash is 409. */
  createTemplate: (key: string, b: { name: string; description?: string } & ({ doc: Doc } | { fromPageId: string })) =>
    request<{ template: PageTemplate }>('POST', `/api/spaces/${enc(key)}/templates`, b),
  /** A stale `baseVersion` is 409; built-ins are 403. */
  updateTemplate: (key: string, id: string, b: { baseVersion: number; name?: string; description?: string; doc?: Doc }) =>
    request<{ template: PageTemplate }>('PATCH', `/api/spaces/${enc(key)}/templates/${enc(id)}`, b),
  deleteTemplate: (key: string, id: string) => request<null>('DELETE', `/api/spaces/${enc(key)}/templates/${enc(id)}`),

  /** Whether the host has AI on. Only `{ enabled }`; never a key, provider or model. */
  aiStatus: () => get<AiStatus>('/api/ai/status'),
  /** A short plain-text summary of the page; 502 ai_unavailable when the provider fails. */
  summarisePage: (id: string) => request<PageSummary>('POST', `/api/pages/${enc(id)}/summary`),
  /** An answer from the pages the user can see, citing [n]; 502 ai_unavailable when the provider fails. */
  ask: (question: string) => request<AskReply>('POST', '/api/ai/ask', { question }),

  /** Comment threads of a page: open ones oldest first, then resolved ones newest resolved first. */
  comments: (pageId: string) => get<CommentList>(`/api/pages/${enc(pageId)}/comments`),
  /** A new thread (on the page, or on one top-level block) or, with `parentId`, a reply. */
  addComment: (pageId: string, b: { body: string; blockId?: string | null; parentId?: string | null }) =>
    request<{ comment: Comment }>('POST', `/api/pages/${enc(pageId)}/comments`, b),
  editComment: (id: string, body: string) => request<{ comment: Comment }>('PATCH', `/api/comments/${enc(id)}`, { body }),
  deleteComment: (id: string) => request<null>('DELETE', `/api/comments/${enc(id)}`),
  resolveComment: (id: string) => request<{ comment: Comment }>('POST', `/api/comments/${enc(id)}/resolve`),
  reopenComment: (id: string) => request<{ comment: Comment }>('POST', `/api/comments/${enc(id)}/reopen`),

  /** Star (on) or unstar a page for the person asking. Idempotent both ways; 404 if they cannot read it. */
  setFavourite: (pageId: string, on: boolean) =>
    request<null>(on ? 'PUT' : 'DELETE', `/api/pages/${enc(pageId)}/favourite`),
  /** Follow (on) or unfollow a page (viewer and up). Idempotent both ways; 404 if they cannot read it. */
  setFollow: (pageId: string, on: boolean) => request<FollowReply>(on ? 'PUT' : 'DELETE', `/api/pages/${enc(pageId)}/follow`),
  /** Own notifications on pages they can read now, newest first, 30 a time; `before` = the last id shown. */
  notifications: (before?: string) =>
    get<NotificationList>(`/api/me/notifications${before ? `?before=${enc(before)}` : ''}`),
  /** Unread count with exactly the list's filter. */
  unreadCount: () => get<UnreadCount>('/api/me/notifications/unread'),
  /** Marks some of yours (`ids`) or all of yours (`all`) as read; returns the unread count left. */
  markRead: (b: MarkReadBody) => request<UnreadCount>('POST', '/api/me/notifications/read', b),
  /** Records that the person opened this page (once per open; never on autosave or refetch). */
  recordView: (pageId: string) => request<null>('POST', `/api/pages/${enc(pageId)}/viewed`),
  /** The person's own favourites they can still read, newest first. */
  favourites: () => get<{ pages: FavouritePage[] }>('/api/me/favourites'),
  /** The person's own recently opened pages they can still read, newest first. */
  recent: () => get<{ pages: RecentPage[] }>('/api/me/recent'),

  /** The person's open tasks on live pages they can read: dated first, earliest first. */
  myTasks: () => get<MyTaskList>('/api/me/tasks'),
  /** Ticks or unticks a task through a normal page save (editor and up); 409 when the page just changed twice. */
  tickTask: (pageId: string, taskId: string, checked: boolean) =>
    request<TickTaskReply>('PATCH', `/api/pages/${enc(pageId)}/tasks/${enc(taskId)}`, { checked }),
  /** Active people who can read the space, by name (the task picker). */
  spacePeople: (key: string, q?: string) =>
    get<SpacePeopleList>(`/api/spaces/${enc(key)}/people${q ? `?q=${enc(q)}` : ''}`),

  /** Adds a label to a page (editor and up); a name the page has is a 200 with no change. */
  addLabel: (pageId: string, name: string) => request<PageLabelsReply>('POST', `/api/pages/${enc(pageId)}/labels`, { name }),
  /** Removes a label from a page (editor and up); one the page lacks is a 200 with no change. */
  removeLabel: (pageId: string, labelId: string) =>
    request<PageLabelsReply>('DELETE', `/api/pages/${enc(pageId)}/labels/${enc(labelId)}`),
  /** Label names on pages this person can see, with how many; names starting with `q` first. */
  labelSuggestions: (q: string) => get<LabelSuggestionList>(`/api/labels${q ? `?q=${enc(q)}` : ''}`),
  /** Live pages this person can see with the label, in the whole wiki. */
  labelView: (name: string) => get<LabelView>(`/api/labels/${enc(name)}/pages`),
  /** Live pages with the label in one space (viewer and up). */
  spaceLabelView: (key: string, name: string) => get<LabelView>(`/api/spaces/${enc(key)}/labels/${enc(name)}/pages`),
};

/** Query keys of the two personal lists on Home. */
export const favouritesKey = ['me', 'favourites'] as const;
export const recentKey = ['me', 'recent'] as const;
/** The bell's unread count; refresh it after anything that can hide or show notifications. */
export const unreadKey = ['me', 'notifications', 'unread'] as const;

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}
