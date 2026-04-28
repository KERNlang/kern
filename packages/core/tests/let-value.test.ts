/** Slice 3a — `let.value` ValueIR-canonicalised native expression form.
 *
 * Slice 1j added native value forms to `const.value` (bare → ValueIR,
 * quoted → JSON.stringify, {{...}} → raw). Slice 3a extends the same
 * routing to `let.value` so iteration-scoped bindings can be authored
 * in native form rather than the rawExpr passthrough escape hatch.
 *
 * `expr=` remains supported as the rawExpr fallback for callers that
 * need to opt out of canonicalisation (e.g. a partial expression that
 * the parser cannot accept). One of `value` or `expr` must be present. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode } from '../src/codegen-core.js';
import { parse } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

/** Build a minimal screen tree that exercises a `let` child via the each-block
 * render path — the only context where `let` produces output today. */
function screenWithLet(letNode: IRNode, handlerBody = '<Text>{idx}</Text>'): IRNode {
  return mk('screen', { name: 'List', target: 'ink' }, [
    mk('prop', { name: 'items', type: 'Item[]' }),
    mk('render', {}, [mk('each', { name: 'f', in: 'items' }, [letNode, mk('handler', { code: handlerBody })])]),
  ]);
}

describe('let.value — slice 3a (native ValueIR form)', () => {
  describe('codegen via the each-block render path', () => {
    it('bare numeric value passes through ValueIR canonicalisation', () => {
      const screen = screenWithLet(mk('let', { name: 'idx', value: '42' }));
      const code = generateCoreNode(screen).join('\n');
      expect(code).toContain('const idx = 42;');
    });

    it('bare expression value canonicalises through ValueIR', () => {
      // user.name parses as a member-access ValueIR node and re-emits canonically.
      const screen = screenWithLet(mk('let', { name: 'who', value: 'user.name' }));
      const code = generateCoreNode(screen).join('\n');
      expect(code).toContain('const who = user.name;');
    });

    it('{{ expr }} ExprObject form is emitted raw (escape hatch)', () => {
      const screen = screenWithLet(
        mk('let', {
          name: 'computed',
          value: { __expr: true, code: 'a > b ? 1 : 2' },
        }),
      );
      const code = generateCoreNode(screen).join('\n');
      expect(code).toContain('const computed = a > b ? 1 : 2;');
    });

    it('quoted-string value (__quotedProps tracks "value") emits as JSON literal', () => {
      // The parser populates __quotedProps when the source had `value="..."`;
      // simulate that here so codegen JSON.stringifies the string.
      const node: IRNode = {
        type: 'let',
        props: { name: 'greeting', value: 'hello world' },
        children: [],
        __quotedProps: ['value'],
      };
      const screen = screenWithLet(node);
      const code = generateCoreNode(screen).join('\n');
      expect(code).toContain('const greeting = "hello world";');
    });
  });

  describe('back-compat with expr=', () => {
    it('expr= continues to work (raw passthrough)', () => {
      const screen = screenWithLet(mk('let', { name: 'idx', expr: 'start + __i' }));
      const code = generateCoreNode(screen).join('\n');
      expect(code).toContain('const idx = start + __i;');
    });

    it('value takes precedence when both are set', () => {
      const screen = screenWithLet(mk('let', { name: 'idx', value: '7', expr: 'ignored' }));
      const code = generateCoreNode(screen).join('\n');
      expect(code).toContain('const idx = 7;');
      expect(code).not.toContain('ignored');
    });

    it('throws when neither value nor expr is provided', () => {
      const screen = screenWithLet(mk('let', { name: 'idx' }));
      expect(() => generateCoreNode(screen)).toThrow(/let node requires a 'value' or 'expr' prop/);
    });
  });

  describe('schema parse round-trip', () => {
    it('parses `let name=idx value=42` without error', () => {
      const src = `screen name=List target=ink
  render
    each name=f in=items
      let name=idx value=42
      handler <<<
      <Text>{idx}</Text>
      >>>`;
      expect(() => parse(src)).not.toThrow();
    });

    it('parses `let value="quoted"` and codegens as quoted string', () => {
      const src = `screen name=L target=ink
  render
    each name=f in=items
      let name=greeting value="hello"
      handler <<<
      <Text>{greeting}</Text>
      >>>`;
      const code = generateCoreNode(parse(src)).join('\n');
      expect(code).toContain('const greeting = "hello";');
    });
  });

  describe('capability matrix', () => {
    it('let-native-value is native on TS targets', () => {
      expect(capabilitySupport('lib', 'let-native-value', 'top-level')).toBe('native');
    });
  });
});
