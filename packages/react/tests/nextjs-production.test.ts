import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Next.js 15 Production Patterns', () => {
  let parse: (source: string) => any;
  let transpileNextjs: (root: any, config?: any) => any;

  beforeAll(async () => {
    const parserMod = await import('../../core/src/parser.js');
    const nextjsMod = await import('../src/transpiler-nextjs.js');
    parse = parserMod.parse;
    transpileNextjs = nextjsMod.transpileNextjs;
  });

  // ── Feature 1: generateMetadata ──────────────────────────────────────

  describe('generateMetadata', () => {
    test('parses generateMetadata node', () => {
      const ast = parse('page async name=ProductPage\n  generateMetadata\n    handler code="const { locale } = await params; return { title: locale };"');
      expect(ast.type).toBe('page');
      const genMeta = ast.children?.find((c: any) => c.type === 'generateMetadata');
      expect(genMeta).toBeDefined();
    });

    test('generates async generateMetadata function', () => {
      const ast = parse('page name=ProductPage\n  generateMetadata\n    handler code="const { locale } = await params; return { title: locale };"');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('export async function generateMetadata');
      expect(result.code).toContain('Promise<Metadata>');
      expect(result.code).toContain('params');
    });

    test('includes handler code in generateMetadata body', () => {
      const ast = parse('page name=ProductPage\n  generateMetadata\n    handler code="const { locale } = await params; return { title: locale };"');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('const { locale } = await params');
      expect(result.code).toContain('return { title: locale }');
    });

    test('imports Metadata type for generateMetadata', () => {
      const ast = parse('page name=ProductPage\n  generateMetadata');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("import type { Metadata } from 'next'");
    });

    test('generateMetadata not emitted for client components', () => {
      const ast = parse('page name=ProductPage client=true\n  generateMetadata');
      const result = transpileNextjs(ast);
      expect(result.code).not.toContain('export async function generateMetadata');
    });

    test('generateMetadata with default handler when no code provided', () => {
      const ast = parse('page name=ProductPage\n  generateMetadata');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('export async function generateMetadata');
      expect(result.code).toContain('const resolvedParams = await params');
      expect(result.code).toContain('return { title: resolvedParams.slug');
    });
  });

  // ── Feature 2: notFound / redirect ────────────────────────────────────

  describe('notFound', () => {
    test('parses notFound node with expression condition', () => {
      const ast = parse('page name=ProductPage\n  notFound if={{ !product }}');
      const notFoundNode = ast.children?.find((c: any) => c.type === 'notFound');
      expect(notFoundNode).toBeDefined();
    });

    test('generates notFound import and call', () => {
      const ast = parse('page name=ProductPage\n  notFound if={{ !product }}');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("import { notFound } from 'next/navigation'");
      expect(result.code).toContain('if (!product) { notFound(); }');
    });

    test('generates unconditional notFound call', () => {
      const ast = parse('page name=ProductPage\n  notFound');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("import { notFound } from 'next/navigation'");
      expect(result.code).toContain('notFound();');
    });
  });

  describe('redirect', () => {
    test('parses redirect node with target path', () => {
      const ast = parse('page name=ProductPage\n  redirect to=/login');
      const redirectNode = ast.children?.find((c: any) => c.type === 'redirect');
      expect(redirectNode).toBeDefined();
      expect(redirectNode.props?.to).toBe('/login');
    });

    test('generates redirect import and call', () => {
      const ast = parse('page name=ProductPage\n  redirect to=/login');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("import { redirect } from 'next/navigation'");
      expect(result.code).toContain("redirect('/login')");
    });

    test('generates both notFound and redirect imports when used together', () => {
      const ast = parse('page name=ProductPage\n  notFound if={{ !product }}\n  redirect to=/login');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("from 'next/navigation'");
      expect(result.code).toContain('notFound');
      expect(result.code).toContain('redirect');
    });
  });

  // ── Feature 3: custom imports ─────────────────────────────────────────

  describe('custom imports', () => {
    test('parses import node with name and from', () => {
      const ast = parse('page name=Test\n  import useKeyPress from=~/hooks/use-key-press');
      const importNode = ast.children?.find((c: any) => c.type === 'import');
      expect(importNode).toBeDefined();
      expect(importNode.props?.name).toBe('useKeyPress');
      expect(importNode.props?.from).toBe('~/hooks/use-key-press');
    });

    test('generates named import', () => {
      const ast = parse('page name=Test\n  import useKeyPress from=~/hooks/use-key-press');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("import { useKeyPress } from '~/hooks/use-key-press'");
    });

    test('parses default import with default flag', () => {
      const ast = parse('page name=Test\n  import default Link from=next/link');
      const importNode = ast.children?.find((c: any) => c.type === 'import');
      expect(importNode).toBeDefined();
      expect(importNode.props?.name).toBe('Link');
      expect(importNode.props?.default).toBe(true);
      expect(importNode.props?.from).toBe('next/link');
    });

    test('generates default import', () => {
      const ast = parse('page name=Test\n  import default Link from=next/link');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("import Link from 'next/link'");
    });

    test('generates multiple custom imports', () => {
      const source = `page name=Test
  import useAuth from=~/hooks/use-auth
  import default axios from=axios
  text value=Hello`;
      const ast = parse(source);
      const result = transpileNextjs(ast);
      expect(result.code).toContain("import { useAuth } from '~/hooks/use-auth'");
      expect(result.code).toContain("import axios from 'axios'");
    });
  });

  // ── Feature 4: async server components ────────────────────────────────

  describe('async server components', () => {
    test('parses page with async=true', () => {
      const ast = parse('page async=true name=ProductPage\n  text value=Hello');
      expect(ast.props?.async).toBe('true');
    });

    test('generates async function signature', () => {
      const ast = parse('page async=true name=ProductPage\n  text value=Hello');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('export default async function ProductPage');
      expect(result.code).toContain('props: { params: Promise<Record<string, string>> }');
    });

    test('destructures params in async component', () => {
      const ast = parse('page async=true name=ProductPage\n  text value=Hello');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('const params = await props.params');
    });

    test('non-async page generates standard function', () => {
      const ast = parse('page name=StandardPage\n  text value=Hello');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('export default function StandardPage()');
      expect(result.code).not.toContain('async');
    });

    test('page with async prop on root node', () => {
      const ast = parse('page name=AsyncPage async=true\n  text value=Hello');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('async function AsyncPage');
    });
  });

  // ── Feature 5: fetch node ─────────────────────────────────────────────

  describe('fetch node', () => {
    test('parses fetch node with name and url', () => {
      const ast = parse('page name=ProductPage\n  fetch name=product url=/api/product');
      const fetchNode = ast.children?.find((c: any) => c.type === 'fetch');
      expect(fetchNode).toBeDefined();
      expect(fetchNode.props?.name).toBe('product');
      expect(fetchNode.props?.url).toBe('/api/product');
    });

    test('generates fetch call with await', () => {
      const ast = parse('page name=ProductPage\n  fetch name=product url=/api/product');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("const product = await fetch('/api/product').then(r => r.json())");
    });

    test('fetch node makes page async automatically', () => {
      const ast = parse('page name=ProductPage\n  fetch name=product url=/api/product\n  text value=Hello');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('export default async function ProductPage');
    });

    test('multiple fetch calls in same page', () => {
      const source = `page name=ProductPage
  fetch name=product url=/api/product
  fetch name=reviews url=/api/reviews
  text value=Hello`;
      const ast = parse(source);
      const result = transpileNextjs(ast);
      expect(result.code).toContain("const product = await fetch('/api/product').then(r => r.json())");
      expect(result.code).toContain("const reviews = await fetch('/api/reviews').then(r => r.json())");
    });
  });

  // ── Combined / integration tests ──────────────────────────────────────

  describe('combined patterns', () => {
    test('async page with fetch, notFound, and generateMetadata', () => {
      const source = `page async=true name=ProductPage
  generateMetadata
    handler code="const { locale } = await params; return { title: 'Product - ' + locale };"
  fetch name=product url=/api/product
  notFound if={{ !product }}
  text value=Hello`;
      const ast = parse(source);
      const result = transpileNextjs(ast);

      // Should have generateMetadata
      expect(result.code).toContain('export async function generateMetadata');
      // Should have navigation import
      expect(result.code).toContain("from 'next/navigation'");
      // Should have notFound call
      expect(result.code).toContain('if (!product) { notFound(); }');
      // Should have fetch
      expect(result.code).toContain("await fetch('/api/product')");
      // Should be async
      expect(result.code).toContain('export default async function ProductPage');
    });

    test('page with custom imports and fetch', () => {
      const source = `page name=Dashboard async=true
  import useAuth from=~/hooks/use-auth
  fetch name=data url=/api/dashboard
  text value=Dashboard`;
      const ast = parse(source);
      const result = transpileNextjs(ast);

      expect(result.code).toContain("import { useAuth } from '~/hooks/use-auth'");
      expect(result.code).toContain("const data = await fetch('/api/dashboard').then(r => r.json())");
      expect(result.code).toContain('async function Dashboard');
    });

    test('new node types are in NODE_TYPES spec', async () => {
      const { NODE_TYPES } = await import('../../core/src/spec.js');
      expect(NODE_TYPES).toContain('generateMetadata');
      expect(NODE_TYPES).toContain('notFound');
      expect(NODE_TYPES).toContain('redirect');
      expect(NODE_TYPES).toContain('fetch');
    });
  });
});
