import { Project } from 'ts-morph';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

// Phase 1 of error-contract-drift (Codex/Gemini/OpenCode consensus,
// confidence ~0.9 on the signal). The mapper now captures
// `handledErrorStatusCodes` on every network-effect concept — the set
// of status codes the call-site EXPLICITLY branches on. Phase 2 will
// compare these against the server-side `errorStatusCodes` to flag
// PRs that add a server status the client doesn't handle.
//
// 0.9 gate from the buddy round: ONLY explicit literal-status dispatch
// counts. Generic `catch (e) { log(e) }` and `if (!response.ok)` checks
// produce empty arrays — the rule will treat empty as "client is
// generic-handle-only" and decline to fire.

describe('TS handled-error-status extraction (phase 1)', () => {
  const project = () => new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });

  function extractHandled(file: string, src: string): Array<readonly number[] | undefined> {
    const p = project();
    const map = extractTsConcepts(p.createSourceFile(file, src), file);
    return map.nodes
      .filter((n) => n.kind === 'effect' && n.payload.kind === 'effect' && n.payload.subtype === 'network')
      .map((n) => (n.payload.kind === 'effect' ? n.payload.handledErrorStatusCodes : undefined));
  }

  it('extracts a single literal status branch on the response variable', () => {
    const src = `
      async function load() {
        const response = await fetch('/api/users');
        if (response.status === 404) {
          throw new Error('not found');
        }
      }
    `;
    expect(extractHandled('/t/a.ts', src)).toEqual([[404]]);
  });

  it('extracts multiple literal branches on the response variable', () => {
    const src = `
      async function load() {
        const response = await fetch('/api/users');
        if (response.status === 401) return null;
        if (response.status === 403) return null;
        if (response.status === 404) return [];
      }
    `;
    expect(extractHandled('/t/a.ts', src)).toEqual([[401, 403, 404]]);
  });

  it('extracts statuses from a try/catch on err.status', () => {
    const src = `
      async function load() {
        try {
          await fetch('/api/users');
        } catch (err: any) {
          if (err.status === 401) return 'auth';
          if (err.status === 409) return 'conflict';
        }
      }
    `;
    expect(extractHandled('/t/a.ts', src)).toEqual([[401, 409]]);
  });

  it('extracts statuses from err.response?.status (axios shape)', () => {
    const src = `
      declare const axios: { get: (u: string) => Promise<unknown> };
      async function load() {
        try {
          await axios.get('/api/users');
        } catch (err: any) {
          if (err.response?.status === 422) return 'validation';
          if (err.response?.status === 404) return null;
        }
      }
    `;
    expect(extractHandled('/t/a.ts', src)).toEqual([[404, 422]]);
  });

  it('extracts statuses from a switch on response.status', () => {
    const src = `
      async function load() {
        const response = await fetch('/api/users');
        switch (response.status) {
          case 200: return [];
          case 401: return null;
          case 404: return [];
        }
      }
    `;
    // Phase 1 captures every `case N:` — phase 2's rule will know which
    // are "error" codes (4xx/5xx) vs success.
    expect(extractHandled('/t/a.ts', src)).toEqual([[200, 401, 404]]);
  });

  it('returns empty array when the call has only a generic catch', () => {
    const src = `
      async function load() {
        try {
          await fetch('/api/users');
        } catch (e) {
          console.error(e);
        }
      }
    `;
    // Empty array tells phase 2's rule "client is generic-handle-only".
    // The rule will decline to fire — that's the FP gate Codex/Gemini/
    // OpenCode all called out.
    expect(extractHandled('/t/a.ts', src)).toEqual([[]]);
  });

  it('returns empty array for `if (!response.ok)` (not status dispatch)', () => {
    const src = `
      async function load() {
        const response = await fetch('/api/users');
        if (!response.ok) {
          throw new Error('failed');
        }
      }
    `;
    expect(extractHandled('/t/a.ts', src)).toEqual([[]]);
  });

  it('returns empty array for status-range tests like `status >= 400`', () => {
    const src = `
      async function load() {
        const response = await fetch('/api/users');
        if (response.status >= 400) {
          throw new Error('error');
        }
      }
    `;
    expect(extractHandled('/t/a.ts', src)).toEqual([[]]);
  });

  it('handles `==` (loose equality) the same as `===`', () => {
    const src = `
      async function load() {
        const response = await fetch('/api/users');
        if (response.status == 404) return null;
      }
    `;
    expect(extractHandled('/t/a.ts', src)).toEqual([[404]]);
  });

  it('accepts `N === response.status` (literal on the left)', () => {
    const src = `
      async function load() {
        const response = await fetch('/api/users');
        if (404 === response.status) return null;
      }
    `;
    expect(extractHandled('/t/a.ts', src)).toEqual([[404]]);
  });

  it('does NOT count an unrelated `obj.status === 200` on a non-response receiver', () => {
    const src = `
      async function load() {
        const widget = { status: 200 };
        if (widget.status === 200) return;
        await fetch('/api/users');
      }
    `;
    // The widget receiver doesn't match the response/err receiver
    // pattern, so it's filtered out. The fetch call has nothing else,
    // so handled is empty.
    expect(extractHandled('/t/a.ts', src)).toEqual([[]]);
  });

  it('deduplicates when the same status is checked twice', () => {
    const src = `
      async function load() {
        const response = await fetch('/api/users');
        if (response.status === 404) return null;
        if (response.status === 404) console.log('again');
      }
    `;
    expect(extractHandled('/t/a.ts', src)).toEqual([[404]]);
  });

  it('extracts handled codes on axios-style direct calls', () => {
    const src = `
      declare const axios: {
        post: (url: string, body: unknown) => Promise<{ data: unknown }>;
      };
      async function load() {
        try {
          await axios.post('/api/users', { name: 'a' });
        } catch (err: any) {
          if (err.response.status === 409) return 'conflict';
        }
      }
    `;
    expect(extractHandled('/t/a.ts', src)).toEqual([[409]]);
  });

  it('returns sorted, deduplicated codes regardless of source order', () => {
    const src = `
      async function load() {
        const response = await fetch('/api/users');
        if (response.status === 500) return null;
        if (response.status === 401) return null;
        if (response.status === 404) return null;
        if (response.status === 401) return null;
      }
    `;
    expect(extractHandled('/t/a.ts', src)).toEqual([[401, 404, 500]]);
  });
});
