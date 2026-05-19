import { parse } from '@kernlang/core';
import { generatePythonCoreNode } from '../src/codegen-python.js';
import { transpileFastAPI } from '../src/transpiler-fastapi.js';
import { mapTsTypeToPython } from '../src/type-map.js';

describe('function type aliases — Python target', () => {
  test('maps TS function types to Callable annotations', () => {
    expect(mapTsTypeToPython('(event: AppEvent) => void')).toBe('Callable[[AppEvent], None]');
    expect(mapTsTypeToPython('() => Promise<Result<string, Error>>')).toBe('Callable[[], Result[str, Error]]');
    expect(mapTsTypeToPython('(item: User, done: () => void) => boolean')).toBe(
      'Callable[[User, Callable[[], None]], bool]',
    );
    expect(mapTsTypeToPython('(cb: (x: number, y: number) => number) => void')).toBe(
      'Callable[[Callable[[float, float], float]], None]',
    );
    expect(mapTsTypeToPython('(a: () => void, b: number) => void')).toBe('Callable[[Callable[[], None], float], None]');
    expect(mapTsTypeToPython('(...args: any[]) => void')).toBe('Callable[..., None]');
  });

  test('maps function type edge cases without leaking TS syntax', () => {
    expect(mapTsTypeToPython('(opts: { a: number; b: string }) => void')).toBe('Callable[[dict[str, Any]], None]');
    expect(mapTsTypeToPython('{ a: number } | { b: string }')).toBe('dict[str, Any] | dict[str, Any]');
    expect(mapTsTypeToPython('((x: number) => void) | null')).toBe('Callable[[float], None] | None');
    expect(mapTsTypeToPython('(x: "a,b") => void')).toBe('Callable[[Literal["a,b"]], None]');
    expect(mapTsTypeToPython('(x) => void')).toBe('Callable[[Any], None]');
    expect(mapTsTypeToPython('(x?: number) => string')).toBe('Callable[[float], str]');
  });

  test('generates Python type alias for function type alias nodes', () => {
    const ast = parse('type name=Dispatch alias="(event: AppEvent) => void"');
    const output = generatePythonCoreNode(ast).join('\n');
    expect(output).toContain('Dispatch = Callable[[AppEvent], None]');
  });

  test('FastAPI transpiler imports Callable when core nodes use function types', () => {
    const ast = parse(
      ['server name=API port=8000', '  type name=Dispatch alias="(event: AppEvent) => void"'].join('\n'),
    );
    const result = transpileFastAPI(ast);
    expect(result.code).toContain('from typing import Callable');
    expect(result.code).toContain('Dispatch = Callable[[AppEvent], None]');
  });

  test('FastAPI transpiler does not import Callable for non-type arrow text props', () => {
    const ast = parse(
      [
        'server name=API port=8000',
        '  fn name=ok description="not a type: x => y" returns=string',
        '    handler <<<',
        '      return "ok"',
        '    >>>',
      ].join('\n'),
    );
    const result = transpileFastAPI(ast);
    expect(result.code).not.toContain('from typing import Callable');
  });
});
