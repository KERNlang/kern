import {
  assertInternalMachineTextSplicePreflight,
  parseInternalMachineTextSplice,
  runInternalMachineTextSplice,
} from '../src/ir/semantics/internal-effect-machine-text-splice.js';
import { defineBinding, defineIntBinding, getBinding, makeEnv } from '../src/ir/semantics/semantic-env.js';
import { parseExpression } from '../src/parser-expression.js';
import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../src/runtime-handler.js';

const limits = {
  maxBytes: 1_048_576,
  maxCollectionLength: 8192,
  maxDepth: 64,
  maxDiagnostics: 8,
  maxEvents: 8,
  maxStringBytes: 65_536,
};

function source(operation: string, declarations: readonly string[] = []): string {
  return [
    'fn name=splice returns="string[]" export=true',
    '  param name=input type=string',
    '  handler lang="kern"',
    '    let name=start value="1"',
    '    let name=end value="3"',
    '    let name=replacement value="\\"XY\\""',
    '    let name=cap value="64"',
    ...declarations.map((line) => `    ${line}`),
    `    ${operation}`,
    '    return value="[input]"',
  ].join('\n');
}

function execute(program: string, input = 'abcd') {
  return executeKernRuntimeHandlerSync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: [input],
      identity: { handlerName: 'splice', sourcePath: 'tests/text-splice.kern' },
      source: program,
    },
    { enabled: true, limits },
  );
}

function value(program: string, input = 'abcd'): unknown {
  const envelope = execute(program, input);
  expect(envelope.outcome, JSON.stringify(envelope.diagnostics)).toBe('success');
  expect(envelope.result.presence).toBe('value');
  return envelope.result.presence === 'value' ? envelope.result.value : undefined;
}

describe('internal effect-machine text splice', () => {
  test('atomically replaces a code-point range through direct bindings', () => {
    expect(value(source('do value="Text.splice(input, start, end, replacement, cap)"'))).toEqual({
      tag: 'list',
      value: [{ tag: 'text', value: 'aXYd' }],
    });
    expect(value(source('do value="Text.splice(input, start, end, replacement, cap)"'), '😀bcd')).toEqual({
      tag: 'list',
      value: [{ tag: 'text', value: '😀XYd' }],
    });
  });

  test.each([
    'Text.splice(input, start + 0, end, replacement, cap)',
    'Text.splice(input, start, end, replacement + "", cap)',
    'Text.splice(input, start, end, String(replacement), cap)',
    'Text.splice(input, start, end, true ? replacement : input, cap)',
    'Text.splice(input, start, end, `${replacement}`, cap)',
    'Text.splice(input, start, end, input[start], cap)',
    'Text.splice(input.length, start, end, replacement, cap)',
  ])('rejects executable or computed operands: %s', (call) => {
    expect(execute(source(`do value="${call.replaceAll('"', '\\"')}"`)).outcome).toBe('failure');
  });

  test('rejects namespace shadowing and non-string operands', () => {
    expect(
      execute(
        source('do value="Text.splice(input, start, end, replacement, cap)"', ['let name=Text value="\\"shadow\\""']),
      ).outcome,
    ).toBe('failure');
    expect(
      execute(source('do value="Text.splice(input, start, end, bad, cap)"', ['let name=bad value="1"'])).outcome,
    ).toBe('failure');
  });

  test.each([
    ['assign target=start value="-1"'],
    ['assign target=end value="5"'],
    ['assign target=start value="3"', 'assign target=end value="2"'],
    ['assign target=cap value="3"'],
  ])('rejects invalid bounds or caps without returning a mutated target', (...declarations) => {
    expect(
      execute(source('do value="Text.splice(input, start, end, replacement, cap)"', declarations as string[])).outcome,
    ).toBe('failure');
  });

  test('keeps the target unchanged when concrete validation rejects', () => {
    const parsed = parseInternalMachineTextSplice(parseExpression('Text.splice(target, start, end, replacement, cap)'));
    expect(parsed).toBeDefined();
    for (const invalid of [
      { cap: 3, end: 3, replacement: 'XY', start: 1, target: 'abcd' },
      { cap: 64, end: 3, replacement: 'XY', start: -1, target: 'abcd' },
      { cap: 64, end: 5, replacement: 'XY', start: 1, target: 'abcd' },
      { cap: 1_000_001, end: 3, replacement: 'XY', start: 1, target: 'abcd' },
      { cap: 64, end: 3, replacement: '\ud800', start: 1, target: 'abcd' },
      { cap: 64, end: 3, replacement: 'XY', start: 1, target: '\ud800abc' },
    ]) {
      const env = makeEnv();
      defineBinding(env, 'target', invalid.target);
      defineBinding(env, 'replacement', invalid.replacement);
      defineIntBinding(env, 'start', invalid.start);
      defineIntBinding(env, 'end', invalid.end);
      defineIntBinding(env, 'cap', invalid.cap);
      expect(() => runInternalMachineTextSplice(parsed!, env)).toThrow();
      expect(getBinding(env, 'target')).toBe(invalid.target);
    }
  });

  test('requires static integer provenance before execution', () => {
    const parsed = parseInternalMachineTextSplice(parseExpression('Text.splice(target, start, end, replacement, cap)'));
    const env = makeEnv();
    defineBinding(env, 'target', 'abcd');
    defineBinding(env, 'replacement', 'XY');
    defineBinding(env, 'start', null);
    defineIntBinding(env, 'end', 3);
    defineIntBinding(env, 'cap', 64);
    expect(() => assertInternalMachineTextSplicePreflight(parsed!, env)).toThrow(
      'start must be a known, proven, or declared deferred integer',
    );
  });

  test('does not broaden ordinary deferred Text.slice assignment', () => {
    const program = [
      'fn name=wrap returns=string',
      '  param name=value type=string',
      '  handler lang="kern"',
      '    return value="\\"[\\" + value + "]\\""',
      '',
      'fn name=splice returns="string[]" export=true',
      '  param name=input type=string',
      '  handler lang="kern"',
      '    let name=cursor value="0"',
      '    while cond="cursor < 1"',
      '      assign target=input value="input + \\"x\\""',
      '      assign target=cursor value="cursor + 1"',
      '    let name=start value="0"',
      '    let name=end value="1"',
      '    let name=replacement value="\\"Y\\""',
      '    assign target=input value="Text.slice(input, 0, start) + wrap(replacement) + Text.slice(input, end, Text.length(input))"',
      '    return value="[input]"',
    ].join('\n');
    expect(execute(program)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      outcome: 'failure',
    });
  });
});
