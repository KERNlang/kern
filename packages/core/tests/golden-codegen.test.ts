/**
 * Golden-file snapshot tests for ALL core codegen generators.
 *
 * These freeze current output behavior so refactoring (splitting codegen-core.ts,
 * hardening emitters, etc.) can be verified against known-good baselines.
 *
 * Run `pnpm test -- -u` to update snapshots after intentional changes.
 */

import { generateCoreNode } from '../src/codegen-core.js';
import { parse } from '../src/parser.js';

function gen(source: string): string {
  const root = parse(source);
  return generateCoreNode(root).join('\n');
}

// ── Type system nodes ──

describe('golden: type', () => {
  it('union values', () => {
    expect(gen('type name=Status values="active|paused|done"')).toMatchSnapshot();
  });
  it('alias', () => {
    expect(gen('type name=IdList alias="string[]"')).toMatchSnapshot();
  });
  it('export=false', () => {
    expect(gen('type name=Internal values="a|b" export=false')).toMatchSnapshot();
  });
});

describe('golden: interface', () => {
  it('with fields and extends', () => {
    expect(
      gen(
        [
          'interface name=User extends=BaseEntity',
          '  field name=email type=string',
          '  field name=age type=number optional=true',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
  it('empty interface', () => {
    expect(gen('interface name=EmptyConfig')).toMatchSnapshot();
  });
});

describe('golden: union', () => {
  it('discriminated union', () => {
    expect(
      gen(
        [
          'union name=Shape discriminant=kind',
          '  variant name=circle',
          '    field name=radius type=number',
          '  variant name=rect',
          '    field name=width type=number',
          '    field name=height type=number',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
  it('optional fields in variant', () => {
    expect(
      gen(
        [
          'union name=Result discriminant=status',
          '  variant name=ok',
          '    field name=data type=unknown',
          '  variant name=error',
          '    field name=message type=string',
          '    field name=code type=number optional=true',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
  it('empty union', () => {
    expect(gen('union name=Never discriminant=type')).toMatchSnapshot();
  });
});

describe('golden: service', () => {
  it('class with fields, methods, constructor', () => {
    expect(
      gen(
        [
          'service name=Cache',
          '  field name=store type="Map<string,any>" private=true',
          '  field name=ttl type=number default=3600 readonly=true',
          '  constructor params="maxSize:number"',
          '    handler <<<',
          '      this.store = new Map();',
          '    >>>',
          '  method name=get params="key:string" returns="any | undefined"',
          '    handler <<<',
          '      return this.store.get(key);',
          '    >>>',
          '  method name=set params="key:string,value:any" returns=void',
          '    handler <<<',
          '      this.store.set(key, value);',
          '    >>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
  it('implements clause', () => {
    expect(
      gen(
        [
          'service name=Adapter implements=Transport',
          '  method name=send params="data:Buffer" returns="Promise<void>" async=true',
          '    handler <<<',
          '      await this.socket.write(data);',
          '    >>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
  it('async generator method', () => {
    expect(
      gen(
        [
          'service name=Stream',
          '  method name=items returns=Item stream=true',
          '    handler <<<',
          '      for await (const item of this.source) {',
          '        yield item;',
          '      }',
          '    >>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
  it('singleton', () => {
    expect(
      gen(
        [
          'service name=Registry',
          '  field name=entries type="string[]" default="[]"',
          '  singleton name=registry',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
  it('static and private methods', () => {
    expect(
      gen(
        [
          'service name=Utils',
          '  method name=helper returns=void private=true',
          '    handler <<<return;>>>',
          '  method name=create returns=Utils static=true',
          '    handler <<<return new Utils();>>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
});

describe('golden: fn', () => {
  it('sync function with params and return', () => {
    expect(
      gen(
        ['fn name=add params="a:number,b:number" returns=number', '  handler <<<', '    return a + b;', '  >>>'].join(
          '\n',
        ),
      ),
    ).toMatchSnapshot();
  });
  it('async function', () => {
    expect(
      gen(
        [
          'fn name=fetchUser params="id:string" returns="Promise<User>" async=true',
          '  handler <<<',
          '    return await db.find(id);',
          '  >>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
  it('stream function', () => {
    expect(
      gen(['fn name=generate returns=string stream=true', '  handler <<<', '    yield "hello";', '  >>>'].join('\n')),
    ).toMatchSnapshot();
  });
  it('sync generator function', () => {
    expect(
      gen(
        [
          'fn name=iterate returns=number generator=true',
          '  handler <<<',
          '    yield 1;',
          '    yield 2;',
          '  >>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
  it('async generator function', () => {
    expect(
      gen(
        [
          'fn name=paginate returns=Page generator=true async=true',
          '  handler <<<',
          '    for await (const page of fetchPages()) yield page;',
          '  >>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
  it('signal and cleanup', () => {
    expect(
      gen(
        [
          'fn name=fetchData params="url:string" returns="Promise<void>" async=true',
          '  signal name=abort',
          '  handler <<<',
          '    const res = await fetch(url, { signal: abort.signal });',
          '  >>>',
          '  cleanup <<<',
          '    abort.abort();',
          '  >>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
  it('default params and generics', () => {
    expect(
      gen(
        'fn name=merge params="a:Record<string,number>,b:Record<string,number>,deep:boolean=true" returns="Record<string,number>"',
      ),
    ).toMatchSnapshot();
  });
});

describe('golden: machine', () => {
  it('full state machine', () => {
    expect(
      gen(
        [
          'machine name=Order',
          '  state name=pending',
          '  state name=confirmed',
          '  state name=shipped',
          '  state name=delivered',
          '  state name=cancelled',
          '  transition name=confirm from=pending to=confirmed',
          '  transition name=ship from=confirmed to=shipped',
          '  transition name=deliver from=shipped to=delivered',
          '  transition name=cancel from="pending|confirmed" to=cancelled',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
  it('transition with custom handler', () => {
    expect(
      gen(
        [
          'machine name=Task',
          '  state name=open',
          '  state name=closed',
          '  transition name=close from=open to=closed',
          '    handler <<<',
          '      return { ...entity, state: "closed", closedAt: Date.now() };',
          '    >>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
});

describe('golden: error', () => {
  it('simple error', () => {
    expect(gen('error name=AppError extends=Error')).toMatchSnapshot();
  });
  it('error with fields and message', () => {
    expect(
      gen(
        [
          'error name=ValidationError extends=Error message="Validation failed: ${field} is invalid"',
          '  field name=field type=string',
          '  field name=value type=unknown',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
});

describe('golden: config', () => {
  it('config with defaults', () => {
    expect(
      gen(
        [
          'config name=AppConfig',
          '  field name=port type=number default=3000',
          '  field name=host type=string default=localhost',
          '  field name=debug type=boolean default=false',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
});

describe('golden: store', () => {
  it('file-backed store', () => {
    expect(gen('store name=User path="~/.app/users" key=id model=User')).toMatchSnapshot();
  });
});

describe('golden: test', () => {
  it('test suite with describe/it', () => {
    expect(
      gen(
        [
          'test name="Math Utils"',
          '  describe name=add',
          '    it name="adds two numbers"',
          '      handler <<<',
          '        expect(add(1, 2)).toBe(3);',
          '      >>>',
          '    it name="handles negatives"',
          '      handler <<<',
          '        expect(add(-1, 1)).toBe(0);',
          '      >>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
});

describe('golden: event', () => {
  it('typed event system', () => {
    expect(
      gen(
        [
          'event name=AppEvent',
          '  type name="user:login" data="{ userId: string }"',
          '  type name="user:logout"',
          '  type name="error" data="{ code: number; message: string }"',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
});

describe('golden: import', () => {
  it('named import', () => {
    expect(gen('import from="./utils" names="add,subtract"')).toMatchSnapshot();
  });
  it('default import', () => {
    expect(gen('import from="express" default=express')).toMatchSnapshot();
  });
  it('default + named', () => {
    expect(gen('import from="react" default=React names="useState,useEffect"')).toMatchSnapshot();
  });
  it('side-effect import', () => {
    expect(gen('import from="./polyfill"')).toMatchSnapshot();
  });
  it('type-only import', () => {
    expect(gen('import from="./types" names="User,Config" types=true')).toMatchSnapshot();
  });
});

describe('golden: const', () => {
  it('const with value', () => {
    expect(gen('const name=MAX_RETRIES type=number value=3')).toMatchSnapshot();
  });
  it('const with expression value', () => {
    expect(gen('const name=HOUR_MS type=number value={{ 60 * 60 * 1000 }}')).toMatchSnapshot();
  });
  it('const with string-literal expression value', () => {
    expect(gen('const name=HOST type=string value={{ "localhost" }}')).toMatchSnapshot();
  });
  it('fn with expr body', () => {
    expect(gen('fn name=getPath returns=string expr={{ return join(tmp, "x"); }}')).toMatchSnapshot();
  });
  it('fn with expr body void return', () => {
    expect(gen('fn name=tick returns=void expr={{ state.count++; }}')).toMatchSnapshot();
  });
  it('const with handler', () => {
    expect(
      gen(
        ['const name=CONFIG type=AppConfig', '  handler <<<', '    { port: 3000, host: "localhost" }', '  >>>'].join(
          '\n',
        ),
      ),
    ).toMatchSnapshot();
  });
  it('const without value or handler', () => {
    expect(gen('const name=EMPTY type=string')).toMatchSnapshot();
  });
});

describe('golden: on', () => {
  it('click handler', () => {
    expect(
      gen(['on event=click', '  handler <<<', '    console.log("clicked");', '  >>>'].join('\n')),
    ).toMatchSnapshot();
  });
  it('key handler with filter', () => {
    expect(gen(['on event=key key=Enter', '  handler <<<', '    submit();', '  >>>'].join('\n'))).toMatchSnapshot();
  });
  it('handler reference', () => {
    expect(gen('on event=submit handler=handleSubmit')).toMatchSnapshot();
  });
});

describe('golden: websocket', () => {
  it('websocket with handlers', () => {
    expect(
      gen(
        [
          'websocket path=/ws',
          '  on event=connect',
          '    handler <<<ws.send("hello");>>>',
          '  on event=message',
          '    handler <<<',
          '      const data = JSON.parse(event.data);',
          '    >>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
});

// ── Ground layer nodes ──

describe('golden: derive', () => {
  it('simple derive', () => {
    expect(gen('derive name=total expr={{items.length}} type=number')).toMatchSnapshot();
  });
});

describe('golden: transform', () => {
  it('with target and via', () => {
    expect(gen('transform name=limited target="items" via="slice(0, 10)" type="Item[]"')).toMatchSnapshot();
  });
  it('with handler', () => {
    expect(
      gen(
        [
          'transform name=processed type="Result[]"',
          '  handler <<<',
          '    return data.map(d => process(d));',
          '  >>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
});

describe('golden: action', () => {
  it('async action with metadata', () => {
    expect(
      gen(
        [
          'action name=sendEmail idempotent=true reversible=true params="to:string,body:string" returns=void',
          '  handler <<<',
          '    await mailer.send(to, body);',
          '  >>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
});

describe('golden: guard', () => {
  it('guard with numeric else (HTTP status)', () => {
    expect(gen('guard name=isAdmin expr={{user.role === "admin"}} else=403')).toMatchSnapshot();
  });
  it('guard with code else', () => {
    expect(gen('guard name=isValid expr={{data.valid}} else="redirect(\'/error\')"')).toMatchSnapshot();
  });
  it('guard with default throw', () => {
    expect(gen('guard name=hasAccess expr={{token.valid}}')).toMatchSnapshot();
  });
});

describe('golden: assume', () => {
  it('assume with evidence and fallback', () => {
    expect(
      gen(
        'assume expr={{user.id === params.userId}} scope=request evidence="route-signing" fallback="throw AuthError()"',
      ),
    ).toMatchSnapshot();
  });
});

describe('golden: invariant', () => {
  it('simple invariant', () => {
    expect(gen('invariant name=positiveBalance expr={{account.balance >= 0}}')).toMatchSnapshot();
  });
});

describe('golden: each', () => {
  it('each with child nodes', () => {
    expect(
      gen(['each name=item in="items"', '  derive name=processed expr={{transform(item)}} type=Result'].join('\n')),
    ).toMatchSnapshot();
  });
  it('each with index', () => {
    expect(gen('each name=item in="list" index=i')).toMatchSnapshot();
  });
});

describe('golden: collect', () => {
  it('collect with filter, sort, limit', () => {
    expect(
      gen('collect name=topItems from="items" where={{item.score > 50}} order={{b.score - a.score}} limit=10'),
    ).toMatchSnapshot();
  });
  it('collect simple', () => {
    expect(gen('collect name=all from="data"')).toMatchSnapshot();
  });
});

describe('golden: branch', () => {
  it('branch with paths', () => {
    expect(
      gen(
        [
          'branch name=route on="user.tier"',
          '  path value="free"',
          '    derive name=limit expr={{10}} type=number',
          '  path value="pro"',
          '    derive name=limit expr={{100}} type=number',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
});

describe('golden: guard + assume + invariant', () => {
  it('low confidence guard generates TODO', () => {
    expect(gen('guard name=maybeValid expr={{check()}} confidence=0.4')).toMatchSnapshot();
  });
});

// ── Module ──

describe('golden: module', () => {
  it('module with children', () => {
    expect(
      gen(
        [
          'module name=auth',
          '  type name=Role values="admin|user|guest"',
          '  fn name=checkRole params="role:Role" returns=boolean',
          '    handler <<<',
          '      return role === "admin";',
          '    >>>',
        ].join('\n'),
      ),
    ).toMatchSnapshot();
  });
});
