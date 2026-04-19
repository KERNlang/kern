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
    expect(result.kern).toContain('field name=baseUrl type=string readonly=true default="/api"');
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
    expect(result.kern).toContain('conditional expr="count > 0"');
    expect(result.stats.components).toBe(1);
    expect(() => parse(result.kern)).not.toThrow();
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
