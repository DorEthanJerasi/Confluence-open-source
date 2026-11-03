// Where uploaded file bytes live (ARCHITECTURE.md §4, "Files"). Routes only use
// this interface, so an S3-compatible store can be added later without
// touching them. Keys are opaque ids chosen by the server, never user input.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface FileStorage {
  /** Store the stream under key; resolves to the bytes written. On error nothing is left behind. */
  put(key: string, data: Readable): Promise<number>;
  /** A stream of the stored bytes, or null if the key is unknown. */
  get(key: string): Promise<Readable | null>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[0-9a-f-]{36}$/;

function safeKey(key: string): string {
  if (!KEY_RE.test(key)) throw new Error('invalid storage key');
  return key;
}

export class DiskStorage implements FileStorage {
  constructor(private readonly dir: string) {}

  private path(key: string) {
    return join(this.dir, safeKey(key));
  }

  async put(key: string, data: Readable): Promise<number> {
    await mkdir(this.dir, { recursive: true });
    const final = this.path(key);
    const part = `${final}.part`;
    try {
      const out = createWriteStream(part, { flags: 'wx' });
      await pipeline(data, out);
      await rename(part, final);
      return out.bytesWritten;
    } catch (err) {
      await rm(part, { force: true });
      throw err;
    }
  }

  async get(key: string): Promise<Readable | null> {
    const p = this.path(key);
    try {
      await stat(p);
    } catch {
      return null;
    }
    return createReadStream(p);
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}
