/**
 * Tests for `conditional` inside render blocks — JSX-expression codegen path.
 *
 * Core-level `conditional` (wrap arbitrary children into `{cond && (<>...</>)}`)
 * is still covered by graduated-nodes.test.ts. This suite covers the JSX-context
 * behaviour added for PR 3:
 *   - `conditional` as a child of `render` emits `{cond && (...)}` around the
 *     handler JSX
 *   - `else` fallback turns the emission into `{cond ? (...) : (...)}`
 *   - `elseif` branches chain into nested ternaries before the (optional) else
 *   - handler bodies with `return (...);` wrappers are stripped so they compose
 */

import { generateCoreNode } from '../src/codegen-core.js';
import { parse } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

function screenWith(conditionalChildren: IRNode[]): IRNode {
  return mk('screen', { name: 'Gate', target: 'ink' }, [
    mk('prop', { name: 'loading', type: 'boolean' }),
    mk('prop', { name: 'error', type: 'string | null' }),
    mk('render', {}, conditionalChildren),
  ]);
}

describe('conditional inside render — JSX-expression codegen', () => {
  it('emits `{cond && (<then>)}` with no alternative branches', () => {
    const screen = screenWith([mk('conditional', { if: 'loading' }, [mk('handler', { code: '<Spinner />' })])]);
    const code = generateCoreNode(screen).join('\n');

    expect(code).toContain('{loading && (');
    expect(code).toContain('<Spinner />');
    expect(code).toContain(')}');
    // Still wrapped in the outer composed render fragment.
    expect(code).toContain('<>');
  });

  it('emits `{cond ? (<then>) : (<else>)}` when an `else` branch is present', () => {
    const screen = screenWith([
      mk('conditional', { if: 'loading' }, [
        mk('handler', { code: '<Spinner />' }),
        mk('else', {}, [mk('handler', { code: '<Content />' })]),
      ]),
    ]);
    const code = generateCoreNode(screen).join('\n');

    expect(code).toContain('{loading ? (');
    expect(code).toContain('<Spinner />');
    expect(code).toContain(') : (');
    expect(code).toContain('<Content />');
    expect(code).not.toContain('{loading && (');
  });

  it('chains `elseif` branches into nested ternaries before the else', () => {
    const screen = screenWith([
      mk('conditional', { if: 'loading' }, [
        mk('handler', { code: '<Spinner />' }),
        mk('elseif', { expr: 'error' }, [mk('handler', { code: '<Err msg={error} />' })]),
        mk('else', {}, [mk('handler', { code: '<Content />' })]),
      ]),
    ]);
    const code = generateCoreNode(screen).join('\n');

    expect(code).toContain('{loading ? (');
    expect(code).toContain('<Spinner />');
    expect(code).toContain(') : error ? (');
    expect(code).toContain('<Err msg={error} />');
    expect(code).toContain(') : (');
    expect(code).toContain('<Content />');
  });

  it('handles `elseif` with no `else` — falls back to null', () => {
    const screen = screenWith([
      mk('conditional', { if: 'loading' }, [
        mk('handler', { code: '<Spinner />' }),
        mk('elseif', { expr: 'error' }, [mk('handler', { code: '<Err />' })]),
      ]),
    ]);
    const code = generateCoreNode(screen).join('\n');

    expect(code).toContain('{loading ? (');
    expect(code).toContain(') : error ? (');
    expect(code).toContain('<Err />');
    expect(code).toContain(') : null}');
  });

  it('strips `return (<jsx>);` wrappers from branch handlers so they embed cleanly', () => {
    const screen = screenWith([
      mk('conditional', { if: 'loading' }, [
        mk('handler', { code: 'return (<Spinner />);' }),
        mk('else', {}, [mk('handler', { code: 'return (<Content />);' })]),
      ]),
    ]);
    const code = generateCoreNode(screen).join('\n');

    expect(code).toContain('<Spinner />');
    expect(code).toContain('<Content />');
    // Exactly one `return (` — the outer emitRenderComposed one. Branch bodies
    // must not carry their own return statement inside the fragment.
    expect(code.match(/return\s*\(/g)?.length).toBe(1);
  });

  it('composes with a sibling `each` inside the same render block', () => {
    const screen = mk('screen', { name: 'List', target: 'ink' }, [
      mk('prop', { name: 'loading', type: 'boolean' }),
      mk('prop', { name: 'files', type: 'FileEntry[]' }),
      mk('render', {}, [
        mk('conditional', { if: 'loading' }, [mk('handler', { code: '<Spinner />' })]),
        mk('each', { name: 'f', in: 'files' }, [mk('handler', { code: '<Text>{f.path}</Text>' })]),
      ]),
    ]);
    const code = generateCoreNode(screen).join('\n');

    expect(code).toContain('{loading && (');
    expect(code).toContain('(files).map((f, __i) =>');
    expect(code).toContain('<Spinner />');
    expect(code).toContain('<Text>{f.path}</Text>');
  });

  it('throws when the `then` handler is missing', () => {
    const screen = screenWith([mk('conditional', { if: 'loading' }, [])]);
    expect(() => generateCoreNode(screen)).toThrow(/conditional .* requires a `handler/);
  });

  it('throws when an `elseif` is missing its `expr` prop', () => {
    const screen = screenWith([
      mk('conditional', { if: 'loading' }, [
        mk('handler', { code: '<Spinner />' }),
        mk('elseif', {}, [mk('handler', { code: '<Err />' })]),
      ]),
    ]);
    expect(() => generateCoreNode(screen)).toThrow(/elseif .* requires an 'expr' prop/);
  });
});

describe('full pipeline — parse .kern source then generate TSX', () => {
  const source = [
    'screen name=Gate target=ink',
    '  prop name=loading type=boolean',
    '  prop name=error type="string | null"',
    '  render',
    '    conditional if=loading',
    '      handler <<<',
    '        <Spinner />',
    '      >>>',
    '      elseif expr=error',
    '        handler <<<',
    '          <Err msg={error} />',
    '        >>>',
    '      else',
    '        handler <<<',
    '          <Content />',
    '        >>>',
    '',
  ].join('\n');

  it('parses render → conditional → elseif/else shape', () => {
    const ast = parse(source);
    const screen = ast.type === 'screen' ? ast : ast.children?.find((c) => c.type === 'screen');
    expect(screen).toBeDefined();
    const render = (screen as IRNode).children?.find((c) => c.type === 'render');
    const cond = (render as IRNode).children?.find((c) => c.type === 'conditional');
    expect(cond).toBeDefined();
    expect((cond as IRNode).children?.some((c) => c.type === 'elseif')).toBe(true);
    expect((cond as IRNode).children?.some((c) => c.type === 'else')).toBe(true);
  });

  it('emits a ternary chain wrapping all three branches', () => {
    const ast = parse(source);
    const screen = ast.type === 'screen' ? ast : ast.children?.find((c) => c.type === 'screen');
    const code = generateCoreNode(screen as IRNode).join('\n');

    expect(code).toContain('function Gate({ loading, error }');
    expect(code).toContain('{loading ? (');
    expect(code).toContain('<Spinner />');
    expect(code).toContain(') : error ? (');
    expect(code).toContain('<Err msg={error} />');
    expect(code).toContain(') : (');
    expect(code).toContain('<Content />');
  });
});
