import { describe, expect, it } from 'vitest';
import type { Role } from '@stillwater/shared';
import { effectiveRole } from '../src/auth/permissions.js';

const open = (defaultRole: Role) => ({ visibility: 'open' as const, defaultRole });
const restricted = { visibility: 'restricted' as const, defaultRole: 'viewer' as const };

describe('effectiveRole', () => {
  it.each([
    // instance role, space, membership, expected
    ['admin', restricted, null, 'admin'],
    ['admin', open('viewer'), 'viewer', 'admin'],
    ['editor', open('viewer'), null, 'viewer'],
    ['editor', open('editor'), null, 'editor'],
    ['editor', open('viewer'), 'editor', 'editor'],
    ['editor', open('viewer'), 'admin', 'admin'],
    ['editor', restricted, null, null],
    ['editor', restricted, 'editor', 'editor'],
    ['viewer', open('editor'), null, 'viewer'],
    ['viewer', restricted, 'admin', 'viewer'],
    ['viewer', restricted, null, null],
  ] as const)('%s in %o as member %s -> %s', (role, space, member, expected) => {
    expect(effectiveRole({ role }, space, member)).toBe(expected);
  });
});
