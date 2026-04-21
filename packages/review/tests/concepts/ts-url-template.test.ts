import { Project } from 'ts-morph';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

describe('TS client URL extraction — template literals', () => {
  const project = () => new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });

  function extractNetworkTargets(file: string, src: string): string[] {
    const p = project();
    const map = extractTsConcepts(p.createSourceFile(file, src), file);
    return map.nodes
      .filter((n) => n.kind === 'effect' && n.payload.kind === 'effect' && n.payload.subtype === 'network')
      .map((n) => (n.payload.kind === 'effect' ? n.payload.target : undefined))
      .filter((t): t is string => typeof t === 'string');
  }

  it('drops a leading ${API_BASE}-like interpolation and keeps the path', () => {
    const src = `
      const API_BASE = '';
      async function load(slug: string) {
        await fetch(\`\${API_BASE}/api/review/\${slug}\`);
      }
    `;
    const targets = extractNetworkTargets('/t/a.ts', src);
    expect(targets).toEqual(['/api/review/:slug']);
  });

  it('handles multiple interpolations (base + nested params)', () => {
    const src = `
      const BASE_URL = '';
      async function load(slug: string, id: number) {
        await fetch(\`\${BASE_URL}/api/review/\${slug}/comments/\${id}\`);
      }
    `;
    const targets = extractNetworkTargets('/t/a.ts', src);
    expect(targets).toEqual(['/api/review/:slug/comments/:id']);
  });

  it('handles a bare path with no base prefix', () => {
    const src = `
      async function load(slug: string) {
        await fetch(\`/api/review/\${slug}\`);
      }
    `;
    const targets = extractNetworkTargets('/t/a.ts', src);
    expect(targets).toEqual(['/api/review/:slug']);
  });

  it('handles a NoSubstitutionTemplateLiteral (no ${} at all)', () => {
    const src = `
      async function load() {
        await fetch(\`/api/health\`);
      }
    `;
    const targets = extractNetworkTargets('/t/a.ts', src);
    expect(targets).toEqual(['/api/health']);
  });

  it('keeps a leading interpolation when its name does not look like a base URL', () => {
    const src = `
      async function load(slug: string) {
        await fetch(\`\${slug}/status\`);
      }
    `;
    const targets = extractNetworkTargets('/t/a.ts', src);
    expect(targets).toEqual([':slug/status']);
  });
});
