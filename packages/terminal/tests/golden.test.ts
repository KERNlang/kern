import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Golden Snapshot Tests', () => {
  test('Terminal output for agon-terminal.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileTerminal } = await import('../src/transpiler-terminal.js');
    const source = readFileSync(resolve(ROOT, 'examples/agon-terminal.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileTerminal(ast);
    expect(result.code).toMatchSnapshot();
  });

  test('Ink output for agon-terminal.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = readFileSync(resolve(ROOT, 'examples/agon-terminal.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileInk(ast);
    expect(result.code).toMatchSnapshot();
  });

  test('Terminal output for interactive.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileTerminal } = await import('../src/transpiler-terminal.js');
    const source = readFileSync(resolve(ROOT, 'examples/interactive.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileTerminal(ast);
    expect(result.code).toMatchSnapshot();
  });
});
