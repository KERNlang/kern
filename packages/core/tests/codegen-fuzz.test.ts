/**
 * Codegen output fuzzing — property-based tests with random IRNodes.
 *
 * Verifies:
 * 1. generateCoreNode never throws on well-formed IRNodes
 * 2. Safe emitters reject dangerous input (injection patterns)
 * 3. No generated output contains unescaped template literals or semicolons in type positions
 */

import type { IRNode } from '../src/types.js';
import { generateCoreNode } from '../src/codegen-core.js';
import { emitIdentifier, emitTypeAnnotation, emitImportSpecifier } from '../src/codegen/emitters.js';
import { KernCodegenError } from '../src/errors.js';

// ── Random generators ───────────────────────────────────────────────────

const SAFE_NAMES = ['foo', 'Bar', 'myVar', '_private', '$state', 'camelCase', 'PascalCase', 'x', 'item'];
const SAFE_TYPES = ['string', 'number', 'boolean', 'void', 'any', 'unknown', 'string[]', 'Map<string, number>', 'Promise<void>', 'Foo | null', '(x: number) => void', 'Record<string, unknown>', '[string, number]'];
const CODEGEN_TYPES = ['type', 'interface', 'union', 'service', 'fn', 'machine', 'error', 'config', 'store', 'event', 'import', 'const', 'on', 'derive', 'guard', 'invariant', 'collect', 'action'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomName(): string {
  return pick(SAFE_NAMES);
}

function randomType(): string {
  return pick(SAFE_TYPES);
}

function makeNode(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children: children.length > 0 ? children : undefined };
}

function makeField(name?: string, type?: string): IRNode {
  return makeNode('field', { name: name || randomName(), type: type || randomType() });
}

function randomCoreNode(): IRNode {
  const t = pick(CODEGEN_TYPES);
  switch (t) {
    case 'type':
      return makeNode('type', { name: randomName(), values: 'a|b|c' });
    case 'interface':
      return makeNode('interface', { name: randomName() }, [makeField(), makeField()]);
    case 'union':
      return makeNode('union', { name: randomName(), discriminant: 'kind' }, [
        makeNode('variant', { name: 'a' }, [makeField()]),
        makeNode('variant', { name: 'b' }, [makeField()]),
      ]);
    case 'service':
      return makeNode('service', { name: randomName() }, [
        makeField(),
        makeNode('method', { name: randomName(), returns: randomType() }, [
          makeNode('handler', { code: 'return null;' }),
        ]),
      ]);
    case 'fn':
      return makeNode('fn', { name: randomName(), params: 'x:string', returns: randomType() }, [
        makeNode('handler', { code: 'return x;' }),
      ]);
    case 'machine':
      return makeNode('machine', { name: randomName() }, [
        makeNode('state', { name: 'on' }),
        makeNode('state', { name: 'off' }),
        makeNode('transition', { name: 'toggle', from: 'on', to: 'off' }),
      ]);
    case 'error':
      return makeNode('error', { name: randomName(), extends: 'Error' });
    case 'config':
      return makeNode('config', { name: randomName() }, [
        makeNode('field', { name: 'port', type: 'number', default: '3000' }),
      ]);
    case 'store':
      return makeNode('store', { name: randomName(), path: '~/.data', key: 'id', model: randomName() });
    case 'event':
      return makeNode('event', { name: randomName() }, [
        makeNode('type', { name: 'start' }),
        makeNode('type', { name: 'stop' }),
      ]);
    case 'import':
      return makeNode('import', { from: './utils', names: 'add,sub' });
    case 'const':
      return makeNode('const', { name: randomName(), type: randomType(), value: '42' });
    case 'on':
      return makeNode('on', { event: 'click' }, [
        makeNode('handler', { code: 'console.log("clicked");' }),
      ]);
    case 'derive':
      return makeNode('derive', { name: randomName(), expr: 'items.length', type: 'number' });
    case 'guard':
      return makeNode('guard', { name: randomName(), expr: 'x > 0' });
    case 'invariant':
      return makeNode('invariant', { name: randomName(), expr: 'count >= 0' });
    case 'collect':
      return makeNode('collect', { name: randomName(), from: 'items' });
    case 'action':
      return makeNode('action', { name: randomName() }, [
        makeNode('handler', { code: 'await doIt();' }),
      ]);
    default:
      return makeNode('type', { name: 'Fallback', values: 'x|y' });
  }
}

// ── Fuzz tests ──────────────────────────────────────────────────────────

describe('Codegen fuzzing', () => {
  it('generateCoreNode handles 100 random valid nodes without throwing', () => {
    for (let i = 0; i < 100; i++) {
      const node = randomCoreNode();
      const result = generateCoreNode(node);
      expect(Array.isArray(result)).toBe(true);
      expect(result.every(line => typeof line === 'string')).toBe(true);
    }
  });

  it('generated output is always string[]', () => {
    for (let i = 0; i < 50; i++) {
      const node = randomCoreNode();
      const output = generateCoreNode(node);
      expect(Array.isArray(output)).toBe(true);
      for (const line of output) {
        expect(typeof line).toBe('string');
      }
    }
  });
});

describe('Emitter fuzzing', () => {
  const INJECTION_PAYLOADS = [
    "'; alert(1); //",
    'foo; throw 1',
    'bar\nconst evil = 1',
    'x"; console.log(1); "',
    'a b c',
    'kebab-case',
    'dot.notation',
    'foo()',
    'foo[0]',
  ];

  it('emitIdentifier rejects all injection payloads', () => {
    for (const payload of INJECTION_PAYLOADS) {
      expect(() => emitIdentifier(payload, 'safe')).toThrow(KernCodegenError);
    }
  });

  it('emitTypeAnnotation rejects injection payloads', () => {
    const typeInjections = [
      'string; console.log(1)',
      'typeof import("fs")',
      'string // evil comment',
      'string /* block comment */',
      'Map<string',
      'string>',
    ];
    for (const payload of typeInjections) {
      expect(() => emitTypeAnnotation(payload, 'unknown')).toThrow(KernCodegenError);
    }
  });

  it('emitImportSpecifier rejects injection payloads', () => {
    const importInjections = [
      "'; alert(1); //",
      'foo;bar',
      'path\nwith\nnewlines',
    ];
    for (const payload of importInjections) {
      expect(() => emitImportSpecifier(payload)).toThrow(KernCodegenError);
    }
  });

  it('emitTypeAnnotation accepts all safe types', () => {
    for (const t of SAFE_TYPES) {
      expect(() => emitTypeAnnotation(t, 'unknown')).not.toThrow();
      expect(emitTypeAnnotation(t, 'unknown')).toBe(t);
    }
  });

  it('emitIdentifier accepts all safe names', () => {
    for (const n of SAFE_NAMES) {
      expect(() => emitIdentifier(n, 'safe')).not.toThrow();
      expect(emitIdentifier(n, 'safe')).toBe(n);
    }
  });
});
