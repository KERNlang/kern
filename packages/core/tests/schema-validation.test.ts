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

    it('passes fmt binding form (name + template)', () => {
      const v = validate('fmt name=label template="${x}"');
      expect(v).toHaveLength(0);
    });

    it('passes fmt return form (return=true + template, no name)', () => {
      const v = validate('fmt return=true template="${ms}ms"');
      expect(v).toHaveLength(0);
    });

    it('accepts fmt without name/return=true (inline-JSX form — positional check is semantic)', () => {
      // Schema passes; `fmt-inline-must-be-inside-render` fires from the
      // semantic validator when the node is placed outside `render`/`group`.
      const v = validate('fmt template="${x}"');
      expect(v.some((v) => v.message.includes("'fmt' requires"))).toBe(false);
    });

    it('flags fmt with return=true AND a name prop', () => {
      const v = validate('fmt name=label return=true template="${x}"');
      expect(v.some((v) => v.message.includes("must not carry a 'name' prop"))).toBe(true);
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

    it('allows native structural expect assertions inside tests', () => {
      const v = validate(
        [
          'test name="Order invariants" target="./order.kern"',
          '  it name="reaches paid"',
          '    expect machine=Order reaches=paid via=confirm,capture',
          '  it name="declares capture transition"',
          '    expect machine=Order transition=capture from=confirmed to=paid guarded=true',
          '  it name="derive graph"',
          '    expect no=deriveCycles',
          '  it name="machine states stay live"',
          '    expect machine=Order no=deadStates',
          '  it name="guard covers payment variants"',
          '    expect guard=ChargeCard exhaustive=true over=Payment',
          '  it name="uses a preset"',
          '    expect preset=mcpSafety severity=warn',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('allows native behavioral expect assertions with scoped fixtures', () => {
      const v = validate(
        [
          'test name="Order behavior" target="./order.kern"',
          '  fixture name=paidOrder value={{({ items: [{ price: 20, qty: 2 }] })}}',
          '  describe name="totals"',
          '    fixture name=taxRate value=0.2',
          '    it name="calculates subtotal and tax"',
          '      expect fn=orderSubtotal with=paidOrder equals=40',
          '      expect fn=addTax args={{[orderSubtotal(paidOrder), taxRate]}} equals=48',
          '      expect derive=total equals=48',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('allows native effect mocks inside test cases', () => {
      const v = validate(
        [
          'test name="Effect behavior" target="./effects.kern"',
          '  it name="mocks effect boundary"',
          '    mock effect=fetchUsers returns={{users}}',
          '    expect effect=fetchUsers returns={{users}}',
          '  it name="mocks failures"',
          '    mock effect=fetchUsers throws=NetworkError',
          '    expect effect=fetchUsers throws=NetworkError',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('allows native mock call-count assertions', () => {
      const v = validate(
        [
          'test name="Effect behavior" target="./effects.kern"',
          '  it name="counts mocked effect calls"',
          '    mock effect=fetchUsers returns={{users}}',
          '    expect effect=fetchUsers returns={{users}}',
          '    expect mock=fetchUsers called=1',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('flags native effect mocks without behavior', () => {
      const v = validate(
        ['test name="Effect behavior"', '  it name="mocks effect boundary"', '    mock effect=fetchUsers'].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes("'mock' requires either returns"))).toBe(true);
    });

    it('flags native effect mocks that combine returns and throws', () => {
      const v = validate(
        [
          'test name="Effect behavior"',
          '  it name="mocks effect boundary"',
          '    mock effect=fetchUsers returns={{[]}} throws=NetworkError',
        ].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes("'mock' must not combine returns"))).toBe(true);
    });

    it('flags incomplete native mock call-count assertions', () => {
      const missingCalled = validate(
        [
          'test name="Effect behavior"',
          '  it name="missing called"',
          '    mock effect=fetchUsers returns={{[]}}',
          '    expect mock=fetchUsers',
        ].join('\n'),
      );
      const missingMock = validate(
        ['test name="Effect behavior"', '  it name="missing mock"', '    expect called=1'].join('\n'),
      );
      expect(
        missingCalled.some((violation) => violation.message.includes('require both mock=<effect> and called=<count>')),
      ).toBe(true);
      expect(
        missingMock.some((violation) => violation.message.includes('require both mock=<effect> and called=<count>')),
      ).toBe(true);
    });

    it('flags native mock call-count assertions with ignored result props', () => {
      const v = validate(
        [
          'test name="Effect behavior"',
          '  it name="ambiguous mock call"',
          '    mock effect=fetchUsers returns={{[]}}',
          '    expect mock=fetchUsers called=1 returns={{[]}}',
        ].join('\n'),
      );
      expect(
        v.some((violation) => violation.message.includes('mock call assertions cannot combine with runtime value')),
      ).toBe(true);
    });

    it('flags empty expect assertions', () => {
      const v = validate(['test name="Empty"', '  it name="does nothing"', '    expect'].join('\n'));
      expect(v.some((violation) => violation.message.includes("'expect' requires"))).toBe(true);
    });

    it('flags fixtures without a runtime value', () => {
      const v = validate(['test name="Fixture"', '  it name="missing value"', '    fixture name=order'].join('\n'));
      expect(v.some((violation) => violation.message.includes("'fixture' requires either value"))).toBe(true);
    });

    it('flags fixtures that combine value and expr', () => {
      const v = validate(
        [
          'test name="Fixture"',
          '  it name="ambiguous"',
          '    fixture name=order value={{({ id: "1" })}} expr={{({ id: "2" })}}',
        ].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes("'fixture' must not combine"))).toBe(true);
    });

    it('flags behavioral expect assertions that combine fn and derive', () => {
      const v = validate(
        ['test name="Behavior"', '  it name="ambiguous"', '    expect fn=total derive=total equals=3'].join('\n'),
      );
      expect(
        v.some((violation) =>
          violation.message.includes(
            'cannot combine fn=<name>, derive=<name>, route=<spec>, effect=<name>, and mock=<name>',
          ),
        ),
      ).toBe(true);
    });

    it('flags behavioral expect assertions that combine fn or derive with expr', () => {
      const v = validate(
        ['test name="Behavior"', '  it name="ambiguous"', '    expect fn=total expr={{total()}} equals=3'].join('\n'),
      );
      expect(
        v.some((violation) =>
          violation.message.includes('cannot combine fn/derive/route/effect/mock behavioral assertions'),
        ),
      ).toBe(true);
    });

    it('flags machine transition expect assertions without machine', () => {
      const v = validate(
        [
          'test name="Order"',
          '  it name="declares capture"',
          '    expect transition=capture from=confirmed to=paid',
        ].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes('require machine=<name>'))).toBe(true);
    });

    it('flags mixed transition and reachability expect assertions', () => {
      const v = validate(
        [
          'test name="Order"',
          '  it name="mixes transition and reachability"',
          '    expect machine=Order transition=capture reaches=paid',
        ].join('\n'),
      );
      expect(v.some((violation) => violation.message.includes('cannot combine machine transition'))).toBe(true);
    });

    it('allows helper core nodes in mcp', () => {
      const v = validate(
        [
          'mcp name=HelperServer',
          '  import from="node:fs" names=readFileSync',
          '  const name=DEFAULT_GREETING value="hello"',
          '  fn name=formatGreeting params="name:string" returns=string',
          '    handler <<<return `${DEFAULT_GREETING}, ${name}`;>>>',
          '  tool name=greet',
          '    param name=name type=string required=true',
        ].join('\n'),
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

  describe('Pareto schema coverage — new schemas', () => {
    it('passes valid cli with command, arg, flag', () => {
      const v = validate(
        [
          'cli name=myapp version=1.0.0',
          '  command name=deploy description="Deploy"',
          '    arg name=target type=string required=true',
          '    flag name=dry-run alias=n type=boolean',
          '    handler <<<deploy(target)>>>',
        ].join('\n'),
      );
      expect(v).toHaveLength(0);
    });

    it('flags cli missing name', () => {
      const v = validate('cli version=1.0');
      expect(v.some((v) => v.message.includes("'cli' requires prop 'name'"))).toBe(true);
    });

    it('flags command missing name', () => {
      const v = validate('command description="test"');
      expect(v.some((v) => v.message.includes("'command' requires prop 'name'"))).toBe(true);
    });

    it('flags spawn missing binary', () => {
      const v = validate('spawn args="[]"');
      expect(v.some((v) => v.message.includes("'spawn' requires prop 'binary'"))).toBe(true);
    });

    it('passes valid spawn', () => {
      const v = validate('spawn binary=ffmpeg args="[-i,input]" timeout=30');
      expect(v).toHaveLength(0);
    });

    it('flags fetch missing name', () => {
      const v = validate('fetch url="/api"');
      expect(v.some((v) => v.message.includes("'fetch' requires prop 'name'"))).toBe(true);
    });

    it('allows fetch without url when a handler body supplies the loader (GAP-009)', () => {
      const v = validate('fetch name=data\n  handler <<<return await loadRows()>>>');
      expect(v.some((violation) => violation.message.includes("'fetch' requires prop 'url'"))).toBe(false);
    });

    it('passes valid memo', () => {
      const v = validate('memo name=filtered deps="items"\n  handler <<<return items>>>');
      expect(v).toHaveLength(0);
    });

    it('flags memo missing name', () => {
      const v = validate('memo deps="items"');
      expect(v.some((v) => v.message.includes("'memo' requires prop 'name'"))).toBe(true);
    });

    it('passes valid column', () => {
      const v = validate('column name=email type=string unique=true');
      expect(v).toHaveLength(0);
    });

    it('flags column missing name', () => {
      const v = validate('column type=string');
      expect(v.some((v) => v.message.includes("'column' requires prop 'name'"))).toBe(true);
    });

    it('flags redirect missing to', () => {
      const v = validate('redirect');
      expect(v.some((v) => v.message.includes("'redirect' requires prop 'to'"))).toBe(true);
    });

    it('flags env missing name', () => {
      const v = validate('env required=true');
      expect(v.some((v) => v.message.includes("'env' requires prop 'name'"))).toBe(true);
    });

    it('flags option missing value', () => {
      const v = validate('option label="Admin"');
      expect(v.some((v) => v.message.includes("'option' requires prop 'value'"))).toBe(true);
    });

    it('flags context missing source', () => {
      const v = validate('context name=theme');
      expect(v.some((v) => v.message.includes("'context' requires prop 'source'"))).toBe(true);
    });

    it('passes valid invalidate', () => {
      const v = validate('invalidate on=userUpdate tags="user"');
      expect(v).toHaveLength(0);
    });

    it('flags invalidate missing on', () => {
      const v = validate('invalidate tags="user"');
      expect(v.some((v) => v.message.includes("'invalidate' requires prop 'on'"))).toBe(true);
    });
  });
});
