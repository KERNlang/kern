import { readFileSync } from 'node:fs';

import {
  parseWithGenericPropertyAdmissionSafety,
  parseWithGenericPropertyLoopSafety,
  parseWithGenericPropertyThemeRefsSafety,
  parseWithMutableNodeTypeRegistrySnapshot,
} from '../src/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../src/runtime-state.js';

const SNAPSHOT_LIMITS = Object.freeze({
  maxNameBytes: 256,
  maxNameCodePoints: 128,
  maxRegistryEntries: 64,
});

function parseWithSnapshot(source: string, runtime: KernRuntime) {
  return parseWithMutableNodeTypeRegistrySnapshot(source, runtime, SNAPSHOT_LIMITS);
}

function unknownCodes(result: ReturnType<typeof parseWithMutableNodeTypeRegistrySnapshot>): string[] {
  return result.parseResult.diagnostics
    .filter((diagnostic) => diagnostic.code === 'UNKNOWN_NODE_TYPE')
    .map((d) => d.code);
}

describe('mutable node-type registry snapshot', () => {
  it('binds canonical membership to one runtime and increasing parse epochs', () => {
    const runtime = new KernRuntime();
    const defaultMultilineTypes = [...runtime.multilineBlockTypes];
    runtime.registerEvolvedType('zeta');
    runtime.registerEvolvedType('alpha');
    runtime.registerParserHints('widget', { multilineBlock: 'body' });
    runtime.registerTemplate('card', { name: 'card', slots: [], imports: [], body: '// card' });

    const first = parseWithSnapshot('alpha', runtime);
    const second = parseWithSnapshot('card', runtime);

    expect(first.snapshot.runtimeInstance).toBe(second.snapshot.runtimeInstance);
    expect(first.snapshot.parseEpoch).toBe(1);
    expect(second.snapshot.parseEpoch).toBe(2);
    expect(first.snapshot.evolvedTypes).toEqual(['alpha', 'zeta']);
    expect(first.snapshot.multilineTypes).toEqual([...defaultMultilineTypes, 'widget'].sort());
    expect(first.snapshot.templateTypes).toEqual(['card']);
    expect(unknownCodes(first)).toEqual([]);
    expect(unknownCodes(second)).toEqual([]);
  });

  it('keeps equal-content runtimes instance-distinct', () => {
    const left = new KernRuntime();
    const right = new KernRuntime();
    left.dynamicNodeTypes.add('widget');
    right.dynamicNodeTypes.add('widget');

    const a = parseWithSnapshot('widget', left);
    const b = parseWithSnapshot('widget', right);

    expect(a.snapshot.runtimeInstance).not.toBe(b.snapshot.runtimeInstance);
    expect(a.snapshot.parseEpoch).toBe(1);
    expect(b.snapshot.parseEpoch).toBe(1);
    expect(a.snapshot.evolvedTypes).toEqual(b.snapshot.evolvedTypes);
  });

  it('captures direct legacy writes and all category overlaps exactly', () => {
    const runtime = new KernRuntime();
    runtime.dynamicNodeTypes.add('shared');
    runtime.multilineBlockTypes.add('shared');
    runtime.templateRegistry.set('shared', { name: 'shared', slots: [], imports: [], body: '' });

    const result = parseWithSnapshot('shared', runtime);

    expect(result.snapshot.evolvedTypes).toContain('shared');
    expect(result.snapshot.multilineTypes).toContain('shared');
    expect(result.snapshot.templateTypes).toContain('shared');
    expect(unknownCodes(result)).toEqual([]);
  });

  it('assigns a new epoch after add-delete restoration without inventing content drift', () => {
    const runtime = new KernRuntime();
    const before = parseWithSnapshot('missing', runtime);
    runtime.dynamicNodeTypes.add('temporary');
    runtime.dynamicNodeTypes.delete('temporary');
    const after = parseWithSnapshot('missing', runtime);

    expect(after.snapshot.parseEpoch).toBe(before.snapshot.parseEpoch + 1);
    expect(after.snapshot.evolvedTypes).toEqual(before.snapshot.evolvedTypes);
    expect(unknownCodes(before)).toEqual(['UNKNOWN_NODE_TYPE']);
    expect(unknownCodes(after)).toEqual(['UNKNOWN_NODE_TYPE']);
  });

  it('treats duplicate membership and same-name template replacement as membership-idempotent', () => {
    const runtime = new KernRuntime();
    runtime.registerEvolvedType('widget');
    runtime.registerEvolvedType('widget');
    runtime.registerTemplate('card', { name: 'card', slots: [], imports: [], body: 'first' });
    const first = parseWithSnapshot('card', runtime);
    runtime.registerTemplate('card', { name: 'card', slots: [], imports: [], body: 'second' });
    const second = parseWithSnapshot('card', runtime);

    expect(first.snapshot.evolvedTypes).toEqual(['widget']);
    expect(second.snapshot.evolvedTypes).toEqual(['widget']);
    expect(first.snapshot.templateTypes).toEqual(['card']);
    expect(second.snapshot.templateTypes).toEqual(['card']);
    expect(second.snapshot.parseEpoch).toBe(first.snapshot.parseEpoch + 1);
  });

  it('fails closed when default multiline ownership or collection identity is corrupted', () => {
    const missingDefault = new KernRuntime();
    missingDefault.multilineBlockTypes.delete('handler');
    expect(() => parseWithSnapshot('text', missingDefault)).toThrow(/default multiline/);

    const alteredPrototype = new KernRuntime();
    Object.setPrototypeOf(alteredPrototype.dynamicNodeTypes, null);
    expect(() => parseWithSnapshot('text', alteredPrototype)).toThrow(/native Set/);
  });

  it('freezes returned evidence and rejects empty or non-string direct registry names', () => {
    const runtime = new KernRuntime();
    runtime.dynamicNodeTypes.add('widget');
    const result = parseWithSnapshot('widget', runtime);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(Object.isFrozen(result.snapshot.evolvedTypes)).toBe(true);

    runtime.dynamicNodeTypes.add('');
    expect(() => parseWithSnapshot('widget', runtime)).toThrow(/non-empty strings/);
    runtime.dynamicNodeTypes.delete('');
    (runtime.dynamicNodeTypes as Set<unknown>).add(7);
    expect(() => parseWithSnapshot('widget', runtime)).toThrow(/non-empty strings/);
  });

  it('rejects proxied runtimes before a property trap can interleave capture and parse', () => {
    const target = new KernRuntime();
    let trapped = false;
    const runtime = new Proxy(target, {
      get(object, property, receiver) {
        trapped = true;
        return Reflect.get(object, property, receiver);
      },
    });

    expect(() => parseWithSnapshot('widget', runtime)).toThrow(/proxi/);
    expect(trapped).toBe(false);
  });

  it('rejects parser-used iterator tampering before registry capture', () => {
    const runtime = new KernRuntime();
    const originalIterator = Set.prototype[Symbol.iterator];
    let thrown: unknown;
    Set.prototype[Symbol.iterator] = function iteratorMutation(this: Set<string>) {
      runtime.dynamicNodeTypes.add('widget');
      return originalIterator.call(this);
    };
    try {
      parseWithSnapshot('widget', runtime);
    } catch (error) {
      thrown = error;
    } finally {
      Set.prototype[Symbol.iterator] = originalIterator;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(String(thrown)).toMatch(/iterator/);
    expect(runtime.dynamicNodeTypes.has('widget')).toBe(false);
  });

  it('rejects proxied parser hints before admission can invoke a getter', () => {
    const runtime = new KernRuntime();
    let trapped = false;
    const hints = new Proxy(
      { bareWord: 'name' },
      {
        get(object, property, receiver) {
          trapped = true;
          return Reflect.get(object, property, receiver);
        },
      },
    );
    runtime.parserHints.set('widget', hints);

    expect(() => parseWithSnapshot('widget value', runtime)).toThrow(/parserHints.*plain data/);
    expect(trapped).toBe(false);
  });

  it('rejects oversized collections and names before copying or sorting them', () => {
    const tooMany = new KernRuntime();
    for (let index = 0; index <= SNAPSHOT_LIMITS.maxRegistryEntries; index += 1) {
      tooMany.dynamicNodeTypes.add(`type-${index}`);
    }
    expect(() => parseWithSnapshot('widget', tooMany)).toThrow(/entry limit/);

    const tooLong = new KernRuntime();
    tooLong.dynamicNodeTypes.add('x'.repeat(SNAPSHOT_LIMITS.maxNameCodePoints + 1));
    expect(() => parseWithSnapshot('widget', tooLong)).toThrow(/code-point limit/);
  });

  it('keeps fused capture before parser entry and mutable admission before optional callbacks', () => {
    const wrapperSource = readFileSync(
      new URL('../src/mutable-node-type-registry-snapshot.ts', import.meta.url),
      'utf8',
    );
    const wrapperStart = wrapperSource.indexOf('export function parseWithMutableNodeTypeRegistrySnapshot');
    const wrapperEnd = wrapperSource.indexOf('export function consumeMutableNodeTypeRegistryParseEvidence');
    const wrapper = wrapperSource.slice(wrapperStart, wrapperEnd);
    const capture = wrapper.indexOf('captureSnapshot(runtime, limits)');
    const parse = wrapper.indexOf('parseWithDiagnostics(source, runtime, options)');
    expect(wrapperStart).toBeGreaterThanOrEqual(0);
    expect(wrapperEnd).toBeGreaterThan(wrapperStart);
    expect(capture).toBeGreaterThanOrEqual(0);
    expect(parse).toBeGreaterThan(capture);
    expect(wrapper.slice(capture, parse)).not.toMatch(
      /\b(?:await|yield|setTimeout|queueMicrotask|Promise)\b|import\s*\(/u,
    );

    const parserSource = readFileSync(new URL('../src/parser-core.ts', import.meta.url), 'utf8');
    const parseInternal = parserSource.slice(parserSource.indexOf('export function parseInternal'));
    const parseLines = parseInternal.indexOf('const parsed = parseLines(state, source, rt)');
    expect(parseLines).toBeGreaterThanOrEqual(0);
    for (const callback of [
      'options?.closureClassifier',
      'options?.resolveImport',
      'options?.nativeEligibilityClassifier',
    ]) {
      expect(parseInternal.indexOf(callback)).toBeGreaterThan(parseLines);
    }
  });

  it('rejects unsafe M4.164 property keys before parser entry without widening M4.162', () => {
    const runtime = new KernRuntime();
    for (const source of ['screen __proto__=bare', 'screen __proto__={{ ({ polluted: true }) }}']) {
      expect(() => parseWithGenericPropertyAdmissionSafety(source, runtime, SNAPSHOT_LIMITS)).toThrow(
        /reserved generic property key __proto__/,
      );
    }

    const safe = parseWithGenericPropertyAdmissionSafety(
      'screen name=Home # __proto__=ignored',
      runtime,
      SNAPSHOT_LIMITS,
    );
    expect(safe.snapshot.parseEpoch).toBe(1);
    expect(safe.parseResult.root.props?.name).toBe('Home');
    expect(() =>
      parseWithGenericPropertyAdmissionSafety('screen title="__proto__=ignored"', runtime, SNAPSHOT_LIMITS),
    ).not.toThrow();
    const inheritedNameInBareValue = parseWithGenericPropertyAdmissionSafety(
      'screen safe=__proto__=value',
      runtime,
      SNAPSHOT_LIMITS,
    );
    expect(inheritedNameInBareValue.parseResult.root.props?.safe).toBe('__proto__=value');
    expect(() =>
      parseWithGenericPropertyAdmissionSafety('screen name=Home // __proto__=ignored', runtime, SNAPSHOT_LIMITS),
    ).not.toThrow();

    expect(() =>
      parseWithMutableNodeTypeRegistrySnapshot('screen __proto__=legacy-bootstrap-debt', runtime, SNAPSHOT_LIMITS),
    ).not.toThrow();
  });

  it('rejects every inherited M4.165 loop key before epoch capture without widening prior entries', () => {
    const runtime = new KernRuntime();
    const baseline = parseWithGenericPropertyLoopSafety('screen name=Home', runtime, SNAPSHOT_LIMITS);
    expect(baseline.snapshot.parseEpoch).toBe(1);

    for (const source of ['screen constructor=one', 'screen safe=one toString=two', 'screen safe=one __proto__=two']) {
      expect(() => parseWithGenericPropertyLoopSafety(source, runtime, SNAPSHOT_LIMITS)).toThrow(
        /(?:inherited|reserved) generic property key/,
      );
    }
    const afterRejections = parseWithGenericPropertyLoopSafety('screen name=After', runtime, SNAPSHOT_LIMITS);
    expect(afterRejections.snapshot.parseEpoch).toBe(2);

    expect(() =>
      parseWithGenericPropertyLoopSafety(
        'screen title="// constructor=quoted" # toString=comment',
        runtime,
        SNAPSHOT_LIMITS,
      ),
    ).not.toThrow();
    const inheritedNameInBareValue = parseWithGenericPropertyLoopSafety(
      'screen safe=toString=value',
      runtime,
      SNAPSHOT_LIMITS,
    );
    expect(inheritedNameInBareValue.parseResult.root.props?.safe).toBe('toString=value');

    Object.defineProperty(Object.prototype, 'm4165PollutedKey', {
      configurable: true,
      value: 'polluted',
    });
    try {
      expect(() =>
        parseWithGenericPropertyLoopSafety('screen m4165PollutedKey=value', runtime, SNAPSHOT_LIMITS),
      ).toThrow(/inherited generic property key m4165PollutedKey/);
    } finally {
      delete (Object.prototype as Record<string, unknown>).m4165PollutedKey;
    }

    const legacy = parseWithGenericPropertyAdmissionSafety('screen constructor=legacy', runtime, SNAPSHOT_LIMITS);
    expect(legacy.parseResult.root.props?.constructor).toBe('legacy');
    expect(legacy.parseResult.diagnostics.map(({ code }) => code)).toContain('DUPLICATE_PROP');
    expect(() =>
      parseWithMutableNodeTypeRegistrySnapshot('screen constructor=legacy', runtime, SNAPSHOT_LIMITS),
    ).not.toThrow();
  });

  it('preserves M4.165 key safety for the M4.166 theme-enabled loop entry', () => {
    const runtime = new KernRuntime();
    const safe = parseWithGenericPropertyThemeRefsSafety('screen a=one $base b=two', runtime, SNAPSHOT_LIMITS);
    expect(safe.snapshot.parseEpoch).toBe(1);
    expect(safe.parseResult.root.props).toEqual({ a: 'one', b: 'two', themeRefs: ['base'] });
    for (const source of ['screen constructor=one $base', 'screen a=one toString=two $base']) {
      expect(() => parseWithGenericPropertyThemeRefsSafety(source, runtime, SNAPSHOT_LIMITS)).toThrow(
        /inherited generic property key/,
      );
    }
    expect(parseWithGenericPropertyLoopSafety('screen safe=legacy', runtime, SNAPSHOT_LIMITS).snapshot.parseEpoch).toBe(
      2,
    );
  });
});
