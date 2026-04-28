/** Slice 3b — `field.value` ValueIR-canonicalised native field initializer.
 *
 * Slice 1j added native value forms to `const.value`; slice 3a extended the
 * same routing to `let.value`. Slice 3b applies the pattern to `field.value`
 * for class/service/config fields. The `default=` rawExpr passthrough stays
 * for back-compat with seeds that author bare-string defaults like
 * `default=plan` for string-typed config fields (where the legacy
 * type-aware coercion still applies). When both `value` and `default` are
 * present, `value` takes precedence. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode } from '../src/codegen-core.js';
import { decompile } from '../src/decompiler.js';
import { parse } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

function gen(kern: string): string {
  return generateCoreNode(parse(kern)).join('\n');
}

describe('field.value — slice 3b (native ValueIR form)', () => {
  describe('class field initializers via emitConstValue', () => {
    it('bare numeric value passes through ValueIR canonicalisation', () => {
      const code = gen('class name=Counter\n  field name=count type=number value=42');
      expect(code).toContain('count: number = 42;');
    });

    it('bare expression value canonicalises through ValueIR', () => {
      // `Date.now` parses as a member-access ValueIR node and re-emits canonically.
      const code = gen('class name=Stamp\n  field name=ts type=number value=Date.now');
      expect(code).toContain('ts: number = Date.now;');
    });

    it('{{ expr }} ExprObject form is emitted raw (escape hatch)', () => {
      const node = mk('class', { name: 'Stamp' }, [
        mk('field', {
          name: 'ts',
          type: 'number',
          value: { __expr: true, code: 'Date.now()' },
        }),
      ]);
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('ts: number = Date.now();');
    });

    it('quoted-string value (__quotedProps tracks "value") emits as JSON literal', () => {
      const node: IRNode = {
        type: 'class',
        props: { name: 'Greeter' },
        children: [
          {
            type: 'field',
            props: { name: 'greeting', type: 'string', value: 'hello world' },
            children: [],
            __quotedProps: ['value'],
          },
        ],
      };
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('greeting: string = "hello world";');
    });

    it('parsed `value="..."` round-trips as JSON literal', () => {
      const code = gen('class name=Greeter\n  field name=greeting type=string value="hello"');
      expect(code).toContain('greeting: string = "hello";');
    });

    it('private + readonly + static modifiers compose with value', () => {
      const code = gen('class name=Cfg\n  field name=MAX type=number private=true static=true readonly=true value=100');
      expect(code).toContain('private static readonly MAX: number = 100;');
    });
  });

  describe('config field defaults via emitConstValue', () => {
    it('bare numeric value emits in the DEFAULT_FOO object', () => {
      const code = gen('config name=Cfg\n  field name=timeout type=number value=120');
      expect(code).toContain('timeout?: number;');
      expect(code).toContain('timeout: 120,');
    });

    it('quoted-string value JSON-stringifies in the DEFAULT_FOO object', () => {
      const code = gen('config name=Cfg\n  field name=mode type=string value="plan"');
      expect(code).toContain('mode?: string;');
      expect(code).toContain('mode: "plan",');
    });

    it('expression value passes through raw', () => {
      const node = mk('config', { name: 'Cfg' }, [
        mk('field', {
          name: 'now',
          type: 'number',
          value: { __expr: true, code: 'Date.now()' },
        }),
      ]);
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('now?: number;');
      expect(code).toContain('now: Date.now(),');
    });
  });

  describe('back-compat with default=', () => {
    it('default= continues to work (raw passthrough on class fields)', () => {
      const code = gen('class name=Gauge\n  field name=_v type=number private=true default={{ 0 }}');
      expect(code).toContain('private _v: number = 0;');
    });

    it('default= continues to work on config (legacy heuristic, bare string-typed)', () => {
      const code = gen('config name=Cfg\n  field name=mode type=string default=plan');
      // Legacy heuristic wraps bare unquoted string-typed defaults in quotes.
      // emitStringLiteral uses single quotes — the slice 3a `value=` path
      // uses JSON.stringify (double quotes); both are valid TS.
      expect(code).toContain("mode: 'plan',");
    });

    it('value takes precedence when both are set', () => {
      const code = gen('class name=Gauge\n  field name=_v type=number value=7 default={{ 99 }}');
      expect(code).toContain('_v: number = 7;');
      expect(code).not.toContain('= 99');
    });

    it('config interface marks field optional when only default is set', () => {
      const code = gen('config name=Cfg\n  field name=timeout type=number default=120');
      expect(code).toContain('timeout?: number;');
    });

    it('config interface marks field optional when only value is set', () => {
      const code = gen('config name=Cfg\n  field name=timeout type=number value=120');
      expect(code).toContain('timeout?: number;');
    });
  });

  describe('empty-string handling (Codex-hold-from-3a + 3b guard)', () => {
    it('quoted `value=""` round-trips as the empty string literal (not absent)', () => {
      // Slice 3a Codex hold: `=== undefined` is the only "absent" marker.
      // A quoted empty string is a legal explicit value — JSON.stringify
      // emits it as `""` and the field gets an explicit empty initializer.
      const node: IRNode = {
        type: 'class',
        props: { name: 'Holder' },
        children: [
          {
            type: 'field',
            props: { name: 'x', type: 'string', value: '' },
            children: [],
            __quotedProps: ['value'],
          },
        ],
      };
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('x: string = "";');
    });

    it('parsed `field value=""` emits `= ""`', () => {
      const code = gen('class name=Holder\n  field name=x type=string value=""');
      expect(code).toContain('x: string = "";');
    });

    it('Codex-hold #1 (slice 3b): unquoted empty `value` is treated as absent on a class field', () => {
      // Without the guard, parseExpression('') throws and emitConstValue
      // returns '' — producing the invalid TS line `x: string = ;`. The
      // guard recognises that absence of __quotedProps means the user did
      // not explicitly type an empty string literal.
      const node: IRNode = {
        type: 'class',
        props: { name: 'Holder' },
        children: [
          {
            type: 'field',
            props: { name: 'x', type: 'string', value: '' },
            children: [],
            // Note: NO __quotedProps — this is the bug surface.
          },
        ],
      };
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('x: string;');
      expect(code).not.toContain('x: string = ;');
      expect(code).not.toContain('= "";');
    });

    it('Codex-hold #1 (slice 3b): unquoted empty `value` on a config field falls back to type-aware default', () => {
      // The DEFAULT_FOO object should produce a valid number default (`0`),
      // not an invalid `mode: ,` line.
      const node: IRNode = {
        type: 'config',
        props: { name: 'Cfg' },
        children: [
          {
            type: 'field',
            props: { name: 'timeout', type: 'number', value: '' },
            children: [],
            // No __quotedProps.
          },
        ],
      };
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('timeout: 0,');
      expect(code).not.toContain('timeout?: number;'); // unquoted-empty doesn't mark optional
      expect(code).toContain('timeout: number;');
    });
  });

  describe('round-trip via decompile', () => {
    // Decompile-then-reparse round-trip: the surrounding `class` header still
    // uses the generic debug serializer (canonical class rendering is a
    // separate slice), so we re-parse just the field line by splicing it into
    // a minimal class wrapper. That isolates renderField's contract:
    // parse → IR → decompile field → re-parse → identical codegen.
    function fieldRoundTripCode(field: IRNode): string {
      const decompiled = decompile(field).code;
      const wrapped = `class name=Wrap\n  ${decompiled}`;
      return generateCoreNode(parse(wrapped)).join('\n');
    }

    it('bare numeric value round-trips re-parseably', () => {
      const ir = parse('class name=C\n  field name=n type=number value=42');
      const fieldNode = (ir.children ?? [])[0] as IRNode;
      const reCode = fieldRoundTripCode(fieldNode);
      expect(reCode).toContain('n: number = 42;');
    });

    it('field with {{ expr }} value round-trips through decompile', () => {
      const fieldNode = mk('field', {
        name: 'now',
        type: 'number',
        value: { __expr: true, code: 'Date.now()' },
      });
      const text = decompile(fieldNode).code;
      // Generic JSON.stringify would emit `value={"__expr":true,...}`; renderField
      // emits `value={{Date.now()}}` — re-parseable.
      expect(text).toContain('value={{Date.now()}}');
      const reCode = fieldRoundTripCode(fieldNode);
      expect(reCode).toContain('now: number = Date.now();');
    });

    it('field with default={{ expr }} round-trips through decompile', () => {
      const fieldNode = mk('field', {
        name: 'x',
        type: 'number',
        default: { __expr: true, code: '0' },
      });
      const text = decompile(fieldNode).code;
      expect(text).toContain('default={{0}}');
      const reCode = fieldRoundTripCode(fieldNode);
      expect(reCode).toContain('x: number = 0;');
    });

    it('field decompile preserves modifier order: type, private, readonly, static, value', () => {
      const node = mk('class', { name: 'C' }, [
        mk('field', {
          name: 'MAX',
          type: 'number',
          private: 'true',
          readonly: 'true',
          static: 'true',
          value: '100',
        }),
      ]);
      const text = decompile(node).code;
      // Simple identifiers/literals (no whitespace, no `=`) round-trip bare
      // so that `value=100` keeps its numeric semantic on re-parse.
      expect(text).toContain('field name=MAX type=number private=true readonly=true static=true value=100');
    });

    it('whitespace in string props forces quotes on round-trip', () => {
      const node: IRNode = {
        type: 'class',
        props: { name: 'C' },
        children: [
          {
            type: 'field',
            props: { name: 'cache', type: 'Map<string, User>' },
            children: [],
          },
        ],
      };
      const text = decompile(node).code;
      expect(text).toContain('field name=cache type="Map<string, User>"');
    });

    it('Codex-hold #2: tokenizer-significant chars force quotes on round-trip', () => {
      // A type union containing `'literal'|'literal'` has no whitespace and
      // no `=`, but contains quote chars + `|`. The strict identifier
      // whitelist forces JSON.stringify so the parser can read it back.
      const node: IRNode = {
        type: 'class',
        props: { name: 'C' },
        children: [
          {
            type: 'field',
            props: { name: 'state', type: "'draft'|'done'" },
            children: [],
          },
        ],
      };
      const text = decompile(node).code;
      expect(text).toContain(`type=${JSON.stringify("'draft'|'done'")}`);
      // Re-parse must succeed (would have truncated at the embedded quote).
      const reCode = generateCoreNode(parse(`class name=Wrap\n  ${decompile(node.children?.[0] as IRNode).code}`)).join(
        '\n',
      );
      expect(reCode).toContain("state: 'draft'|'done';");
    });

    it('Codex-hold #2: object-shape type values force quotes (not parsed as a style block)', () => {
      const node: IRNode = {
        type: 'class',
        props: { name: 'C' },
        children: [
          {
            type: 'field',
            props: { name: 'meta', type: '{id:string}' },
            children: [],
          },
        ],
      };
      const text = decompile(node.children?.[0] as IRNode).code;
      expect(text).toContain(`type=${JSON.stringify('{id:string}')}`);
      // Re-parse: the field's `type` should still be the object shape, not
      // a style-block payload swallowed by the parser.
      const wrapped = `class name=Wrap\n  ${text}`;
      const ir = parse(wrapped);
      const fieldChild = (ir.children ?? [])[0] as IRNode;
      expect(fieldChild.props?.type).toBe('{id:string}');
    });

    it('quoted-source value re-emits quoted (preserves string-literal semantic)', () => {
      // Simulate a parsed `value="42"` — __quotedProps marks the prop as
      // originally-quoted so renderField re-emits with quotes.
      const node: IRNode = {
        type: 'class',
        props: { name: 'C' },
        children: [
          {
            type: 'field',
            props: { name: 'k', type: 'string', value: '42' },
            children: [],
            __quotedProps: ['value'],
          },
        ],
      };
      const text = decompile(node).code;
      expect(text).toContain('value="42"');
    });
  });

  describe('capability matrix', () => {
    it('field-native-value is native on TS targets', () => {
      expect(capabilitySupport('auto', 'field-native-value', 'top-level')).toBe('native');
      expect(capabilitySupport('lib', 'field-native-value', 'top-level')).toBe('native');
      expect(capabilitySupport('nextjs', 'field-native-value', 'top-level')).toBe('native');
    });

    it('field-native-value is unsupported on Python (fastapi)', () => {
      expect(capabilitySupport('fastapi', 'field-native-value', 'top-level')).toBe('unsupported');
    });
  });
});
