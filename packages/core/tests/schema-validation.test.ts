/**
 * Tests for AST schema validation.
 * Verifies that validateSchema catches malformed ASTs before they reach codegen.
 */

import { parse } from '../src/parser.js';
import { validateSchema } from '../src/schema.js';

function validate(source: string) {
  const root = parse(source);
  return validateSchema(root);
}

describe('Schema Validation', () => {
  describe('required props', () => {
    it('passes valid interface', () => {
      const v = validate(['interface name=User', '  field name=id type=string'].join('\n'));
      expect(v).toHaveLength(0);
    });

    it('flags interface missing name', () => {
      const v = validate('interface extends=Base');
      expect(v.some((v) => v.message.includes("'interface' requires prop 'name'"))).toBe(true);
    });

    it('flags field missing name', () => {
      const v = validate(['interface name=User', '  field type=string'].join('\n'));
      expect(v.some((v) => v.message.includes("'field' requires prop 'name'"))).toBe(true);
    });

    it('passes valid machine', () => {
      const v = validate(
        ['machine name=Order', '  state name=pending', '  transition name=confirm from=pending to=confirmed'].join(
          '\n',
        ),
      );
      expect(v).toHaveLength(0);
    });

    it('flags transition missing from', () => {
      const v = validate(
        ['machine name=Order', '  state name=pending', '  transition name=confirm to=confirmed'].join('\n'),
      );
      expect(v.some((v) => v.message.includes("'transition' requires prop 'from'"))).toBe(true);
    });

    it('flags store missing required props', () => {
      const v = validate('store name=Plan');
      expect(v.some((v) => v.message.includes("requires prop 'path'"))).toBe(true);
      expect(v.some((v) => v.message.includes("requires prop 'key'"))).toBe(true);
      expect(v.some((v) => v.message.includes("requires prop 'model'"))).toBe(true);
    });

    it('flags import missing from', () => {
      const v = validate('import names="foo,bar"');
      expect(v.some((v) => v.message.includes("'import' requires prop 'from'"))).toBe(true);
    });

    it('passes valid import', () => {
      const v = validate('import from="./utils" names="add"');
      expect(v).toHaveLength(0);
    });

    it('flags assume missing evidence and fallback', () => {
      const v = validate('assume expr={{true}}');
      expect(v.some((v) => v.message.includes("requires prop 'evidence'"))).toBe(true);
      expect(v.some((v) => v.message.includes("requires prop 'fallback'"))).toBe(true);
    });

    it('passes valid guard', () => {
      const v = validate('guard name=check expr={{x > 0}}');
      expect(v).toHaveLength(0);
    });

    it('passes guard with kind (MCP security guard)', () => {
      const v = validate('guard type=sanitize param=query');
      expect(v).toHaveLength(0);
    });

    it('flags guard missing both expr and kind/type', () => {
      const v = validate('guard name=check');
      expect(v.some((v) => v.message.includes("'guard' requires either"))).toBe(true);
    });

    it('flags derive missing expr', () => {
      const v = validate('derive name=total');
      expect(v.some((v) => v.message.includes("requires prop 'expr'"))).toBe(true);
    });

    it('flags collect missing from', () => {
      const v = validate('collect name=items');
      expect(v.some((v) => v.message.includes("requires prop 'from'"))).toBe(true);
    });

    it('passes valid union', () => {
      const v = validate(
        ['union name=Shape discriminant=kind', '  variant name=circle', '    field name=r type=number'].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('flags union missing discriminant', () => {
      const v = validate('union name=Shape');
      expect(v.some((v) => v.message.includes("requires prop 'discriminant'"))).toBe(true);
    });
  });

  describe('allowed children', () => {
    it('flags wrong child type in interface', () => {
      const v = validate(['interface name=User', '  method name=foo'].join('\n'));
      expect(v.some((v) => v.message.includes("does not allow child type 'method'"))).toBe(true);
    });

    it('allows field in interface', () => {
      const v = validate(['interface name=User', '  field name=id type=string'].join('\n'));
      expect(v).toHaveLength(0);
    });

    it('allows handler as universal child', () => {
      // handler is a universal child allowed everywhere
      const v = validate(['fn name=foo', '  handler <<<return 1;>>>'].join('\n'));
      expect(v).toHaveLength(0);
    });

    it('flags wrong child in machine', () => {
      const v = validate(['machine name=Order', '  field name=x type=string'].join('\n'));
      expect(v.some((v) => v.message.includes("does not allow child type 'field'"))).toBe(true);
    });

    it('allows state and transition in machine', () => {
      const v = validate(
        ['machine name=Order', '  state name=pending', '  transition name=start from=pending to=running'].join('\n'),
      );
      expect(v).toHaveLength(0);
    });
  });

  describe('complex valid nodes', () => {
    it('passes valid service', () => {
      const v = validate(
        [
          'service name=Cache implements=Storage',
          '  field name=data type="Map<string,any>" private=true',
          '  method name=get params="key:string" returns=any',
          '    handler <<<return this.data.get(key);>>>',
          '  constructor params="size:number"',
          '    handler <<<this.data = new Map();>>>',
          '  singleton name=cache',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('passes valid event', () => {
      const v = validate(['event name=AppEvent', '  type name="user:login"', '  type name="user:logout"'].join('\n'));
      expect(v).toHaveLength(0);
    });

    it('passes valid config', () => {
      const v = validate(
        [
          'config name=Settings',
          '  field name=port type=number default=3000',
          '  field name=host type=string default=localhost',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('passes valid action', () => {
      const v = validate(
        ['action name=notify params="to:string" returns=void idempotent=true', '  handler <<<await send(to);>>>'].join(
          '\n',
        ),
      );
      expect(v).toHaveLength(0);
    });
  });

  describe('nodes without schemas pass silently', () => {
    it('screen nodes have no schema and pass', () => {
      const v = validate('screen name=Home');
      expect(v).toHaveLength(0);
    });

    it('text nodes pass', () => {
      const v = validate('text value="hello"');
      expect(v).toHaveLength(0);
    });
  });
});
