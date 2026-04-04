import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Ink Transpiler', () => {
  test('generates React/Ink imports and Text component', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  text value=Hello {fw:bold,c:#f97316}');
    const result = transpileInk(ast);

    expect(result.code).toContain('import React');
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

  // ── New primitives ─────────────────────────────────────────────────

  test('async=true on callback generates async useCallback', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  callback name=handleSubmit params="value:string" deps="dispatch,mode" async=true',
      '    handler <<<',
      '      const result = await process(value);',
      '      dispatch({ type: "done", result });',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('useCallback(async (value:string) => {');
    expect(result.code).toContain('await process(value)');
    expect(result.code).toContain('[dispatch,mode]');
  });

  test('each node generates .map() iteration', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  each collection={{engines}} item=engine index=i key={{engine.id}}',
      '    box',
      '      text value={{engine.name}}',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('{engines.map((engine, i) => (');
    expect(result.code).toContain('key={engine.id}');
    expect(result.code).toContain('<Box');
    expect(result.code).toContain('))}');
  });

  test('each node with multiple children wraps in React.Fragment', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  each collection={{items}} item=item key={{item.id}}',
      '    text value={{item.label}}',
      '    text value={{item.detail}} {dim:true}',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('{items.map((item, i) => (');
    expect(result.code).toContain('React.Fragment key={item.id}');
    expect(result.code).toContain('</React.Fragment>');
  });

  // ── Bug fixes ──────────────────────────────────────────────────────

  test('Bug #1: hoists nested on-nodes from UI containers to useInput', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  state name=active initial=false',
      '  box color=cyan',
      '    on event=key key=return',
      '      handler <<<',
      '        setActive(true);',
      '      >>>',
      '    text value="Press Enter"',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Should generate useInput hook (not just a comment)
    expect(result.code).toContain('useInput((input, key) => {');
    expect(result.code).toContain('key.return');
    expect(result.code).toContain('setActive(true)');
    // Should NOT have an on-node rendered as JSX
    expect(result.code).not.toContain('// on key');
  });

  test('Bug #2: handles __expr objects in text value', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = 'screen name=Test\n  text value={{ loading ? "Loading..." : "Done" }}';
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('loading ? "Loading..." : "Done"');
    expect(result.code).not.toContain('__expr');
    expect(result.code).not.toContain('[object Object]');
  });

  test('Bug #3: dynamic progress with expression values', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  state name=progress initial=0',
      '  progress value={{ progress }} max=100 color=green',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Should generate runtime computation, not static 0%
    expect(result.code).toContain('_pct');
    expect(result.code).toContain('progress');
    expect(result.code).not.toContain("{'░░░░░░░░░░░░░░░░░░░░'}");
    expect(result.code).not.toContain("' 0%'");
  });

  test('Bug #4: text-input generates value/onChange when bind is set', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  state name=query initial=""',
      '  text-input bind=query placeholder="Search..."',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('value={query}');
    expect(result.code).toContain('onChange={setQuery}');
    expect(result.code).toContain('placeholder="Search..."');
  });

  test('Bug #5: select-input generates onSelect handler', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = 'screen name=Test\n  select-input items={{menuItems}} onSelect=handleSelect';
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('items={menuItems}');
    expect(result.code).toContain('onSelect={handleSelect}');
  });

  test('Bug #6: handler blocks preserve indentation', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  box',
      '    handler <<<',
      '      if (condition) {',
      '        doSomething();',
      '      }',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Indentation structure should be preserved (not flattened by trim)
    expect(result.code).toContain('if (condition) {');
    expect(result.code).toContain('  doSomething();');
    expect(result.code).toContain('}');
  });

  // ── New features ──────────────────────────────────────────────────

  test('Feature #7: conditional rendering', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  state name=loading initial=true',
      '  conditional if={{ loading }}',
      '    spinner message="Loading..."',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('{loading && (');
    expect(result.code).toContain('<>');
    expect(result.code).toContain('<Spinner');
    expect(result.code).toContain('</>');
  });

  test('Feature #8: logic blocks generate useEffect', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  logic <<<',
      '    const timer = setInterval(() => tick(), 1000);',
      '    return () => clearInterval(timer);',
      '  >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('useEffect(() => {');
    expect(result.code).toContain('setInterval');
    expect(result.code).toContain('clearInterval');
  });

  test('Feature #9: component props from screen attributes', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = 'screen name=MyScreen props="onExit:() => void, title:string"\n  text value="Hello"';
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('function MyScreen(');
    expect(result.code).toContain('onExit');
    expect(result.code).toContain('title');
  });

  test('Feature #10: ref nodes generate useRef', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = ['screen name=Test', '  ref name=timer initial=null', '  text value="Timer app"'].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('useRef');
    expect(result.code).toContain('const timerRef = useRef(null)');
  });

  test('Feature #11: callback nodes generate useCallback', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  callback name=handleSubmit params="value:string" deps=onSubmit',
      '    handler <<<',
      '      onSubmit(value);',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('useCallback');
    expect(result.code).toContain('const handleSubmit = useCallback((value:string) => {');
    expect(result.code).toContain('onSubmit(value)');
    expect(result.code).toContain('}, [onSubmit])');
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
