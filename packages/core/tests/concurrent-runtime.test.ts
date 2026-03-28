/**
 * Concurrent runtime isolation tests.
 *
 * Proves that separate KernRuntime instances don't interfere with each other
 * under parallel execution — the core guarantee of the Phase 4 refactor.
 */

import { KernRuntime } from '../src/runtime.js';
import { parse } from '../src/parser.js';
import { generateCoreNode } from '../src/codegen-core.js';

describe('KernRuntime isolation', () => {
  it('separate runtimes have independent evolved types', () => {
    const a = new KernRuntime();
    const b = new KernRuntime();

    a.registerEvolvedType('widget');
    expect(a.dynamicNodeTypes.has('widget')).toBe(true);
    expect(b.dynamicNodeTypes.has('widget')).toBe(false);
  });

  it('separate runtimes have independent parser hints', () => {
    const a = new KernRuntime();
    const b = new KernRuntime();

    a.registerParserHints('widget', { positionalArgs: ['name'] });
    expect(a.parserHints.has('widget')).toBe(true);
    expect(b.parserHints.has('widget')).toBe(false);
  });

  it('separate runtimes have independent evolved generators', () => {
    const a = new KernRuntime();
    const b = new KernRuntime();

    a.registerEvolvedGenerator('widget', () => ['// widget']);
    expect(a.hasEvolvedGenerator('widget')).toBe(true);
    expect(b.hasEvolvedGenerator('widget')).toBe(false);
  });

  it('separate runtimes have independent template registries', () => {
    const a = new KernRuntime();
    const b = new KernRuntime();

    a.registerTemplate('card', { name: 'card', slots: [], imports: [], body: '// card' });
    expect(a.isTemplateNode('card')).toBe(true);
    expect(b.isTemplateNode('card')).toBe(false);
  });

  it('separate runtimes have independent diagnostics', () => {
    const a = new KernRuntime();
    const b = new KernRuntime();

    a.lastParseDiagnostics = [{ code: 'EMPTY_DOCUMENT' as any, severity: 'error', message: 'test', line: 1, col: 1, endCol: 1, suggestion: '' }];
    expect(a.lastParseDiagnostics).toHaveLength(1);
    expect(b.lastParseDiagnostics).toHaveLength(0);
  });

  it('reset() clears all runtime state', () => {
    const rt = new KernRuntime();
    rt.registerEvolvedType('widget');
    rt.registerParserHints('widget', { positionalArgs: ['name'] });
    rt.registerEvolvedGenerator('widget', () => ['// widget']);
    rt.registerTemplate('card', { name: 'card', slots: [], imports: [], body: '' });
    rt.lastParseDiagnostics = [{ code: 'EMPTY_DOCUMENT' as any, severity: 'error', message: 'x', line: 1, col: 1, endCol: 1, suggestion: '' }];

    rt.reset();

    expect(rt.dynamicNodeTypes.size).toBe(0);
    expect(rt.parserHints.size).toBe(0);
    expect(rt.evolvedGenerators.size).toBe(0);
    expect(rt.templateRegistry.size).toBe(0);
    expect(rt.lastParseDiagnostics).toHaveLength(0);
  });

  it('parallel parse calls using defaultRuntime do not crash', async () => {
    const sources = [
      'type name=A values="x|y"',
      'interface name=B\n  field name=id type=string',
      'fn name=c returns=void\n  handler <<<return;>>>',
      'machine name=D\n  state name=on\n  state name=off\n  transition name=toggle from=on to=off',
      'error name=E extends=Error',
    ];

    const results = await Promise.all(
      sources.map(async (src) => {
        const root = parse(src);
        return generateCoreNode(root).join('\n');
      })
    );

    expect(results).toHaveLength(5);
    expect(results[0]).toContain("type A = 'x' | 'y'");
    expect(results[1]).toContain('interface B');
    expect(results[2]).toContain('function c');
    expect(results[3]).toContain("type DState = 'on' | 'off'");
    expect(results[4]).toContain('class E extends Error');
  });

  it('multilineBlockTypes initialized with defaults', () => {
    const rt = new KernRuntime();
    expect(rt.multilineBlockTypes.has('handler')).toBe(true);
    expect(rt.multilineBlockTypes.has('cleanup')).toBe(true);
    expect(rt.multilineBlockTypes.has('body')).toBe(true);
    expect(rt.multilineBlockTypes.has('logic')).toBe(true);
  });

  it('registerParserHints adds to multilineBlockTypes', () => {
    const rt = new KernRuntime();
    rt.registerParserHints('widget', { multilineBlock: 'widget' });
    expect(rt.multilineBlockTypes.has('widget')).toBe(true);

    rt.unregisterParserHints('widget');
    expect(rt.multilineBlockTypes.has('widget')).toBe(false);
  });

  it('target-specific evolved generators are isolated', () => {
    const a = new KernRuntime();
    const b = new KernRuntime();

    a.registerEvolvedTargetGenerator('widget', 'nextjs', () => ['// nextjs widget']);
    expect(a.evolvedTargetGenerators.get('widget')?.get('nextjs')).toBeDefined();
    expect(b.evolvedTargetGenerators.get('widget')).toBeUndefined();
  });
});
