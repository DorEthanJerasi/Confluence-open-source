// One typed client for the Stillwater API. Every call goes through `request`,
// which sends the session cookie and turns error bodies into ApiFailure.
import type { ApiError, AuthConfig, Page, PageTreeItem, Role, Space, SpaceMember, User, Visibility } from '@stillwater/shared';

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
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
  deleteSpace: (key: string) => request<{ ok: true }>('DELETE', `/api/spaces/${enc(key)}`),
  members: (key: string) => get<{ members: SpaceMember[] }>(`/api/spaces/${enc(key)}/members`),
  setMember: (key: string, userId: string, role: Role) =>
    request<{ ok: true }>('PUT', `/api/spaces/${enc(key)}/members/${enc(userId)}`, { role }),
  removeMember: (key: string, userId: string) =>
    request<{ ok: true }>('DELETE', `/api/spaces/${enc(key)}/members/${enc(userId)}`),

  tree: (key: string) => get<{ pages: PageTreeItem[] }>(`/api/spaces/${enc(key)}/pages`),
  createPage: (key: string, b: { title: string; parentId: string | null }) =>
    request<{ page: Page }>('POST', `/api/spaces/${enc(key)}/pages`, b),
  page: (id: string) => get<{ page: Page }>(`/api/pages/${enc(id)}`),
  savePage: (id: string, b: { baseVersion: number; title?: string }) =>
    request<{ version: number }>('PUT', `/api/pages/${enc(id)}`, b),
  movePage: (id: string, b: { parentId: string | null; index: number }) =>
    request<{ ok: true }>('POST', `/api/pages/${enc(id)}/move`, b),
  deletePage: (id: string) => request<{ ok: true; deleted: number }>('DELETE', `/api/pages/${enc(id)}`),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}
