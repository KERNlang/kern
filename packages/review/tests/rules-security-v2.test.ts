import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

describe('Security v2 Rules', () => {
  // ── jwt-weak-verification ──────────────────────────────────────────────

  describe('jwt-weak-verification', () => {
    it('flags jwt.decode() used for auth', () => {
      const source = `
        import jwt from 'jsonwebtoken';
        const payload = jwt.decode(token);
        if (payload.role === 'admin') { /* grant access */ }
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter(f => f.ruleId === 'jwt-weak-verification');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].severity).toBe('error');
      expect(f[0].message).toContain('decode');
    });

    it('flags jwt.verify() without algorithms option', () => {
      const source = `
        import jwt from 'jsonwebtoken';
        const payload = jwt.verify(token, secret);
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter(f => f.ruleId === 'jwt-weak-verification');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].message).toContain('algorithms');
    });

    it('flags jwt.verify() with options but no algorithms', () => {
      const source = `
        import jwt from 'jsonwebtoken';
        const payload = jwt.verify(token, secret, { issuer: 'myapp' });
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter(f => f.ruleId === 'jwt-weak-verification');
      expect(f.length).toBeGreaterThanOrEqual(1);
    });

    it('passes jwt.verify() with algorithms', () => {
      const source = `
        import jwt from 'jsonwebtoken';
        const payload = jwt.verify(token, secret, { algorithms: ['RS256'] });
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter(f => f.ruleId === 'jwt-weak-verification');
      expect(f.length).toBe(0);
    });
  });

  // ── cookie-hardening ───────────────────────────────────────────────────

  describe('cookie-hardening', () => {
    it('flags auth cookie without security options', () => {
      const source = `
        import express from 'express';
        const app = express();
        app.get('/login', (req, res) => {
          res.cookie('session_token', token);
        });
      `;
      const report = reviewSource(source, 'server.ts');
      const f = report.findings.filter(f => f.ruleId === 'cookie-hardening');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].severity).toBe('error');
    });

    it('flags auth cookie missing httpOnly', () => {
      const source = `
        import express from 'express';
        const app = express();
        app.get('/login', (req, res) => {
          res.cookie('auth_token', token, { secure: true, sameSite: 'strict' });
        });
      `;
      const report = reviewSource(source, 'server.ts');
      const f = report.findings.filter(f => f.ruleId === 'cookie-hardening');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].message).toContain('httpOnly');
    });

    it('passes fully hardened auth cookie', () => {
      const source = `
        import express from 'express';
        const app = express();
        app.get('/login', (req, res) => {
          res.cookie('session', token, { httpOnly: true, secure: true, sameSite: 'strict' });
        });
      `;
      const report = reviewSource(source, 'server.ts');
      const f = report.findings.filter(f => f.ruleId === 'cookie-hardening');
      expect(f.length).toBe(0);
    });

    it('flags httpOnly: false on auth cookie', () => {
      const source = `
        import express from 'express';
        const app = express();
        app.get('/login', (req, res) => {
          res.cookie('jwt', token, { httpOnly: false, secure: true, sameSite: 'strict' });
        });
      `;
      const report = reviewSource(source, 'server.ts');
      const f = report.findings.filter(f => f.ruleId === 'cookie-hardening');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f.some(x => x.message.includes('httpOnly: false'))).toBe(true);
    });
  });

  // ── csrf-detection ─────────────────────────────────────────────────────

  describe('csrf-detection', () => {
    it('flags cookie-auth app without CSRF protection', () => {
      const source = `
        import express from 'express';
        import session from 'express-session';
        const app = express();
        app.use(session({ secret: 'key' }));
        app.post('/transfer', (req, res) => { /* state change */ });
      `;
      const report = reviewSource(source, 'server.ts');
      const f = report.findings.filter(f => f.ruleId === 'csrf-detection');
      expect(f.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag bearer-token API', () => {
      const source = `
        import express from 'express';
        const app = express();
        app.post('/api/data', (req, res) => { /* no cookies */ });
      `;
      const report = reviewSource(source, 'api.ts');
      const f = report.findings.filter(f => f.ruleId === 'csrf-detection');
      expect(f.length).toBe(0);
    });
  });

  // ── csp-strength ───────────────────────────────────────────────────────

  describe('csp-strength', () => {
    it('flags unsafe-inline in CSP', () => {
      const source = `
        const csp = "default-src 'self'; script-src 'unsafe-inline'";
        res.setHeader('Content-Security-Policy', csp);
      `;
      const report = reviewSource(source, 'server.ts');
      const f = report.findings.filter(f => f.ruleId === 'csp-strength');
      expect(f.some(x => x.message.includes('unsafe-inline'))).toBe(true);
    });

    it('flags unsafe-eval in CSP', () => {
      const source = `
        const policy = "default-src 'self'; script-src 'unsafe-eval'";
      `;
      const report = reviewSource(source, 'server.ts');
      const f = report.findings.filter(f => f.ruleId === 'csp-strength');
      expect(f.some(x => x.message.includes('unsafe-eval'))).toBe(true);
    });
  });

  // ── path-traversal ─────────────────────────────────────────────────────

  describe('path-traversal', () => {
    it('flags readFile with req.params without validation', () => {
      const source = `
        import { readFile } from 'fs';
        app.get('/file/:name', (req, res) => {
          readFile(req.params.name, 'utf-8', (err, data) => res.send(data));
        });
      `;
      const report = reviewSource(source, 'server.ts');
      const f = report.findings.filter(f => f.ruleId === 'path-traversal');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].severity).toBe('error');
    });

    it('flags res.sendFile with user input', () => {
      const source = `
        app.get('/download', (req, res) => {
          res.sendFile(req.query.file);
        });
      `;
      const report = reviewSource(source, 'server.ts');
      const f = report.findings.filter(f => f.ruleId === 'path-traversal');
      expect(f.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── weak-password-hashing ──────────────────────────────────────────────

  describe('weak-password-hashing', () => {
    it('flags createHash(md5)', () => {
      const source = `
        import crypto from 'crypto';
        function hashPassword(password: string) {
          return crypto.createHash('md5').update(password).digest('hex');
        }
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter(f => f.ruleId === 'weak-password-hashing');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].message).toContain('md5');
    });

    it('flags bcrypt with low rounds', () => {
      const source = `
        import bcrypt from 'bcrypt';
        const hash = bcrypt.hash(password, 4);
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter(f => f.ruleId === 'weak-password-hashing');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].message).toContain('4 rounds');
    });

    it('flags pbkdf2 with low iterations', () => {
      const source = `
        import crypto from 'crypto';
        crypto.pbkdf2(password, salt, 1000, 64, 'sha512', callback);
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter(f => f.ruleId === 'weak-password-hashing');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].message).toContain('1');
      expect(f[0].message).toContain('000');
    });

    it('passes bcrypt with adequate rounds', () => {
      const source = `
        import bcrypt from 'bcrypt';
        const hash = bcrypt.hash(password, 12);
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter(f => f.ruleId === 'weak-password-hashing');
      expect(f.length).toBe(0);
    });
  });
});
