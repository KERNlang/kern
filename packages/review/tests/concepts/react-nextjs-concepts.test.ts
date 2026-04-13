import type { ConceptNode } from '@kernlang/core';
import { Project } from 'ts-morph';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

function createSourceFile(source: string, filePath = 'test.ts') {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  return project.createSourceFile(filePath, source);
}

function getEntrypoints(nodes: ConceptNode[]) {
  return nodes.filter((n) => n.kind === 'entrypoint');
}

function getFunctionDeclarations(nodes: ConceptNode[]) {
  return nodes.filter((n) => n.kind === 'function_declaration');
}

describe('Next.js concept extraction', () => {
  describe('App Router API handlers', () => {
    it('detects exported GET handler as entrypoint', () => {
      const sf = createSourceFile(
        `
        export async function GET(request: Request) {
          return Response.json({ users: [] });
        }
      `,
        'app/api/users/route.ts',
      );
      const map = extractTsConcepts(sf, 'app/api/users/route.ts');
      const entries = getEntrypoints(map.nodes);
      expect(entries.length).toBe(1);
      expect(entries[0].payload).toMatchObject({
        kind: 'entrypoint',
        subtype: 'route',
        name: 'GET',
        httpMethod: 'GET',
      });
      expect(entries[0].confidence).toBe(0.95);
    });

    it('detects exported POST handler as entrypoint', () => {
      const sf = createSourceFile(
        `
        export async function POST(request: Request) {
          const body = await request.json();
          return Response.json({ id: 1 });
        }
      `,
        'app/api/users/route.ts',
      );
      const map = extractTsConcepts(sf, 'app/api/users/route.ts');
      const entries = getEntrypoints(map.nodes);
      expect(entries.length).toBe(1);
      expect(entries[0].payload).toMatchObject({
        kind: 'entrypoint',
        subtype: 'route',
        name: 'POST',
        httpMethod: 'POST',
      });
    });

    it('detects multiple HTTP methods in same file', () => {
      const sf = createSourceFile(
        `
        export async function GET(request: Request) {
          return Response.json({ users: [] });
        }
        export async function PUT(request: Request) {
          return Response.json({ updated: true });
        }
        export async function DELETE(request: Request) {
          return new Response(null, { status: 204 });
        }
      `,
        'app/api/users/route.ts',
      );
      const map = extractTsConcepts(sf, 'app/api/users/route.ts');
      const entries = getEntrypoints(map.nodes);
      expect(entries.length).toBe(3);
      const methods = entries.map((e) => {
        if (e.payload.kind === 'entrypoint') return e.payload.httpMethod;
        return undefined;
      });
      expect(methods).toContain('GET');
      expect(methods).toContain('PUT');
      expect(methods).toContain('DELETE');
    });

    it('detects PATCH and HEAD handlers', () => {
      const sf = createSourceFile(
        `
        export async function PATCH(request: Request) {
          return Response.json({ patched: true });
        }
        export async function HEAD() {
          return new Response(null);
        }
      `,
        'app/api/items/route.ts',
      );
      const map = extractTsConcepts(sf, 'app/api/items/route.ts');
      const entries = getEntrypoints(map.nodes);
      expect(entries.length).toBe(2);
    });

    it('also detects GET handler as function_declaration', () => {
      const sf = createSourceFile(
        `
        export async function GET(request: Request) {
          return Response.json({ ok: true });
        }
      `,
        'app/api/route.ts',
      );
      const map = extractTsConcepts(sf, 'app/api/route.ts');
      const funcs = getFunctionDeclarations(map.nodes);
      const getFn = funcs.find((f) => f.payload.kind === 'function_declaration' && f.payload.name === 'GET');
      expect(getFn).toBeDefined();
      expect(getFn!.payload).toMatchObject({
        kind: 'function_declaration',
        async: true,
        isExport: true,
      });
    });
  });

  describe('Pages Router default export handler', () => {
    it('detects default export handler in api/ path', () => {
      const sf = createSourceFile(
        `
        export default async function handler(req: any, res: any) {
          res.status(200).json({ ok: true });
        }
      `,
        'pages/api/users.ts',
      );
      const map = extractTsConcepts(sf, 'pages/api/users.ts');
      const entries = getEntrypoints(map.nodes);
      // Should be detected either by extractEntrypoints (req param) or extractNextjsHandlers (api/ path)
      expect(entries.length).toBeGreaterThanOrEqual(1);
      const handler = entries.find((e) => e.payload.kind === 'entrypoint' && e.payload.subtype === 'handler');
      expect(handler).toBeDefined();
    });
  });

  describe('Server actions', () => {
    it('detects exported async functions in use-server files as entrypoints', () => {
      const sf = createSourceFile(
        `
        'use server'

        export async function createUser(formData: FormData) {
          const name = formData.get('name');
          return { id: 1, name };
        }

        export async function deleteUser(id: number) {
          return { deleted: true };
        }
      `,
        'app/actions.ts',
      );
      const map = extractTsConcepts(sf, 'app/actions.ts');
      const entries = getEntrypoints(map.nodes);
      expect(entries.length).toBe(2);

      const names = entries.map((e) => (e.payload.kind === 'entrypoint' ? e.payload.name : ''));
      expect(names).toContain('createUser');
      expect(names).toContain('deleteUser');
    });

    it('does not detect non-exported functions as server action entrypoints', () => {
      const sf = createSourceFile(
        `
        'use server'

        async function internalHelper() {
          return 42;
        }

        export async function createUser(formData: FormData) {
          const val = await internalHelper();
          return { id: val };
        }
      `,
        'app/actions.ts',
      );
      const map = extractTsConcepts(sf, 'app/actions.ts');
      const entries = getEntrypoints(map.nodes);
      // Only createUser should be an entrypoint, not internalHelper
      expect(entries.length).toBe(1);
      expect(entries[0].payload).toMatchObject({
        kind: 'entrypoint',
        name: 'createUser',
      });
    });

    it('does not detect non-async exports as server action entrypoints', () => {
      const sf = createSourceFile(
        `
        'use server'

        export function getConfig() {
          return { debug: true };
        }

        export async function saveData(data: string) {
          return { saved: true };
        }
      `,
        'app/actions.ts',
      );
      const map = extractTsConcepts(sf, 'app/actions.ts');
      const entries = getEntrypoints(map.nodes);
      // Only saveData should be a server action entrypoint
      expect(entries.length).toBe(1);
      expect(entries[0].payload).toMatchObject({
        kind: 'entrypoint',
        name: 'saveData',
      });
    });

    it('does not fire on files without use-server directive', () => {
      const sf = createSourceFile(
        `
        export async function createUser(formData: FormData) {
          return { id: 1 };
        }
      `,
        'app/utils.ts',
      );
      const map = extractTsConcepts(sf, 'app/utils.ts');
      const entries = getEntrypoints(map.nodes);
      // No entrypoint — not an api path and no 'use server' directive
      expect(entries.length).toBe(0);
    });
  });
});

describe('React component concept extraction', () => {
  describe('React.memo wrapped components', () => {
    it('detects React.memo arrow component as function_declaration', () => {
      const sf = createSourceFile(
        `
        import React from 'react';
        const MyCard = React.memo(() => {
          return <div>card</div>;
        });
      `,
        'components/MyCard.tsx',
      );
      const map = extractTsConcepts(sf, 'components/MyCard.tsx');
      const funcs = getFunctionDeclarations(map.nodes);
      const card = funcs.find((f) => f.payload.kind === 'function_declaration' && f.payload.name === 'MyCard');
      expect(card).toBeDefined();
      expect(card!.payload).toMatchObject({
        kind: 'function_declaration',
        name: 'MyCard',
        isComponent: true,
      });
    });

    it('detects bare memo() call component', () => {
      const sf = createSourceFile(
        `
        import { memo } from 'react';
        const ListItem = memo(() => {
          return <li>item</li>;
        });
      `,
        'components/ListItem.tsx',
      );
      const map = extractTsConcepts(sf, 'components/ListItem.tsx');
      const funcs = getFunctionDeclarations(map.nodes);
      const item = funcs.find((f) => f.payload.kind === 'function_declaration' && f.payload.name === 'ListItem');
      expect(item).toBeDefined();
      expect(item!.payload).toMatchObject({
        kind: 'function_declaration',
        isComponent: true,
      });
    });

    it('detects exported React.memo component', () => {
      const sf = createSourceFile(
        `
        import React from 'react';
        export const Header = React.memo(() => {
          return <header>Title</header>;
        });
      `,
        'components/Header.tsx',
      );
      const map = extractTsConcepts(sf, 'components/Header.tsx');
      const funcs = getFunctionDeclarations(map.nodes);
      const header = funcs.find((f) => f.payload.kind === 'function_declaration' && f.payload.name === 'Header');
      expect(header).toBeDefined();
      expect(header!.payload).toMatchObject({
        kind: 'function_declaration',
        isComponent: true,
        isExport: true,
      });
    });
  });

  describe('React.forwardRef wrapped components', () => {
    it('detects React.forwardRef component as function_declaration', () => {
      const sf = createSourceFile(
        `
        import React from 'react';
        const Input = React.forwardRef((props: any, ref: any) => {
          return <input ref={ref} {...props} />;
        });
      `,
        'components/Input.tsx',
      );
      const map = extractTsConcepts(sf, 'components/Input.tsx');
      const funcs = getFunctionDeclarations(map.nodes);
      const input = funcs.find((f) => f.payload.kind === 'function_declaration' && f.payload.name === 'Input');
      expect(input).toBeDefined();
      expect(input!.payload).toMatchObject({
        kind: 'function_declaration',
        name: 'Input',
        isComponent: true,
      });
    });

    it('detects bare forwardRef call component', () => {
      const sf = createSourceFile(
        `
        import { forwardRef } from 'react';
        const TextArea = forwardRef((props: any, ref: any) => {
          return <textarea ref={ref} />;
        });
      `,
        'components/TextArea.tsx',
      );
      const map = extractTsConcepts(sf, 'components/TextArea.tsx');
      const funcs = getFunctionDeclarations(map.nodes);
      const ta = funcs.find((f) => f.payload.kind === 'function_declaration' && f.payload.name === 'TextArea');
      expect(ta).toBeDefined();
      expect(ta!.payload).toMatchObject({
        kind: 'function_declaration',
        isComponent: true,
      });
    });
  });

  describe('plain arrow function components (already detected)', () => {
    it('detects const MyComponent = () => { ... }', () => {
      const sf = createSourceFile(
        `
        const Sidebar = () => {
          return <nav>sidebar</nav>;
        };
      `,
        'components/Sidebar.tsx',
      );
      const map = extractTsConcepts(sf, 'components/Sidebar.tsx');
      const funcs = getFunctionDeclarations(map.nodes);
      const sidebar = funcs.find((f) => f.payload.kind === 'function_declaration' && f.payload.name === 'Sidebar');
      expect(sidebar).toBeDefined();
      expect(sidebar!.payload).toMatchObject({
        kind: 'function_declaration',
        isComponent: true,
      });
    });
  });

  describe('edge cases', () => {
    it('does not detect lowercase memo call as component', () => {
      const sf = createSourceFile(
        `
        import { memo } from 'react';
        const helper = memo(() => {
          return <span>not a component name</span>;
        });
      `,
        'utils/helper.tsx',
      );
      const map = extractTsConcepts(sf, 'utils/helper.tsx');
      const funcs = getFunctionDeclarations(map.nodes);
      // Should NOT be detected as a React component by the wrapper extractor
      // because 'helper' starts with lowercase
      const helperFromWrapper = funcs.find(
        (f) => f.payload.kind === 'function_declaration' && f.payload.name === 'helper' && f.evidence.includes('memo'),
      );
      expect(helperFromWrapper).toBeUndefined();
    });
  });
});
