import { readFileSync } from 'node:fs';

import { bindInternalEffectMachineState } from '../src/ir/semantics/internal-effect-machine-helper-state.js';
import type { InternalEffectMachineState } from '../src/ir/semantics/internal-effect-machine-types.js';
import { installInternalTextCodePointCache } from '../src/ir/semantics/internal-text-code-point-cache.js';
import { evalPortableValue } from '../src/ir/semantics/portable-machine-evaluator.js';
import { makeEnv } from '../src/ir/semantics/semantic-env.js';
import { parseExpression } from '../src/parser-expression.js';

function state(maxStringBytes: number): InternalEffectMachineState {
  const machine = { remainingIterations: 1 };
  installInternalTextCodePointCache(machine, maxStringBytes);
  return machine;
}

function evaluate(expression: string, source: string, machine: InternalEffectMachineState) {
  const env = makeEnv({ bindings: new Map([['source', source]]) });
  const restore = bindInternalEffectMachineState(env, machine);
  try {
    return evalPortableValue(parseExpression(expression), env);
  } finally {
    restore();
  }
}

describe('internal effect-machine Text code-point cache', () => {
  test('maps scalar boundaries exactly without exposing retained storage', () => {
    const source = '😀a𐐀😀';
    const machine = state(64);

    expect(evaluate('Text.length(source)', source, machine)).toBe(4);
    expect(evaluate('Text.utf8Length(source)', source, machine)).toBe(13);
    expect(evaluate('Text.charAt(source, 0)', source, machine)).toBe('😀');
    expect(evaluate('Text.charAt(source, 1)', source, machine)).toBe('a');
    expect(evaluate('Text.charAt(source, 2)', source, machine)).toBe('𐐀');
    expect(evaluate('Text.charAt(source, 3)', source, machine)).toBe('😀');
    expect(evaluate('Text.slice(source, 1, 3)', source, machine)).toBe('a𐐀');
    expect(evaluate('Text.indexOf(source, "𐐀😀")', source, machine)).toBe(2);
    expect(Object.keys(machine)).toEqual(['remainingIterations']);
  });

  test('cache admission and eviction never change Text outcomes', () => {
    const machine = state(4);
    const first = '😀'.repeat(128);
    const second = '𐐀'.repeat(128);

    expect(evaluate('Text.charAt(source, 127)', first, machine)).toBe('😀');
    expect(evaluate('Text.utf8Length(source)', first, machine)).toBe(512);
    expect(evaluate('Text.charAt(source, 127)', second, machine)).toBe('𐐀');
    expect(evaluate('Text.charAt(source, 127)', first, machine)).toBe('😀');
  });

  test('rejects malformed UTF-16 before insertion', () => {
    const machine = state(1024);
    expect(() => evaluate('Text.length(source)', '\ud800', machine)).toThrow(/malformed.*UTF-16/u);
    expect(() => evaluate('Text.utf8Length(source)', '\udc00', machine)).toThrow(/malformed.*UTF-16/u);
    expect(() => evaluate('Text.length(source)', '\udc00', machine)).toThrow(/malformed.*UTF-16/u);
    expect(() => evaluate('Text.length(source)', '\ud800\ud800', machine)).toThrow(/malformed.*UTF-16/u);
    expect(evaluate('Text.length(source)', 'a', machine)).toBe(1);
  });

  test('does not share retained state between executions', () => {
    const first = state(1024);
    const second = state(1024);
    expect(evaluate('Text.length(source)', 'same', first)).toBe(4);
    expect(evaluate('Text.length(source)', 'same', second)).toBe(4);
    expect(Object.keys(first)).toEqual(['remainingIterations']);
    expect(Object.keys(second)).toEqual(['remainingIterations']);
  });

  test('validates malformed receivers before index diagnostics', () => {
    const machine = state(1024);
    expect(() => evaluate('Text.charAt(source, 1.5)', '\ud800', machine)).toThrow(/malformed.*UTF-16/u);
    expect(() => evaluate('Text.slice(source, -1, 99)', '\ud800', machine)).toThrow(/malformed.*UTF-16/u);
    expect(() => evaluate('Text.indexOf(source, 1)', '\ud800', machine)).toThrow(/malformed.*UTF-16/u);
    expect(() => evaluate('Text.startsWith(source, false)', '\ud800', machine)).toThrow(/malformed.*UTF-16/u);
  });

  test('startsWith validates operands without depending on cache admission', () => {
    const machine = state(1);
    const source = `${'a'.repeat(16_384)}😀`;
    expect(evaluate('Text.startsWith(source, "aaaa")', source, machine)).toBe(true);
    expect(() => evaluate('Text.startsWith(source, "\\uD800")', source, machine)).toThrow(/malformed.*UTF-16/u);
  });

  test('matches Array.from scalar behavior across deterministic mixed samples', () => {
    const machine = state(64);
    const samples = ['', 'ascii', 'é日', '😀a𐐀😀', 'a\r\nb', '𝄞'.repeat(32)];
    for (const source of samples) {
      const expected = Array.from(source);
      expect(evaluate('Text.length(source)', source, machine)).toBe(expected.length);
      for (let index = 0; index < expected.length; index += 1) {
        expect(evaluate(`Text.charAt(source, ${index})`, source, machine)).toBe(expected[index]);
      }
      expect(evaluate(`Text.slice(source, 0, ${expected.length})`, source, machine)).toBe(source);
    }
  });

  test('keeps cache admission allocation-bounded and startsWith cache-neutral', () => {
    const source = readFileSync(
      new URL('../src/ir/semantics/internal-text-code-point-cache.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/Array\.from|textCodePoints|readonly string\[\]/u);
    expect(source).not.toMatch(/cache budget exhausted/u);
    expect(source.indexOf('const cost = retainedCost')).toBeLessThan(
      source.indexOf('const astralScalarPositions = materializeAstralPositions'),
    );
    const startsWith = source.slice(source.indexOf('export function internalTextStartsWith'));
    expect(startsWith).not.toMatch(/acquireTextScalarIndex|stores\.get|new Uint32Array/u);
  });

  test('compat sync and async machine paths propagate the accepted string limit and envelope trace retention', () => {
    const compatSource = readFileSync(new URL('../src/runtime-envelope/execute-compat.ts', import.meta.url), 'utf8');
    const engineSource = readFileSync(new URL('../src/runtime-envelope/internal-engine.ts', import.meta.url), 'utf8');
    const machineSource = readFileSync(
      new URL('../src/ir/semantics/internal-effect-machine.ts', import.meta.url),
      'utf8',
    );

    expect(compatSource).toMatch(
      /runInternalRuntimeEngineSync\([\s\S]*?accepted\.limits\.maxStringBytes,\s*'observable-only',?\s*\)/u,
    );
    expect(compatSource).toMatch(
      /runInternalRuntimeEngineAsync\([\s\S]*?textCodePointCacheMaxStringBytes:\s*accepted\.limits\.maxStringBytes,[\s\S]*?traceRetention:\s*'observable-only'/u,
    );
    expect(engineSource).toMatch(/runInternalEffectMachineSync\([\s\S]*?textCodePointCacheMaxStringBytes/u);
    expect(engineSource).toMatch(/runInternalEffectMachineAsync\(nodes, env, options\)/u);
    expect(
      machineSource.match(/installInternalTextCodePointCache\(state, options\.textCodePointCacheMaxStringBytes\)/gu),
    ).toHaveLength(2);
  });
});
