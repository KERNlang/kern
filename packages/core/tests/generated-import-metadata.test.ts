import * as generated from '../src/generated/utils/import-metadata.js';
import * as facade from '../src/import-metadata.js';

describe('generated import-metadata behavior', () => {
  it.each([
    [undefined, []],
    [null, []],
    ['', []],
    ['fs,exec, stream', ['fs', 'exec', 'stream']],
    ['[fs, exec]', ['fs', 'exec']],
    ['["fs", "exec"]', ['fs', 'exec']],
    ["['fs', 'exec']", ['fs', 'exec']],
    ['fs,,exec', ['fs', 'exec']],
  ])('splitCapabilityList(%p) returns %p', (input, expected) => {
    expect(generated.splitCapabilityList(input)).toEqual(expected);
  });

  it.each([
    [undefined, 'host'],
    [null, 'host'],
    ['', 'host'],
    ['npm', 'npm'],
    ['PyPI', 'pypi'],
    ['kern', 'kern'],
    ['unknown', 'host'],
  ] as const)('importRegistryOf(%p) returns %p', (input, expected) => {
    expect(generated.importRegistryOf(input)).toBe(expected);
  });

  it.each([
    [undefined, undefined, 'all'],
    [undefined, 'npm', 'ts'],
    [undefined, 'pypi', 'python'],
    ['fastapi', undefined, 'fastapi'],
    ['React', undefined, 'react'],
    ['bad', undefined, 'all'],
  ] as const)('importTargetOf(%p, %p) returns %p', (target, registry, expected) => {
    expect(generated.importTargetOf(target, registry)).toBe(expected);
  });

  it.each([
    [undefined, undefined, 'all'],
    [undefined, 'npm', 'ts'],
    [undefined, 'pypi', 'python'],
    ['fastapi', undefined, 'python'],
    ['node', undefined, 'ts'],
    ['bad', undefined, 'none'],
  ] as const)('importTargetFamilyOf(%p, %p) returns %p', (target, registry, expected) => {
    expect(generated.importTargetFamilyOf(target, registry)).toBe(expected);
  });

  it.each([
    [{ registry: 'npm' }, 'node', true],
    [{ registry: 'npm' }, 'fastapi', false],
    [{ registry: 'pypi' }, 'fastapi', true],
    [{ registry: 'pypi' }, 'node', false],
    [{ target: 'bad' }, 'node', true],
    [{ target: 'all' }, 'fastapi', true],
  ] satisfies Array<
    [
      Parameters<typeof generated.shouldEmitImportForTarget>[0],
      Parameters<typeof generated.shouldEmitImportForTarget>[1],
      boolean,
    ]
  >)('shouldEmitImportForTarget(%p, %p) returns %p', (props, target, expected) => {
    expect(generated.shouldEmitImportForTarget(props, target)).toBe(expected);
  });

  it('validates import metadata conflicts and invalid values', () => {
    expect(generated.validateImportMetadata({ type: 'import', props: { registry: 'bad' } })).toEqual([
      "'import registry=' must be one of host, npm, pypi, kern",
    ]);
    expect(generated.validateImportMetadata({ type: 'extern', props: { target: 'bad' } })).toEqual([
      "'extern target=' must be one of all, ts, python, react, node, express, cli, lib, mcp, terminal, ink, vue, nuxt, nextjs, native, web, fastapi",
    ]);
    expect(generated.validateImportMetadata({ type: 'import', props: { registry: 'npm', target: 'fastapi' } })).toEqual(
      ["'import registry=npm' must target a TS-family target or omit target= so KERN can infer ts"],
    );
    expect(generated.validateImportMetadata({ type: 'extern', props: { registry: 'pypi', target: 'node' } })).toEqual([
      "'extern registry=pypi' must target python/fastapi or omit target= so KERN can infer python",
    ]);
  });

  it('validates capability metadata values', () => {
    expect(
      generated.validateCapabilityMetadata({
        type: 'island',
        props: { runtime: 'bad', effects: '[fs,bad-effect]', serialization: 'bad', protocol: 'bad' },
      }),
    ).toEqual([
      "'island runtime=' must be one of node, python, browser, host, worker, edge",
      "'island effects=' contains unsupported effect 'bad-effect' (expected network, fs, exec, secret, stream, state, auth, cpu, validation, io)",
      "'island serialization=' must be one of json, ndjson, stream, handle, none",
      "'island protocol=' must be one of pty-session",
    ]);
  });

  it('src facade delegates generated utility exports', () => {
    expect(facade.splitCapabilityList).toBe(generated.splitCapabilityList);
    expect(facade.importRegistryOf).toBe(generated.importRegistryOf);
    expect(facade.importTargetOf).toBe(generated.importTargetOf);
    expect(facade.importTargetFamilyOf).toBe(generated.importTargetFamilyOf);
    expect(facade.shouldEmitImportForTarget).toBe(generated.shouldEmitImportForTarget);
    expect(facade.validateImportMetadata({ type: 'import', props: { registry: 'npm' }, children: [] })).toEqual(
      generated.validateImportMetadata({ type: 'import', props: { registry: 'npm' } }),
    );
    expect(facade.validateCapabilityMetadata({ type: 'island', props: { effects: '[fs]' }, children: [] })).toEqual(
      generated.validateCapabilityMetadata({ type: 'island', props: { effects: '[fs]' } }),
    );
  });
});
