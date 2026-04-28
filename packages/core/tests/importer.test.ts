import { importTypeScript } from '../src/importer.js';
import { parse } from '../src/parser.js';

describe('importTypeScript', () => {
  test('imports default, named, type-only, and side-effect imports', () => {
    const source = `
import React, { type FC, useState as useStateAlias } from 'react';
import './setup';
`;

    const result = importTypeScript(source, 'component.tsx');

    expect(result.kern).toContain('import from="react" default=React names="FC,useStateAlias" types=true');
    expect(result.kern).toContain('import from="./setup"');
    expect(result.stats.imports).toBe(2);
    expect(() => parse(result.kern)).not.toThrow();
  });

  test('imports typed exported async functions with doc comments and handlers', () => {
    const source = `
/** Load a user by id. */
export async function loadUser(id: string, retries: number = 3): Promise<User> {
  const response = await fetch('/api/users/' + id);
  return response.json();
}
`;

    const result = importTypeScript(source, 'load-user.ts');

    expect(result.kern).toContain('doc text="Load a user by id."');
    expect(result.kern).toContain(
      'fn name=loadUser params="id:string,retries:number=3" returns=Promise<User> async=true export=true',
    );
    expect(result.kern).toContain("const response = await fetch('/api/users/' + id);");
    expect(result.kern).toContain('return response.json();');
    expect(result.stats.functions).toBe(1);
    expect(() => parse(result.kern)).not.toThrow();
  });

  test('imports class and error classes', () => {
    const source = `
export class UserService implements Reader {
  readonly baseUrl: string = "/api";
  private cache: Map<string, User>;

  constructor() {
    this.cache = new Map();
  }

  async fetchUser(id: string): Promise<User> {
    return fetch(this.baseUrl + '/' + id).then((response) => response.json());
  }
}

export class NotFoundError extends Error {
  constructor(public resource: string) {
    super("Not found");
  }
}
`;

    const result = importTypeScript(source, 'services.ts');

    expect(result.kern).toContain('class name=UserService implements=Reader export=true');
    // Field initializers are emitted as `{{ ... }}` rawExpr blocks so string
    // literals round-trip with their quotes preserved by the parser.
    expect(result.kern).toContain('field name=baseUrl type=string readonly=true default={{ "/api" }}');
    // Type strings with whitespace are quoted so the prop tokeniser preserves them.
    expect(result.kern).toContain('field name=cache type="Map<string, User>" private=true');
    expect(result.kern).toContain('method name=fetchUser params="id:string" returns=Promise<User> async=true');
    expect(result.kern).toContain('error name=NotFoundError extends=Error message="\\"Not found\\"" export=true');
    expect(result.kern).toContain('field name=resource type=string');
    expect(result.stats.classes).toBe(2);
    expect(() => parse(result.kern)).not.toThrow();
  });

  test('imports TSX components with hooks, tailwind styles, events, and conditionals', () => {
    const source = `
import React, { useEffect, useMemo, useState } from 'react';

export function DashboardPage(): JSX.Element {
  const [count, setCount] = useState<number>(0);
  useEffect(() => {
    console.log(count);
    return () => console.log('cleanup');
  }, [count]);
  const doubled = useMemo(() => count * 2, [count]);

  return (
    <div className="flex flex-col p-4">
      <button onClick={() => setCount(count + 1)}>Increment</button>
      {count > 0 && <span>{doubled}</span>}
    </div>
  );
}
`;

    const result = importTypeScript(source, 'DashboardPage.tsx');

    expect(result.kern).toContain('page name=DashboardPage export=true');
    expect(result.kern).toContain('// state: count (number) = 0');
    expect(result.kern).toContain('effect deps="count"');
    expect(result.kern).toContain('console.log(count);');
    expect(result.kern).toContain("console.log('cleanup')");
    expect(result.kern).toContain('memo name=doubled deps="count"');
    expect(result.kern).toContain('row {fd:column, p:4}');
    expect(result.kern).toContain('button');
    expect(result.kern).toContain('on event=click');
    expect(result.kern).toContain('conditional if="count > 0"');
    expect(result.stats.components).toBe(1);
    expect(() => parse(result.kern)).not.toThrow();
  });

  // ── PR 7: extraction lifts for PR 3/4 primitives ─────────────────────────

  describe('lift: template literal → fmt', () => {
    test('const bound to a template literal becomes a `fmt` node', () => {
      const source = 'const label = `${count} files over ${totalMb} MB`;';
      const result = importTypeScript(source, 'label.ts');
      expect(result.kern).toContain('fmt name=label template="${count} files over ${totalMb} MB"');
      expect(() => parse(result.kern)).not.toThrow();
    });

    test('const bound to a no-substitution template literal also becomes fmt', () => {
      const source = 'const greeting = `hello world`;';
      const result = importTypeScript(source, 'greeting.ts');
      expect(result.kern).toContain('fmt name=greeting template="hello world"');
    });

    test('preserves explicit type annotation on fmt', () => {
      const source = 'const label: string = `${n} items`;';
      const result = importTypeScript(source, 'label.ts');
      expect(result.kern).toContain('fmt name=label type=string template="${n} items"');
    });

    test('propagates export=true', () => {
      const source = 'export const label = `${n} files`;';
      const result = importTypeScript(source, 'label.ts');
      expect(result.kern).toMatch(/fmt name=label template="\$\{n\} files".*export=true/);
    });

    test('multi-line templates fall through to raw-handler path (no fmt)', () => {
      const source = 'const label = `first line\nsecond line`;';
      const result = importTypeScript(source, 'label.ts');
      // Multi-line can't fit in a quoted KERN attribute — fmt is not emitted.
      expect(result.kern).not.toContain('fmt name=label');
      // Falls back to the complex-initializer path.
      expect(result.kern).toContain('const name=label');
    });

    test('round-trips through parse without error for an interpolated fmt', () => {
      const source = 'const msg = `count is ${count}`;';
      const result = importTypeScript(source, 'msg.ts');
      expect(result.kern).toContain('fmt name=msg template="count is ${count}"');
      expect(() => parse(result.kern)).not.toThrow();
    });
  });

  describe('lift: JSX ternary / short-circuit → conditional', () => {
    test('{cond && <X/>} becomes `conditional if=... handler <<<>>>`', () => {
      const source = `
import React from 'react';
export function Gate({ show }: { show: boolean }) {
  return (
    <div>
      {show && <span>visible</span>}
    </div>
  );
}
`;
      const result = importTypeScript(source, 'gate.tsx');
      expect(result.kern).toContain('conditional if="show"');
      expect(result.kern).toContain('handler <<<');
      expect(result.kern).toContain('<span>visible</span>');
      expect(() => parse(result.kern)).not.toThrow();
    });

    test('{cond ? <A/> : <B/>} becomes `conditional if=... + else handler`', () => {
      const source = `
import React from 'react';
export function Gate({ loading }: { loading: boolean }) {
  return (
    <div>
      {loading ? <Spinner /> : <Content />}
    </div>
  );
}
`;
      const result = importTypeScript(source, 'gate.tsx');
      expect(result.kern).toContain('conditional if="loading"');
      expect(result.kern).toContain('<Spinner />');
      expect(result.kern).toContain('else');
      expect(result.kern).toContain('<Content />');
      // No more old branch/path shape.
      expect(result.kern).not.toContain('branch name=cond');
      expect(result.kern).not.toContain('path value=true');
      expect(() => parse(result.kern)).not.toThrow();
    });
  });

  describe('enum import (slice 2b deferred fix)', () => {
    test('numeric auto-increment enum uses compact values= form', () => {
      const source = `
export enum Direction { Up, Down, Left, Right }
`;
      const result = importTypeScript(source, 'direction.ts');
      expect(result.kern).toContain('enum name=Direction values="Up|Down|Left|Right" export=true');
      expect(result.kern).not.toContain('type name=Direction');
      expect(() => parse(result.kern)).not.toThrow();
    });

    test('string-valued enum uses member children', () => {
      const source = `
export enum Status {
  Pending = 'pending',
  Active = 'active',
}
`;
      const result = importTypeScript(source, 'status.ts');
      expect(result.kern).toContain('enum name=Status export=true');
      expect(result.kern).toContain('member name=Pending value="pending"');
      expect(result.kern).toContain('member name=Active value="active"');
      expect(() => parse(result.kern)).not.toThrow();
    });

    test('const enum carries const=true', () => {
      const source = `
export const enum Flag { On, Off }
`;
      const result = importTypeScript(source, 'flag.ts');
      expect(result.kern).toContain('enum name=Flag values="On|Off" const=true export=true');
      expect(() => parse(result.kern)).not.toThrow();
    });

    test('numeric enum with explicit initializer uses member children with bare value', () => {
      const source = `
export enum Code {
  A = 1,
  B = 2,
}
`;
      const result = importTypeScript(source, 'code.ts');
      expect(result.kern).toContain('enum name=Code export=true');
      expect(result.kern).toContain('member name=A value=1');
      expect(result.kern).toContain('member name=B value=2');
      expect(() => parse(result.kern)).not.toThrow();
    });

    test('computed (bitwise) enum members use {{expr}} form', () => {
      const source = `
export enum Perm {
  Read = 1 << 0,
  Write = 1 << 1,
}
`;
      const result = importTypeScript(source, 'perm.ts');
      expect(result.kern).toContain('enum name=Perm export=true');
      expect(result.kern).toContain('member name=Read value={{1 << 0}}');
      expect(result.kern).toContain('member name=Write value={{1 << 1}}');
      expect(() => parse(result.kern)).not.toThrow();
    });

    test('empty-string enum value uses {{""}} form (Codex hold)', () => {
      // Without the {{""}} routing, codegen's "no value" guard would drop
      // the empty string, so `enum E { Empty = "" }` would round-trip to
      // `Empty,` instead of `Empty = ""`.
      const source = `
export enum E {
  Empty = '',
  Filled = 'x',
}
`;
      const result = importTypeScript(source, 'e.ts');
      expect(result.kern).toContain('enum name=E export=true');
      expect(result.kern).toContain('member name=Empty value={{""}}');
      expect(result.kern).toContain('member name=Filled value="x"');
      expect(() => parse(result.kern)).not.toThrow();
    });

    test('negative-number enum value uses {{expr}} form (PrefixUnaryExpression)', () => {
      // `A = -1` parses as a PrefixUnaryExpression (not a NumericLiteral), so
      // it falls into the expression branch — verify it round-trips correctly.
      const source = `
export enum N { A = -1, B = 0 }
`;
      const result = importTypeScript(source, 'n.ts');
      expect(result.kern).toContain('enum name=N export=true');
      expect(result.kern).toContain('member name=A value={{-1}}');
      expect(result.kern).toContain('member name=B value=0');
      expect(() => parse(result.kern)).not.toThrow();
    });
  });

  test('tracks unmapped constructs instead of dropping them silently', () => {
    const source = `
namespace Legacy {
  export const version = '1.0.0';
}
`;

    const result = importTypeScript(source, 'legacy.ts');

    expect(result.unmapped).toHaveLength(1);
    expect(result.unmapped[0]).toContain('namespace Legacy');
    expect(result.kern).toContain('// [unmapped] namespace Legacy');
    expect(() => parse(result.kern)).not.toThrow();
  });
});
