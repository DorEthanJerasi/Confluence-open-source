import type { FastifyRequest } from 'fastify';
import type { Role } from '@stillwater/shared';
import type { Config } from '../env.js';
import type { Db } from '../db/client.js';
import { forbidden, unauthorized } from '../http.js';
import type { SessionUser } from './session.js';
import type { FileStorage } from '../files/storage.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: Config;
    storage: FileStorage;
  }
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Instance-level role check (e.g. admin-only user management). */
export function requireInstanceRole(req: FastifyRequest, role: Extract<Role, 'admin' | 'editor'>): SessionUser {
  const user = requireUser(req);
  if (role === 'admin' && user.role !== 'admin') throw forbidden();
  if (role === 'editor' && user.role === 'viewer') throw forbidden();
  return user;
}
