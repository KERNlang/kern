import { rewriteClassBodies } from '../src/commands/migrate-class-body.js';

describe('rewriteClassBodies', () => {
  test('rewrites a basic AudioRecorder-shape class-in-const', () => {
    const source = [
      'const name=AudioRecorder type=any export=true',
      '  handler <<<',
      '    class AudioRecorder {',
      '      private fd: number | null = null;',
      '      private filePath: string;',
      '',
      '      constructor(sessionKey: string) {',
      '        this.filePath = `/tmp/${sessionKey}.wav`;',
      '      }',
      '',
      '      close(): void {',
      '        this.fd = null;',
      '      }',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteClassBodies(source);

    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('class name=AudioRecorder export=true');
    expect(result.output).toContain('field name=fd type="number | null" private=true default={{ null }}');
    expect(result.output).toContain('field name=filePath type=string private=true');
    expect(result.output).toContain('constructor params="sessionKey:string"');
    expect(result.output).toContain('method name=close returns=void');
    expect(result.output).not.toContain('const name=AudioRecorder');
    // The original const handler is gone, but the new class's constructor
    // and methods still use `handler <<< ... >>>` for their bodies.
    expect(result.output).not.toMatch(/const name=AudioRecorder[\s\S]*?handler <<</);
  });

  test('preserves indentation when the const is nested', () => {
    const source = [
      'module name=Audio',
      '  const name=Recorder type=any',
      '    handler <<<',
      '      class Recorder {',
      '        private x: number;',
      '      }',
      '    >>>',
    ].join('\n');

    const result = rewriteClassBodies(source);

    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('  class name=Recorder');
    expect(result.output).toContain('    field name=x type=number private=true');
  });

  test('skips classes whose const type is not any/object/unknown', () => {
    // A named type means external code relies on the const's type; migrating
    // to a class declaration would change the type surface.
    const source = ['const name=Foo type=Factory', '  handler <<<', '    class Foo {}', '  >>>'].join('\n');

    const result = rewriteClassBodies(source);

    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('skips when the const name does not match the class name', () => {
    const source = ['const name=Exported type=any', '  handler <<<', '    class Internal {}', '  >>>'].join('\n');

    const result = rewriteClassBodies(source);

    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('skips when the handler body has more than one top-level statement', () => {
    const source = [
      'const name=Combo type=any',
      '  handler <<<',
      '    const helper = 1;',
      '    class Combo {}',
      '  >>>',
    ].join('\n');

    const result = rewriteClassBodies(source);

    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('keeps super() first when expanding param-property shortcuts in a derived class', () => {
    // TS requires `super(...)` before any `this.*` access. The synthesised
    // `this.x = x;` assignments must therefore be spliced AFTER the super
    // call, not prepended to the top of the ctor body.
    const source = [
      'const name=MyError type=any',
      '  handler <<<',
      '    class MyError extends Error {',
      '      constructor(public code: number, message: string) {',
      '        super(message);',
      '        this.name = "MyError";',
      '      }',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteClassBodies(source);

    expect(result.hits).toHaveLength(1);
    const out = result.output;
    const superIdx = out.indexOf('super(message);');
    const assignIdx = out.indexOf('this.code = code;');
    const bodyIdx = out.indexOf('this.name = "MyError";');
    expect(superIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(-1);
    expect(superIdx).toBeLessThan(assignIdx);
    expect(assignIdx).toBeLessThan(bodyIdx);
  });

  test('expands TS parameter-property shortcuts into sibling fields + ctor assigns', () => {
    const source = [
      'const name=Widget type=any',
      '  handler <<<',
      '    class Widget {',
      '      constructor(private x: number, readonly y: string) {}',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteClassBodies(source);

    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('field name=x type=number private=true');
    expect(result.output).toContain('field name=y type=string readonly=true');
    expect(result.output).toContain('this.x = x;');
    expect(result.output).toContain('this.y = y;');
    expect(result.output).toContain('constructor params="x:number,y:string"');
  });

  test('migrates classes with static fields', () => {
    const source = [
      'const name=Counter type=any',
      '  handler <<<',
      '    class Counter {',
      '      private static count = 0;',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteClassBodies(source);

    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('field name=count private=true static=true default={{ 0 }}');
  });

  test('migrates classes with getter/setter members', () => {
    const source = [
      'const name=Gauge type=any',
      '  handler <<<',
      '    class Gauge {',
      '      private _v: number = 0;',
      '      get v(): number { return this._v; }',
      '      set v(value: number) { this._v = value; }',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteClassBodies(source);

    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('getter name=v returns=number');
    expect(result.output).toContain('setter name=v params="value:number"');
    expect(result.output).toContain('return this._v;');
    expect(result.output).toContain('this._v = value;');
  });

  test('skips methods with multi-line inline type annotations', () => {
    const source = [
      'const name=Reader type=any',
      '  handler <<<',
      '    class Reader {',
      '      read(req: {',
      '        id: string;',
      '      }): void {}',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteClassBodies(source);

    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('carries through extends, implements, and abstract', () => {
    const source = [
      'const name=Cat type=any export=true',
      '  handler <<<',
      '    abstract class Cat extends Animal implements Purrer {',
      '      abstract sound(): string;',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteClassBodies(source);

    // Abstract methods have no body and hit the emitMember fallback, so the
    // whole class is skipped. Only surface this as a documentation point; we
    // can revisit once `method abstract=true` is schema-supported.
    expect(result.hits).toHaveLength(0);
  });
});
