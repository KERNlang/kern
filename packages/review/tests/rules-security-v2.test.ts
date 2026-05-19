import { reviewSource } from '../src/index.js';

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
      const f = report.findings.filter((f) => f.ruleId === 'jwt-weak-verification');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].severity).toBe('warning');
      expect(f[0].message).toContain('decode');
    });

    it('flags jwt.verify() without algorithms option', () => {
      const source = `
        import jwt from 'jsonwebtoken';
        const payload = jwt.verify(token, secret);
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter((f) => f.ruleId === 'jwt-weak-verification');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].message).toContain('algorithms');
    });

    it('flags jwt.verify() with options but no algorithms', () => {
      const source = `
        import jwt from 'jsonwebtoken';
        const payload = jwt.verify(token, secret, { issuer: 'myapp' });
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter((f) => f.ruleId === 'jwt-weak-verification');
      expect(f.length).toBeGreaterThanOrEqual(1);
    });

    it('passes jwt.verify() with algorithms', () => {
      const source = `
        import jwt from 'jsonwebtoken';
        const payload = jwt.verify(token, secret, { algorithms: ['RS256'] });
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter((f) => f.ruleId === 'jwt-weak-verification');
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
      const f = report.findings.filter((f) => f.ruleId === 'cookie-hardening');
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
      const f = report.findings.filter((f) => f.ruleId === 'cookie-hardening');
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
      const f = report.findings.filter((f) => f.ruleId === 'cookie-hardening');
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
      const f = report.findings.filter((f) => f.ruleId === 'cookie-hardening');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f.some((x) => x.message.includes('httpOnly: false'))).toBe(true);
    });

    it('flags NextResponse auth cookies without security options', () => {
      const source = `
        import { NextResponse } from 'next/server';

        export async function POST() {
          const response = NextResponse.json({ ok: true });
          response.cookies.set('session_token', token);
          return response;
        }
      `;
      const report = reviewSource(source, 'app/api/login/route.ts');
      const f = report.findings.filter((f) => f.ruleId === 'cookie-hardening');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].severity).toBe('error');
    });

    it('flags cookies().set object form missing secure flags', () => {
      const source = `
        import { cookies } from 'next/headers';

        export async function login() {
          cookies().set({ name: 'refresh_token', value: token, httpOnly: true });
        }
      `;
      const report = reviewSource(source, 'app/actions.ts');
      const f = report.findings.filter((f) => f.ruleId === 'cookie-hardening');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].message).toContain('secure');
    });

    it('flags assigned Next cookies store missing security options', () => {
      const source = `
        import { cookies } from 'next/headers';

        export async function login() {
          const cookieStore = cookies();
          cookieStore.set('session_token', token);
        }
      `;
      const report = reviewSource(source, 'app/actions.ts');
      const f = report.findings.filter((f) => f.ruleId === 'cookie-hardening');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].severity).toBe('error');
    });

    it('flags awaited Next cookies store missing security options', () => {
      const source = `
        import { cookies } from 'next/headers';

        export async function login() {
          (await cookies()).set('refresh_token', token, { httpOnly: true });
        }
      `;
      const report = reviewSource(source, 'app/actions.ts');
      const f = report.findings.filter((f) => f.ruleId === 'cookie-hardening');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].message).toContain('secure');
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
      const f = report.findings.filter((f) => f.ruleId === 'csrf-detection');
      expect(f.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag bearer-token API', () => {
      const source = `
        import express from 'express';
        const app = express();
        app.post('/api/data', (req, res) => { /* no cookies */ });
      `;
      const report = reviewSource(source, 'api.ts');
      const f = report.findings.filter((f) => f.ruleId === 'csrf-detection');
      expect(f.length).toBe(0);
    });
  });

  // ── browser-storage-json-parse-unguarded ───────────────────────────────

  describe('browser-storage-json-parse-unguarded', () => {
    it('flags JSON.parse(localStorage.getItem()) outside try/catch', () => {
      const source = `
        export function readPrefs() {
          return JSON.parse(localStorage.getItem('prefs') || '{}');
        }
      `;
      const report = reviewSource(source, 'prefs.ts');
      const f = report.findings.find((f) => f.ruleId === 'browser-storage-json-parse-unguarded');
      expect(f).toBeDefined();
    });

    it('flags JSON.parse(sessionStorage.getItem()) outside try/catch', () => {
      const source = `
        export function readDraft() {
          return JSON.parse(window.sessionStorage.getItem('draft'));
        }
      `;
      const report = reviewSource(source, 'draft.ts');
      const f = report.findings.find((f) => f.ruleId === 'browser-storage-json-parse-unguarded');
      expect(f).toBeDefined();
    });

    it('does not flag browser storage parsing inside try/catch', () => {
      const source = `
        export function readPrefs() {
          try {
            return JSON.parse(localStorage.getItem('prefs') || '{}');
          } catch {
            return {};
          }
        }
      `;
      const report = reviewSource(source, 'prefs.ts');
      expect(report.findings.find((f) => f.ruleId === 'browser-storage-json-parse-unguarded')).toBeUndefined();
    });

    it('flags asserted browser storage parsing outside try/catch', () => {
      const source = `
        export function readPrefs() {
          return JSON.parse((localStorage.getItem('prefs') || '{}') as string);
        }
      `;
      const report = reviewSource(source, 'prefs.ts');
      expect(report.findings.find((f) => f.ruleId === 'browser-storage-json-parse-unguarded')).toBeDefined();
    });

    it('flags browser storage parsing in deferred callbacks despite outer try/catch', () => {
      const source = `
        export function readLater() {
          try {
            setTimeout(() => JSON.parse(localStorage.getItem('prefs') || '{}'), 0);
          } catch {}
        }
      `;
      const report = reviewSource(source, 'prefs.ts');
      expect(report.findings.find((f) => f.ruleId === 'browser-storage-json-parse-unguarded')).toBeDefined();
    });

    it('flags browser storage parsing inside conditional expressions', () => {
      const source = `
        export function readPrefs(enabled: boolean) {
          return JSON.parse(enabled ? localStorage.getItem('prefs') : '{}');
        }
      `;
      const report = reviewSource(source, 'prefs.ts');
      expect(report.findings.find((f) => f.ruleId === 'browser-storage-json-parse-unguarded')).toBeDefined();
    });
  });

  // ── postmessage-wildcard-target ───────────────────────────────────────

  describe('postmessage-wildcard-target', () => {
    it('flags wildcard postMessage targetOrigin', () => {
      const source = `
        export function send(frame: HTMLIFrameElement) {
          frame.contentWindow?.postMessage({ type: 'ready' }, '*');
        }
      `;
      const report = reviewSource(source, 'frame.ts');
      const f = report.findings.find((f) => f.ruleId === 'postmessage-wildcard-target');
      expect(f).toBeDefined();
    });

    it('does not flag exact postMessage targetOrigin', () => {
      const source = `
        export function send(frame: HTMLIFrameElement) {
          frame.contentWindow?.postMessage({ type: 'ready' }, 'https://example.com');
        }
      `;
      const report = reviewSource(source, 'frame.ts');
      expect(report.findings.find((f) => f.ruleId === 'postmessage-wildcard-target')).toBeUndefined();
    });

    it('flags global and top postMessage wildcard targets', () => {
      const source = `
        export function send() {
          postMessage({ type: 'ready' }, '*');
          window.top?.postMessage({ type: 'ready' }, '*');
          window.parent.postMessage({ type: 'ready' }, '*');
          popup.opener.postMessage({ type: 'ready' }, '*');
        }
      `;
      const report = reviewSource(source, 'frame.ts');
      const findings = report.findings.filter((f) => f.ruleId === 'postmessage-wildcard-target');
      expect(findings.length).toBeGreaterThanOrEqual(4);
    });

    it('does not flag a locally defined postMessage helper', () => {
      const source = `
        function postMessage(channel: string, target: string) {}
        export function send() {
          postMessage('internal', '*');
        }
      `;
      const report = reviewSource(source, 'queue.ts');
      expect(report.findings.find((f) => f.ruleId === 'postmessage-wildcard-target')).toBeUndefined();
    });
  });

  // ── postmessage-missing-target-origin ─────────────────────────────────

  describe('postmessage-missing-target-origin', () => {
    it('flags postMessage without targetOrigin', () => {
      const source = `
        export function send() {
          window.parent.postMessage({ type: 'ready' });
        }
      `;
      const report = reviewSource(source, 'frame.ts');
      expect(report.findings.find((f) => f.ruleId === 'postmessage-missing-target-origin')).toBeDefined();
    });

    it('does not flag postMessage with exact targetOrigin', () => {
      const source = `
        export function send() {
          window.parent.postMessage({ type: 'ready' }, 'https://example.com');
        }
      `;
      const report = reviewSource(source, 'frame.ts');
      expect(report.findings.find((f) => f.ruleId === 'postmessage-missing-target-origin')).toBeUndefined();
    });

    it('does not flag a local postMessage helper without targetOrigin', () => {
      const source = `
        function postMessage(message: unknown) {}
        export function send() {
          postMessage({ type: 'ready' });
        }
      `;
      const report = reviewSource(source, 'queue.ts');
      expect(report.findings.find((f) => f.ruleId === 'postmessage-missing-target-origin')).toBeUndefined();
    });

    it('does not flag bare worker postMessage without targetOrigin', () => {
      const source = `
        export function sendToMain() {
          postMessage({ type: 'ready' });
        }
      `;
      const report = reviewSource(source, 'app.worker.ts');
      expect(report.findings.find((f) => f.ruleId === 'postmessage-missing-target-origin')).toBeUndefined();
    });

    it('flags nullish postMessage targetOrigin', () => {
      const source = `
        export function send() {
          window.parent.postMessage({ type: 'ready' }, undefined);
        }
      `;
      const report = reviewSource(source, 'frame.ts');
      expect(report.findings.find((f) => f.ruleId === 'postmessage-missing-target-origin')).toBeDefined();
    });
  });

  // ── html-string-target-blank-noopener ─────────────────────────────────

  describe('html-string-target-blank-noopener', () => {
    it('flags HTML string target blank without rel noopener', () => {
      const source = `
        export const link = '<a href="https://example.com" target="_blank">open</a>';
      `;
      const report = reviewSource(source, 'messages.ts');
      expect(report.findings.find((f) => f.ruleId === 'html-string-target-blank-noopener')).toBeDefined();
    });

    it('does not flag HTML string target blank with noopener', () => {
      const source = `
        export const link = '<a href="https://example.com" target="_blank" rel="noopener noreferrer">open</a>';
      `;
      const report = reviewSource(source, 'messages.ts');
      expect(report.findings.find((f) => f.ruleId === 'html-string-target-blank-noopener')).toBeUndefined();
    });

    it('flags template HTML string target blank without rel noopener', () => {
      const source = `
        export function link(url: string) {
          return \`<a href="\${url}" target="_blank">open</a>\`;
        }
      `;
      const report = reviewSource(source, 'messages.ts');
      expect(report.findings.find((f) => f.ruleId === 'html-string-target-blank-noopener')).toBeDefined();
    });

    it('does not flag target blank strings in test files', () => {
      const source = `
        export const fixture = '<a href="https://example.com" target="_blank">open</a>';
      `;
      const report = reviewSource(source, 'component.test.ts');
      expect(report.findings.find((f) => f.ruleId === 'html-string-target-blank-noopener')).toBeUndefined();
    });
  });

  // ── client-open-redirect-from-query ────────────────────────────────────

  describe('client-open-redirect-from-query', () => {
    it('flags query parameter assigned to location.href', () => {
      const source = `
        export function finish() {
          const params = new URLSearchParams(window.location.search);
          const next = params.get('redirect');
          if (next) window.location.href = next;
        }
      `;
      const report = reviewSource(source, 'redirect.ts');
      const f = report.findings.find((f) => f.ruleId === 'client-open-redirect-from-query');
      expect(f).toBeDefined();
    });

    it('flags direct query parameter passed to location.replace', () => {
      const source = `
        export function finish() {
          window.location.replace(new URLSearchParams(location.search).get('next'));
        }
      `;
      const report = reviewSource(source, 'redirect.ts');
      const f = report.findings.find((f) => f.ruleId === 'client-open-redirect-from-query');
      expect(f).toBeDefined();
    });

    it('flags asserted and fallback query parameter redirects', () => {
      const source = `
        export function finish() {
          const params = new URLSearchParams(window.location.search);
          const next = params.get('redirect') || '/';
          window.location.href = next as string;
        }
      `;
      const report = reviewSource(source, 'redirect.ts');
      const f = report.findings.find((f) => f.ruleId === 'client-open-redirect-from-query');
      expect(f).toBeDefined();
    });

    it('flags direct assignment to window.location from query params', () => {
      const source = `
        export function finish() {
          window.location = new URLSearchParams(location.search).get('next') as any;
        }
      `;
      const report = reviewSource(source, 'redirect.ts');
      const f = report.findings.find((f) => f.ruleId === 'client-open-redirect-from-query');
      expect(f).toBeDefined();
    });

    it('flags chained query param transforms before redirect', () => {
      const source = `
        export function finish() {
          const params = new URLSearchParams(window.location.search);
          const next = params.get('redirect')?.trim();
          if (next) location.assign(next);
        }
      `;
      const report = reviewSource(source, 'redirect.ts');
      const f = report.findings.find((f) => f.ruleId === 'client-open-redirect-from-query');
      expect(f).toBeDefined();
    });

    it('flags URL.searchParams values passed to client redirect sinks', () => {
      const source = `
        export function finish() {
          const next = new URL(window.location.href).searchParams.get('redirect');
          if (next) window.location.href = next;
        }
      `;
      const report = reviewSource(source, 'redirect.ts');
      const f = report.findings.find((f) => f.ruleId === 'client-open-redirect-from-query');
      expect(f).toBeDefined();
    });

    it('does not flag static same-origin redirect', () => {
      const source = `
        export function finish() {
          window.location.href = '/account';
        }
      `;
      const report = reviewSource(source, 'redirect.ts');
      expect(report.findings.find((f) => f.ruleId === 'client-open-redirect-from-query')).toBeUndefined();
    });
  });

  // ── window-open-blank-missing-noopener ────────────────────────────────

  describe('window-open-blank-missing-noopener', () => {
    it("flags window.open(..., '_blank') without feature string", () => {
      const source = `
        export function openDocs(url: string) {
          window.open(url, '_blank');
        }
      `;
      const report = reviewSource(source, 'open.ts');
      expect(report.findings.find((f) => f.ruleId === 'window-open-blank-missing-noopener')).toBeDefined();
    });

    it('flags window.open blank target when features omit noopener', () => {
      const source = `
        export function openDocs(url: string) {
          window.open(url, '_blank', 'width=600,height=400');
        }
      `;
      const report = reviewSource(source, 'open.ts');
      expect(report.findings.find((f) => f.ruleId === 'window-open-blank-missing-noopener')).toBeDefined();
    });

    it('does not flag window.open blank target with noopener', () => {
      const source = `
        export function openDocs(url: string) {
          window.open(url, '_blank', 'noopener,noreferrer,width=600');
        }
      `;
      const report = reviewSource(source, 'open.ts');
      expect(report.findings.find((f) => f.ruleId === 'window-open-blank-missing-noopener')).toBeUndefined();
    });

    it('does not flag window.open blank target with noopener=yes', () => {
      const source = `
        export function openDocs(url: string) {
          window.open(url, '_blank', 'noopener=yes,width=600');
        }
      `;
      const report = reviewSource(source, 'open.ts');
      expect(report.findings.find((f) => f.ruleId === 'window-open-blank-missing-noopener')).toBeUndefined();
    });

    it('flags globalThis.open blank target without noopener', () => {
      const source = `
        export function openDocs(url: string) {
          globalThis.open(url, '_blank');
        }
      `;
      const report = reviewSource(source, 'open.ts');
      expect(report.findings.find((f) => f.ruleId === 'window-open-blank-missing-noopener')).toBeDefined();
    });

    it('flags self.open blank target without noopener', () => {
      const source = `
        export function openDocs(url: string) {
          self.open(url, '_blank');
        }
      `;
      const report = reviewSource(source, 'open.ts');
      expect(report.findings.find((f) => f.ruleId === 'window-open-blank-missing-noopener')).toBeDefined();
    });
  });

  // ── iframe-dynamic-src-missing-sandbox ────────────────────────────────

  describe('iframe-dynamic-src-missing-sandbox', () => {
    it('flags iframe with dynamic src and no sandbox', () => {
      const source = `
        export function Embed({ url }: { url: string }) {
          return <iframe src={url} />;
        }
      `;
      const report = reviewSource(source, 'embed.tsx');
      expect(report.findings.find((f) => f.ruleId === 'iframe-dynamic-src-missing-sandbox')).toBeDefined();
    });

    it('flags iframe with external static src and no sandbox', () => {
      const source = `
        export function Embed() {
          return <iframe src="https://example.com/widget" />;
        }
      `;
      const report = reviewSource(source, 'embed.tsx');
      expect(report.findings.find((f) => f.ruleId === 'iframe-dynamic-src-missing-sandbox')).toBeDefined();
    });

    it('does not flag sandboxed dynamic iframe src', () => {
      const source = `
        export function Embed({ url }: { url: string }) {
          return <iframe src={url} sandbox="allow-scripts" />;
        }
      `;
      const report = reviewSource(source, 'embed.tsx');
      expect(report.findings.find((f) => f.ruleId === 'iframe-dynamic-src-missing-sandbox')).toBeUndefined();
    });

    it('does not flag static same-origin iframe src', () => {
      const source = `
        export function Preview() {
          return <iframe src="/preview" />;
        }
      `;
      const report = reviewSource(source, 'preview.tsx');
      expect(report.findings.find((f) => f.ruleId === 'iframe-dynamic-src-missing-sandbox')).toBeUndefined();
    });

    it('flags dynamic iframe srcDoc and no sandbox', () => {
      const source = `
        export function Preview({ html }: { html: string }) {
          return <iframe srcDoc={html} />;
        }
      `;
      const report = reviewSource(source, 'preview.tsx');
      expect(report.findings.find((f) => f.ruleId === 'iframe-dynamic-src-missing-sandbox')).toBeDefined();
    });

    it('does not flag static iframe srcDoc', () => {
      const source = `
        export function Preview() {
          return <iframe srcDoc={'<p>Preview</p>'} />;
        }
      `;
      const report = reviewSource(source, 'preview.tsx');
      expect(report.findings.find((f) => f.ruleId === 'iframe-dynamic-src-missing-sandbox')).toBeUndefined();
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
      const f = report.findings.filter((f) => f.ruleId === 'csp-strength');
      expect(f.some((x) => x.message.includes('unsafe-inline'))).toBe(true);
    });

    it('flags unsafe-eval in CSP', () => {
      const source = `
        const policy = "default-src 'self'; script-src 'unsafe-eval'";
      `;
      const report = reviewSource(source, 'server.ts');
      const f = report.findings.filter((f) => f.ruleId === 'csp-strength');
      expect(f.some((x) => x.message.includes('unsafe-eval'))).toBe(true);
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
      const f = report.findings.filter((f) => f.ruleId === 'path-traversal');
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
      const f = report.findings.filter((f) => f.ruleId === 'path-traversal');
      expect(f.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── weak-password-hashing ──────────────────────────────────────────────

  describe('weak-password-hashing', () => {
    it('flags createHash(md5) in password context', () => {
      const source = `
        import crypto from 'crypto';
        function hashPassword(password: string) {
          return crypto.createHash('md5').update(password).digest('hex');
        }
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter((f) => f.ruleId === 'weak-password-hashing');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].message).toContain('md5');
      expect(f[0].severity).toBe('error');
    });

    it('does not flag createHash(md5) for checksums', () => {
      const source = `
        import crypto from 'crypto';
        function getEtag(content: string) {
          return crypto.createHash('md5').update(content).digest('hex');
        }
      `;
      const report = reviewSource(source, 'util.ts');
      const f = report.findings.filter((f) => f.ruleId === 'weak-password-hashing');
      expect(f.length).toBe(0);
    });

    it('flags bcrypt with low rounds', () => {
      const source = `
        import bcrypt from 'bcrypt';
        const hash = bcrypt.hash(password, 4);
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter((f) => f.ruleId === 'weak-password-hashing');
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f[0].message).toContain('4 rounds');
    });

    it('flags pbkdf2 with low iterations', () => {
      const source = `
        import crypto from 'crypto';
        crypto.pbkdf2(password, salt, 1000, 64, 'sha512', callback);
      `;
      const report = reviewSource(source, 'auth.ts');
      const f = report.findings.filter((f) => f.ruleId === 'weak-password-hashing');
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
      const f = report.findings.filter((f) => f.ruleId === 'weak-password-hashing');
      expect(f.length).toBe(0);
    });
  });
});
