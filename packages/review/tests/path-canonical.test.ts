/**
 * path-canonical tests — verify the canonical-key utilities behave as
 * specified for the call sites that will plug into them in later steps
 * (seed maps, reachability blockers, cgProject lookup).
 *
 * The end-to-end fix for red-team finding #9 (a re-export crossing a
 * pnpm-style symlink fails seed lookup) requires canonicalizing the whole
 * pipeline including the ts-morph project's file additions — landing in a
 * later step. This module is the shared primitive both sides will use.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { canonicalize, createPathCanonicalizer, tryCanonicalize } from '../src/path-canonical.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'kern-canonical-'));
}

describe('canonicalize', () => {
  let tmp: string;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('returns the realpath for an existing file (resolves symlinks)', () => {
    tmp = makeTmp();
    const real = join(tmp, 'real-dir');
    mkdirSync(real);
    writeFileSync(join(real, 'src.ts'), 'export const x = 1\n');
    const link = join(tmp, 'link-dir');
    symlinkSync(real, link, 'dir');

    const viaLink = join(link, 'src.ts');
    const viaReal = join(real, 'src.ts');

    expect(canonicalize(viaLink)).toBe(canonicalize(viaReal));
  });

  it('is idempotent on a canonical path', () => {
    tmp = makeTmp();
    writeFileSync(join(tmp, 'x.ts'), '');
    const p = join(tmp, 'x.ts');
    const once = canonicalize(p);
    expect(canonicalize(once)).toBe(once);
  });

  it('falls back to deepest existing ancestor when the path does not exist', () => {
    tmp = makeTmp();
    const real = join(tmp, 'a');
    mkdirSync(real);
    const link = join(tmp, 'a-link');
    symlinkSync(real, link, 'dir');

    // missing/nope.ts does not exist under either real or link, but a/a-link
    // do, so canonicalize should resolve up to the symlink target.
    const result = canonicalize(join(link, 'missing/nope.ts'));
    expect(result).toBe(join(canonicalize(real), 'missing/nope.ts'));
  });

  it('returns an absolute path even for fully missing input', () => {
    const r = canonicalize('./does-not-exist-anywhere/nope.ts');
    expect(r.startsWith('/') || /^[A-Za-z]:[\\/]/.test(r)).toBe(true);
  });
});

describe('tryCanonicalize', () => {
  let tmp: string;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('returns the realpath when the file exists', () => {
    tmp = makeTmp();
    writeFileSync(join(tmp, 'a.ts'), '');
    const link = join(tmp, 'b.ts');
    symlinkSync(join(tmp, 'a.ts'), link, 'file');

    expect(tryCanonicalize(link)).toBe(tryCanonicalize(join(tmp, 'a.ts')));
  });

  it('returns undefined for a path that does not exist', () => {
    expect(tryCanonicalize('/this/path/should/never/exist-xyzzy')).toBeUndefined();
  });
});

describe('createPathCanonicalizer', () => {
  let tmp: string;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('memoizes results so the same input yields the same output without rework', () => {
    tmp = makeTmp();
    writeFileSync(join(tmp, 'mem.ts'), '');
    const canon = createPathCanonicalizer();

    const first = canon(join(tmp, 'mem.ts'));
    const second = canon(join(tmp, 'mem.ts'));
    expect(second).toBe(first);
  });

  it('caches by raw input, so symlinked and real paths cache separately but resolve to the same canonical', () => {
    tmp = makeTmp();
    const real = join(tmp, 'real.ts');
    const link = join(tmp, 'link.ts');
    writeFileSync(real, '');
    symlinkSync(real, link, 'file');

    const canon = createPathCanonicalizer();
    expect(canon(link)).toBe(canon(real));
  });
});
