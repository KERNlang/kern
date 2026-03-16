import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Terminal Transpiler', () => {
  test('generates ANSI helpers and text output', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileTerminal } = await import('../src/transpiler-terminal.js');
    const ast = parse('screen name=Test\n  text value=Hello {fw:bold,c:#f97316}');
    const result = transpileTerminal(ast);

    expect(result.code).toContain('ansiColor');
    expect(result.code).toContain('style(');
    expect(result.code).toContain('Hello');
  });

  test('generates separator and box', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileTerminal } = await import('../src/transpiler-terminal.js');
    const ast = parse('screen name=Test\n  separator width=40\n  box color=cyan\n    text value="Inside box"');
    const result = transpileTerminal(ast);

    expect(result.code).toContain('separator(40)');
    expect(result.code).toContain('box(');
    expect(result.code).toContain('Inside box');
  });

  test('generates gradient and spinner', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileTerminal } = await import('../src/transpiler-terminal.js');
    const ast = parse('screen name=Test\n  gradient text="AGON" colors=[208,214,220]\n  spinner message="Loading..." color=214');
    const result = transpileTerminal(ast);

    expect(result.code).toContain('gradient(');
    expect(result.code).toContain('AGON');
    expect(result.code).toContain('spinner(');
    expect(result.code).toContain('Loading...');
  });

  test('generates state blocks as module-level vars', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileTerminal } = await import('../src/transpiler-terminal.js');
    const ast = parse('screen name=Test\n  state name=busy initial=false');
    const result = transpileTerminal(ast);

    expect(result.code).toContain('let busy = false');
  });

  test('agon-terminal.kern produces valid output', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileTerminal } = await import('../src/transpiler-terminal.js');
    const source = readFileSync(resolve(ROOT, 'examples/agon-terminal.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileTerminal(ast);

    expect(result.code).toContain('gradient');
    expect(result.code).toContain('AGON');
    expect(result.code).toContain('spinner');
    expect(result.code).toContain('progressBar');
    expect(result.code).toContain('separator');
  });

  test('generates parallel dispatch with Promise.all and timeout', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileTerminal } = await import('../src/transpiler-terminal.js');
    const source = [
      'screen name=Test',
      '  parallel timeout=120',
      '    dispatch engine=claude prompt=task result=claudeResult',
      '    dispatch engine=codex prompt=task result=codexResult',
    ].join('\n');
    const ast = parse(source);
    const result = transpileTerminal(ast);

    expect(result.code).toContain('AbortController');
    expect(result.code).toContain('Promise.race');
    expect(result.code).toContain('Promise.allSettled');
    expect(result.code).toContain('120000');
    expect(result.code).toContain('"claude"');
    expect(result.code).toContain('"codex"');
  });

  test('generates parallel each with collection iteration', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileTerminal } = await import('../src/transpiler-terminal.js');
    const source = [
      'screen name=Test',
      '  state name=engines initial=["claude","codex","gemini"]',
      '  parallel timeout=60',
      '    each name=engine in=engines',
      '      dispatch prompt=draftPrompt result=draft',
    ].join('\n');
    const ast = parse(source);
    const result = transpileTerminal(ast);

    expect(result.code).toContain('.map(async (engine)');
    expect(result.code).toContain('dispatch(engine');
    expect(result.code).toContain('60000');
  });
});
