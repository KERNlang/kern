/**
 * `.env` analyzer — covers the cases that matter for kern-sight (editor
 * diagnostics) and kern-guard (PR Check annotations):
 *   - clean file → zero findings
 *   - duplicate variables flagged with stable per-key fingerprints
 *   - malformed assignment lines flagged by content-hash fingerprint
 *   - committed-secret heuristic fires on real-looking values, NOT on
 *     placeholders (changeme, ${VAR}, <…>, your_…_here)
 *   - `.env.example` / `.env.sample` files suppress the secret rule
 */

import { isEnvFile, reviewEnvFile } from '../src/config-files/env.js';

describe('config-files/env', () => {
  describe('isEnvFile classifier', () => {
    it('matches .env and .env.<anything>', () => {
      expect(isEnvFile('/r/.env')).toBe(true);
      expect(isEnvFile('/r/.env.local')).toBe(true);
      expect(isEnvFile('/r/.env.production')).toBe(true);
      expect(isEnvFile('/r/.env.example')).toBe(true);
      expect(isEnvFile('/r/.env.test')).toBe(true);
    });

    it('does NOT match envrc, config.env, .envignore', () => {
      expect(isEnvFile('/r/.envrc')).toBe(false);
      expect(isEnvFile('/r/config.env')).toBe(false);
      expect(isEnvFile('/r/.envignore')).toBe(false);
    });
  });

  describe('clean files', () => {
    it('returns no findings for a well-formed .env', () => {
      const src = 'NODE_ENV=production\nPORT=3000\n# comment\n\nDEBUG=false\n';
      expect(reviewEnvFile(src, '/r/.env')).toEqual([]);
    });

    it('accepts `export KEY=VALUE` (bash-style)', () => {
      const src = 'export NODE_ENV=production\nexport PORT=3000\n';
      expect(reviewEnvFile(src, '/r/.env')).toEqual([]);
    });

    it('accepts quoted values', () => {
      const src = 'GREETING="hello world"\nNAME=\'kern\'\n';
      expect(reviewEnvFile(src, '/r/.env')).toEqual([]);
    });
  });

  describe('duplicate keys', () => {
    it('flags a second assignment of the same key', () => {
      const src = 'PORT=3000\nPORT=4000\n';
      const findings = reviewEnvFile(src, '/r/.env');
      const dups = findings.filter((f) => f.ruleId === 'env/duplicate-key');
      expect(dups).toHaveLength(1);
      expect(dups[0]?.message).toContain('Duplicate variable "PORT"');
      expect(dups[0]?.fingerprint).toBe('env/duplicate-key:PORT');
    });

    it('three duplicates produce two findings with distinct fingerprints', () => {
      const src = 'A=1\nA=2\nA=3\n';
      const findings = reviewEnvFile(src, '/r/.env');
      const dups = findings.filter((f) => f.ruleId === 'env/duplicate-key');
      expect(dups).toHaveLength(2);
      const fps = dups.map((d) => d.fingerprint);
      expect(new Set(fps).size).toBe(2);
      expect(fps).toContain('env/duplicate-key:A');
      expect(fps).toContain('env/duplicate-key:A#2');
    });

    it('duplicate fingerprint is stable across whitespace shifts (kern-guard contract)', () => {
      const a = reviewEnvFile('PORT=3000\nPORT=4000\n', '/r/.env');
      const b = reviewEnvFile('\n\n\nPORT=3000\nPORT=4000\n', '/r/.env');
      const fpA = a.find((f) => f.ruleId === 'env/duplicate-key')?.fingerprint;
      const fpB = b.find((f) => f.ruleId === 'env/duplicate-key')?.fingerprint;
      expect(fpA).toBe(fpB);
    });
  });

  describe('malformed lines', () => {
    it('flags a line without an `=`', () => {
      const src = 'PORT 3000\n';
      const findings = reviewEnvFile(src, '/r/.env');
      const m = findings.filter((f) => f.ruleId === 'env/malformed');
      expect(m).toHaveLength(1);
      expect(m[0]?.severity).toBe('warning');
    });

    it('does NOT flag blank or comment lines', () => {
      const src = '\n# this is fine\n  \n# another\n';
      expect(reviewEnvFile(src, '/r/.env')).toEqual([]);
    });

    it('malformed fingerprint is content-stable across line moves', () => {
      const a = reviewEnvFile('garbage line\n', '/r/.env');
      const b = reviewEnvFile('\n\ngarbage line\n', '/r/.env');
      const fpA = a.find((f) => f.ruleId === 'env/malformed')?.fingerprint;
      const fpB = b.find((f) => f.ruleId === 'env/malformed')?.fingerprint;
      expect(fpA).toBe(fpB);
    });
  });

  describe('possible-secret heuristic', () => {
    it('fires on a secret-shaped key with a real-looking value', () => {
      const findings = reviewEnvFile('API_KEY=sk_live_abc123def456\n', '/r/.env');
      const secrets = findings.filter((f) => f.ruleId === 'env/possible-secret');
      expect(secrets).toHaveLength(1);
      expect(secrets[0]?.message).toContain('"API_KEY"');
      expect(secrets[0]?.fingerprint).toBe('env/possible-secret:API_KEY');
    });

    it('does NOT fire on placeholder values', () => {
      const cases = [
        'API_KEY=changeme',
        'API_KEY=your_api_key_here',
        'API_KEY=<your-token>',
        'API_KEY=${OTHER}',
        'SECRET_TOKEN=example',
        'PRIVATE_KEY=',
        'PASSWORD=xxx',
        'ACCESS_KEY=xxx-xxx-xxx',
      ];
      for (const src of cases) {
        const findings = reviewEnvFile(`${src}\n`, '/r/.env');
        expect(findings.filter((f) => f.ruleId === 'env/possible-secret')).toEqual([]);
      }
    });

    it('does NOT fire on keys that are not secret-shaped', () => {
      const findings = reviewEnvFile('PORT=3000\nNODE_ENV=production\n', '/r/.env');
      expect(findings.filter((f) => f.ruleId === 'env/possible-secret')).toEqual([]);
    });

    it('is SUPPRESSED on .env.example by convention', () => {
      const src = 'API_KEY=sk_live_abc123\nSECRET_TOKEN=hunter2\n';
      const findings = reviewEnvFile(src, '/r/.env.example');
      expect(findings.filter((f) => f.ruleId === 'env/possible-secret')).toEqual([]);
    });

    it('is SUPPRESSED on .env.sample and .env.template too', () => {
      const src = 'API_KEY=sk_live_abc123\n';
      expect(reviewEnvFile(src, '/r/.env.sample').filter((f) => f.ruleId === 'env/possible-secret')).toEqual([]);
      expect(reviewEnvFile(src, '/r/.env.template').filter((f) => f.ruleId === 'env/possible-secret')).toEqual([]);
    });

    it('strips an inline `# comment` before checking for placeholder shapes', () => {
      const findings = reviewEnvFile('API_KEY=changeme # for prod replace this\n', '/r/.env');
      expect(findings.filter((f) => f.ruleId === 'env/possible-secret')).toEqual([]);
    });
  });
});
