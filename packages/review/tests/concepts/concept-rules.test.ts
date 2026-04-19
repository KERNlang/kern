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
  });
});
