import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const _ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

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
      const ast = parse(
        'page async name=ProjectPage\n  generateMetadata\n    handler code="const { locale } = await params; return { title: locale };"',
      );
      expect(ast.type).toBe('page');
      const genMeta = ast.children?.find((c: any) => c.type === 'generateMetadata');
      expect(genMeta).toBeDefined();
    });

    test('generates async generateMetadata function', () => {
      const ast = parse(
        'page name=ProjectPage\n  generateMetadata\n    handler code="const { locale } = await params; return { title: locale };"',
      );
      const result = transpileNextjs(ast);
      expect(result.code).toContain('export async function generateMetadata');
      expect(result.code).toContain('Promise<Metadata>');
      expect(result.code).toContain('params');
    });

    test('includes handler code in generateMetadata body', () => {
      const ast = parse(
        'page name=ProjectPage\n  generateMetadata\n    handler code="const { locale } = await params; return { title: locale };"',
      );
      const result = transpileNextjs(ast);
      expect(result.code).toContain('const { locale } = await params');
      expect(result.code).toContain('return { title: locale }');
    });

    test('imports Metadata type for generateMetadata', () => {
      const ast = parse('page name=ProjectPage\n  generateMetadata');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("import type { Metadata } from 'next'");
    });

    test('generateMetadata not emitted for client components', () => {
      const ast = parse('page name=ProjectPage client=true\n  generateMetadata');
      const result = transpileNextjs(ast);
      expect(result.code).not.toContain('export async function generateMetadata');
    });

    test('client=true prevents async function even with async=true', () => {
      const ast = parse('page name=LandingPage client=true async=true\n  text value=Hello');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("'use client'");
      expect(result.code).not.toContain('async function');
    });

    test('client=true prevents async function even with fetch calls', () => {
      const ast = parse('page name=LandingPage client=true\n  fetch name=data url=/api/data\n  text value=Hello');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("'use client'");
      expect(result.code).not.toContain('async function');
    });

    test('generateMetadata with default handler when no code provided', () => {
      const ast = parse('page name=ProjectPage\n  generateMetadata');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('export async function generateMetadata');
      expect(result.code).toContain('const resolvedParams = await params');
      expect(result.code).toContain('return { title: resolvedParams.slug');
    });
  });

  // ── Feature 2: notFound / redirect ────────────────────────────────────

  describe('notFound', () => {
    test('parses notFound node with expression condition', () => {
      const ast = parse('page name=ProjectPage\n  notFound if={{ !project }}');
      const notFoundNode = ast.children?.find((c: any) => c.type === 'notFound');
      expect(notFoundNode).toBeDefined();
    });

    test('generates notFound import and call', () => {
      const ast = parse('page name=ProjectPage\n  notFound if={{ !project }}');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("import { notFound } from 'next/navigation'");
      expect(result.code).toContain('if (!project) { notFound(); }');
    });

    test('generates unconditional notFound call', () => {
      const ast = parse('page name=ProjectPage\n  notFound');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("import { notFound } from 'next/navigation'");
      expect(result.code).toContain('notFound();');
    });
  });

  describe('redirect', () => {
    test('parses redirect node with target path', () => {
      const ast = parse('page name=ProjectPage\n  redirect to=/login');
      const redirectNode = ast.children?.find((c: any) => c.type === 'redirect');
      expect(redirectNode).toBeDefined();
      expect(redirectNode.props?.to).toBe('/login');
    });

    test('generates redirect import and call', () => {
      const ast = parse('page name=ProjectPage\n  redirect to=/login');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("import { redirect } from 'next/navigation'");
      expect(result.code).toContain("redirect('/login')");
    });

    test('generates both notFound and redirect imports when used together', () => {
      const ast = parse('page name=ProjectPage\n  notFound if={{ !project }}\n  redirect to=/login');
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
      const ast = parse('page async=true name=ProjectPage\n  text value=Hello');
      expect(ast.props?.async).toBe('true');
    });

    test('generates async function signature', () => {
      const ast = parse('page async=true name=ProjectPage\n  text value=Hello');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('export default async function ProjectPage');
      expect(result.code).toContain('props: { params: Promise<Record<string, string>> }');
    });

    test('destructures params in async component', () => {
      const ast = parse('page async=true name=ProjectPage\n  text value=Hello');
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
      const ast = parse('page name=ProjectPage\n  fetch name=project url=/api/project');
      const fetchNode = ast.children?.find((c: any) => c.type === 'fetch');
      expect(fetchNode).toBeDefined();
      expect(fetchNode.props?.name).toBe('project');
      expect(fetchNode.props?.url).toBe('/api/project');
    });

    test('generates fetch call with await', () => {
      const ast = parse('page name=ProjectPage\n  fetch name=project url=/api/project');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("const project = await fetch('/api/project').then(r => r.json())");
    });

    test('fetch node makes page async automatically', () => {
      const ast = parse('page name=ProjectPage\n  fetch name=project url=/api/project\n  text value=Hello');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('export default async function ProjectPage');
    });

    test('multiple fetch calls in same page', () => {
      const source = `page name=ProjectPage
  fetch name=project url=/api/project
  fetch name=reviews url=/api/reviews
  text value=Hello`;
      const ast = parse(source);
      const result = transpileNextjs(ast);
      expect(result.code).toContain("const project = await fetch('/api/project').then(r => r.json())");
      expect(result.code).toContain("const reviews = await fetch('/api/reviews').then(r => r.json())");
    });
  });

  // ── Combined / integration tests ──────────────────────────────────────

  describe('combined patterns', () => {
    test('async page with fetch, notFound, and generateMetadata', () => {
      const source = `page async=true name=ProjectPage
  generateMetadata
    handler code="const { locale } = await params; return { title: 'Project - ' + locale };"
  fetch name=project url=/api/project
  notFound if={{ !project }}
  text value=Hello`;
      const ast = parse(source);
      const result = transpileNextjs(ast);

      // Should have generateMetadata
      expect(result.code).toContain('export async function generateMetadata');
      // Should have navigation import
      expect(result.code).toContain("from 'next/navigation'");
      // Should have notFound call
      expect(result.code).toContain('if (!project) { notFound(); }');
      // Should have fetch
      expect(result.code).toContain("await fetch('/api/project')");
      // Should be async
      expect(result.code).toContain('export default async function ProjectPage');
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
      expect(NODE_TYPES).toContain('codeblock');
      expect(NODE_TYPES).toContain('section');
    });
  });

  // ── Route-aware page compilation ──────────────────────────────────────

  describe('route-aware compilation', () => {
    test('page with route="/features" outputs features/page.tsx', () => {
      const ast = parse('page name=FeaturesPage route="/features"\n  text value="Features"');
      const result = transpileNextjs(ast);
      expect(result.files[0].path).toBe('features/page.tsx');
    });

    test('layout with route="/docs" outputs docs/layout.tsx', () => {
      const ast = parse('layout route="/docs"\n  text value="Docs"');
      const result = transpileNextjs(ast);
      expect(result.files[0].path).toBe('docs/layout.tsx');
    });

    test('nested route /docs/getting-started outputs correct path', () => {
      const ast = parse('page name=GettingStarted route="/docs/getting-started"\n  text value="Getting Started"');
      const result = transpileNextjs(ast);
      expect(result.files[0].path).toBe('docs/getting-started/page.tsx');
    });

    test('no route prop falls back to page.tsx (backward compat)', () => {
      const ast = parse('page name=Home\n  text value="Home"');
      const result = transpileNextjs(ast);
      expect(result.files[0].path).toBe('page.tsx');
    });

    test('segment="[slug]" appended to route path', () => {
      const ast = parse('page name=DocPage route="/docs" segment="[slug]"\n  text value="Doc"');
      const result = transpileNextjs(ast);
      expect(result.files[0].path).toBe('docs/[slug]/page.tsx');
    });
  });

  // ── Codeblock node ────────────────────────────────────────────────────

  describe('codeblock', () => {
    test('inline value renders <pre><code>', () => {
      const ast = parse('page name=DocsPage\n  codeblock lang=kern value="page name=Hello"');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('<pre className="bg-zinc-900 rounded-lg p-4 overflow-x-auto">');
      expect(result.code).toContain('<code');
      expect(result.code).toContain('page name=Hello');
    });

    test('lang prop renders as CSS class', () => {
      const ast = parse('page name=DocsPage\n  codeblock lang=typescript value="const x = 1"');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('language-typescript');
    });

    test('multiline via body child renders content', () => {
      const ast = parse('page name=DocsPage\n  codeblock lang=kern\n    body value="page name=Hello"');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('<pre');
      expect(result.code).toContain('page name=Hello');
    });
  });

  // ── Enhanced section ──────────────────────────────────────────────────

  describe('enhanced section', () => {
    test('id prop renders as HTML attribute', () => {
      const ast = parse('page name=Home\n  section id=hero\n    text value="Hello"');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('<section id="hero"');
    });

    test('no title means no <h2>', () => {
      const ast = parse('page name=Home\n  section id=features\n    text value="Feature 1"');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('<section id="features"');
      expect(result.code).not.toContain('<h2');
    });

    test('title prop still renders <h2>', () => {
      const ast = parse('page name=Home\n  section title="About"\n    text value="About us"');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('<h2');
      expect(result.code).toContain('About');
    });
  });

  // ── Enhanced image ────────────────────────────────────────────────────

  describe('enhanced image', () => {
    test('full path src used as-is', () => {
      const ast = parse('page name=Home\n  image src="/images/hero.png" alt="Hero" width=800 height=400');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('src="/images/hero.png"');
      expect(result.code).not.toContain('src="//images/hero.png.png"');
    });

    test('priority prop renders attribute', () => {
      const ast = parse('page name=Home\n  image src="/hero.jpg" alt="Hero" width=800 height=400 priority=true');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('priority');
    });

    test('fill prop omits width/height', () => {
      const ast = parse('page name=Home\n  image src="https://cdn.example.com/photo.jpg" alt="Photo" fill=true');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('fill');
      expect(result.code).not.toContain('width={');
    });

    test('legacy bare src still gets /<name>.png', () => {
      const ast = parse('page name=Home\n  image src=logo alt="Logo"');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('src="/logo.png"');
    });
  });

  // ── Text tags ─────────────────────────────────────────────────────────

  describe('text tag map', () => {
    test('h3 tag renders correctly', () => {
      const ast = parse('page name=Home\n  text value="Subtitle" tag=h3');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('<h3');
      expect(result.code).toContain('</h3>');
    });

    test('h4 tag renders correctly', () => {
      const ast = parse('page name=Home\n  text value="Sub" tag=h4');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('<h4');
    });

    test('h5 and h6 tags render correctly', () => {
      const ast = parse('page name=Home\n  text value="A" tag=h5\n  text value="B" tag=h6');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('<h5');
      expect(result.code).toContain('<h6');
    });

    test('span is default for unknown tag', () => {
      const ast = parse('page name=Home\n  text value="Hello"');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('<span');
    });
  });

  // ── Node type registration ────────────────────────────────────────────

  describe('node type registration', () => {
    test('all 15 new node types are in NODE_TYPES', async () => {
      const { NODE_TYPES } = await import('../../core/src/spec.js');
      const required = [
        'page',
        'layout',
        'loading',
        'metadata',
        'link',
        'textarea',
        'slider',
        'toggle',
        'grid',
        'component',
        'icon',
        'logic',
        'form',
        'const',
        'svg',
      ];
      for (const type of required) {
        expect((NODE_TYPES as readonly string[]).includes(type)).toBe(true);
      }
    });
  });

  // ── SVG node ──────────────────────────────────────────────────────────

  describe('svg node', () => {
    test('icon shorthand renders SVG markup', () => {
      const ast = parse('page name=Test\n  svg icon=heart size=20');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('<svg');
      expect(result.code).toContain('width={20}');
      expect(result.code).toContain('M20.84 4.61');
    });

    test('custom SVG renders with viewBox and content', () => {
      const ast = parse(
        'page name=Test\n  svg viewBox="0 0 100 100" width=32 height=32 content="<rect width=100 height=100 />"',
      );
      const result = transpileNextjs(ast);
      expect(result.code).toContain('viewBox="0 0 100 100"');
      expect(result.code).toContain('width={32}');
      expect(result.code).toContain('width={100}');
    });

    test('unknown icon falls back to circle', () => {
      const ast = parse('page name=Test\n  svg icon=nonexistent');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('<circle');
    });
  });

  // ── Grid NaN fix ──────────────────────────────────────────────────────

  describe('grid gap NaN fix', () => {
    test('numeric gap produces valid class', () => {
      const ast = parse('page name=Test\n  grid cols=3 gap=32\n    text value=A');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('gap-8');
      expect(result.code).not.toContain('NaN');
    });

    test('string gap with px suffix does not produce NaN', () => {
      const ast = parse('page name=Test\n  grid cols=2 gap=8px\n    text value=A');
      const result = transpileNextjs(ast);
      expect(result.code).not.toContain('NaN');
      expect(result.code).toContain('gap-2');
    });
  });

  // ── Form node ─────────────────────────────────────────────────────────

  describe('form node', () => {
    test('renders form element', () => {
      const ast = parse('page name=Test\n  form\n    input placeholder="Name"');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('<form');
      expect(result.code).toContain('</form>');
    });
  });

  // ── Component cross-prop validation ───────────────────────────────────

  describe('component schema validation', () => {
    test('component without ref or name produces violation', async () => {
      const { validateSchema } = await import('../../core/src/schema.js');
      const node = { type: 'component', props: { bind: 'value' } };
      const violations = validateSchema(node as any);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].message).toContain('ref');
    });

    test('component with ref passes validation', async () => {
      const { validateSchema } = await import('../../core/src/schema.js');
      const node = { type: 'component', props: { ref: 'MyWidget' } };
      const violations = validateSchema(node as any);
      expect(violations.length).toBe(0);
    });

    test('component with name passes validation', async () => {
      const { validateSchema } = await import('../../core/src/schema.js');
      const node = { type: 'component', props: { name: 'MyWidget' } };
      const violations = validateSchema(node as any);
      expect(violations.length).toBe(0);
    });
  });
});
