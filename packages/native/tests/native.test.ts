import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from '../../core/src/parser.js';
import { transpile } from '../src/transpiler.js';
import type { IRNode } from '../../core/src/types.js';

const ROOT = resolve(__dirname, '../../..');

function makeNode(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

describe('Native Transpiler', () => {
  test('transpiler produces valid React Native TypeScript', () => {
    const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
    const ast = parse(irSource);
    const result = transpile(ast);

    expect(result.code).toBeDefined();
    expect(result.code.length).toBeGreaterThan(100);
    expect(result.code).toContain('react-native');
    expect(result.code).toContain('View');
    expect(result.code).toContain('Text');
    expect(result.code).toContain('FITVT');
  });

  test('transpiler produces source map entries', () => {
    const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
    const ast = parse(irSource);
    const result = transpile(ast);

    expect(result.sourceMap).toBeDefined();
    expect(Array.isArray(result.sourceMap)).toBe(true);
    expect(result.sourceMap.length).toBeGreaterThan(0);
  });

  test('transpiler reports token counts', () => {
    const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
    const ast = parse(irSource);
    const result = transpile(ast);

    expect(result.irTokenCount).toBeGreaterThan(0);
    expect(result.tsTokenCount).toBeGreaterThan(0);
    expect(result.tokenReduction).toBeGreaterThan(0);
  });

  test('IR achieves at least 30% token reduction vs TypeScript output', () => {
    const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
    const ast = parse(irSource);
    const result = transpile(ast);
    expect(result.tokenReduction).toBeGreaterThanOrEqual(30);
  });
});

describe('Native Transpiler: node-level', () => {
  test('screen node maps to View component', () => {
    const ast = makeNode('screen', { name: 'HomeScreen' });
    const result = transpile(ast);
    expect(result.code).toContain('View');
    expect(result.code).toContain('HomeScreen');
    expect(result.code).toContain("from 'react-native'");
  });

  test('text node renders content from value prop', () => {
    const ast = makeNode('screen', { name: 'App' }, [
      makeNode('text', { value: 'Hello World' }),
    ]);
    const result = transpile(ast);
    expect(result.code).toContain('Text');
    expect(result.code).toContain('Hello World');
  });

  test('row node gets flexDirection row by default', () => {
    const ast = makeNode('screen', { name: 'App' }, [
      makeNode('row', {}),
    ]);
    const result = transpile(ast);
    expect(result.code).toContain("flexDirection: 'row'");
  });

  test('button maps to TouchableOpacity with Text child', () => {
    const ast = makeNode('screen', { name: 'App' }, [
      makeNode('button', { text: 'Click Me' }),
    ]);
    const result = transpile(ast);
    expect(result.code).toContain('TouchableOpacity');
    expect(result.code).toContain('Click Me');
  });

  test('scroll node maps to ScrollView', () => {
    const ast = makeNode('screen', { name: 'App' }, [
      makeNode('scroll', {}, [
        makeNode('text', { value: 'Scrollable' }),
      ]),
    ]);
    const result = transpile(ast);
    expect(result.code).toContain('ScrollView');
  });

  test('input node maps to TextInput', () => {
    const ast = makeNode('screen', { name: 'App' }, [
      makeNode('input', { placeholder: 'Enter text' }),
    ]);
    const result = transpile(ast);
    expect(result.code).toContain('TextInput');
  });

  test('modal node maps to Modal', () => {
    const ast = makeNode('screen', { name: 'App' }, [
      makeNode('modal', {}, [
        makeNode('text', { value: 'Modal content' }),
      ]),
    ]);
    const result = transpile(ast);
    expect(result.code).toContain('Modal');
  });

  test('inline styles generate StyleSheet entries', () => {
    const ast = makeNode('screen', { name: 'App' }, [
      makeNode('col', { styles: { p: '16', bg: '#FF0000' } }),
    ]);
    const result = transpile(ast);
    expect(result.code).toContain('StyleSheet.create');
    expect(result.code).toContain('padding');
    expect(result.code).toContain('backgroundColor');
  });

  test('nested children render correctly', () => {
    const ast = makeNode('screen', { name: 'App' }, [
      makeNode('col', {}, [
        makeNode('row', {}, [
          makeNode('text', { value: 'Nested' }),
        ]),
      ]),
    ]);
    const result = transpile(ast);
    expect(result.code).toContain('View');
    expect(result.code).toContain('Nested');
    // Should have multiple View components
    const viewCount = (result.code.match(/<View/g) || []).length;
    expect(viewCount).toBeGreaterThanOrEqual(2);
  });

  test('image node uses source require pattern', () => {
    const ast = makeNode('screen', { name: 'App' }, [
      makeNode('image', { src: 'avatar.png' }),
    ]);
    const result = transpile(ast);
    expect(result.code).toContain('Image');
    expect(result.code).toContain("require('./avatar.png')");
  });

  test('exports default component', () => {
    const ast = makeNode('screen', { name: 'MyScreen' });
    const result = transpile(ast);
    expect(result.code).toContain('export default MyScreen');
  });

  test('progress node renders bar structure', () => {
    const ast = makeNode('screen', { name: 'App' }, [
      makeNode('progress', { label: 'Loading', current: '75', target: '100', unit: '%' }),
    ]);
    const result = transpile(ast);
    expect(result.code).toContain('Loading');
    expect(result.code).toContain('75');
  });

  test('theme refs merge into component styles', () => {
    const ast = makeNode('screen', { name: 'App' }, [
      makeNode('theme', { name: 'card', styles: { p: '16', br: '8' } }),
      makeNode('col', { themeRefs: ['card'] }),
    ]);
    const result = transpile(ast);
    expect(result.code).toContain('StyleSheet.create');
    expect(result.code).toContain('padding');
    expect(result.code).toContain('borderRadius');
  });
});
