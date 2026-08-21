import { spawnSync } from 'node:child_process';
import type { IRNode } from '@kernlang/core';
import {
  emitNativeKernBodyTSWithImports,
  emittedCodeUsesTextOps,
  kernStdlibPreamble,
  parseExpression,
} from '@kernlang/core';
import ts from 'typescript';
import { emitNativeKernBodyPythonWithImports, emitPyExpression } from '../src/codegen-body-python.js';

const pythonAvailable = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
const describeIfPython = pythonAvailable ? describe : describe.skip;

function handler(value: string, setup: IRNode[] = []): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: [...setup, { type: 'return', props: { value } }],
  };
}

function occurrences(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function emitTsProgram(value: string): { body: string; preamble: string; source: string } {
  const body = emitNativeKernBodyTSWithImports(handler(value)).code;
  const preamble = kernStdlibPreamble({
    result: false,
    option: false,
    textOps: emittedCodeUsesTextOps(body),
  }).join('\n');
  const source = ts.transpileModule(`${preamble}\nfunction __probe() {\n${body}\n}\n`, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return { body, preamble, source };
}

function runNode(source: string, suffix: string): string {
  const result = spawnSync(process.execPath, ['-e', `${source}\n${suffix}`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`node failed:\n${result.stderr}\n${source}`);
  return result.stdout.trim();
}

function emitPyProgram(value: string): { body: string; helpers: string; source: string } {
  const emitted = emitNativeKernBodyPythonWithImports(handler(value));
  const helpers = [...emitted.helpers].join('\n\n');
  const body = emitted.code
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  return { body: emitted.code, helpers, source: `${helpers}\ndef __probe():\n${body}\n` };
}

function runPython(source: string, suffix: string): string {
  const result = spawnSync('python3', ['-c', `${source}\n${suffix}`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`python3 failed:\n${result.stderr}\n${source}`);
  return result.stdout.trim();
}

const VALUE_VECTOR = [
  'Text.utf8Length("")',
  'Text.utf8Length(KernInternal.textFromScalar(0))',
  'Text.utf8Length(KernInternal.textFromScalar(127))',
  'Text.utf8Length(KernInternal.textFromScalar(128))',
  'Text.utf8Length(KernInternal.textFromScalar(2047))',
  'Text.utf8Length(KernInternal.textFromScalar(2048))',
  'Text.utf8Length(KernInternal.textFromScalar(65535))',
  'Text.utf8Length(KernInternal.textFromScalar(65536))',
  'Text.utf8Length(KernInternal.textFromScalar(127757))',
  'Text.utf8Length("A¢€🌍")',
].join(', ');

describe('Text.utf8Length — generated lowering and helper injection', () => {
  test('lowers through the shared Text helper family on both targets', () => {
    expect(parseExpression('Text.utf8Length(s)')).toBeDefined();
    expect(emitTsProgram('Text.utf8Length(s)').body).toBe('return __kern_text_utf8_length(s);');
    expect(emitPyExpression(parseExpression('Text.utf8Length(s)'))).toBe('_kern_text_utf8_length(s)');
  });

  test('injects each generated helper exactly once and omits it when unused', () => {
    const tsEmission = emitTsProgram(`[${VALUE_VECTOR}]`);
    const pyEmission = emitPyProgram(`[${VALUE_VECTOR}]`);
    expect(occurrences(tsEmission.preamble, /function __kern_text_utf8_length\(/gu)).toBe(1);
    expect(occurrences(pyEmission.helpers, /def _kern_text_utf8_length\(/gu)).toBe(1);

    const unusedTs = emitTsProgram('0');
    const unusedPy = emitPyProgram('0');
    expect(unusedTs.preamble).not.toContain('__kern_text_');
    expect(unusedPy.helpers).not.toContain('_kern_text_');
  });

  test('lexical Text bindings remain authored calls and do not inject helpers', () => {
    const shadowSetup: IRNode[] = [{ type: 'let', props: { name: 'Text', value: '1' } }];
    const tsBody = emitNativeKernBodyTSWithImports(handler('Text.utf8Length("x")', shadowSetup)).code;
    const pyEmission = emitNativeKernBodyPythonWithImports(handler('Text.utf8Length("x")', shadowSetup));
    expect(tsBody).toContain('return Text.utf8Length("x");');
    expect(emittedCodeUsesTextOps(tsBody)).toBe(false);
    expect(pyEmission.code).toContain('return Text.utf8Length("x")');
    expect([...pyEmission.helpers].join('\n')).not.toContain('_kern_text_');
  });

  test('both target lowerings reject wrong arity', () => {
    expect(() => emitTsProgram('Text.utf8Length()')).toThrow(/takes 1 arg/u);
    expect(() => emitPyExpression(parseExpression('Text.utf8Length("x", "y")'))).toThrow(/takes 1 arg/u);
  });

  test.each(['Text?.utf8Length("x")', 'Text.utf8Length?.("x")', 'Number?.floor(1)'])(
    'both target lowerings reject optional known-stdlib access identically: %s',
    (source) => {
      let tsMessage = '';
      let pyMessage = '';
      try {
        emitTsProgram(source);
      } catch (error) {
        tsMessage = error instanceof Error ? error.message : String(error);
      }
      try {
        emitPyExpression(parseExpression(source));
      } catch (error) {
        pyMessage = error instanceof Error ? error.message : String(error);
      }
      expect(tsMessage).toMatch(/optional KERN-stdlib access/u);
      expect(pyMessage).toBe(tsMessage);
    },
  );

  test('a user-shadowed optional Text member stays authored and injects no helper', () => {
    const shadowSetup: IRNode[] = [{ type: 'let', props: { name: 'Text', value: '1' } }];
    const tsBody = emitNativeKernBodyTSWithImports(handler('Text?.utf8Length("x")', shadowSetup)).code;
    const pyEmission = emitNativeKernBodyPythonWithImports(handler('Text?.utf8Length("x")', shadowSetup));
    expect(tsBody).toContain('Text?.utf8Length("x")');
    expect(emittedCodeUsesTextOps(tsBody)).toBe(false);
    expect(pyEmission.code).toContain('Text');
    expect([...pyEmission.helpers].join('\n')).not.toContain('_kern_text_');
  });
});

describeIfPython('Text.utf8Length — real generated TypeScript/Python execution parity', () => {
  test('dynamic non-string input fails closed with the same KERN diagnostic', () => {
    const tsEmission = emitTsProgram('Text.utf8Length(s)');
    const pyEmission = emitPyProgram('Text.utf8Length(s)');
    const tsSuffix = [
      'try { __probe(1); console.log("ACCEPTED"); }',
      'catch (error) { console.log(String(error.message)); }',
    ].join('\n');
    const pySuffix = [
      'try:',
      '    __probe(1)',
      'except Exception as error:',
      '    print(str(error))',
      'else:',
      '    print("ACCEPTED")',
    ].join('\n');
    const tsMessage = runNode(tsEmission.source.replace('function __probe()', 'function __probe(s)'), tsSuffix);
    const pyMessage = runPython(pyEmission.source.replace('def __probe():', 'def __probe(s):'), pySuffix);
    expect(tsMessage).toBe('portable: Text.utf8Length requires a string');
    expect(pyMessage).toBe(tsMessage);
  });

  test('executes exact scalar widths without a host encoder implementation', () => {
    const expected = [0, 1, 1, 2, 2, 3, 3, 4, 4, 10];
    const tsEmission = emitTsProgram(`[${VALUE_VECTOR}]`);
    const pyEmission = emitPyProgram(`[${VALUE_VECTOR}]`);
    const tsResult = JSON.parse(runNode(tsEmission.source, 'console.log(JSON.stringify(__probe()));'));
    const pyResult = JSON.parse(
      runPython(`import json\n${pyEmission.source}`, 'print(json.dumps(__probe(), ensure_ascii=False))'),
    );
    expect(tsResult).toEqual(expected);
    expect(pyResult).toEqual(expected);
    expect(pyResult).toEqual(tsResult);
  });

  test('both emitted helpers fail closed on all constructible malformed classes', () => {
    const tsEmission = emitTsProgram('Text.utf8Length(s)');
    const pyEmission = emitPyProgram('Text.utf8Length(s)');
    const tsSuffix = [
      'const malformed = [String.fromCharCode(0xd800), String.fromCharCode(0xdc00),',
      '  String.fromCharCode(0xdc00, 0xd800), String.fromCharCode(0xd800, 0xd800),',
      '  String.fromCharCode(0xdc00, 0xdc00)];',
      'for (const value of malformed) {',
      '  let rejected = false; try { __probe(value); } catch { rejected = true; }',
      '  if (!rejected) throw new Error("malformed text was accepted");',
      '}',
      'console.log("FAIL_CLOSED");',
    ].join('\n');
    const pySuffix = [
      'malformed = [chr(0xd800), chr(0xdc00), chr(0xdc00) + chr(0xd800),',
      '             chr(0xd800) + chr(0xd800), chr(0xdc00) + chr(0xdc00)]',
      'for value in malformed:',
      '    try:',
      '        __probe(value)',
      '    except Exception:',
      '        continue',
      '    raise AssertionError("malformed text was accepted")',
      'print("FAIL_CLOSED")',
    ].join('\n');
    expect(runNode(tsEmission.source.replace('function __probe()', 'function __probe(s)'), tsSuffix)).toBe(
      'FAIL_CLOSED',
    );
    expect(runPython(pyEmission.source.replace('def __probe():', 'def __probe(s):'), pySuffix)).toBe('FAIL_CLOSED');
  });
});

if (!pythonAvailable) {
  describe('Text.utf8Length — real generated TypeScript/Python execution parity', () => {
    test.skip('python3 is unavailable', () => {});
  });
}
