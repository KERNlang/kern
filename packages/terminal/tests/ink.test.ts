import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Ink Transpiler', () => {
  test('generates React/Ink imports and Text component', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  text value=Hello {fw:bold,c:#f97316}');
    const result = transpileInk(ast);

    expect(result.code).toContain("import React");
    expect(result.code).toContain("from 'react'");
    expect(result.code).toContain("from 'ink'");
    expect(result.code).toContain('<Text');
    expect(result.code).toContain('bold');
    expect(result.code).toContain('Hello');
    expect(result.code).toContain('export default function Test()');
  });

  test('generates separator as dimColor Text', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  separator width=40');
    const result = transpileInk(ast);

    expect(result.code).toContain('<Text dimColor>');
    expect(result.code).toContain('─'.repeat(40));
  });

  test('generates Box with border props', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  box color=cyan\n    text value="Inside box"');
    const result = transpileInk(ast);

    expect(result.code).toContain('<Box');
    expect(result.code).toContain('borderStyle="round"');
    expect(result.code).toContain('borderColor="cyan"');
    expect(result.code).toContain('Inside box');
  });

  test('generates Spinner with ink-spinner import', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  spinner message="Loading..." color=214');
    const result = transpileInk(ast);

    expect(result.code).toContain("import Spinner from 'ink-spinner'");
    expect(result.code).toContain('<Spinner');
    expect(result.code).toContain('Loading...');
  });

  test('generates progress bar with filled/empty blocks', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  progress value=75 max=100 color=214');
    const result = transpileInk(ast);

    expect(result.code).toContain('<Box>');
    expect(result.code).toContain('▓');
    expect(result.code).toContain('░');
    expect(result.code).toContain('75%');
  });

  test('generates gradient with per-character color mapping', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  gradient text="AGON" colors=[208,214,220]');
    const result = transpileInk(ast);

    expect(result.code).toContain('AGON');
    expect(result.code).toContain('.split');
    expect(result.code).toContain('.map');
    expect(result.code).toContain('color={color}');
  });

  test('generates state as useState hooks', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  state name=busy initial=false\n  state name=count initial=0');
    const result = transpileInk(ast);

    expect(result.code).toContain('useState');
    expect(result.code).toContain('const [busy, setBusy] = useState(false)');
    expect(result.code).toContain('const [count, setCount] = useState(0)');
  });

  test('generates machine with useReducer hook', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  machine name=App',
      '    state name=idle initial=true',
      '    state name=busy',
      '    transition name=start from=idle to=busy',
      '    transition name=finish from=busy to=idle',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Standard machine output
    expect(result.code).toContain("type AppState = 'idle' | 'busy'");
    expect(result.code).toContain('class AppStateError');
    expect(result.code).toContain('function startApp');
    expect(result.code).toContain('function finishApp');

    // useReducer additions
    expect(result.code).toContain("type AppAction = 'start' | 'finish'");
    expect(result.code).toContain('function appReducer');
    expect(result.code).toContain('function useAppReducer');
    expect(result.code).toContain('useReducer');
  });

  test('generates input-area and output-area layout', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=App',
      '  output-area',
      '    text value="Output here"',
      '  input-area',
      '    text value="Input here"',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('flexGrow={1}');
    expect(result.code).toContain('borderStyle="single"');
    expect(result.code).toContain('Output here');
    expect(result.code).toContain('Input here');
  });

  test('generates text-input with placeholder', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = 'screen name=App\n  text-input placeholder="Type here..."';
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain("import TextInput from 'ink-text-input'");
    expect(result.code).toContain('<TextInput');
    expect(result.code).toContain('placeholder="Type here..."');
  });

  test('generates scoreboard with metrics', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  scoreboard title="Forge Scoreboard" winner="claude"',
      '    metric name=Score values=["89","74","71"]',
      '    metric name=Time values=["45s","52s","38s"]',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('Forge Scoreboard');
    expect(result.code).toContain('Winner: claude');
    expect(result.code).toContain('Score:');
    expect(result.code).toContain('Time:');
    expect(result.code).toContain('.join');
  });

  test('agon-terminal.kern produces valid Ink output', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = readFileSync(resolve(ROOT, 'examples/agon-terminal.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('export default function AgonTerminal()');
    expect(result.code).toContain("from 'react'");
    expect(result.code).toContain("from 'ink'");
    expect(result.code).toContain('<Text');
    expect(result.code).toContain('<Box');
    expect(result.code).toContain('<Spinner');
    expect(result.code).toContain('AGON');
    expect(result.code).toContain('useState');
  });

  test('generates stream as useEffect with async generator (append mode)', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=StreamDemo',
      '  state name=lines initial=[]',
      '  stream name=lines source=generateLines',
      '  text value="Streaming Output" {fw:bold}',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Should import useEffect
    expect(result.code).toContain('useEffect');
    expect(result.code).toContain("from 'react'");
    // Should generate the async generator iteration pattern
    expect(result.code).toContain('let cancelled = false');
    expect(result.code).toContain('for await (const chunk of generateLines())');
    expect(result.code).toContain('if (cancelled) break');
    // Default append mode: spread prev into new array
    expect(result.code).toContain('setLines(prev => [...prev, chunk])');
    // Cleanup
    expect(result.code).toContain('return () => { cancelled = true; }');
    expect(result.code).toContain(', [])');
  });

  test('generates stream with replace mode (append=false)', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=ReplaceDemo',
      '  state name=status initial=null',
      '  stream name=status source=fetchStatus append=false',
      '  text value="Status" {fw:bold}',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Replace mode: directly set the value, no spread
    expect(result.code).toContain('setStatus(chunk)');
    expect(result.code).not.toContain('setStatus(prev =>');
    // Still has the async generator pattern
    expect(result.code).toContain('for await (const chunk of fetchStatus())');
  });

  test('stream node is excluded from JSX output', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  state name=items initial=[]',
      '  stream name=items source=loadItems',
      '  text value="Items"',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // stream should not appear as a JSX element
    expect(result.code).not.toContain('<stream');
    expect(result.code).not.toContain('<Stream');
    // But it should generate the useEffect hook
    expect(result.code).toContain('useEffect');
    expect(result.code).toContain('loadItems()');
  });

  test('returns valid TranspileResult with token metrics', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  text value=Hello');
    const result = transpileInk(ast);

    expect(result.code).toBeDefined();
    expect(result.sourceMap).toBeDefined();
    expect(result.sourceMap.length).toBeGreaterThan(0);
    expect(result.irTokenCount).toBeGreaterThan(0);
    expect(result.tsTokenCount).toBeGreaterThan(0);
    expect(typeof result.tokenReduction).toBe('number');
  });
});
