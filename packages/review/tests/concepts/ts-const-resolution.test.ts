import { Project } from 'ts-morph';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

// Phase 1 IR depth: same-file const literal substitution. Real-world
// fetch URLs hide behind module-level constants
// (`const API_BASE = '...'; fetch(`${API_BASE}/users/${id}`)`); the
// audiofacets probe found only 8% of call-sites had `host` populated
// because the mapper saw `${API_BASE}` as opaque. This pass walks
// `const X = <literal>` declarations and substitutes them so target /
// host / query extraction finds real values. These tests pin the
// resolution behaviour and guard the FP gates (ambiguous names, scope
// limits).

describe('TS const literal resolution (phase 1 IR depth)', () => {
  const project = () => new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });

  function effectOf(file: string, src: string) {
    // `export {}` forces the source into module mode. Without it,
    // `useInMemoryFileSystem` treats the file as a script — top-level
    // `const URL` then collides with global lib.dom URL and symbol
    // resolution returns the global declaration instead of the local.
    // Real review-engine input is always module-mode, so this matches prod.
    const p = project();
    const map = extractTsConcepts(p.createSourceFile(file, `export {};\n${src}`), file);
    const effects = map.nodes.filter(
      (n) => n.kind === 'effect' && n.payload.kind === 'effect' && n.payload.subtype === 'network',
    );
    if (effects.length !== 1) throw new Error(`expected 1 network effect, got ${effects.length}`);
    const e = effects[0];
    if (e.payload.kind !== 'effect') throw new Error('not an effect payload');
    return e.payload;
  }

  it('resolves `fetch(URL)` where URL is a same-file string-literal const', () => {
    const src = `
      const URL = 'https://api.example.com/users';
      async function load() { await fetch(URL); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBe('https://api.example.com/users');
    expect(p.host).toBe('api.example.com');
  });

  it('resolves `fetch(URL)` for a no-substitution template-literal const', () => {
    const src = `
      const URL = \`https://api.example.com/users\`;
      async function load() { await fetch(URL); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBe('https://api.example.com/users');
    expect(p.host).toBe('api.example.com');
  });

  it('resolves `${API_BASE}/users/${id}` so host populates and path stays parameterized', () => {
    const src = `
      const API_BASE = 'https://api.example.com';
      async function load(id: string) { await fetch(\`\${API_BASE}/users/\${id}\`); }
    `;
    const p = effectOf('/t/a.ts', src);
    // Path-only consumers normalize the absolute URL down to /users/:id (cross-stack-utils:normalizeClientUrl).
    expect(p.target).toBe('https://api.example.com/users/:id');
    expect(p.host).toBe('api.example.com');
  });

  it('resolves a const that itself contains an interpolation of another const (one hop)', () => {
    const src = `
      const HOST = 'https://api.example.com';
      const API = \`\${HOST}/v1\`;
      async function load(id: string) { await fetch(\`\${API}/users/\${id}\`); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBe('https://api.example.com/v1/users/:id');
    expect(p.host).toBe('api.example.com');
  });

  it('correctly binds to the outer const at the call site when a different scope has its own `URL`', () => {
    // Inner `URL` lives inside `other()` and is not in scope at the
    // `fetch(URL)` call. Symbol-based resolution must pick the OUTER
    // declaration — both declarations live in the map, but the call site
    // binds to the outer one.
    const src = `
      const URL = 'https://api.example.com/v1';
      function other() {
        const URL = 'https://other.example.com/v2';
        return URL;
      }
      async function load() { await fetch(URL); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBe('https://api.example.com/v1');
    expect(p.host).toBe('api.example.com');
  });

  it('does NOT resolve `let` (mutable) declarations', () => {
    const src = `
      let URL = 'https://api.example.com/users';
      async function load() { await fetch(URL); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBeUndefined();
  });

  it('does NOT resolve destructured consts (out of phase-1 scope)', () => {
    const src = `
      const config = { url: 'https://api.example.com/users' };
      const { url } = config;
      async function load() { await fetch(url); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBeUndefined();
  });

  it('does NOT resolve a const initialized from a function call (out of scope)', () => {
    const src = `
      const URL = buildUrl('users');
      async function load() { await fetch(URL); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBeUndefined();
  });

  it('falls back to the legacy "drop bare BASE_URL ident" path when const map is missing the name', () => {
    // BASE_URL is imported (not in same-file map). The historical heuristic
    // (looksLikeBaseUrlName drops the leading `${BASE_URL}`) still applies so
    // we get a path-only target; host stays undefined. This pins the contract
    // that const resolution is additive — it never weakens the legacy path.
    const src = `
      import { BASE_URL } from './config';
      async function load(id: string) { await fetch(\`\${BASE_URL}/users/\${id}\`); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBe('/users/:id');
    expect(p.host).toBeUndefined();
  });

  it('still parameterizes non-base-shaped identifiers when no resolution exists', () => {
    // `API_VERSION` doesn't look-like-base-url, so we keep the legacy
    // `:API_VERSION` placeholder rather than dropping it.
    const src = `
      import { API_VERSION } from './v';
      async function load() { await fetch(\`/api/\${API_VERSION}/users\`); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBe('/api/:API_VERSION/users');
  });

  it('extracts query params from a const-resolved URL', () => {
    const src = `
      const URL = 'https://api.example.com/search?q=&page=';
      async function load() { await fetch(URL); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBe('https://api.example.com/search?q=&page=');
    expect(p.host).toBe('api.example.com');
    expect(p.queryParams).toEqual(['q', 'page']);
    expect(p.queryParamsResolved).toBe(true);
  });

  it('lifts the audiofacets shape: const + template + bare ident → host populated', () => {
    // The exact shape that scored 8% on the probe.
    const src = `
      const API_HOST = 'https://api.audiofacets.com';
      async function loadProfile(slug: string) {
        const r = await fetch(\`\${API_HOST}/api/profiles/\${slug}\`);
        return r.json();
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.host).toBe('api.audiofacets.com');
    expect(p.target).toBe('https://api.audiofacets.com/api/profiles/:slug');
  });

  // ── Shadowing FP gate (Codex review 2026-05-04) ──────────────────────
  // Name-keyed resolution would fabricate wrong hosts/targets when an
  // inner binding shadows the outer literal const. The resolver must use
  // symbol/declaration lookup, not text match.

  it('does NOT resolve a fetch arg shadowed by a function parameter of the same name', () => {
    const src = `
      const URL = 'https://api.example.com/users';
      async function load(URL: string) {
        await fetch(URL); // parameter shadows outer const
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBeUndefined();
    expect(p.host).toBeUndefined();
  });

  it('does NOT resolve a fetch arg shadowed by an inner non-literal const', () => {
    const src = `
      const URL = 'https://api.example.com/users';
      async function load(id: string) {
        const URL = \`/users/\${id}\`; // inner non-literal const shadows outer
        await fetch(URL);
      }
    `;
    const p = effectOf('/t/a.ts', src);
    // The inner URL binds locally — resolution to the OUTER literal would
    // fabricate a wrong target. We must bail.
    expect(p.target).toBeUndefined();
    expect(p.host).toBeUndefined();
  });

  it('does NOT resolve a template `${API_BASE}` shadowed by a function parameter', () => {
    const src = `
      const API_BASE = 'https://api.example.com';
      async function load(API_BASE: string, id: string) {
        await fetch(\`\${API_BASE}/users/\${id}\`); // parameter shadows outer
      }
    `;
    const p = effectOf('/t/a.ts', src);
    // Inner template's API_BASE binds to the parameter — must NOT fabricate
    // a concrete absolute URL. The path-only fallback (looksLikeBaseUrlName
    // drop) still applies.
    expect(p.host).toBeUndefined();
    expect(p.target).toBe('/users/:id');
  });

  it('does NOT resolve a fetch arg shadowed by a `let` of the same name', () => {
    const src = `
      const URL = 'https://api.example.com/users';
      async function load() {
        let URL = '/dynamic';
        URL = recompute();
        await fetch(URL);
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBeUndefined();
    expect(p.host).toBeUndefined();
  });

  // ── Env-with-fallback initializer (phase 1.5) ────────────────────────
  // Real-world audiofacets shape: `const API_URL = process.env.X || "https://..."`.
  // Pure-literal collector silently dropped these — phase 1.5 captures the
  // fallback branch as the resolvable value.

  it('resolves `const X = process.env.A || "literal"`', () => {
    const src = `
      const API_URL = process.env.AUDIOFACETS_API_URL || 'https://api.audiofacets.com';
      async function load() { await fetch(\`\${API_URL}/api/profiles\`); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.host).toBe('api.audiofacets.com');
    expect(p.target).toBe('https://api.audiofacets.com/api/profiles');
  });

  it('resolves `const X = process.env.A ?? "literal"` (nullish-coalescing)', () => {
    const src = `
      const API_URL = process.env.X ?? 'https://api.example.com';
      async function load() { await fetch(\`\${API_URL}/api/x\`); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.host).toBe('api.example.com');
    expect(p.target).toBe('https://api.example.com/api/x');
  });

  it('resolves the audiofacets server-api shape: env-fallback const + multi-segment template + POST', () => {
    const src = `
      const API_URL = process.env.AUDIOFACETS_API_URL || 'https://api.audiofacets.com';
      async function postFeedback(slug: string) {
        const response = await fetch(\`\${API_URL}/api/review/\${slug}/feedback\`, {
          method: 'POST',
          body: JSON.stringify({ rating: 5 }),
        });
        return response.json();
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.host).toBe('api.audiofacets.com');
    expect(p.target).toBe('https://api.audiofacets.com/api/review/:slug/feedback');
    expect(p.method).toBe('POST');
  });

  it('resolves chained `a || b || "lit"` to the rightmost literal (left-assoc AST)', () => {
    // `a || b || 'fallback'` parses as `(a || b) || 'fallback'`. Our
    // collector takes the right side of the OUTERMOST `||`, which is the
    // rightmost literal — exactly the value the runtime returns when all
    // env reads are falsy. Useful, and it's the semantically correct
    // "no-env-set" value.
    const src = `
      const API_URL = process.env.A || process.env.B || 'fallback';
      async function load() { await fetch(API_URL); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBe('fallback');
  });

  it('does NOT resolve a ternary initializer (out of phase-1.5 scope)', () => {
    const src = `
      const API_URL = isDev ? 'http://localhost:3000' : 'https://api.example.com';
      async function load() { await fetch(API_URL); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBeUndefined();
  });

  it('does NOT resolve when the right side of `||` is a non-literal expression', () => {
    const src = `
      const API_URL = process.env.X || someFunction();
      async function load() { await fetch(API_URL); }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBeUndefined();
  });

  it('preserves shadow-bail under env-fallback initializer', () => {
    // Env-fallback resolution must still respect symbol-binding gates. A
    // parameter shadowing the const must NOT pick up the fallback.
    const src = `
      const API_URL = process.env.X || 'https://api.example.com';
      async function load(API_URL: string) {
        await fetch(API_URL); // parameter shadows outer const
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.target).toBeUndefined();
    expect(p.host).toBeUndefined();
  });
});
