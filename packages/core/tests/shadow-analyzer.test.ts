import { parse } from '../src/parser.js';
import { analyzeShadow } from '../src/shadow-analyzer.js';

async function analyze(source: string) {
  return analyzeShadow(parse(source));
}

describe('Shadow Analyzer — fn', () => {
  it('catches undefined variables in fn handlers', async () => {
    const diagnostics = await analyze(
      [
        'fn name=calc params="value:number" returns=number',
        '  handler <<<',
        '    return missingValue + value;',
        '  >>>',
      ].join('\n'),
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'shadow-ts', nodeType: 'fn', tsCode: 2304 }),
      ]),
    );
    expect(diagnostics.some((d) => d.message.includes('missingValue'))).toBe(true);
  });

  it('does not flag unused params', async () => {
    const diagnostics = await analyze(
      ['fn name=echo params="value:string" returns=string', '  handler <<<', "    return 'ok';", '  >>>'].join('\n'),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it('catches return type mismatches against fn signatures', async () => {
    const diagnostics = await analyze(
      ['fn name=count returns=number', '  handler <<<', "    return 'oops';", '  >>>'].join('\n'),
    );
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'shadow-ts', nodeType: 'fn', tsCode: 2322 }),
      ]),
    );
  });

  it('produces no diagnostics for clean handlers', async () => {
    const diagnostics = await analyze(
      ['fn name=answer returns=number', '  handler <<<', '    return 42;', '  >>>'].join('\n'),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it('allows valid references to declared params', async () => {
    const diagnostics = await analyze(
      [
        'fn name=formatLabel params="id:string,count:number" returns=string',
        '  handler <<<',
        '    const label = `${id}:${count}`;',
        '    return label;',
        '  >>>',
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(0);
  });
});

describe('Shadow Analyzer — method', () => {
  it('resolves `this.field` on a service method', async () => {
    const diagnostics = await analyze(
      [
        'service name=UserService',
        '  field name=count type=number',
        '  method name=bump returns=number',
        '    handler <<<',
        '      this.count += 1;',
        '      return this.count;',
        '    >>>',
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it('flags references to missing `this.field`', async () => {
    const diagnostics = await analyze(
      [
        'service name=UserService',
        '  field name=count type=number',
        '  method name=bad returns=number',
        '    handler <<<',
        '      return this.missingField;',
        '    >>>',
      ].join('\n'),
    );
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'shadow-ts', nodeType: 'method', tsCode: 2339 }),
      ]),
    );
  });
});

describe('Shadow Analyzer — websocket', () => {
  it('connect handler sees ws/req/path in scope', async () => {
    const diagnostics = await analyze(
      [
        'websocket name=chat path="/ws"',
        '  on event=connect',
        '    handler <<<',
        '      ws.send(path);',
        '    >>>',
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it('message handler sees data from JSON.parse', async () => {
    const diagnostics = await analyze(
      [
        'websocket name=chat path="/ws"',
        '  on event=message',
        '    handler <<<',
        '      ws.send(data.greeting);',
        '    >>>',
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it('flags unknown variable in a websocket handler', async () => {
    const diagnostics = await analyze(
      [
        'websocket name=chat path="/ws"',
        '  on event=connect',
        '    handler <<<',
        '      ws.send(nonexistent);',
        '    >>>',
      ].join('\n'),
    );
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'shadow-ts', tsCode: 2304 }),
      ]),
    );
  });
});

describe('Shadow Analyzer — regression coverage', () => {
  it('multi-service methods do not cross-contaminate __ShadowSelf', async () => {
    const diagnostics = await analyze(
      [
        'service name=AService',
        '  field name=a type=number',
        '  method name=useA returns=number',
        '    handler <<<',
        '      return this.a;',
        '    >>>',
        'service name=BService',
        '  field name=b type=string',
        '  method name=useB returns=string',
        '    handler <<<',
        '      return this.b;',
        '    >>>',
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it('referencing the wrong service field is still caught', async () => {
    const diagnostics = await analyze(
      [
        'service name=AService',
        '  field name=a type=number',
        '  method name=bad returns=number',
        '    handler <<<',
        '      return this.b;',
        '    >>>',
        'service name=BService',
        '  field name=b type=string',
      ].join('\n'),
    );
    expect(diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'shadow-ts', tsCode: 2339 })]),
    );
  });

  it('async fn allows `await` without TS1308', async () => {
    const diagnostics = await analyze(
      [
        'fn name=load async=true returns="Promise<number>"',
        '  handler <<<',
        '    const n = await Promise.resolve(42);',
        '    return n;',
        '  >>>',
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it('plain (non-async) fn using `await` is still flagged', async () => {
    const diagnostics = await analyze(
      ['fn name=bad returns=number', '  handler <<<', '    return await Promise.resolve(42);', '  >>>'].join('\n'),
    );
    expect(
      diagnostics.some(
        (d) => d.rule === 'shadow-ts' && (d.tsCode === 1308 || d.tsCode === 2355),
      ),
    ).toBe(true);
  });

  it('repository method can reference this.modelType', async () => {
    const diagnostics = await analyze(
      [
        'model name=User',
        '  column name=id type=string',
        'repository name=UserRepo model=User',
        '  method name=label returns=string',
        '    handler <<<',
        '      return this.modelType;',
        '    >>>',
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(0);
  });

  it('console/setTimeout/fetch/process are available as ambient globals', async () => {
    const diagnostics = await analyze(
      [
        'fn name=mix async=true returns="Promise<void>"',
        '  handler <<<',
        '    setTimeout(() => {}, 100);',
        '    const r = await fetch("/x");',
        '    console.log(process.env.NODE_ENV, r);',
        '  >>>',
      ].join('\n'),
    );
    expect(diagnostics).toHaveLength(0);
  });
});

describe('Shadow Analyzer — module scope + signature diagnostics', () => {
  it('sibling fn is visible from another fn handler', async () => {
    const diagnostics = await analyze(
      [
        'fn name=double params="n:number" returns=number',
        '  handler <<<',
        '    return n * 2;',
        '  >>>',
        'fn name=quad params="n:number" returns=number',
        '  handler <<<',
        '    return double(double(n));',
        '  >>>',
      ].join('\n'),
    );
    expect(diagnostics.some((d) => d.rule === 'shadow-ts')).toBe(false);
  });

  it('sibling error class can be thrown', async () => {
    const diagnostics = await analyze(
      [
        'error name=NotFound',
        'fn name=find params="id:string" returns=string',
        '  handler <<<',
        '    throw new NotFound();',
        '  >>>',
      ].join('\n'),
    );
    expect(diagnostics.some((d) => d.rule === 'shadow-ts')).toBe(false);
  });

  it('signature-level diagnostics are preserved (TS2355 on missing return)', async () => {
    const diagnostics = await analyze(
      ['fn name=bad returns=number', '  handler <<<', '    const x = 1;', '  >>>'].join('\n'),
    );
    expect(diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'shadow-ts', tsCode: 2355 })]),
    );
  });
});

describe('Shadow Analyzer — generator/stream/model correctness', () => {
  it('generator fn return type uses Generator<T> for both stub and wrapper', async () => {
    const diagnostics = await analyze(
      [
        'fn name=nums generator=true returns=number',
        '  handler <<<',
        '    yield 1;',
        '    yield 2;',
        '  >>>',
        'fn name=sumNums returns=number',
        '  handler <<<',
        '    let total = 0;',
        '    for (const x of nums()) { total += x; }',
        '    return total;',
        '  >>>',
      ].join('\n'),
    );
    expect(diagnostics.some((d) => d.rule === 'shadow-ts')).toBe(false);
  });

  it('stream fn return type uses AsyncGenerator<T>', async () => {
    const diagnostics = await analyze(
      [
        'fn name=pump stream=true returns=number',
        '  handler <<<',
        '    yield 1;',
        '  >>>',
        'fn name=drain async=true returns="Promise<number>"',
        '  handler <<<',
        '    let total = 0;',
        '    for await (const x of pump()) { total += x; }',
        '    return total;',
        '  >>>',
      ].join('\n'),
    );
    expect(diagnostics.some((d) => d.rule === 'shadow-ts')).toBe(false);
  });

  it('model name is not constructible as a value', async () => {
    const diagnostics = await analyze(
      [
        'model name=User',
        '  column name=id type=string',
        'fn name=bad returns=unknown',
        '  handler <<<',
        '    return new User();',
        '  >>>',
      ].join('\n'),
    );
    expect(diagnostics.some((d) => d.rule === 'shadow-ts')).toBe(true);
  });

  it('model name is usable as a type parameter', async () => {
    const diagnostics = await analyze(
      [
        'model name=User',
        '  column name=id type=string',
        'fn name=greet params="u:User" returns=string',
        '  handler <<<',
        '    return "hi " + u.id;',
        '  >>>',
      ].join('\n'),
    );
    expect(diagnostics.some((d) => d.rule === 'shadow-ts')).toBe(false);
  });
});

describe('Shadow Analyzer — unsupported contexts', () => {
  it('flags route handlers as unsupported (no route codegen exists yet)', async () => {
    const diagnostics = await analyze(
      [
        'server name=API',
        '  route path="/users" method=get',
        '    handler <<<',
        '      res.json([]);',
        '    >>>',
      ].join('\n'),
    );
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'shadow-unsupported-context', nodeType: 'route' }),
      ]),
    );
  });
});
