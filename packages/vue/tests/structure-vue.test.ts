import { resolveConfig } from '../../core/src/config.js';
import { parse } from '../../core/src/parser.js';
import {
  classifyNode,
  extractComposables,
  generateBarrelCode,
  generateLogicComposableCode,
  generateStateComposableCode,
  generateTypesCode,
  planVueStructure,
} from '../src/structure-vue.js';

// ── Node Classification ──

describe('classifyNode', () => {
  test('screen → surface', () => {
    const ast = parse('screen name=Test');
    expect(classifyNode(ast)).toBe('surface');
  });

  test('page → surface', () => {
    const ast = parse('page name=Test');
    expect(classifyNode(ast)).toBe('surface');
  });

  test('card → block', () => {
    const ast = parse('card name=UserCard');
    expect(classifyNode(ast)).toBe('block');
  });

  test('section → block', () => {
    const ast = parse('section title=Settings');
    expect(classifyNode(ast)).toBe('block');
  });

  test('form → block', () => {
    const ast = parse('form name=LoginForm');
    expect(classifyNode(ast)).toBe('block');
  });

  test('row → container', () => {
    const ast = parse('row');
    expect(classifyNode(ast)).toBe('container');
  });

  test('col → container', () => {
    const ast = parse('col');
    expect(classifyNode(ast)).toBe('container');
  });

  test('text → element', () => {
    const ast = parse('text value=Hello');
    expect(classifyNode(ast)).toBe('element');
  });

  test('button → element', () => {
    const ast = parse('button text=Click');
    expect(classifyNode(ast)).toBe('element');
  });

  test('state → state', () => {
    const ast = parse('state name=count initial=0');
    expect(classifyNode(ast)).toBe('state');
  });

  test('logic → logic', () => {
    const ast = parse('logic code="console.log(1)"');
    expect(classifyNode(ast)).toBe('logic');
  });

  test('theme → theme', () => {
    const ast = parse('theme name=dark');
    expect(classifyNode(ast)).toBe('theme');
  });

  test('metadata → meta', () => {
    const ast = parse('metadata title=Home');
    expect(classifyNode(ast)).toBe('meta');
  });

  test('derive → logic (ground layer)', () => {
    const ast = parse('derive name=total expr="a+b"');
    expect(classifyNode(ast)).toBe('logic');
  });
});

// ── Structure Planning ──

describe('planVueStructure', () => {
  test('flat returns null', () => {
    const ast = parse('screen name=Dashboard\n  text value=Hello');
    const config = resolveConfig({ structure: 'flat' });
    const plan = planVueStructure(ast, config);
    expect(plan).toBeNull();
  });

  describe('bulletproof', () => {
    const source = [
      'screen name=Dashboard',
      '  state name=count initial=0',
      '  logic code="console.log(count)"',
      '  card name=StatsCard',
      '    text value=Stats',
      '  card name=ChartCard',
      '    text value=Charts',
      '  text value=Footer',
    ].join('\n');

    test('generates .vue entry file', () => {
      const ast = parse(source);
      const config = resolveConfig({ structure: 'bulletproof' });
      const plan = planVueStructure(ast, config);
      expect(plan).not.toBeNull();
      const entry = plan!.files.find((f) => f.isEntry);
      expect(entry).toBeDefined();
      expect(entry!.path).toContain('.vue');
      expect(entry!.path).toContain('features/dashboard/index.vue');
    });

    test('extracts block components to components/ with .vue extension', () => {
      const ast = parse(source);
      const config = resolveConfig({ structure: 'bulletproof' });
      const plan = planVueStructure(ast, config);
      const components = plan!.files.filter((f) => f.artifactType === 'component');
      expect(components.length).toBe(2);
      expect(components[0].path).toContain('components/');
      expect(components[0].path).toMatch(/\.vue$/);
      expect(components[1].path).toMatch(/\.vue$/);
    });

    test('extracts composables to composables/ (not hooks/)', () => {
      const ast = parse(source);
      const config = resolveConfig({ structure: 'bulletproof' });
      const plan = planVueStructure(ast, config);
      const composableFiles = plan!.files.filter((f) => f.artifactType === 'hook');
      expect(composableFiles.length).toBeGreaterThan(0);
      for (const f of composableFiles) {
        expect(f.path).toContain('composables/');
        expect(f.path).toContain('use');
      }
    });

    test('generates types and barrel', () => {
      const ast = parse(source);
      const config = resolveConfig({ structure: 'bulletproof' });
      const plan = planVueStructure(ast, config);
      const types = plan!.files.find((f) => f.artifactType === 'types');
      expect(types).toBeDefined();
      expect(types!.path).toContain('.types.ts');
      expect(plan!.barrels.length).toBeGreaterThan(0);
    });
  });

  describe('atomic', () => {
    const source = [
      'screen name=Dashboard',
      '  state name=count initial=0',
      '  card name=StatsCard',
      '    text value=Stats',
      '  text value=Footer',
    ].join('\n');

    test('generates page in pages/ with .vue', () => {
      const ast = parse(source);
      const config = resolveConfig({ structure: 'atomic' });
      const plan = planVueStructure(ast, config);
      const page = plan!.files.find((f) => f.isEntry);
      expect(page!.path).toContain('pages/');
      expect(page!.path).toMatch(/\.vue$/);
    });

    test('generates template in templates/', () => {
      const ast = parse(source);
      const config = resolveConfig({ structure: 'atomic' });
      const plan = planVueStructure(ast, config);
      const template = plan!.files.find((f) => f.artifactType === 'template');
      expect(template).toBeDefined();
      expect(template!.path).toContain('templates/');
      expect(template!.path).toMatch(/\.vue$/);
    });

    test('blocks go to organisms/', () => {
      const ast = parse(source);
      const config = resolveConfig({ structure: 'atomic' });
      const plan = planVueStructure(ast, config);
      const organisms = plan!.files.filter((f) => f.path.includes('organisms/'));
      expect(organisms.length).toBeGreaterThan(0);
      expect(organisms[0].path).toMatch(/\.vue$/);
    });
  });

  describe('kern', () => {
    const source = [
      'screen name=Dashboard',
      '  state name=count initial=0',
      '  card name=StatsCard',
      '    text value=Stats',
      '  text value=Footer',
    ].join('\n');

    test('generates surface .vue file', () => {
      const ast = parse(source);
      const config = resolveConfig({ structure: 'kern' });
      const plan = planVueStructure(ast, config);
      const surface = plan!.files.find((f) => f.isEntry);
      expect(surface!.path).toContain('surfaces/');
      expect(surface!.path).toContain('.surface.vue');
    });

    test('blocks go to blocks/', () => {
      const ast = parse(source);
      const config = resolveConfig({ structure: 'kern' });
      const plan = planVueStructure(ast, config);
      const blocks = plan!.files.filter((f) => f.path.includes('blocks/'));
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0].path).toContain('.block.vue');
    });

    test('signals for state/logic', () => {
      const ast = parse(source);
      const config = resolveConfig({ structure: 'kern' });
      const plan = planVueStructure(ast, config);
      const signals = plan!.files.filter((f) => f.path.includes('signals/'));
      expect(signals.length).toBeGreaterThan(0);
    });
  });
});

// ── Composable Extraction ──

describe('extractComposables', () => {
  test('extracts state composable', () => {
    const stateNodes = [parse('state name=count initial=0'), parse('state name=name initial=John')];
    const composables = extractComposables('Dashboard', stateNodes, [], 'composables');
    expect(composables.length).toBe(1);
    expect(composables[0].composableName).toBe('useDashboardState');
    expect(composables[0].stateDecls.length).toBe(2);
    expect(composables[0].returnedValues).toContain('count');
    expect(composables[0].returnedValues).toContain('name');
  });

  test('extracts logic composable', () => {
    const logicNodes = [parse('logic code="const double = computed(() => count.value * 2)"')];
    const composables = extractComposables('Dashboard', [], logicNodes, 'composables');
    expect(composables.length).toBe(1);
    expect(composables[0].composableName).toBe('useDashboardLogic');
    expect(composables[0].logicBlocks.length).toBe(1);
  });

  test('extracts both state and logic composables', () => {
    const stateNodes = [parse('state name=count initial=0')];
    const logicNodes = [parse('logic code="const increment = () => count.value++"')];
    const composables = extractComposables('Dashboard', stateNodes, logicNodes, 'composables');
    expect(composables.length).toBe(2);
    expect(composables[0].composableName).toBe('useDashboardState');
    expect(composables[1].composableName).toBe('useDashboardLogic');
  });
});

// ── Code Generation ──

describe('generateStateComposableCode', () => {
  test('generates ref() declarations', () => {
    const composable = {
      composableName: 'useDashboardState',
      path: 'composables/useDashboardState.ts',
      stateDecls: [
        { name: 'count', initial: '0' },
        { name: 'name', initial: 'John' },
      ],
      logicBlocks: [],
      returnedValues: ['count', 'name'],
      importedBy: [],
    };
    const code = generateStateComposableCode(composable);
    expect(code).toContain("import { ref } from 'vue'");
    expect(code).toContain('export function useDashboardState()');
    expect(code).toContain('const count = ref(0);');
    expect(code).toContain("const name = ref('John');");
    expect(code).toContain('return { count, name }');
  });

  test('handles boolean and empty string initials', () => {
    const composable = {
      composableName: 'useFormState',
      path: 'composables/useFormState.ts',
      stateDecls: [
        { name: 'active', initial: 'true' },
        { name: 'label', initial: '' },
      ],
      logicBlocks: [],
      returnedValues: ['active', 'label'],
      importedBy: [],
    };
    const code = generateStateComposableCode(composable);
    expect(code).toContain('const active = ref(true);');
    expect(code).toContain("const label = ref('');");
  });
});

describe('generateLogicComposableCode', () => {
  test('generates logic composable with state import', () => {
    const composable = {
      composableName: 'useDashboardLogic',
      path: 'composables/useDashboardLogic.ts',
      stateDecls: [],
      logicBlocks: ['const double = computed(() => count.value * 2)'],
      returnedValues: ['double'],
      importedBy: [],
    };
    const code = generateLogicComposableCode(composable, 'useDashboardState');
    expect(code).toContain("import { computed } from 'vue'");
    expect(code).toContain("import { useDashboardState } from './useDashboardState'");
    expect(code).toContain('export function useDashboardLogic()');
    expect(code).toContain('const state = useDashboardState()');
    expect(code).toContain('return { double }');
  });
});

describe('generateTypesCode', () => {
  test('generates Ref-typed interface', () => {
    const code = generateTypesCode('Dashboard', [
      { name: 'count', initial: '0' },
      { name: 'active', initial: 'true' },
      { name: 'name', initial: 'John' },
    ]);
    expect(code).toContain("import type { Ref } from 'vue'");
    expect(code).toContain('export interface DashboardState');
    expect(code).toContain('count: Ref<number>');
    expect(code).toContain('active: Ref<boolean>');
    expect(code).toContain('name: Ref<string>');
  });
});

describe('generateBarrelCode', () => {
  test('generates barrel export', () => {
    const code = generateBarrelCode({
      path: 'features/dashboard/barrel.ts',
      exports: [{ name: 'Dashboard', from: './index' }],
    });
    expect(code).toContain("export { Dashboard } from './index'");
  });
});
