import { generateCoreNode } from '../src/codegen-core.js';
import { parse } from '../src/parser.js';
import { COMMON_TEMPLATES, detectTemplates, TEMPLATE_CATALOG } from '../src/template-catalog.js';
import { clearTemplates, registerTemplate } from '../src/template-engine.js';

beforeEach(() => {
  clearTemplates();
});

describe('Template Catalog', () => {
  // ── Detection ──

  describe('detectTemplates', () => {
    it('detects Zustand from dependencies', () => {
      const detected = detectTemplates({
        dependencies: { zustand: '^4.5.0', react: '^18.2.0' },
      });
      expect(detected).toHaveLength(1);
      expect(detected[0].libraryName).toBe('Zustand');
      expect('zustand-store.kern' in detected[0].templates).toBe(true);
      expect('zustand-selector.kern' in detected[0].templates).toBe(true);
    });

    it('detects SWR from dependencies', () => {
      const detected = detectTemplates({
        dependencies: { swr: '^2.0.0' },
      });
      expect(detected).toHaveLength(1);
      expect(detected[0].libraryName).toBe('SWR');
    });

    it('detects TanStack Query', () => {
      const detected = detectTemplates({
        dependencies: { '@tanstack/react-query': '^5.0.0' },
      });
      expect(detected).toHaveLength(1);
      expect(detected[0].libraryName).toBe('TanStack Query');
    });

    it('detects XState', () => {
      const detected = detectTemplates({
        dependencies: { xstate: '^5.25.0' },
      });
      expect(detected).toHaveLength(1);
      expect(detected[0].libraryName).toBe('XState');
    });

    it('detects Jotai', () => {
      const detected = detectTemplates({
        dependencies: { jotai: '^2.0.0' },
      });
      expect(detected).toHaveLength(1);
      expect(detected[0].libraryName).toBe('Jotai');
    });

    it('detects tRPC from devDependencies too', () => {
      const detected = detectTemplates({
        devDependencies: { '@trpc/react-query': '^10.0.0' },
      });
      expect(detected).toHaveLength(1);
      expect(detected[0].libraryName).toBe('tRPC');
    });

    it('detects multiple libraries at once', () => {
      const detected = detectTemplates({
        dependencies: {
          zustand: '^4.5.0',
          swr: '^2.0.0',
          xstate: '^5.0.0',
          react: '^18.2.0',
        },
      });
      const names = detected.map((d) => d.libraryName).sort();
      expect(names).toEqual(['SWR', 'XState', 'Zustand']);
    });

    it('returns empty for unknown libraries', () => {
      const detected = detectTemplates({
        dependencies: { 'my-custom-lib': '^1.0.0', lodash: '^4.0.0' },
      });
      expect(detected).toHaveLength(0);
    });

    it('handles empty package.json', () => {
      const detected = detectTemplates({});
      expect(detected).toHaveLength(0);
    });
  });

  // ── Catalog templates are valid ──

  describe('catalog templates are parseable and registerable', () => {
    for (const entry of TEMPLATE_CATALOG) {
      for (const [filename, content] of Object.entries(entry.templates)) {
        it(`${entry.libraryName}: ${filename} parses and registers`, () => {
          const ast = parse(content);
          const node = ast.type === 'template' ? ast : (ast.children || []).find((n) => n.type === 'template');
          expect(node).toBeDefined();
          expect(() => registerTemplate(node!)).not.toThrow();
          clearTemplates();
        });
      }
    }

    for (const [filename, content] of Object.entries(COMMON_TEMPLATES)) {
      it(`common: ${filename} parses and registers`, () => {
        const ast = parse(content);
        const node = ast.type === 'template' ? ast : (ast.children || []).find((n) => n.type === 'template');
        expect(node).toBeDefined();
        expect(() => registerTemplate(node!)).not.toThrow();
        clearTemplates();
      });
    }
  });

  // ── Real project detection: AudioFacets ──

  describe('real project: AudioFacets stack', () => {
    it('detects Zustand + XState from AudioFacets-like deps', () => {
      const detected = detectTemplates({
        dependencies: {
          zustand: '4.5.0',
          xstate: '5.28.0',
          '@xstate/react': '6.0.0',
          react: '18.2.0',
          'wavesurfer.js': '7.12.0',
          '@dnd-kit/core': '6.0.0',
          motion: '12.35.0',
          zod: '4.3.6',
        },
      });
      const names = detected.map((d) => d.libraryName).sort();
      expect(names).toEqual(['XState', 'Zustand']);
    });

    it('Zustand store template expands with AudioFacets toast pattern', () => {
      // Register catalog templates
      const entry = TEMPLATE_CATALOG.find((e) => e.packageName === 'zustand')!;
      for (const content of Object.values(entry.templates)) {
        const ast = parse(content);
        registerTemplate(ast.type === 'template' ? ast : (ast.children || []).find((n) => n.type === 'template')!);
      }

      const code = generateCoreNode(
        parse(
          [
            'zustand-store storeName=Toast stateType=ToastState',
            '  handler <<<',
            '    toasts: [],',
            '    addToast: (msg: string) => set({ toasts: [msg] }),',
            '  >>>',
          ].join('\n'),
        ),
      ).join('\n');

      expect(code).toContain("import { create } from 'zustand';");
      expect(code).toContain('useToastStore');
      expect(code).toContain('create<ToastState>');
      expect(code).toContain('toasts: [],');
    });
  });

  // ── Real project detection: Supercard ──

  describe('real project: Supercard stack', () => {
    it('detects XState from Supercard-like deps', () => {
      const detected = detectTemplates({
        dependencies: {
          xstate: '5.25.0',
          '@xstate/react': '6.0.0',
          next: '15.5.9',
          react: '19.2.3',
          clsx: '2.1.1',
          'iron-session': '8.0.0',
          'next-rosetta': '2.0.2',
        },
      });
      const names = detected.map((d) => d.libraryName);
      expect(names).toEqual(['XState']);
    });
  });
});
