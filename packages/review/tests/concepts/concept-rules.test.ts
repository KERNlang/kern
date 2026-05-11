import { Project } from 'ts-morph';
import { reviewSource } from '../../src/index.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

function createSourceFile(source: string, filePath = 'test.ts') {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  return project.createSourceFile(filePath, source);
}

describe('Concept Extraction (TS)', () => {
  describe('error_raise', () => {
    it('extracts throw statements', () => {
      const sf = createSourceFile(`
        function fail() { throw new Error('boom'); }
      `);
      const map = extractTsConcepts(sf, 'test.ts');
      const raises = map.nodes.filter((n) => n.kind === 'error_raise');
      expect(raises.length).toBe(1);
      expect(raises[0].payload.kind).toBe('error_raise');
      if (raises[0].payload.kind === 'error_raise') {
        expect(raises[0].payload.subtype).toBe('throw');
        expect(raises[0].payload.errorType).toBe('Error');
      }
    });

    it('extracts Promise.reject', () => {
      const sf = createSourceFile(`
        const p = Promise.reject(new Error('no'));
      `);
      const map = extractTsConcepts(sf, 'test.ts');
      const raises = map.nodes.filter((n) => n.kind === 'error_raise');
      expect(raises.length).toBe(1);
      if (raises[0].payload.kind === 'error_raise') {
        expect(raises[0].payload.subtype).toBe('reject');
      }
    });
  });

  describe('error_handle', () => {
    it('classifies empty catch as ignored', () => {
      const sf = createSourceFile(`
        try { doWork(); } catch (e) {}
      `);
      const map = extractTsConcepts(sf, 'test.ts');
      const handles = map.nodes.filter((n) => n.kind === 'error_handle');
      expect(handles.length).toBe(1);
      if (handles[0].payload.kind === 'error_handle') {
        expect(handles[0].payload.disposition).toBe('ignored');
        expect(handles[0].confidence).toBe(1.0);
      }
    });

    it('classifies catch with console.error as logged', () => {
      const sf = createSourceFile(`
        try { doWork(); } catch (e) { console.error(e); }
      `);
      const map = extractTsConcepts(sf, 'test.ts');
      const handles = map.nodes.filter((n) => n.kind === 'error_handle');
      expect(handles.length).toBe(1);
      if (handles[0].payload.kind === 'error_handle') {
        expect(handles[0].payload.disposition).toBe('logged');
      }
    });

    it('classifies catch with throw as rethrown/wrapped', () => {
      const sf = createSourceFile(`
        try { doWork(); } catch (e) { throw new AppError(e); }
      `);
      const map = extractTsConcepts(sf, 'test.ts');
      const handles = map.nodes.filter((n) => n.kind === 'error_handle');
      expect(handles.length).toBe(1);
      if (handles[0].payload.kind === 'error_handle') {
        expect(['wrapped', 'rethrown']).toContain(handles[0].payload.disposition);
      }
    });

    it('classifies .catch(() => {}) as ignored', () => {
      const sf = createSourceFile(`
        fetchData().catch(() => {});
      `);
      const map = extractTsConcepts(sf, 'test.ts');
      const handles = map.nodes.filter((n) => n.kind === 'error_handle');
      expect(handles.length).toBe(1);
      if (handles[0].payload.kind === 'error_handle') {
        expect(handles[0].payload.disposition).toBe('ignored');
      }
    });

    it('treats an empty catch with ANY intent comment as wrapped (Agon/AudioFacets FP regression)', () => {
      // Real shapes from AudioFacets + Agon generated code — 67 FPs in Agon
      // and ~50 in AudioFacets used these comment forms. Prior regex only
      // trusted `Intentional|Expected|@suppress|eslint-disable`.
      const samples = [
        `try { x(); } catch { /* ignore */ }`,
        `try { x(); } catch { /* swallow during janitor */ }`,
        `try { x(); } catch { /* non-fatal */ }`,
        `try { x(); } catch { /* already gone — ok */ }`,
        `try { x(); } catch { // Folder might already exist\n}`,
        `try { x(); } catch { // Process likely already exited.\n}`,
      ];
      for (const source of samples) {
        const sf = createSourceFile(source, `fixture-${Math.random()}.ts`);
        const map = extractTsConcepts(sf, 'fixture.ts');
        const handle = map.nodes.find((n) => n.kind === 'error_handle');
        expect(handle?.payload.kind).toBe('error_handle');
        if (handle?.payload.kind === 'error_handle') {
          expect(handle.payload.disposition).toBe('wrapped');
        }
      }
    });

    it('still flags a truly empty catch with no comment as ignored (genuine bug)', () => {
      const sf = createSourceFile('try { x(); } catch {}', 'empty-catch.ts');
      const map = extractTsConcepts(sf, 'empty-catch.ts');
      const handle = map.nodes.find((n) => n.kind === 'error_handle');
      if (handle?.payload.kind === 'error_handle') {
        expect(handle.payload.disposition).toBe('ignored');
      }
    });

    it('still flags an empty /* */ comment (no content) as ignored', () => {
      const sf = createSourceFile('try { x(); } catch { /* */ }', 'empty-comment.ts');
      const map = extractTsConcepts(sf, 'empty-comment.ts');
      const handle = map.nodes.find((n) => n.kind === 'error_handle');
      if (handle?.payload.kind === 'error_handle') {
        expect(handle.payload.disposition).toBe('ignored');
      }
    });
  });

  describe('effect', () => {
    it('detects fetch() as network effect', () => {
      const sf = createSourceFile(`
        async function getData() { const res = await fetch('/api'); }
      `);
      const map = extractTsConcepts(sf, 'test.ts');
      const effects = map.nodes.filter((n) => n.kind === 'effect');
      expect(effects.length).toBe(1);
      if (effects[0].payload.kind === 'effect') {
        expect(effects[0].payload.subtype).toBe('network');
        expect(effects[0].payload.async).toBe(true);
      }
    });

    it('detects readFile as fs effect', () => {
      const sf = createSourceFile(`
        import { readFile } from 'fs';
        readFile('data.txt', 'utf-8', cb);
      `);
      const map = extractTsConcepts(sf, 'test.ts');
      const effects = map.nodes.filter((n) => n.kind === 'effect');
      expect(effects.length).toBe(1);
      if (effects[0].payload.kind === 'effect') {
        expect(effects[0].payload.subtype).toBe('fs');
      }
    });

    it('detects db.query as db effect', () => {
      const sf = createSourceFile(`
        async function getUsers() { const rows = await db.query('SELECT *'); }
      `);
      const map = extractTsConcepts(sf, 'test.ts');
      const effects = map.nodes.filter((n) => n.kind === 'effect');
      expect(effects.length).toBe(1);
      if (effects[0].payload.kind === 'effect') {
        expect(effects[0].payload.subtype).toBe('db');
      }
    });

    // RULE-FEEDBACK.md #3: synchronous Web API accessors (Headers, cookies,
    // URLSearchParams) must NOT classify as network effects.
    it('does NOT classify request.headers.get() as network effect', () => {
      const sf = createSourceFile(`
        function check(request: Request) {
          if (request.headers.get('Authorization')?.includes('invalid')) return 401;
          return 200;
        }
      `);
      const map = extractTsConcepts(sf, 'test.ts');
      const effects = map.nodes.filter((n) => n.kind === 'effect');
      expect(effects.length).toBe(0);
    });

    it('does NOT classify url.searchParams.get() as network effect', () => {
      const sf = createSourceFile(`
        function read(url: URL) {
          return url.searchParams.get('page');
        }
      `);
      const map = extractTsConcepts(sf, 'test.ts');
      const effects = map.nodes.filter((n) => n.kind === 'effect');
      expect(effects.length).toBe(0);
    });

    it('does NOT classify req.cookies.get() as network effect', () => {
      const sf = createSourceFile(`
        function token(req: any) { return req.cookies.get('session'); }
      `);
      const map = extractTsConcepts(sf, 'test.ts');
      const effects = map.nodes.filter((n) => n.kind === 'effect');
      expect(effects.length).toBe(0);
    });

    // Regression guard for the Evil Twin's challenge #2: chained client
    // builders must STILL be detected as network effects.
    it('still detects request.get(url) (express-style http client)', () => {
      const sf = createSourceFile(`
        const request = require('http').request;
        async function fetchIt() { return request.get('https://api.example.com'); }
      `);
      const map = extractTsConcepts(sf, 'test.ts');
      const effects = map.nodes.filter(
        (n) => n.kind === 'effect' && n.payload.kind === 'effect' && n.payload.subtype === 'network',
      );
      expect(effects.length).toBe(1);
    });
  });
});

describe('Concept Rules (universal)', () => {
  describe('ignored-error', () => {
    it('fires on empty catch via concept pipeline', () => {
      const report = reviewSource('try { doWork(); } catch (e) {}', 'test.ts');
      const finding = report.findings.find((f) => f.ruleId === 'ignored-error');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
    });

    it('does not fire on catch with handling', () => {
      const report = reviewSource('try { doWork(); } catch (e) { throw new AppError(e); }', 'test.ts');
      const finding = report.findings.find((f) => f.ruleId === 'ignored-error');
      expect(finding).toBeUndefined();
    });
  });

  describe('unrecovered-effect', () => {
    it('fires on fetch without try/catch', () => {
      const source = `
        async function getData() {
          const res = await fetch('/api/data');
          return res.json();
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const finding = report.findings.find((f) => f.ruleId === 'unrecovered-effect');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
      expect(finding!.message).toContain('network');
    });

    it('does not fire on fetch inside try/catch', () => {
      const source = `
        async function getData() {
          try {
            const res = await fetch('/api/data');
            return res.json();
          } catch (e) {
            throw new AppError(e);
          }
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const finding = report.findings.find((f) => f.ruleId === 'unrecovered-effect');
      expect(finding).toBeUndefined();
    });

    // RULE-FEEDBACK.md #7: transport primitives in request.ts/fetch.ts/http.ts
    // /api-client.ts that contain a throw are deliberately propagating to
    // callers. Suppress here, not at the wrapper.
    it('does NOT fire on transport primitive in request.ts that throws on !ok', () => {
      const source = `
        export async function request<T>(url: string, init?: RequestInit): Promise<T> {
          const response = await fetch(url, init);
          if (!response.ok) {
            throw new Error('transport failure: ' + response.status);
          }
          return response.json() as Promise<T>;
        }
      `;
      const report = reviewSource(source, 'src/lib/request.ts');
      const finding = report.findings.find((f) => f.ruleId === 'unrecovered-effect');
      expect(finding).toBeUndefined();
    });

    it('does NOT fire on transport primitive in fetch.ts', () => {
      const source = `
        export async function httpGet<T>(url: string): Promise<T> {
          const res = await fetch(url);
          if (!res.ok) throw new Error('failed');
          return res.json();
        }
      `;
      const report = reviewSource(source, 'src/lib/fetch.ts');
      const finding = report.findings.find((f) => f.ruleId === 'unrecovered-effect');
      expect(finding).toBeUndefined();
    });

    // Regression guard for Evil Twin Challenge 1: the throw-as-handler carve-
    // out must NOT silence the rule outside transport files. A route handler
    // that fetches and throws a validation error for an unrelated reason
    // should still warn.
    it('STILL fires when a route handler throws (not in a transport file)', () => {
      const source = `
        export async function POST(request: Request) {
          const data = await fetch('https://api.example.com/items');
          if (!data.ok) throw new Error('missing user');
          return Response.json(await data.json());
        }
      `;
      const report = reviewSource(source, 'app/api/items/route.ts');
      const finding = report.findings.find((f) => f.ruleId === 'unrecovered-effect');
      expect(finding).toBeDefined();
    });

    // Regression: transport-primitive file WITHOUT a throw still fires —
    // the carve-out requires both signals.
    it('STILL fires on request.ts function that fetches without throwing', () => {
      const source = `
        export async function fetchData(url: string) {
          const res = await fetch(url);
          return res.json();
        }
      `;
      const report = reviewSource(source, 'src/lib/request.ts');
      const finding = report.findings.find((f) => f.ruleId === 'unrecovered-effect');
      expect(finding).toBeDefined();
    });

    // Hardening per OpenCode review: filenames that *start* with a transport
    // keyword but aren't exact matches must NOT receive the carve-out. The
    // regex requires `\.` immediately after the keyword, so `http-status.ts`
    // and `request-helper.ts` are correctly excluded.
    it('STILL fires on http-status.ts (basename starts with http but not exact match)', () => {
      const source = `
        export async function check(url: string) {
          const res = await fetch(url);
          if (!res.ok) throw new Error('bad');
          return res.status;
        }
      `;
      const report = reviewSource(source, 'src/lib/http-status.ts');
      const finding = report.findings.find((f) => f.ruleId === 'unrecovered-effect');
      expect(finding).toBeDefined();
    });

    it('STILL fires on request-helper.ts (suffix mismatch)', () => {
      const source = `
        export async function helper(url: string) {
          const res = await fetch(url);
          if (!res.ok) throw new Error('bad');
          return res.json();
        }
      `;
      const report = reviewSource(source, 'src/lib/request-helper.ts');
      const finding = report.findings.find((f) => f.ruleId === 'unrecovered-effect');
      expect(finding).toBeDefined();
    });
  });
});
