import { Project } from 'ts-morph';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

// Phase 1 of surface-fingerprinting (Codex idea, confidence 0.89): the
// mapper now captures `host` on every network-effect concept whose URL
// was an absolute URL. Phase 2 will let cross-stack rules filter
// third-party hosts using this. These tests pin the extraction shape
// before phase 2 ships, so the policy change can rely on the data.

describe('TS network-effect host extraction (phase 1)', () => {
  const project = () => new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });

  function extractHosts(file: string, src: string): Array<string | undefined> {
    const p = project();
    const map = extractTsConcepts(p.createSourceFile(file, src), file);
    return map.nodes
      .filter((n) => n.kind === 'effect' && n.payload.kind === 'effect' && n.payload.subtype === 'network')
      .map((n) => (n.payload.kind === 'effect' ? n.payload.host : undefined));
  }

  it('extracts the host from an absolute https URL string literal', () => {
    const src = `
      async function load() {
        await fetch('https://api.example.com/users');
      }
    `;
    expect(extractHosts('/t/a.ts', src)).toEqual(['api.example.com']);
  });

  it('extracts the host from an absolute http URL', () => {
    const src = `
      async function load() {
        await fetch('http://internal.svc/healthz');
      }
    `;
    expect(extractHosts('/t/a.ts', src)).toEqual(['internal.svc']);
  });

  it('preserves the port when the URL includes one', () => {
    const src = `
      async function load() {
        await fetch('http://localhost:8080/api/x');
      }
    `;
    expect(extractHosts('/t/a.ts', src)).toEqual(['localhost:8080']);
  });

  it('lower-cases the host so DNS case differences do not matter downstream', () => {
    const src = `
      async function load() {
        await fetch('https://API.Example.COM/users');
      }
    `;
    expect(extractHosts('/t/a.ts', src)).toEqual(['api.example.com']);
  });

  it('returns undefined for a relative URL — the body of the cross-stack work', () => {
    const src = `
      async function load() {
        await fetch('/api/users');
      }
    `;
    expect(extractHosts('/t/a.ts', src)).toEqual([undefined]);
  });

  it('returns undefined when the host is interpolated (`https://${HOST}/api`)', () => {
    // extractTemplateUrl produces `https://:HOST/api` for this — `:HOST`
    // is not a real host. Phase 1 must not surface it as one, otherwise
    // phase 2 would silence real cross-stack matches whenever the host
    // happens to come from a config variable.
    const src = `
      const HOST = '';
      async function load() {
        await fetch(\`https://\${HOST}/api/users\`);
      }
    `;
    expect(extractHosts('/t/a.ts', src)).toEqual([undefined]);
  });

  it('returns undefined when the URL is just a `${API_BASE}/path` template', () => {
    // Existing behaviour drops the leading `${API_BASE}` and returns a
    // root-relative path — there is no host info to extract.
    const src = `
      const API_BASE = '';
      async function load() {
        await fetch(\`\${API_BASE}/api/users\`);
      }
    `;
    expect(extractHosts('/t/a.ts', src)).toEqual([undefined]);
  });

  it('extracts host from an absolute URL inside a NoSubstitutionTemplateLiteral', () => {
    const src = `
      async function load() {
        await fetch(\`https://api.example.com/users\`);
      }
    `;
    expect(extractHosts('/t/a.ts', src)).toEqual(['api.example.com']);
  });

  it('extracts host on axios-style calls (axios.post(absolute))', () => {
    // `axios.post(...)` is matched by NETWORK_METHODS + the
    // `axios|got|ky|http|request|superagent` object-name regex in
    // extractEffects, so it's recorded as a network effect without
    // needing the full wrapped-client pipeline.
    const src = `
      declare const axios: {
        post: (url: string, body: unknown) => Promise<{ data: unknown }>;
      };
      async function load() {
        await axios.post('https://api.example.com/users', { name: 'a' });
      }
    `;
    expect(extractHosts('/t/a.ts', src)).toEqual(['api.example.com']);
  });

  it('handles bare-host URLs with no path (`https://api.example.com`)', () => {
    const src = `
      async function load() {
        await fetch('https://api.example.com');
      }
    `;
    expect(extractHosts('/t/a.ts', src)).toEqual(['api.example.com']);
  });

  it('rejects a malformed scheme (`htps://...`) — returns undefined', () => {
    const src = `
      async function load() {
        await fetch('htps://api.example.com/users');
      }
    `;
    // The malformed URL doesn't start with `http(s)://` so extractHost
    // returns undefined. Note that the call still gets recorded as a
    // network effect — it's a fetch — just without host metadata.
    expect(extractHosts('/t/a.ts', src)).toEqual([undefined]);
  });
});
