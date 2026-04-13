import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const cfg: ReviewConfig = { target: 'nextjs' };

describe('Security v5 Rules', () => {
  describe('xss-href-javascript', () => {
    it('flags literal javascript: href', () => {
      const src = `
export function Link() {
  return <a href="javascript:alert(1)">click</a>;
}
`;
      const r = reviewSource(src, 'link.tsx', cfg);
      const f = r.findings.find((x) => x.ruleId === 'xss-href-javascript');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('error');
      expect(f!.autofix).toBeDefined();
      expect(f!.autofix!.replacement).toBe('"#"');
    });

    it('flags javascript: in expression attribute', () => {
      const src = `
export function Link() {
  return <a href={"javascript:void(0)"}>click</a>;
}
`;
      const r = reviewSource(src, 'link.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'xss-href-javascript')).toBeDefined();
    });

    it('does not flag safe href', () => {
      const src = `
export function Link() {
  return <a href="/safe">click</a>;
}
`;
      const r = reviewSource(src, 'link.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'xss-href-javascript')).toBeUndefined();
    });

    it('flags javascript: on src/action/formAction', () => {
      const src = `
export function Form() {
  return (<form action="javascript:submit()"><input formAction="javascript:foo()" /></form>);
}
`;
      const r = reviewSource(src, 'form.tsx', cfg);
      const hits = r.findings.filter((f) => f.ruleId === 'xss-href-javascript');
      expect(hits.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('crypto-iv-reuse', () => {
    it('flags createCipheriv with string literal IV', () => {
      const src = `
import { createCipheriv } from 'crypto';
export function enc(key: Buffer) {
  return createCipheriv('aes-256-gcm', key, 'constant-iv-value');
}
`;
      const r = reviewSource(src, 'enc.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'crypto-iv-reuse')).toBeDefined();
    });

    it('flags createCipheriv with Buffer.alloc constant IV', () => {
      const src = `
import { createCipheriv } from 'crypto';
export function enc(key: Buffer) {
  return createCipheriv('aes-256-gcm', key, Buffer.alloc(12));
}
`;
      const r = reviewSource(src, 'enc.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'crypto-iv-reuse')).toBeDefined();
    });

    it('does not flag createCipheriv with randomBytes IV', () => {
      const src = `
import { createCipheriv, randomBytes } from 'crypto';
export function enc(key: Buffer) {
  const iv = randomBytes(12);
  return createCipheriv('aes-256-gcm', key, iv);
}
`;
      const r = reviewSource(src, 'enc.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'crypto-iv-reuse')).toBeUndefined();
    });
  });

  describe('crypto-weak-kdf', () => {
    it('flags pbkdf2 with too few iterations', () => {
      const src = `
import { pbkdf2Sync } from 'crypto';
export function derive(pwd: string, salt: Buffer) {
  return pbkdf2Sync(pwd, salt, 1000, 32, 'sha256');
}
`;
      const r = reviewSource(src, 'kdf.ts', cfg);
      const f = r.findings.find((x) => x.ruleId === 'crypto-weak-kdf');
      expect(f).toBeDefined();
      expect(f!.autofix).toBeDefined();
      expect(f!.autofix!.replacement).toBe('600_000');
    });

    it('does not flag pbkdf2 with sufficient iterations', () => {
      const src = `
import { pbkdf2Sync } from 'crypto';
export function derive(pwd: string, salt: Buffer) {
  return pbkdf2Sync(pwd, salt, 600_000, 32, 'sha256');
}
`;
      const r = reviewSource(src, 'kdf.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'crypto-weak-kdf')).toBeUndefined();
    });
  });
});
