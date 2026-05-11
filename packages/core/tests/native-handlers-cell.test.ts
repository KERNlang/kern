/** Native KERN handler bodies — `cell` body-statement (slice C-cell-v3).
 *
 *  `cell name=count initial=0 type=number` lowers to a React `useState`
 *  destructure inside a `lang="kern"` handler body. Writes via `set name=X
 *  to=...` (explicit) or `assign target=X value=...` (auto-rewrites to the
 *  setter call). Cell must be a direct child of `handler lang="kern"` — the
 *  schema deliberately omits it from try/catch/finally/while/for/each
 *  allowedChildren to keep authors from accidentally violating React's
 *  Rules of Hooks. */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { parseDocumentWithDiagnostics } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: Array<{ type: string; props?: Record<string, unknown> }>): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: children.map((c) => ({ ...c, props: c.props ?? {} })),
  };
}

describe('cell body-statement — TS codegen', () => {
  test('lowers to useState destructure with type argument', () => {
    const handler = makeHandler([{ type: 'cell', props: { name: 'count', initial: '0', type: 'number' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('const [count, setCount] = useState<number>(0);');
  });

  test('lowers without type argument when type omitted', () => {
    const handler = makeHandler([{ type: 'cell', props: { name: 'count', initial: '0' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('const [count, setCount] = useState(0);');
  });

  test('lowers without initial to useState(undefined)', () => {
    const handler = makeHandler([{ type: 'cell', props: { name: 'value' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('const [value, setValue] = useState(undefined);');
  });

  test('capitalizes multi-character cell names correctly in setter', () => {
    const handler = makeHandler([{ type: 'cell', props: { name: 'isLoading', initial: 'false' } }]);
    expect(emitNativeKernBodyTS(handler)).toBe('const [isLoading, setIsLoading] = useState(false);');
  });

  test('set node lowers to setter call', () => {
    const handler = makeHandler([
      { type: 'cell', props: { name: 'count', initial: '0' } },
      { type: 'set', props: { name: 'count', to: 'count + 1' } },
    ]);
    expect(emitNativeKernBodyTS(handler)).toBe(
      ['const [count, setCount] = useState(0);', 'setCount(count + 1);'].join('\n'),
    );
  });

  test('assign target=cell auto-lowers to setter call (= op)', () => {
    const handler = makeHandler([
      { type: 'cell', props: { name: 'count', initial: '0' } },
      { type: 'assign', props: { target: 'count', value: '42' } },
    ]);
    expect(emitNativeKernBodyTS(handler)).toBe(['const [count, setCount] = useState(0);', 'setCount(42);'].join('\n'));
  });

  test('compound assign target=cell uses functional updater (React batching safe)', () => {
    const handler = makeHandler([
      { type: 'cell', props: { name: 'count', initial: '0' } },
      { type: 'assign', props: { target: 'count', op: '+=', value: '1' } },
    ]);
    expect(emitNativeKernBodyTS(handler)).toBe(
      ['const [count, setCount] = useState(0);', 'setCount((prev) => prev + 1);'].join('\n'),
    );
  });

  test('compound assign with `-=` op also uses functional updater', () => {
    const handler = makeHandler([
      { type: 'cell', props: { name: 'count', initial: '10' } },
      { type: 'assign', props: { target: 'count', op: '-=', value: '3' } },
    ]);
    expect(emitNativeKernBodyTS(handler)).toBe(
      ['const [count, setCount] = useState(10);', 'setCount((prev) => prev - 3);'].join('\n'),
    );
  });

  test('throws on missing name', () => {
    const handler = makeHandler([{ type: 'cell', props: { initial: '0' } }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/name/);
  });

  test('throws on duplicate cell name in same scope', () => {
    const handler = makeHandler([
      { type: 'cell', props: { name: 'count', initial: '0' } },
      { type: 'cell', props: { name: 'count', initial: '1' } },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/already declared/);
  });

  test('throws on `set` with missing `to`', () => {
    const handler = makeHandler([
      { type: 'cell', props: { name: 'count', initial: '0' } },
      { type: 'set', props: { name: 'count' } },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/to=/);
  });

  test('throws on propagation `?` inside set', () => {
    const handler = makeHandler([
      { type: 'cell', props: { name: 'count', initial: '0' } },
      { type: 'set', props: { name: 'count', to: 'load()?' } },
    ]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/[Pp]ropagation/);
  });

  test('composes with let + return', () => {
    const handler = makeHandler([
      { type: 'cell', props: { name: 'count', initial: '0', type: 'number' } },
      { type: 'let', props: { name: 'doubled', value: 'count * 2' } },
      { type: 'return', props: { value: 'doubled' } },
    ]);
    expect(emitNativeKernBodyTS(handler)).toBe(
      ['const [count, setCount] = useState<number>(0);', 'const doubled = count * 2;', 'return doubled;'].join('\n'),
    );
  });
});

describe('cell body-statement — parser + validator', () => {
  test('valid inside handler lang="kern"', () => {
    const src = ['fn name=Counter', '  handler lang="kern"', '    cell name=count initial=0 type=number'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  test('rejected outside native-body scope', () => {
    const src = ['fn name=ok', '  cell name=count initial=0'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const errs = diagnostics.filter(
      (d) => d.severity === 'error' && d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER',
    );
    expect(errs.length).toBeGreaterThan(0);
  });

  test('set inside `on` event block remains valid (regression — must coexist with body-stmt set)', () => {
    const src = [
      'screen name=Counter',
      '  state name=count initial=0',
      '  render',
      '    on event=click',
      '      set name=count to="count + 1"',
    ].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const errs = diagnostics.filter((d) => d.severity === 'error');
    expect(errs).toHaveLength(0);
  });

  test('set inside body-stmt handler lang="kern" is valid (body-stmt form)', () => {
    const src = [
      'fn name=increment',
      '  handler lang="kern"',
      '    cell name=count initial=0',
      '    set name=count to="count + 1"',
    ].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const errs = diagnostics.filter((d) => d.severity === 'error');
    expect(errs).toHaveLength(0);
  });

  test('set outside on AND outside handler lang="kern" is rejected', () => {
    const src = ['fn name=bad', '  set name=count to="1"'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const errs = diagnostics.filter(
      (d) => d.severity === 'error' && d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER',
    );
    expect(errs.length).toBeGreaterThan(0);
  });

  test('cell inside `if` is rejected (Rules of Hooks)', () => {
    const src = [
      'fn name=Counter',
      '  handler lang="kern"',
      '    if cond="show"',
      '      cell name=count initial=0',
    ].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const errs = diagnostics.filter((d) => d.severity === 'error' && d.code === 'CELL_OUTSIDE_HANDLER_TOP_LEVEL');
    expect(errs.length).toBeGreaterThan(0);
  });

  test('cell inside `try` is rejected (Rules of Hooks)', () => {
    const src = [
      'fn name=Counter',
      '  handler lang="kern"',
      '    try',
      '      cell name=count initial=0',
      '      catch name=e',
      '        return',
    ].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    // Either CELL_OUTSIDE_HANDLER_TOP_LEVEL (from validator) or schema-level
    // allowedChildren rejection — both surface the issue.
    const errs = diagnostics.filter((d) => d.severity === 'error');
    expect(errs.length).toBeGreaterThan(0);
  });

  test('set inside `if` inside handler IS allowed (only cell DECLARATIONS need top-level)', () => {
    const src = [
      'fn name=Counter',
      '  handler lang="kern"',
      '    cell name=count initial=0',
      '    if cond="count > 10"',
      '      set name=count to="0"',
    ].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const errs = diagnostics.filter((d) => d.severity === 'error');
    expect(errs).toHaveLength(0);
  });

  test('round-trip: parse handler with cell + set + return through codegen', () => {
    const src = [
      'fn name=Counter returns=number',
      '  handler lang="kern"',
      '    cell name=count initial=0 type=number',
      '    return value="count"',
    ].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const fn = root.children?.find((c: IRNode) => c.type === 'fn' && c.props?.name === 'Counter');
    const handler = fn?.children?.find((c: IRNode) => c.type === 'handler' && c.props?.lang === 'kern');
    expect(handler).toBeDefined();
    expect(emitNativeKernBodyTS(handler as IRNode)).toBe(
      ['const [count, setCount] = useState<number>(0);', 'return count;'].join('\n'),
    );
  });
});
