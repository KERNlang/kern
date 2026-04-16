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
    expect(result.code).toContain('export function Test()');
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

    expect(result.code).toContain("from '@inkjs/ui'");
    expect(result.code).toContain('Spinner');
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

  test('generates state as useState hooks with __inkSafe wrappers', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  state name=busy initial=false\n  state name=count initial=0');
    const result = transpileInk(ast);

    expect(result.code).toContain('useState');
    // Safe setters are default-on for Ink target
    expect(result.code).toContain('const [busy, _setBusyRaw] = useState(false)');
    expect(result.code).toContain('const setBusy = useMemo(() => __inkSafe(_setBusyRaw), [_setBusyRaw])');
    expect(result.code).toContain('const [count, _setCountRaw] = useState(0)');
    expect(result.code).toContain('const setCount = useMemo(() => __inkSafe(_setCountRaw), [_setCountRaw])');
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

    expect(result.code).toContain("from '@inkjs/ui'");
    expect(result.code).toContain('TextInput');
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

    expect(result.code).toContain('export function AgonTerminal()');
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

    // Should generate useInput hook with ref pattern for fresh closures
    expect(result.code).toContain('_inputHandlerRef');
    expect(result.code).toContain('useInput((input: string, key: any) => _inputHandlerRef.current(input, key))');
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

    expect(result.code).toContain('options={menuItems}');
    expect(result.code).toContain('onChange={handleSelect}');
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

  // ── Phase 1: Ink-safe setters & dispatch ──────────────────────────────

  test('state generates __inkSafe wrapper for setters', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  state name=busy initial=false\n  state name=count initial=0');
    const result = transpileInk(ast);

    // Should emit __inkSafe preamble once
    expect(result.code).toContain('function __inkSafe<T>');
    expect(result.code).toContain('setTimeout(() => setter(value), 0)');
    // Should wrap setters
    expect(result.code).toContain('const [busy, _setBusyRaw] = useState(false)');
    expect(result.code).toContain('const setBusy = useMemo(() => __inkSafe(_setBusyRaw), [_setBusyRaw])');
    expect(result.code).toContain('const [count, _setCountRaw] = useState(0)');
    expect(result.code).toContain('const setCount = useMemo(() => __inkSafe(_setCountRaw), [_setCountRaw])');
  });

  test('state with safe=false skips __inkSafe wrapper', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  state name=count initial=0 safe=false');
    const result = transpileInk(ast);

    // Should NOT wrap setter
    expect(result.code).toContain('const [count, setCount] = useState(0)');
    expect(result.code).not.toContain('_setCountRaw');
    // Should NOT emit __inkSafe since no state needs it
    expect(result.code).not.toContain('function __inkSafe');
  });

  test('machine generates wrapped dispatch in useReducer hook', async () => {
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

    // Should wrap dispatch with setTimeout
    expect(result.code).toContain('_rawDispatch');
    expect(result.code).toContain('setTimeout(() => _rawDispatch(action), 0)');
    // Should still have the reducer hook
    expect(result.code).toContain('useReducer');
    expect(result.code).toContain('function useAppReducer');
  });

  test('logic with setInterval auto-generates clearInterval cleanup', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  state name=tick initial=0',
      '  logic <<<',
      '    const id = setInterval(() => setTick(t => t + 1), 1000);',
      '  >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('useEffect(() => {');
    expect(result.code).toContain('setInterval');
    // Auto-cleanup should be injected
    expect(result.code).toContain('return () => { clearInterval(id); };');
  });

  test('logic with existing return cleanup does not duplicate', async () => {
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

    // Should keep existing cleanup
    expect(result.code).toContain('return () => clearInterval(timer)');
    // Should NOT inject a second cleanup
    const cleanupCount = (result.code.match(/clearInterval/g) || []).length;
    expect(cleanupCount).toBe(1);
  });

  test('__inkSafe emitted once even with multiple state nodes', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  state name=a initial=1',
      '  state name=b initial=2',
      '  state name=c initial=3',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // __inkSafe should appear exactly once as a function definition
    const preambleCount = (result.code.match(/function __inkSafe/g) || []).length;
    expect(preambleCount).toBe(1);
    // All three setters should be wrapped
    expect(result.code).toContain('const setA = useMemo(() => __inkSafe(_setARaw), [_setARaw])');
    expect(result.code).toContain('const setB = useMemo(() => __inkSafe(_setBRaw), [_setBRaw])');
    expect(result.code).toContain('const setC = useMemo(() => __inkSafe(_setCRaw), [_setCRaw])');
  });

  // ── batch=true: collapse N __inkSafe macrotasks into 1 paint cycle ──────

  test('on event=key without batch keeps per-setter __inkSafe (baseline, 2 macrotasks)', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Counter',
      '  state name=count initial=0',
      '  state name=tick initial=0',
      '  on event=key key=return',
      '    handler <<<',
      '      setCount(count + 1);',
      '      setTick(Date.now());',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Baseline: setters are emitted as the wrapped names, NOT wrapped in a shared setTimeout
    expect(result.code).toContain('setCount(count + 1)');
    expect(result.code).toContain('setTick(Date.now())');
    expect(result.code).not.toContain('_setCountRaw(count + 1)');
    expect(result.code).not.toContain('_setTickRaw(Date.now())');
  });

  test('on event=key with batch=true wraps body in single setTimeout and uses raw setters', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Counter',
      '  state name=count initial=0',
      '  state name=tick initial=0',
      '  on event=key key=return batch=true',
      '    handler <<<',
      '      setCount(count + 1);',
      '      setTick(Date.now());',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Should call the raw setters (bypassing __inkSafe)
    expect(result.code).toContain('_setCountRaw(count + 1)');
    expect(result.code).toContain('_setTickRaw(Date.now())');
    // Should NOT call the wrapped setters inside the handler body
    expect(result.code).not.toMatch(/=>\s*\{\s*\n\s*setCount\(count \+ 1\)/);
    // Should wrap the body in exactly one shared setTimeout
    const handlerBlock = result.code
      .split('_inputHandlerRef.current = (input: string, key: any) => {')[1]
      .split('useInput((input')[0];
    const setTimeoutCount = (handlerBlock.match(/setTimeout\s*\(/g) || []).length;
    expect(setTimeoutCount).toBe(1);
    // Should still preserve the key gate
    expect(handlerBlock).toContain('if (!(key.return)) return');
  });

  test('batch=true does not rewrite setters for state with safe=false', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Mixed',
      '  state name=count initial=0',
      '  state name=raw initial=0 safe=false',
      '  on event=key key=return batch=true',
      '    handler <<<',
      '      setCount(count + 1);',
      '      setRaw(0);',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // safe-wrapped state gets rewritten to its raw form
    expect(result.code).toContain('_setCountRaw(count + 1)');
    // safe=false state has no _setRawRaw — its setter is already the bare useState setter
    expect(result.code).toContain('setRaw(0)');
    expect(result.code).not.toContain('_setRawRaw');
  });

  test('batch=true does not rewrite throttled or debounced setters', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Stream',
      '  state name=text initial="" throttle=90',
      '  state name=count initial=0',
      '  on event=key key=return batch=true',
      '    handler <<<',
      '      setText("update");',
      '      setCount(count + 1);',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Throttled setter must keep its wrapper (it has its own scheduling)
    expect(result.code).toContain('setText("update")');
    expect(result.code).not.toContain('_setTextRaw("update")');
    // Safe setter still gets the raw rewrite
    expect(result.code).toContain('_setCountRaw(count + 1)');
  });

  test('batch=true does not rewrite member-access calls like form.setCount(...)', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Form',
      '  state name=count initial=0',
      '  on event=key key=return batch=true',
      '    handler <<<',
      '      setCount(count + 1);',
      '      form.setCount(99);',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Bare setter is rewritten
    expect(result.code).toContain('_setCountRaw(count + 1)');
    // Member access is NOT rewritten — preserves the user's intent
    expect(result.code).toContain('form.setCount(99)');
    expect(result.code).not.toContain('form._setCountRaw(99)');
  });

  test('batch=true rejects handlers containing setTimeout', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Bad',
      '  state name=count initial=0',
      '  on event=key key=return batch=true',
      '    handler <<<',
      '      setCount(1);',
      '      setTimeout(() => setCount(2), 100);',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    expect(() => transpileInk(ast)).toThrow(/batch=true handler.*contains 'setTimeout/);
  });

  test('batch=true rejects handlers containing await', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Bad',
      '  state name=count initial=0',
      '  on event=key key=return batch=true',
      '    handler <<<',
      '      setCount(1);',
      '      await fetch("/api");',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    expect(() => transpileInk(ast)).toThrow(/batch=true handler.*contains 'await/);
  });

  test('batch=true rejects handlers containing .then(', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Bad',
      '  state name=count initial=0',
      '  on event=key key=return batch=true',
      '    handler <<<',
      '      setCount(1);',
      '      Promise.resolve().then(() => setCount(2));',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    expect(() => transpileInk(ast)).toThrow(/batch=true handler.*contains '.then/);
  });

  // ── external=true: stable-reference state with auto-version tracking ──

  test('external=true emits version counter and bump callback', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Reg',
      '  state name=registry type=Registry initial="new Registry()" external=true',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Bare state hook (no __inkSafe wrap — user mutates in place)
    expect(result.code).toContain('const [registry, setRegistry] = useState<Registry>(() => new Registry())');
    // Hidden version counter
    expect(result.code).toContain('const [_registryVersion, _setRegistryVersionRaw] = useState<number>(0)');
    // Bump callback uses setTimeout to bridge Ink's microtask→macrotask gap
    expect(result.code).toContain('const bumpRegistry = useMemo(() => {');
    expect(result.code).toContain('return () => setTimeout(() => _setRegistryVersionRaw((v: number) => v + 1), 0)');
    // Touch the version so the binding is "used"
    expect(result.code).toContain('void _registryVersion;');
    // Should NOT emit __inkSafe wrap on the external state's setter
    expect(result.code).not.toContain('const setRegistry = useMemo(() => __inkSafe');
  });

  test('memo referencing an external state auto-receives the version dep', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Reg',
      '  state name=registry type=Registry initial="new Registry()" external=true',
      '  memo name=availableEngines deps="registry"',
      '    handler <<<',
      '      return registry.list();',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Auto-injection: memo deps array contains BOTH `registry` and `_registryVersion`
    expect(result.code).toContain('useMemo');
    expect(result.code).toMatch(
      /useMemo\(\(\) => \{[\s\S]*?return registry\.list\(\);[\s\S]*?\}, \[registry, _registryVersion\]\);/,
    );
  });

  test('memo deps auto-injection is idempotent when user lists version manually', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Reg',
      '  state name=registry type=Registry initial="new Registry()" external=true',
      '  memo name=available deps="registry, _registryVersion"',
      '    handler <<<',
      '      return registry.list();',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Should appear exactly once — no double `_registryVersion`
    const matches = result.code.match(/_registryVersion/g) || [];
    // Three occurrences expected: declaration, void touch, dep array
    expect(matches.length).toBe(3);
  });

  test('memo not referencing an external state gets no auto-injection', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Mixed',
      '  state name=registry type=Registry initial="new Registry()" external=true',
      '  state name=count initial=0',
      '  memo name=double deps="count"',
      '    handler <<<',
      '      return count * 2;',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // The `double` memo only depends on `count`, not on `registry`,
    // so it must not get `_registryVersion` injected.
    expect(result.code).toMatch(/useMemo\(\(\) => \{[\s\S]*?return count \* 2;[\s\S]*?\}, \[count\]\);/);
  });

  test('external=true throws when combined with throttle', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse(
      'screen name=Bad\n  state name=reg type=Registry initial="new Registry()" external=true throttle=100',
    );
    expect(() => transpileInk(ast)).toThrow(/external=true with throttle\/debounce/);
  });

  test('external=true throws when combined with debounce', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse(
      'screen name=Bad\n  state name=reg type=Registry initial="new Registry()" external=true debounce=200',
    );
    expect(() => transpileInk(ast)).toThrow(/external=true with throttle\/debounce/);
  });

  test('external=true throws when combined with safe=false', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse(
      'screen name=Bad\n  state name=reg type=Registry initial="new Registry()" external=true safe=false',
    );
    expect(() => transpileInk(ast)).toThrow(/external=true with safe=false/);
  });

  test('batch=true does not rewrite an external state setter (no _setRaw exists)', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Mixed',
      '  state name=registry type=Registry initial="new Registry()" external=true',
      '  state name=count initial=0',
      '  on event=key key=return batch=true',
      '    handler <<<',
      '      setRegistry(new Registry());',
      '      setCount(count + 1);',
      '    >>>',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // The full-replacement setter on the external state is left as-is —
    // there is no `_setRegistryRaw` to rewrite to.
    expect(result.code).toContain('setRegistry(new Registry())');
    expect(result.code).not.toContain('_setRegistryRaw');
    // Normal safe state still gets the rewrite
    expect(result.code).toContain('_setCountRaw(count + 1)');
  });

  test('derive node with explicit deps referencing external state auto-injects version', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=DerivedReg',
      '  state name=registry type=Registry initial="new Registry()" external=true',
      '  derive name=count expr={{ registry.list().length }} deps="registry"',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Derive's explicit deps should auto-receive `_registryVersion`
    expect(result.code).toMatch(
      /const count = useMemo\(\(\) => registry\.list\(\)\.length, \[registry, _registryVersion\]\);/,
    );
  });

  test('derive node with auto-detected deps referencing external state appends version', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=DerivedReg',
      '  state name=registry type=Registry initial="new Registry()" external=true',
      // no explicit deps — codegen auto-detects from the expression
      '  derive name=count expr={{ registry.list().length }}',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    // Auto-detect should produce [registry, _registryVersion]
    expect(result.code).toMatch(
      /const count = useMemo\(\(\) => registry\.list\(\)\.length, \[registry, _registryVersion\]\);/,
    );
  });

  // ── Phase 2: Throttle, Debounce, Animation, Derive ────────────────────

  test('state with throttle generates throttled setter', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  state name=streamText initial="" throttle=90');
    const result = transpileInk(ast);

    expect(result.code).toContain("const [streamText, _setStreamTextRaw] = useState('')");
    expect(result.code).toContain('const setStreamText = useMemo(() => {');
    expect(result.code).toContain('let _lastCall = 0');
    expect(result.code).toContain('elapsed >= 90');
    expect(result.code).toContain('setTimeout(() => _setStreamTextRaw(value), 0)');
    // Trailing edge: pending value + timer for last update in burst
    expect(result.code).toContain('_pendingValue = value');
    expect(result.code).toContain('_pendingTimer');
    // Should NOT use __inkSafe (throttle handles its own setTimeout)
    expect(result.code).not.toContain('__inkSafe');
  });

  test('state with debounce generates debounced setter', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  state name=query initial="" debounce=300');
    const result = transpileInk(ast);

    expect(result.code).toContain("const [query, _setQueryRaw] = useState('')");
    expect(result.code).toContain('const setQuery = useMemo(() => {');
    expect(result.code).toContain('let _timer');
    expect(result.code).toContain('clearTimeout(_timer)');
    expect(result.code).toContain('setTimeout(() => _setQueryRaw(value), 300)');
  });

  test('animation generates useEffect with setInterval and cleanup', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  state name=frame initial=0',
      '  animation name=frame interval=100 update="(prev) => (prev + 1) % 4"',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('useEffect');
    expect(result.code).toContain('const _animId = setInterval(() => {');
    expect(result.code).toContain('setFrame((prev) => (prev + 1) % 4)');
    expect(result.code).toContain('}, 100)');
    expect(result.code).toContain('return () => clearInterval(_animId)');
  });

  test('animation with active prop generates conditional effect', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  state name=frame initial=0',
      '  state name=loading initial=false',
      '  animation name=frame interval=100 update="(prev) => (prev + 1) % 4" active={{ loading }}',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('if (!(loading)) return');
    expect(result.code).toContain('setFrame((prev) => (prev + 1) % 4)');
    expect(result.code).toContain('[loading]');
  });

  test('derive in screen generates useMemo with auto-deps', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  state name=items initial=[]',
      '  state name=filter initial=""',
      '  derive name=filtered expr={{ items.filter(i => i.name.includes(filter)) }}',
      '  text value="Results"',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('useMemo');
    expect(result.code).toContain('const filtered = useMemo');
    expect(result.code).toContain('items.filter(i => i.name.includes(filter))');
    // Auto-deps should detect items and filter
    expect(result.code).toContain('[items, filter]');
    // derive should NOT appear as JSX
    expect(result.code).not.toContain('<derive');
  });

  // ── Phase 3: Ink API Surface + @inkjs/ui ──────────────────────────────

  test('focus node generates useFocus hook', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = 'screen name=Test\n  focus name=emailFocused autoFocus=true\n  text value="Email"';
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('useFocus');
    expect(result.code).toContain('const { isFocused: emailFocused } = useFocus({ autoFocus: true })');
    expect(result.code).not.toContain('<focus');
  });

  test('app-exit node generates useApp with exit effect', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = 'screen name=Test\n  app-exit on={{ complete }}\n  text value="Done"';
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('useApp');
    expect(result.code).toContain('const { exit } = useApp()');
    expect(result.code).toContain('if (complete) exit()');
    expect(result.code).not.toContain('<app-exit');
  });

  test('static-log generates Static component', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = ['screen name=Test', '  static-log items={{ logs }}', '    text value={{ item.message }}'].join(
      '\n',
    );
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('<Static items={logs}>');
    expect(result.code).toContain('(item: any) => (');
    expect(result.code).toContain('item.message');
  });

  test('newline generates Newline component', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  text value="Hello"\n  newline\n  text value="World"');
    const result = transpileInk(ast);

    expect(result.code).toContain('<Newline />');
    expect(result.code).toContain("from 'ink'");
  });

  test('multi-select generates @inkjs/ui MultiSelect', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  multi-select options={{ configOptions }} onChange=handleChange');
    const result = transpileInk(ast);

    expect(result.code).toContain("from '@inkjs/ui'");
    expect(result.code).toContain('<MultiSelect');
    expect(result.code).toContain('options={configOptions}');
    expect(result.code).toContain('onChange={handleChange}');
  });

  test('confirm-input generates @inkjs/ui ConfirmInput', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  confirm-input onConfirm=handleYes onCancel=handleNo');
    const result = transpileInk(ast);

    expect(result.code).toContain('<ConfirmInput');
    expect(result.code).toContain('onConfirm={handleYes}');
    expect(result.code).toContain('onCancel={handleNo}');
  });

  test('status-message generates @inkjs/ui StatusMessage', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  status-message variant="success"',
      '    text value="Deployment complete!"',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('<StatusMessage variant="success">');
    expect(result.code).toContain('Deployment complete!');
  });

  test('alert generates @inkjs/ui Alert', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  alert variant="warning" title="Caution"',
      '    text value="Cannot undo."',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('<Alert variant="warning" title="Caution">');
    expect(result.code).toContain('Cannot undo.');
  });

  test('spinner migrated to @inkjs/ui import', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  spinner message="Loading..."');
    const result = transpileInk(ast);

    expect(result.code).toContain("from '@inkjs/ui'");
    expect(result.code).toContain('Spinner');
    expect(result.code).not.toContain("from 'ink-spinner'");
  });

  test('text-input migrated to @inkjs/ui import', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  text-input placeholder="Type..."');
    const result = transpileInk(ast);

    expect(result.code).toContain("from '@inkjs/ui'");
    expect(result.code).toContain('TextInput');
    expect(result.code).not.toContain("from 'ink-text-input'");
  });

  test('select-input migrated to @inkjs/ui Select', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  select-input items={{ menuItems }} onSelect=handleSelect');
    const result = transpileInk(ast);

    expect(result.code).toContain("from '@inkjs/ui'");
    expect(result.code).toContain('Select');
    expect(result.code).toContain('<Select');
    expect(result.code).not.toContain("from 'ink-select-input'");
    expect(result.code).not.toContain('SelectInput');
  });

  // ── Phase 4: Layout & Composability ───────────────────────────────────

  test('layout-row generates Box with flexDirection=row', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = ['screen name=Test', '  layout-row gap=2', '    text value="Left"', '    text value="Right"'].join(
      '\n',
    );
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('flexDirection="row"');
    expect(result.code).toContain('gap={2}');
    expect(result.code).toContain('Left');
    expect(result.code).toContain('Right');
  });

  test('layout-stack generates vertical Box', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  layout-stack padding=1',
      '    text value="Header"',
      '    text value="Body"',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('flexDirection="column"');
    expect(result.code).toContain('padding={1}');
  });

  test('spacer generates empty Box with flexGrow=1', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  layout-row',
      '    text value="Left"',
      '    spacer',
      '    text value="Right"',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('<Box flexGrow={1} />');
  });

  test('screen-embed renders component invocation', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = ['screen name=App', '  screen-embed screen=Header title="Dashboard"', '  text value="Body"'].join(
      '\n',
    );
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('<Header title="Dashboard" />');
    expect(result.code).toContain('Body');
  });

  test('multiple screens generate all named exports by default', async () => {
    const { parseDocument } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Header props="title:string"',
      '  text value={{ title }}',
      '',
      'screen name=App',
      '  screen-embed screen=Header title="AGON"',
      '  text value="Body"',
    ].join('\n');
    const ast = parseDocument(source);
    const result = transpileInk(ast);

    // Both should be named exports (no default unless export=default)
    expect(result.code).toContain('export function Header(');
    expect(result.code).toContain('title');
    expect(result.code).toContain('export function App(');
    expect(result.code).not.toContain('export default');
    expect(result.code).toContain('<Header title="AGON" />');
  });

  // ── AGON-requested features ───────────────────────────────────────────

  test('stream mode=channel with dispatch generates async iteration + dispatch', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  state name=messages initial=[]',
      '  stream name=messages source=session.messages mode=channel dispatch=handleChunk',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('useEffect');
    expect(result.code).toContain('for await (const chunk of session.messages)');
    expect(result.code).toContain('handleChunk(chunk)');
    expect(result.code).toContain('abortController.abort()');
    expect(result.code).toContain('[session.messages]');
  });

  test('stream mode=channel without dispatch appends to state', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Test',
      '  state name=chunks initial=[]',
      '  stream name=chunks source=session.output mode=channel',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('for await (const chunk of session.output)');
    expect(result.code).toContain('setChunks(prev => [...prev, chunk])');
    expect(result.code).toContain('[session.output]');
  });

  test('screen-embed with from= generates cross-file import', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=App',
      '  screen-embed screen=SpinnerBlock from="./status.kern"',
      '  text value="Loading"',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    expect(result.code).toContain("import { SpinnerBlock } from './status.js'");
    expect(result.code).toContain('<SpinnerBlock />');
  });

  test('screen export=named generates named export instead of default', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=StatusBar export=named\n  text value="Status"');
    const result = transpileInk(ast);

    expect(result.code).toContain('export function StatusBar(');
    expect(result.code).not.toContain('export default');
  });

  test('secondary screen export=false omits export while keeping main screen exported', async () => {
    const { parseDocument } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=AgonTip export=false',
      '  text value="Tip"',
      '',
      'screen name=Main',
      '  text value="Main"',
      '  conditional if=true',
      '    screen-embed screen=AgonTip',
    ].join('\n');
    const ast = parseDocument(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('function AgonTip(');
    expect(result.code).not.toContain('export function AgonTip(');
    expect(result.code).toContain('export function Main(');
    expect(result.code).toContain('<AgonTip />');
  });

  test('memoized screen export=false omits re-export', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=StatusBar export=false memo=true\n  text value="Status"');
    const result = transpileInk(ast);

    expect(result.code).toContain('const StatusBar = React.memo(function StatusBar(');
    expect(result.code).not.toContain('export { StatusBar };');
    expect(result.code).not.toContain('export default { StatusBar };');
  });

  test('memoized screen export=default emits a valid default export binding', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=StatusBar export=default memo=true\n  text value="Status"');
    const result = transpileInk(ast);

    expect(result.code).toContain('const StatusBar = React.memo(function StatusBar(');
    expect(result.code).toContain('export default StatusBar;');
    expect(result.code).not.toContain('export default { StatusBar };');
  });

  test('memoized secondary screen export=default emits a valid default export binding', async () => {
    const { parseDocument } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=StatusBar export=default memo=true',
      '  text value="Status"',
      '',
      'screen name=Main',
      '  text value="Main"',
      '  conditional if=true',
      '    screen-embed screen=StatusBar',
    ].join('\n');
    const ast = parseDocument(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('const StatusBar = React.memo(function StatusBar(');
    expect(result.code).toContain('export default StatusBar;');
    expect(result.code).not.toContain('export default { StatusBar };');
  });

  test('secondary screen with export=default gets default export', async () => {
    const { parseDocument } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=Helper',
      '  text value="Helper"',
      '',
      'screen name=Main export=default',
      '  text value="Main"',
    ].join('\n');
    const ast = parseDocument(source);
    const result = transpileInk(ast);

    expect(result.code).toContain('export function Helper(');
    expect(result.code).toContain('export default function Main(');
  });

  test('secondary screen compiles all hooks (not just state)', async () => {
    const { parseDocument } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = [
      'screen name=StatusBar',
      '  state name=active initial=false',
      '  ref name=timer initial=null',
      '  logic <<<',
      '    const id = setInterval(() => tick(), 1000);',
      '  >>>',
      '  callback name=handleClick deps=active',
      '    handler <<<',
      '      setActive(!active);',
      '    >>>',
      '  text value="Status"',
      '',
      'screen name=App',
      '  text value="Main"',
    ].join('\n');
    const ast = parseDocument(source);
    const result = transpileInk(ast);

    // Secondary screen should have ALL hooks compiled, not just state
    expect(result.code).toContain('export function StatusBar(');
    expect(result.code).toContain('useState'); // state
    expect(result.code).toContain('useRef'); // ref
    expect(result.code).toContain('useEffect'); // logic
    expect(result.code).toContain('useCallback'); // callback
    expect(result.code).toContain('setInterval'); // logic body
    expect(result.code).toContain('clearInterval'); // auto-cleanup
    expect(result.code).toContain('handleClick'); // callback name
  });

  // ── Next.js parity features ───────────────────────────────────────────

  test('IIFE initial uses lazy useState initializer', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  state name=data initial="(() => computeDefault())()" type=Data safe=false');
    const result = transpileInk(ast);

    expect(result.code).toContain('useState<Data>(() =>');
    expect(result.code).toContain('computeDefault');
  });

  test('new Map() initial uses lazy useState initializer', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  state name=cache initial="new Map()" type="Map<string,any>" safe=false');
    const result = transpileInk(ast);

    expect(result.code).toContain('() => new Map()');
  });

  test('simple initial does NOT use lazy init', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=Test\n  state name=count initial=0 safe=false');
    const result = transpileInk(ast);

    expect(result.code).toContain('useState(0)');
    expect(result.code).not.toContain('() => 0');
  });

  test('generates entry-point artifact with render + waitUntilExit', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=MyApp\n  text value="Hello"');
    const result = transpileInk(ast);

    expect(result.artifacts).toBeDefined();
    const entry = result.artifacts!.find((a) => a.type === 'entry');
    expect(entry).toBeDefined();
    expect(entry!.path).toBe('index.tsx');
    expect(entry!.content).toContain('render(<MyApp />)');
    expect(entry!.content).toContain('waitUntilExit()');
    expect(entry!.content).toContain("import { MyApp } from './MyApp.js'");
  });

  test('multi-screen generates component artifacts', async () => {
    const { parseDocument } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const source = ['screen name=Header', '  text value="Header"', '', 'screen name=App', '  text value="App"'].join(
      '\n',
    );
    const ast = parseDocument(source);
    const result = transpileInk(ast);

    expect(result.artifacts).toBeDefined();
    expect(result.artifacts!.length).toBeGreaterThanOrEqual(2);
    const entry = result.artifacts!.find((a) => a.type === 'entry');
    expect(entry).toBeDefined();
    const components = result.artifacts!.filter((a) => a.type === 'component');
    expect(components.length).toBeGreaterThanOrEqual(1);
  });

  // ── React.memo support ────────────────────────────────────────────────

  test('screen memo=true wraps component in React.memo', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=SpinnerBlock memo=true\n  text value="Spinning"');
    const result = transpileInk(ast);

    expect(result.code).toContain('React.memo(function SpinnerBlock(');
    expect(result.code).toContain('export');
    expect(result.code).toContain('SpinnerBlock');
  });

  test('screen memo with custom comparator generates React.memo with second arg', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse(
      'screen name=StatusBar memo="{{ (prev, next) => prev.active === next.active }}" props="active:boolean"\n  text value="Status"',
    );
    const result = transpileInk(ast);

    expect(result.code).toContain('React.memo(function StatusBar(');
    expect(result.code).toContain('prev.active === next.active');
  });

  test('screen without memo generates normal function', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');
    const ast = parse('screen name=App\n  text value="Hello"');
    const result = transpileInk(ast);

    expect(result.code).not.toContain('React.memo');
    expect(result.code).toContain('export function App(');
  });
});
