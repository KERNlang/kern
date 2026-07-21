import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { decodeCanonicalValue, encodeCanonicalValue } from '../src/canonical-value/canonical.js';
import type { CanonicalValue, CanonicalValueLimits } from '../src/canonical-value/types.js';
import { decodeModuleKir, encodeModuleKir } from '../src/kir-structural/module-canonical.js';
import { ModuleKirError, type ModuleKirInput } from '../src/kir-structural/module-types.js';
import { StructuralKirError } from '../src/kir-structural/types.js';
import type { IRNode } from '../src/types.js';

const limits: CanonicalValueLimits = {
  maxBytes: 262_144,
  maxDepth: 64,
  maxNodes: 4_096,
  maxStringBytes: 8_192,
  maxCollectionLength: 1_024,
  maxRecordFields: 512,
  maxMapEntries: 64,
  maxIntegerDigits: 256,
  maxFractionDigits: 256,
  maxDecimalChars: 520,
};

function roots(children: IRNode[]): IRNode[] {
  return children;
}

function declaration(type: 'class' | 'fn', name: string, exported = true): IRNode {
  return { type, props: { export: exported, name } };
}

function binding(name: string, kind: 'class' | 'fn', as?: string, exported = false): IRNode {
  return { type: 'from', props: { ...(as === undefined ? {} : { as }), export: exported, kind, name } };
}

function moduleFixture(): ModuleKirInput[] {
  return [
    {
      id: 'lib/symbols.kern',
      roots: roots([declaration('class', 'Counter'), declaration('fn', 'double')]),
    },
    {
      id: 'main.kern',
      roots: roots([
        {
          type: 'use',
          props: { path: './lib/symbols' },
          children: [binding('double', 'fn', 'twice', true), binding('Counter', 'class', 'LocalCounter')],
        },
        declaration('fn', 'main'),
      ]),
    },
  ];
}

function expectModuleCode(action: () => unknown, code: ModuleKirError['code']): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ModuleKirError);
    expect((error as ModuleKirError).code).toBe(code);
  }
}

function expectStructuralCode(action: () => unknown, code: StructuralKirError['code']): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StructuralKirError);
    expect((error as StructuralKirError).code).toBe(code);
  }
}

function recordField(value: CanonicalValue, key: string): CanonicalValue {
  if (value.tag !== 'record') throw new Error(`expected record containing ${key}`);
  const result = value.value.find((entry) => entry.key === key)?.value;
  if (result === undefined) throw new Error(`missing ${key}`);
  return result;
}

function listItem(value: CanonicalValue, index: number): CanonicalValue {
  if (value.tag !== 'list' || value.value[index] === undefined) throw new Error(`missing list item ${index}`);
  return value.value[index];
}

describe('internal structural KIR module graph', () => {
  test('round-trips fn/class aliases and re-exports under the explicit catalog', () => {
    const bytes = encodeModuleKir(moduleFixture(), limits);
    const artifact = decodeModuleKir(bytes, limits);
    expect(artifact.format).toBe('kern.kir.modules.r1.5e.1-alpha');
    expect(artifact.proofLabel).toBe('ALPHA-NO-GO');
    expect(artifact.diagnostics).toEqual([]);
    expect(artifact.symbolCatalog.admittedKinds).toEqual(['class', 'fn']);
    expect(artifact.modules.map((module) => module.id)).toEqual(['lib/symbols.kern', 'main.kern']);
    expect(artifact.modules[0]?.exports).toEqual([
      { kind: 'class', name: 'Counter', source: null },
      { kind: 'fn', name: 'double', source: null },
    ]);
    expect(artifact.modules[1]?.imports[0]?.bindings).toEqual([
      { imported: 'Counter', kind: 'class', local: 'LocalCounter', reexport: false },
      { imported: 'double', kind: 'fn', local: 'twice', reexport: true },
    ]);
    expect(artifact.modules[1]?.exports).toEqual([
      { kind: 'fn', name: 'main', source: null },
      { kind: 'fn', name: 'twice', source: 'lib/symbols.kern' },
    ]);
  });

  test('module input order is irrelevant while structural child order remains significant', () => {
    const modules = moduleFixture();
    expect(encodeModuleKir([...modules].reverse(), limits)).toEqual(encodeModuleKir(modules, limits));
    const reordered = structuredClone(modules);
    reordered[1]?.roots.reverse();
    expect(encodeModuleKir(reordered, limits)).not.toEqual(encodeModuleKir(modules, limits));
  });

  test('resolves transitive re-exports before linking downstream imports', () => {
    const modules: ModuleKirInput[] = [
      { id: 'a.kern', roots: [declaration('fn', 'base')] },
      {
        id: 'b.kern',
        roots: [
          {
            type: 'use',
            props: { path: './a' },
            children: [binding('base', 'fn', 'middle', true)],
          },
        ],
      },
      {
        id: 'c.kern',
        roots: [
          {
            type: 'use',
            props: { path: './b' },
            children: [binding('middle', 'fn', 'final')],
          },
        ],
      },
    ];
    const artifact = decodeModuleKir(encodeModuleKir(modules, limits), limits);
    expect(artifact.modules[1]?.exports).toEqual([{ kind: 'fn', name: 'middle', source: 'a.kern' }]);
    expect(artifact.modules[2]?.imports[0]?.bindings).toEqual([
      { imported: 'middle', kind: 'fn', local: 'final', reexport: false },
    ]);
  });

  test.each([
    ['missing-module', () => [{ id: 'main.kern', roots: roots([{ type: 'use', props: { path: './missing' } }]) }]],
    [
      'missing-export',
      () => {
        const modules = moduleFixture();
        modules[1]?.roots[0]?.children?.push(binding('absent', 'fn'));
        return modules;
      },
    ],
    [
      'kind-mismatch',
      () => {
        const modules = moduleFixture();
        const from = modules[1]?.roots[0]?.children?.[0];
        if (from?.props) from.props.kind = 'class';
        return modules;
      },
    ],
    [
      'duplicate-local-binding',
      () => {
        const modules = moduleFixture();
        const from = modules[1]?.roots[0]?.children?.[0];
        if (from?.props) from.props.as = 'main';
        return modules;
      },
    ],
    [
      'module-cycle',
      () => [
        {
          id: 'a.kern',
          roots: roots([
            { type: 'use', props: { path: './b' }, children: [binding('b', 'fn')] },
            declaration('fn', 'a'),
          ]),
        },
        {
          id: 'b.kern',
          roots: roots([
            { type: 'use', props: { path: './a' }, children: [binding('a', 'fn')] },
            declaration('fn', 'b'),
          ]),
        },
      ],
    ],
  ] as const)('rejects hostile graph with %s', (code, fixture) => {
    expectModuleCode(() => encodeModuleKir(fixture(), limits), code);
  });

  test('graph error code and path are invariant to module input order', () => {
    const modules = moduleFixture();
    modules[1]?.roots[0]?.children?.push(binding('absent', 'fn'));
    const failure = (input: ModuleKirInput[]) => {
      try {
        encodeModuleKir(input, limits);
        throw new Error('expected graph failure');
      } catch (error) {
        if (!(error instanceof ModuleKirError)) throw error;
        return { code: error.code, path: error.path };
      }
    };
    expect(failure([...modules].reverse())).toEqual(failure(modules));
  });

  test.each(['C:/main.kern', 'C:main.kern', '/main.kern', './main.kern', '../main.kern', 'main', 'a//b.kern'])(
    'rejects unsafe module id %s',
    (id) => expectModuleCode(() => encodeModuleKir([{ id, roots: [] }], limits), 'invalid-module-id'),
  );

  test('rejects import resolution that escapes the artifact root', () => {
    expectModuleCode(
      () =>
        encodeModuleKir(
          [
            { id: 'main.kern', roots: roots([{ type: 'use', props: { path: '../outside' } }]) },
            { id: 'outside.kern', roots: [] },
          ],
          limits,
        ),
      'invalid-module-id',
    );
  });

  test('reader revalidates roots and rejects serialized metadata drift', () => {
    const value = structuredClone(decodeCanonicalValue(encodeModuleKir(moduleFixture(), limits), limits));
    const modules = recordField(value, 'modules');
    const main = listItem(modules, 1);
    const imports = recordField(main, 'imports');
    const firstImport = listItem(imports, 0);
    const bindings = recordField(firstImport, 'bindings');
    const firstBinding = listItem(bindings, 0);
    const local = recordField(firstBinding, 'local');
    if (local.tag !== 'text') throw new Error('expected local text');
    (local as { tag: 'text'; value: string }).value = 'drifted';
    expectModuleCode(() => decodeModuleKir(encodeCanonicalValue(value, limits), limits), 'metadata-mismatch');

    const rootDrift = structuredClone(decodeCanonicalValue(encodeModuleKir(moduleFixture(), limits), limits));
    const rootModules = recordField(rootDrift, 'modules');
    const library = listItem(rootModules, 0);
    const rootsValue = recordField(library, 'roots');
    const root = listItem(rootsValue, 0);
    const kind = recordField(root, 'kind');
    if (kind.tag !== 'text') throw new Error('expected root kind');
    (kind as { tag: 'text'; value: string }).value = 'screen';
    expectStructuralCode(() => decodeModuleKir(encodeCanonicalValue(rootDrift, limits), limits), 'invalid-artifact');
  });

  test('reader rejects raw type text hidden beneath the current module envelope', () => {
    const value = structuredClone(
      decodeCanonicalValue(
        encodeModuleKir(
          [{ id: 'main.kern', roots: [{ type: 'fn', props: { name: 'main', returns: 'string' } }] }],
          limits,
        ),
        limits,
      ),
    );
    const modules = recordField(value, 'modules');
    const module = listItem(modules, 0);
    const rootsValue = recordField(module, 'roots');
    const root = listItem(rootsValue, 0);
    const properties = recordField(root, 'properties');
    if (properties.tag !== 'record') throw new Error('expected root properties');
    const returns = properties.value.find((entry) => entry.key === 'returns');
    if (!returns) throw new Error('expected return type');
    returns.value = { tag: 'text', value: 'string' };
    expectStructuralCode(() => decodeModuleKir(encodeCanonicalValue(value, limits), limits), 'invalid-type');
  });

  test('reader rejects the predecessor module envelope identity', () => {
    const value = structuredClone(decodeCanonicalValue(encodeModuleKir(moduleFixture(), limits), limits));
    const format = recordField(value, 'format');
    if (format.tag !== 'text') throw new Error('expected module format');
    format.value = 'kern.kir.modules.r1.5c.3-alpha';
    expectModuleCode(() => decodeModuleKir(encodeCanonicalValue(value, limits), limits), 'unsupported-module-version');
  });

  test('forbids the non-catalog document container instead of synthesizing source structure', () => {
    expectStructuralCode(
      () => encodeModuleKir([{ id: 'main.kern', roots: [{ type: 'document', children: [] }] }], limits),
      'unknown-node-kind',
    );
  });

  test('reader rejects duplicate serialized exports with a stable graph code', () => {
    const value = structuredClone(decodeCanonicalValue(encodeModuleKir(moduleFixture(), limits), limits));
    const modules = recordField(value, 'modules');
    const library = listItem(modules, 0);
    const exports = recordField(library, 'exports');
    if (exports.tag !== 'list' || exports.value[0] === undefined) throw new Error('expected exports');
    exports.value.splice(1, 0, structuredClone(exports.value[0]));
    expectModuleCode(() => decodeModuleKir(encodeCanonicalValue(value, limits), limits), 'duplicate-export');
  });

  test('fresh processes are deterministic across locale and timezone variants', () => {
    const digestScript = fileURLToPath(new URL('../../../scripts/kir-structural/module-digest.mjs', import.meta.url));
    const digest = (env: Readonly<Record<string, string>>) =>
      execFileSync(process.execPath, [digestScript], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, ...env },
      });
    expect(digest({ LANG: 'C', TZ: 'UTC' })).toBe(digest({ LANG: 'tr_TR.UTF-8', TZ: 'Pacific/Auckland' }));
  });

  test('writer rejects non-plain module inputs before projection', () => {
    const getter = Object.defineProperty({}, 'id', { enumerable: true, get: () => 'main.kern' });
    expectModuleCode(() => encodeModuleKir([getter as ModuleKirInput], limits), 'invalid-module-artifact');
  });
});
