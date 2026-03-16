import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Structure Planner', () => {
  // ── classifyNode ─────────────────────────────────────────────────────────
  describe('classifyNode', () => {
    test('classifies surface nodes', async () => {
      const { classifyNode } = await import('../src/structure.js');
      expect(classifyNode({ type: 'screen' })).toBe('surface');
      expect(classifyNode({ type: 'page' })).toBe('surface');
      expect(classifyNode({ type: 'modal' })).toBe('surface');
    });

    test('classifies block nodes', async () => {
      const { classifyNode } = await import('../src/structure.js');
      expect(classifyNode({ type: 'card' })).toBe('block');
      expect(classifyNode({ type: 'section' })).toBe('block');
      expect(classifyNode({ type: 'form' })).toBe('block');
      expect(classifyNode({ type: 'list' })).toBe('block');
      expect(classifyNode({ type: 'grid' })).toBe('block');
      expect(classifyNode({ type: 'tabs' })).toBe('block');
    });

    test('classifies element nodes', async () => {
      const { classifyNode } = await import('../src/structure.js');
      expect(classifyNode({ type: 'text' })).toBe('element');
      expect(classifyNode({ type: 'button' })).toBe('element');
      expect(classifyNode({ type: 'input' })).toBe('element');
      expect(classifyNode({ type: 'progress' })).toBe('element');
      expect(classifyNode({ type: 'image' })).toBe('element');
    });

    test('classifies container nodes', async () => {
      const { classifyNode } = await import('../src/structure.js');
      expect(classifyNode({ type: 'row' })).toBe('container');
      expect(classifyNode({ type: 'col' })).toBe('container');
    });

    test('classifies state and logic nodes', async () => {
      const { classifyNode } = await import('../src/structure.js');
      expect(classifyNode({ type: 'state' })).toBe('state');
      expect(classifyNode({ type: 'logic' })).toBe('logic');
      expect(classifyNode({ type: 'handler' })).toBe('logic');
    });

    test('classifies theme and meta nodes', async () => {
      const { classifyNode } = await import('../src/structure.js');
      expect(classifyNode({ type: 'theme' })).toBe('theme');
      expect(classifyNode({ type: 'metadata' })).toBe('meta');
    });
  });

  // ── planStructure — flat ─────────────────────────────────────────────────
  describe('planStructure — flat', () => {
    test('returns null for flat structure (identity case)', async () => {
      const { planStructure } = await import('../src/structure.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const config = resolveConfig({ structure: 'flat' });
      const ast = { type: 'screen', props: { name: 'Dashboard' }, children: [] };
      expect(planStructure(ast, config)).toBeNull();
    });

    test('returns null when no structure is specified (defaults to flat)', async () => {
      const { planStructure } = await import('../src/structure.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const config = resolveConfig({});
      expect(config.structure).toBe('flat');
      const ast = { type: 'screen', props: { name: 'Dashboard' }, children: [] };
      expect(planStructure(ast, config)).toBeNull();
    });
  });

  // ── planStructure — bulletproof ──────────────────────────────────────────
  describe('planStructure — bulletproof', () => {
    test('creates feature folder structure with entry and components', async () => {
      const { planStructure } = await import('../src/structure.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const config = resolveConfig({ target: 'tailwind', structure: 'bulletproof' });

      const ast = {
        type: 'screen',
        props: { name: 'Dashboard' },
        children: [
          { type: 'state', props: { name: 'count', initial: '0' } },
          { type: 'logic', props: { code: 'useEffect(() => {}, []);' } },
          { type: 'card', props: { name: 'CalorieCard' }, children: [
            { type: 'text', props: { value: 'Calories' } },
          ]},
          { type: 'card', props: { name: 'ProgressCard' }, children: [
            { type: 'progress', props: { current: '50', target: '100' } },
          ]},
        ],
      };

      const plan = planStructure(ast, config);
      expect(plan).not.toBeNull();
      expect(plan!.files.length).toBeGreaterThanOrEqual(4); // entry + 2 cards + hooks + types

      // Verify entry file
      const entry = plan!.files.find(f => f.isEntry);
      expect(entry).toBeDefined();
      expect(entry!.path).toContain('features/dashboard/');

      // Verify component files
      const components = plan!.files.filter(f => f.artifactType === 'component');
      expect(components.length).toBe(2);
      expect(components[0].path).toContain('features/dashboard/components/');
      expect(components[1].path).toContain('features/dashboard/components/');

      // Verify hooks
      const hooks = plan!.files.filter(f => f.artifactType === 'hook');
      expect(hooks.length).toBe(2); // state + logic
      expect(hooks.some(h => h.path.includes('useDashboardState'))).toBe(true);
      expect(hooks.some(h => h.path.includes('useDashboardLogic'))).toBe(true);

      // Verify types
      const types = plan!.files.filter(f => f.artifactType === 'types');
      expect(types.length).toBe(1);
      expect(types[0].path).toContain('types/dashboard.types.ts');
    });

    test('generates barrel exports', async () => {
      const { planStructure } = await import('../src/structure.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const config = resolveConfig({ target: 'tailwind', structure: 'bulletproof' });

      const ast = {
        type: 'screen',
        props: { name: 'Dashboard' },
        children: [{ type: 'text', props: { value: 'Hello' } }],
      };

      const plan = planStructure(ast, config);
      expect(plan).not.toBeNull();
      expect(plan!.barrels.length).toBeGreaterThan(0);
      expect(plan!.barrels[0].path).toContain('features/dashboard/barrel.ts');
    });
  });

  // ── planStructure — atomic ───────────────────────────────────────────────
  describe('planStructure — atomic', () => {
    test('creates atomic hierarchy (pages, organisms, hooks)', async () => {
      const { planStructure } = await import('../src/structure.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const config = resolveConfig({ target: 'tailwind', structure: 'atomic' });

      const ast = {
        type: 'screen',
        props: { name: 'Dashboard' },
        children: [
          { type: 'state', props: { name: 'count', initial: '0' } },
          { type: 'card', props: { name: 'CalorieCard' }, children: [] },
          { type: 'section', props: { name: 'StatsSection' }, children: [] },
        ],
      };

      const plan = planStructure(ast, config);
      expect(plan).not.toBeNull();

      // Page
      const page = plan!.files.find(f => f.artifactType === 'page');
      expect(page).toBeDefined();
      expect(page!.path).toContain('pages/DashboardPage.tsx');

      // Template
      const template = plan!.files.find(f => f.artifactType === 'template');
      expect(template).toBeDefined();
      expect(template!.path).toContain('templates/DashboardTemplate.tsx');

      // Organisms (blocks)
      const organisms = plan!.files.filter(f => f.path.includes('organisms/'));
      expect(organisms.length).toBe(2);

      // Hooks
      const hooks = plan!.files.filter(f => f.artifactType === 'hook');
      expect(hooks.length).toBe(1); // state only (no logic nodes)
      expect(hooks[0].path).toContain('hooks/useDashboardState.ts');
    });
  });

  // ── planStructure — kern ─────────────────────────────────────────────────
  describe('planStructure — kern', () => {
    test('creates KERN-native structure (surfaces, blocks, signals, tokens, models)', async () => {
      const { planStructure } = await import('../src/structure.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const config = resolveConfig({ target: 'tailwind', structure: 'kern' });

      const ast = {
        type: 'screen',
        props: { name: 'Dashboard' },
        children: [
          { type: 'state', props: { name: 'count', initial: '0' } },
          { type: 'logic', props: { code: 'const handleClick = () => {};' } },
          { type: 'card', props: { name: 'CalorieCard' }, children: [] },
          { type: 'theme', props: { name: 'dark', styles: { bg: '#000' } } },
        ],
      };

      const plan = planStructure(ast, config);
      expect(plan).not.toBeNull();

      // Surface
      const surface = plan!.files.find(f => f.isEntry);
      expect(surface).toBeDefined();
      expect(surface!.path).toContain('surfaces/Dashboard.surface.tsx');

      // Block
      const blocks = plan!.files.filter(f => f.path.includes('blocks/'));
      expect(blocks.length).toBe(1);
      expect(blocks[0].path).toContain('.block.tsx');

      // Signals (hooks)
      const signals = plan!.files.filter(f => f.path.includes('signals/'));
      expect(signals.length).toBe(2); // state + logic
      expect(signals.some(s => s.path.includes('useDashboardState'))).toBe(true);
      expect(signals.some(s => s.path.includes('useDashboardLogic'))).toBe(true);

      // Tokens (theme)
      const tokens = plan!.files.filter(f => f.path.includes('tokens/'));
      expect(tokens.length).toBe(1);

      // Models (types)
      const models = plan!.files.filter(f => f.path.includes('models/'));
      expect(models.length).toBe(1);
    });
  });

  // ── Hook extraction ──────────────────────────────────────────────────────
  describe('extractHooks', () => {
    test('extracts split state and logic hooks', async () => {
      const { extractHooks } = await import('../src/structure.js');

      const stateNodes = [
        { type: 'state', props: { name: 'count', initial: '0' } },
        { type: 'state', props: { name: 'loading', initial: 'true' } },
      ];
      const logicNodes = [
        { type: 'logic', props: { code: 'const handleClick = () => setCount(count + 1);' } },
      ];

      const hooks = extractHooks('Dashboard', stateNodes, logicNodes, 'hooks');
      expect(hooks.length).toBe(2);

      // State hook
      const stateHook = hooks.find(h => h.hookName === 'useDashboardState');
      expect(stateHook).toBeDefined();
      expect(stateHook!.stateDecls.length).toBe(2);
      expect(stateHook!.returnedValues).toContain('count');
      expect(stateHook!.returnedValues).toContain('setCount');
      expect(stateHook!.returnedValues).toContain('loading');
      expect(stateHook!.returnedValues).toContain('setLoading');

      // Logic hook
      const logicHook = hooks.find(h => h.hookName === 'useDashboardLogic');
      expect(logicHook).toBeDefined();
      expect(logicHook!.logicBlocks.length).toBe(1);
    });

    test('returns empty when no state or logic', async () => {
      const { extractHooks } = await import('../src/structure.js');
      const hooks = extractHooks('Empty', [], [], 'hooks');
      expect(hooks.length).toBe(0);
    });
  });

  // ── Hook code generation ─────────────────────────────────────────────────
  describe('generateStateHookCode', () => {
    test('generates useState hook with correct returns', async () => {
      const { generateStateHookCode } = await import('../src/structure.js');

      const code = generateStateHookCode({
        hookName: 'useDashboardState',
        path: 'hooks/useDashboardState.ts',
        stateDecls: [
          { name: 'count', initial: '0' },
          { name: 'loading', initial: 'true' },
        ],
        logicBlocks: [],
        returnedValues: ['count', 'setCount', 'loading', 'setLoading'],
        importedBy: [],
      });

      expect(code).toContain("import { useState } from 'react';");
      expect(code).toContain('export function useDashboardState()');
      expect(code).toContain('useState(0)');
      expect(code).toContain('useState(true)');
      expect(code).toContain('return { count, setCount, loading, setLoading }');
    });
  });

  describe('generateLogicHookCode', () => {
    test('generates logic hook importing state hook', async () => {
      const { generateLogicHookCode } = await import('../src/structure.js');

      const code = generateLogicHookCode(
        {
          hookName: 'useDashboardLogic',
          path: 'hooks/useDashboardLogic.ts',
          stateDecls: [],
          logicBlocks: ['useEffect(() => { fetch(); }, []);'],
          returnedValues: [],
          importedBy: [],
        },
        'useDashboardState',
      );

      expect(code).toContain("import { useEffect } from 'react';");
      expect(code).toContain("import { useDashboardState } from './useDashboardState';");
      expect(code).toContain('export function useDashboardLogic()');
      expect(code).toContain('const state = useDashboardState()');
    });
  });

  // ── Types code generation ────────────────────────────────────────────────
  describe('generateTypesCode', () => {
    test('generates interface with state props', async () => {
      const { generateTypesCode } = await import('../src/structure.js');
      const code = generateTypesCode('Dashboard', [
        { name: 'count', initial: '0' },
        { name: 'loading', initial: 'true' },
        { name: 'query', initial: '' },
      ]);

      expect(code).toContain('export interface DashboardProps');
      expect(code).toContain('count: number');
      expect(code).toContain('setCount: (value: number) => void');
      expect(code).toContain('loading: boolean');
      expect(code).toContain('query: string');
    });
  });

  // ── Transpiler integration tests ─────────────────────────────────────────
  describe('Tailwind + bulletproof', () => {
    test('produces multi-file output with artifacts', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
      const { resolveConfig } = await import('../../core/src/config.js');

      const config = resolveConfig({ target: 'tailwind', structure: 'bulletproof' });
      const ast = parse([
        'screen name=Dashboard',
        '  state name=count initial=0',
        '  card name=CalorieCard',
        '    text value=Calories',
        '  text value=Hello',
      ].join('\n'));

      const result = transpileTailwind(ast, config);
      expect(result.artifacts).toBeDefined();
      expect(result.artifacts!.length).toBeGreaterThanOrEqual(3); // entry + component + hooks + types

      // Entry artifact exists
      const entry = result.artifacts!.find(a => a.type === 'entry');
      expect(entry).toBeDefined();
      expect(entry!.content).toContain('Dashboard');

      // Hook artifact exists
      const hook = result.artifacts!.find(a => a.type === 'hook');
      expect(hook).toBeDefined();
      expect(hook!.content).toContain('useState');

      // Component artifact exists
      const component = result.artifacts!.find(a => a.type === 'component');
      expect(component).toBeDefined();
      expect(component!.path).toContain('components/');
    });
  });

  describe('Tailwind + atomic', () => {
    test('produces atomic hierarchy artifacts', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
      const { resolveConfig } = await import('../../core/src/config.js');

      const config = resolveConfig({ target: 'tailwind', structure: 'atomic' });
      const ast = parse([
        'screen name=Dashboard',
        '  state name=count initial=0',
        '  card name=CalorieCard',
        '    text value=Calories',
      ].join('\n'));

      const result = transpileTailwind(ast, config);
      expect(result.artifacts).toBeDefined();

      // Page artifact
      const page = result.artifacts!.find(a => a.path.includes('pages/'));
      expect(page).toBeDefined();

      // Organism artifact
      const organism = result.artifacts!.find(a => a.path.includes('organisms/'));
      expect(organism).toBeDefined();

      // Hook artifact
      const hook = result.artifacts!.find(a => a.type === 'hook');
      expect(hook).toBeDefined();
    });
  });

  describe('Tailwind + kern', () => {
    test('produces KERN-native structure artifacts', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
      const { resolveConfig } = await import('../../core/src/config.js');

      const config = resolveConfig({ target: 'tailwind', structure: 'kern' });
      const ast = parse([
        'screen name=Dashboard',
        '  state name=count initial=0',
        '  logic <<<',
        '    const handleClick = () => {};',
        '  >>>',
        '  card name=CalorieCard',
        '    text value=Calories',
      ].join('\n'));

      const result = transpileTailwind(ast, config);
      expect(result.artifacts).toBeDefined();

      // Surface
      const surface = result.artifacts!.find(a => a.path.includes('surfaces/'));
      expect(surface).toBeDefined();
      expect(surface!.path).toContain('.surface.tsx');

      // Block
      const block = result.artifacts!.find(a => a.path.includes('blocks/'));
      expect(block).toBeDefined();
      expect(block!.path).toContain('.block.tsx');

      // Signals
      const signals = result.artifacts!.filter(a => a.path.includes('signals/'));
      expect(signals.length).toBe(2); // state + logic
    });
  });

  describe('Next.js + bulletproof', () => {
    test('produces structured output with Next.js conventions', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileNextjs } = await import('../src/transpiler-nextjs.js');
      const { resolveConfig } = await import('../../core/src/config.js');

      const config = resolveConfig({ target: 'nextjs', structure: 'bulletproof' });
      const ast = parse([
        'screen name=Dashboard',
        '  card name=CalorieCard',
        '    text value=Calories',
      ].join('\n'));

      const result = transpileNextjs(ast, config);
      expect(result.artifacts).toBeDefined();
      expect(result.artifacts!.length).toBeGreaterThanOrEqual(2);

      // Check that component files exist
      const component = result.artifacts!.find(a => a.type === 'component');
      expect(component).toBeDefined();
    });
  });

  describe('Web + kern', () => {
    test('produces KERN-native structure with inline styles', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileWeb } = await import('../src/transpiler-web.js');
      const { resolveConfig } = await import('../../core/src/config.js');

      const config = resolveConfig({ target: 'web', structure: 'kern' });
      const ast = parse([
        'screen name=Dashboard',
        '  card name=CalorieCard {p:16,br:8}',
        '    text value=Calories',
      ].join('\n'));

      const result = transpileWeb(ast, config);
      expect(result.artifacts).toBeDefined();

      // Surface
      const surface = result.artifacts!.find(a => a.path.includes('surfaces/'));
      expect(surface).toBeDefined();

      // Block
      const block = result.artifacts!.find(a => a.path.includes('blocks/'));
      expect(block).toBeDefined();
    });
  });

  // ── Flat mode regression ──────────────────────────────────────────────────
  describe('Flat mode regression', () => {
    test('tailwind flat output unchanged', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
      const { resolveConfig } = await import('../../core/src/config.js');

      const config = resolveConfig({ target: 'tailwind' });
      const ast = parse('screen name=Test\n  state name=count initial=0\n  text value=Hello');
      const result = transpileTailwind(ast, config);

      // No artifacts in flat mode
      expect(result.artifacts).toBeUndefined();
      expect(result.code).toContain('useState');
      expect(result.code).toContain('count');
      expect(result.code).toContain('Hello');
    });

    test('nextjs flat output unchanged', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileNextjs } = await import('../src/transpiler-nextjs.js');
      const { resolveConfig } = await import('../../core/src/config.js');

      const config = resolveConfig({ target: 'nextjs' });
      const ast = parse('page name=Test client=true\n  text value=Hello');
      const result = transpileNextjs(ast, config);

      expect(result.code).toContain("'use client'");
      expect(result.code).toContain('Hello');
    });

    test('web flat output unchanged', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileWeb } = await import('../src/transpiler-web.js');
      const { resolveConfig } = await import('../../core/src/config.js');

      const config = resolveConfig({ target: 'web' });
      const ast = parse('screen name=Test\n  text value=Hello');
      const result = transpileWeb(ast, config);

      expect(result.artifacts).toBeUndefined();
      expect(result.code).toContain('<span');
      expect(result.code).toContain('Hello');
    });
  });

  // ── Config validation ────────────────────────────────────────────────────
  describe('Config — structure validation', () => {
    test('resolveConfig defaults to flat', async () => {
      const { resolveConfig } = await import('../../core/src/config.js');
      const config = resolveConfig({});
      expect(config.structure).toBe('flat');
    });

    test('resolveConfig accepts all valid structures', async () => {
      const { resolveConfig } = await import('../../core/src/config.js');
      expect(resolveConfig({ structure: 'flat' }).structure).toBe('flat');
      expect(resolveConfig({ structure: 'bulletproof' }).structure).toBe('bulletproof');
      expect(resolveConfig({ structure: 'atomic' }).structure).toBe('atomic');
      expect(resolveConfig({ structure: 'kern' }).structure).toBe('kern');
    });

    test('resolveConfig throws on unknown structure', async () => {
      const { resolveConfig } = await import('../../core/src/config.js');
      expect(() => resolveConfig({ structure: 'invalid' as any })).toThrow('Unknown structure');
    });
  });
});
