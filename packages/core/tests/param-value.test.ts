/** Slice 3c — `param.value` ValueIR-canonicalised native fn parameter default.
 *
 * Slice 1j: const.value, 3a: let.value, 3b: field.value. Slice 3c extends the
 * same pattern to fn/method/constructor parameter defaults via structured
 * `param` child nodes. The legacy `params="..."` string with embedded defaults
 * stays supported for back-compat. When both forms are present on the same
 * node, structured children win (canonical). The `default=` rawExpr
 * passthrough stays on the `param` node for back-compat with MCP usage and
 * for callers that need to opt out of canonicalisation. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode } from '../src/codegen-core.js';
import { decompile } from '../src/decompiler.js';
import { importTypeScript } from '../src/importer.js';
import { parse } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

function gen(kern: string): string {
  return generateCoreNode(parse(kern)).join('\n');
}

describe('param.value — slice 3c (native ValueIR form)', () => {
  describe('fn parameter defaults via emitConstValue', () => {
    it('bare numeric value passes through ValueIR canonicalisation', () => {
      const code = gen(
        [
          'fn name=retry returns=number',
          '  param name=attempts type=number value=3',
          '  handler <<<',
          '    return attempts;',
          '  >>>',
        ].join('\n'),
      );
      expect(code).toContain('function retry(attempts: number = 3): number {');
    });

    it('bare expression value canonicalises through ValueIR', () => {
      const code = gen(
        [
          'fn name=stamp returns=number',
          '  param name=ts type=number value=Date.now',
          '  handler <<<',
          '    return ts;',
          '  >>>',
        ].join('\n'),
      );
      expect(code).toContain('function stamp(ts: number = Date.now): number {');
    });

    it('{{ expr }} ExprObject form is emitted raw (escape hatch)', () => {
      const node = mk('fn', { name: 'stamp', returns: 'number' }, [
        mk('param', { name: 'ts', type: 'number', value: { __expr: true, code: 'Date.now()' } }),
        mk('handler', { code: 'return ts;' }),
      ]);
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('function stamp(ts: number = Date.now()): number {');
    });

    it('quoted-string value emits as JSON literal', () => {
      const node: IRNode = {
        type: 'fn',
        props: { name: 'greet', returns: 'string' },
        children: [
          {
            type: 'param',
            props: { name: 'name', type: 'string', value: 'world' },
            children: [],
            __quotedProps: ['value'],
          },
          mk('handler', { code: 'return name;' }),
        ],
      };
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('function greet(name: string = "world"): string {');
    });

    it('multiple params: mixed default-having and default-less', () => {
      const code = gen(
        [
          'fn name=load returns=string',
          '  param name=id type=string',
          '  param name=retries type=number value=3',
          '  handler <<<',
          '    return id;',
          '  >>>',
        ].join('\n'),
      );
      expect(code).toContain('function load(id: string, retries: number = 3): string {');
    });

    it('param without value emits name: type only', () => {
      const code = gen(
        ['fn name=load returns=string', '  param name=id type=string', '  handler <<<', '    return id;', '  >>>'].join(
          '\n',
        ),
      );
      expect(code).toContain('function load(id: string): string {');
    });

    it('param without type emits name only', () => {
      const code = gen(
        ['fn name=stamp returns=number', '  param name=ts', '  handler <<<', '    return 1;', '  >>>'].join('\n'),
      );
      expect(code).toContain('function stamp(ts): number {');
    });
  });

  describe('method/constructor/setter parameter defaults', () => {
    it('method param with value canonicalises through emitConstValue', () => {
      const code = gen(
        [
          'service name=Loader',
          '  method name=fetch returns=string',
          '    param name=id type=string',
          '    param name=retries type=number value=3',
          '    handler <<<',
          '      return id;',
          '    >>>',
        ].join('\n'),
      );
      expect(code).toContain('fetch(id: string, retries: number = 3): string {');
    });

    it('constructor param with value canonicalises', () => {
      const code = gen(
        [
          'service name=Cache',
          '  constructor',
          '    param name=size type=number value=100',
          '    handler <<<',
          '      this.size = size;',
          '    >>>',
        ].join('\n'),
      );
      expect(code).toContain('constructor(size: number = 100) {');
    });

    it('setter param routed through emitParamList', () => {
      const code = gen(
        [
          'class name=Gauge',
          '  setter name=v',
          '    param name=value type=number',
          '    handler <<<',
          '      this._v = value;',
          '    >>>',
        ].join('\n'),
      );
      expect(code).toContain('set v(value: number) {');
    });
  });

  describe('default= rawExpr passthrough (back-compat)', () => {
    it('default= still works for legacy callers', () => {
      const node = mk('fn', { name: 'retry', returns: 'number' }, [
        mk('param', { name: 'attempts', type: 'number', default: '3' }),
        mk('handler', { code: 'return attempts;' }),
      ]);
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('function retry(attempts: number = 3): number {');
    });

    it('value= wins when both value and default are set', () => {
      const node = mk('fn', { name: 'retry', returns: 'number' }, [
        mk('param', { name: 'attempts', type: 'number', value: '7', default: '3' }),
        mk('handler', { code: 'return attempts;' }),
      ]);
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('function retry(attempts: number = 7): number {');
      expect(code).not.toContain('= 3');
    });

    it('default= as ExprObject emits raw', () => {
      const node = mk('fn', { name: 'stamp', returns: 'number' }, [
        mk('param', { name: 'ts', type: 'number', default: { __expr: true, code: 'Date.now()' } }),
        mk('handler', { code: 'return ts;' }),
      ]);
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('function stamp(ts: number = Date.now()): number {');
    });
  });

  describe('legacy params= back-compat', () => {
    it('legacy params="..." string still emits correctly', () => {
      const code = gen(
        [
          'fn name=load params="id:string,retries:number=3" returns=string',
          '  handler <<<',
          '    return id;',
          '  >>>',
        ].join('\n'),
      );
      expect(code).toContain('function load(id: string, retries: number = 3): string {');
    });

    it('structured param children win over legacy params= string', () => {
      // When both are authored, children take precedence (canonical form).
      const node: IRNode = {
        type: 'fn',
        props: { name: 'load', params: 'id:string,retries:number=3', returns: 'string' },
        children: [
          mk('param', { name: 'name', type: 'string', value: 'world' }),
          mk('handler', { code: 'return name;' }),
        ],
      };
      const code = generateCoreNode(node).join('\n');
      // Only the structured-form params are emitted; legacy is ignored.
      expect(code).toContain('function load(name: string = world): string {');
      expect(code).not.toContain('id: string');
      expect(code).not.toContain('retries: number = 3');
    });
  });

  describe('Codex-hold guards (mirror slice 3a/3b)', () => {
    it('quoted empty-string value emits `param: T = ""` (not absent)', () => {
      const node: IRNode = {
        type: 'fn',
        props: { name: 'greet', returns: 'string' },
        children: [
          {
            type: 'param',
            props: { name: 'name', type: 'string', value: '' },
            children: [],
            __quotedProps: ['value'],
          },
          mk('handler', { code: 'return name;' }),
        ],
      };
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('function greet(name: string = ""): string {');
    });

    it('unquoted-empty value= falls through to default= (no broken `name: T = ;`)', () => {
      // This mirrors slice 3a/3b's gate. Without the gate, parseExpression('')
      // throws and falls back to '' → invalid TS.
      const node: IRNode = {
        type: 'fn',
        props: { name: 'retry', returns: 'number' },
        children: [
          mk('param', { name: 'attempts', type: 'number', value: '', default: '3' }),
          mk('handler', { code: 'return attempts;' }),
        ],
      };
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('function retry(attempts: number = 3): number {');
      expect(code).not.toMatch(/attempts:\s*number\s*=\s*;/);
    });

    it('unquoted-empty value= with no default falls through to no init', () => {
      const node: IRNode = {
        type: 'fn',
        props: { name: 'load', returns: 'string' },
        children: [mk('param', { name: 'id', type: 'string', value: '' }), mk('handler', { code: 'return id;' })],
      };
      const code = generateCoreNode(node).join('\n');
      expect(code).toContain('function load(id: string): string {');
      expect(code).not.toMatch(/id:\s*string\s*=\s*;/);
    });
  });

  describe('overload signatures strip defaults', () => {
    it('overload params drop `=default` per TS rules', () => {
      // TS forbids parameter initializers in overload signatures — only the
      // implementation may carry defaults. emitParamList honours stripDefaults.
      const code = gen(
        [
          'fn name=retry returns=number',
          '  overload returns=number',
          '    param name=attempts type=number value=3',
          '  param name=attempts type=number value=3',
          '  handler <<<',
          '    return attempts;',
          '  >>>',
        ].join('\n'),
      );
      // Overload signature: no default
      expect(code).toContain('function retry(attempts: number): number;');
      // Implementation: default present
      expect(code).toContain('function retry(attempts: number = 3): number {');
    });
  });

  describe('decompiler round-trip', () => {
    // NOTE: `fn` nodes themselves use the generic decompiler shape (not a
    // canonical renderFn — out of slice 3c scope). These tests verify the
    // `param` child renders re-parseably, which is the slice 3c contract.

    it('decompiler emits canonical param child shape', () => {
      const node: IRNode = {
        type: 'param',
        props: { name: 'attempts', type: 'number', value: '3' },
        children: [],
      };
      const { code } = decompile(node);
      expect(code).toContain('param name=attempts');
      expect(code).toContain('type=number');
      expect(code).toContain('value=3');
    });

    it('decompiler emits {{...}} for ExprObject value (preserves escape hatch)', () => {
      const node: IRNode = {
        type: 'param',
        props: { name: 'ts', type: 'number', value: { __expr: true, code: 'Date.now()' } },
        children: [],
      };
      const { code } = decompile(node);
      expect(code).toContain('value={{Date.now()}}');
    });

    it('decompiler honours __quotedProps (round-trip bare vs quoted)', () => {
      // Bare value=3 round-trips bare; quoted value="3" round-trips quoted.
      const bare: IRNode = {
        type: 'param',
        props: { name: 'n', type: 'number', value: '3' },
        children: [],
      };
      const quoted: IRNode = {
        type: 'param',
        props: { name: 's', type: 'string', value: 'world' },
        children: [],
        __quotedProps: ['value'],
      };
      expect(decompile(bare).code).toContain('value=3');
      expect(decompile(quoted).code).toContain('value="world"');
    });

    it('renderParam emits union/object types as quoted (Codex hold #2 mirror)', () => {
      // Mirrors slice 3b — types like "string|number" or "{a:T}" must be
      // JSON-quoted for round-trip safety, not bare-emitted.
      const node: IRNode = {
        type: 'param',
        props: { name: 'kind', type: "'draft'|'done'" },
        children: [],
        __quotedProps: ['type'],
      };
      const { code } = decompile(node);
      expect(code).toContain(`type="'draft'|'done'"`);
    });
  });

  describe('capability matrix', () => {
    it('param-native-value is native on TS targets', () => {
      expect(capabilitySupport('lib', 'param-native-value', 'top-level')).toBe('native');
    });

    it('param-native-value is unsupported on Python (FastAPI)', () => {
      expect(capabilitySupport('fastapi', 'param-native-value', 'top-level')).toBe('unsupported');
    });
  });

  // ─── Slice 3c-extension: optional `?` on param ─────────────────────────

  describe('optional=true (slice 3c-extension)', () => {
    it('emits `name?: type` when optional=true', () => {
      const code = gen(
        [
          'fn name=greet returns=string',
          '  param name=salutation type=string optional=true',
          '  handler <<<',
          '    return salutation ?? "hi";',
          '  >>>',
        ].join('\n'),
      );
      expect(code).toContain('function greet(salutation?: string): string {');
    });

    it('combines optional and value=', () => {
      const code = gen(
        [
          'fn name=retry returns=number',
          '  param name=attempts type=number optional=true value=3',
          '  handler <<<',
          '    return attempts ?? 0;',
          '  >>>',
        ].join('\n'),
      );
      expect(code).toContain('function retry(attempts?: number = 3): number {');
    });

    it('does NOT emit `?` when optional is false or absent', () => {
      const code = gen(
        [
          'fn name=greet returns=string',
          '  param name=salutation type=string',
          '  handler <<<',
          '    return salutation;',
          '  >>>',
        ].join('\n'),
      );
      expect(code).toContain('function greet(salutation: string): string {');
      expect(code).not.toContain('salutation?:');
    });

    it('importer captures optional `?` and emits structured param children', () => {
      const ts = `function greet(salutation?: string): string { return salutation ?? "hi"; }`;
      const result = importTypeScript(ts, 'greet.ts');
      expect(result.kern).toContain('optional=true');
      expect(result.kern).toContain('param name=salutation');
      // Verifies the questionToken gate dropped — fn now emits structured
      // children instead of falling back to legacy params="...".
      expect(result.kern).not.toMatch(/params=/);
    });

    it('importer combines optional + default value', () => {
      const ts = `function retry(attempts: number = 3): number { return attempts; }`;
      const result = importTypeScript(ts, 'retry.ts');
      // Plain default (no `?`) — exists pre-extension, included for parity.
      expect(result.kern).toContain('param name=attempts');
      expect(result.kern).toContain('value={{ 3 }}');

      const tsOpt = `function tryGet(key?: string): string | undefined { return key; }`;
      const optResult = importTypeScript(tsOpt, 'try.ts');
      expect(optResult.kern).toContain('param name=key');
      expect(optResult.kern).toContain('optional=true');
    });

    it('decompiler round-trips optional=true', () => {
      const node: IRNode = {
        type: 'param',
        props: { name: 'salutation', type: 'string', optional: true },
        children: [],
        __quotedProps: ['type'],
      };
      const { code } = decompile(node);
      expect(code).toContain('optional=true');
      expect(code).toContain('param name=salutation');
    });
  });

  // ─── Slice 3c-extension: variadic `...` on param ────────────────────────

  describe('variadic=true (slice 3c-extension)', () => {
    it('emits `...name: type` when variadic=true', () => {
      const code = gen(
        [
          'fn name=concat returns=string',
          '  param name=parts type="string[]" variadic=true',
          '  handler <<<',
          '    return parts.join(",");',
          '  >>>',
        ].join('\n'),
      );
      expect(code).toContain('function concat(...parts: string[]): string {');
    });

    it('does NOT emit `...` when variadic is false or absent', () => {
      const code = gen(
        [
          'fn name=concat returns=string',
          '  param name=parts type="string[]"',
          '  handler <<<',
          '    return parts.join(",");',
          '  >>>',
        ].join('\n'),
      );
      expect(code).toContain('function concat(parts: string[]): string {');
      expect(code).not.toContain('...parts');
    });

    it('importer captures variadic `...` and emits structured param children', () => {
      const ts = `function concat(...parts: string[]): string { return parts.join(","); }`;
      const result = importTypeScript(ts, 'concat.ts');
      expect(result.kern).toContain('variadic=true');
      expect(result.kern).toContain('param name=parts');
      // Verifies the dotDotDotToken gate dropped — fn now emits structured
      // children instead of falling back to legacy params="...".
      expect(result.kern).not.toMatch(/params=/);
    });

    it('importer combines variadic with another leading param', () => {
      const ts = `function log(level: string, ...messages: string[]): void { console.log(level, messages); }`;
      const result = importTypeScript(ts, 'log.ts');
      expect(result.kern).toContain('param name=level');
      expect(result.kern).toContain('param name=messages');
      expect(result.kern).toContain('variadic=true');
      expect(result.kern).not.toMatch(/params=/);
    });

    it('decompiler round-trips variadic=true', () => {
      const node: IRNode = {
        type: 'param',
        props: { name: 'parts', type: 'string[]', variadic: true },
        children: [],
        __quotedProps: ['type'],
      };
      const { code } = decompile(node);
      expect(code).toContain('variadic=true');
      expect(code).toContain('param name=parts');
    });

    it('parses generated KERN back to the same param shape', () => {
      const original = [
        'fn name=concat returns=string',
        '  param name=parts type="string[]" variadic=true',
        '  handler <<<',
        '    return parts.join(",");',
        '  >>>',
      ].join('\n');
      const parsed = parse(original);
      // `parse()` unwraps the document for single top-level nodes, so the fn
      // is `parsed` itself. Boolean props parse as strings ("true").
      const paramNode = parsed.children?.find((c) => c.type === 'param');
      expect(parsed.type).toBe('fn');
      expect(paramNode?.props?.variadic).toBe('true');
    });
  });
});
