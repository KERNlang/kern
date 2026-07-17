import { executeSourceRunnerAsync, executeSourceRunnerSync } from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';
import { classMember, preSuperEnv } from './runtime-envelope-effect-machine-class-pre-super-fixtures.js';

function snapshotEnv(preSuperValue = 'value + 2') {
  return preSuperEnv([
    {
      constructor: classMember(
        'Base',
        'constructor',
        ['value'],
        [{ type: 'assign', props: { target: 'this.value', value: 'value' } }],
      ),
      fields: [{ name: 'value', value: '0' }],
      getters: new Map(),
      methods: new Map(),
      name: 'Base',
    },
    {
      constructor: classMember(
        'Derived',
        'constructor',
        ['value'],
        [
          { type: 'let', props: { name: 'adjusted', value: preSuperValue } },
          { type: 'do', props: { value: 'super(adjusted)' } },
          { type: 'assign', props: { target: 'this.value', value: 'this.value + 3' } },
        ],
      ),
      extendsName: 'Base',
      fields: [],
      getters: new Map(),
      methods: new Map(),
      name: 'Derived',
    },
  ]);
}

describe('M3.31b2c1 pre-super snapshot and isolation', () => {
  test('freezes pre-super, super-argument, post-super, and lineage metadata before suspension', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const env = snapshotEnv();
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'llm', operation: 'complete' } },
      { type: 'let', props: { name: 'item', value: 'new Derived(2)' } },
      { type: 'return', props: { value: 'item.value' } },
    ];
    const running = executeSourceRunnerAsync(nodes, env, {
      asyncCapabilities: { llm: { complete: async () => gate } },
      policy: 'machine-only',
    });
    const derived = env.runnerClasses?.get('Derived');
    const pre = derived?.constructor?.body[0];
    const superStatement = derived?.constructor?.body[1];
    const post = derived?.constructor?.body[2];
    if (!derived || !pre?.props || !superStatement?.props || !post?.props) {
      throw new Error('expected derived constructor metadata');
    }
    pre.props.value = '99';
    superStatement.props.value = 'super(99)';
    post.props.value = '99';
    derived.extendsName = 'Missing';
    release?.();

    expect((await running).completion).toEqual({ kind: 'return', value: 7 });
  });

  test('isolates same-named pre-super locals across overlapping runs', async () => {
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const firstEnv = snapshotEnv('value + 10');
    const secondEnv = snapshotEnv('value + 20');
    const nodes: readonly IRNode[] = [
      { type: 'capability', props: { namespace: 'llm', operation: 'complete' } },
      { type: 'let', props: { name: 'item', value: 'new Derived(1)' } },
      { type: 'return', props: { value: 'item.value' } },
    ];
    const first = executeSourceRunnerAsync(nodes, firstEnv, {
      asyncCapabilities: { llm: { complete: async () => firstGate } },
      policy: 'machine-only',
    });
    const second = executeSourceRunnerAsync(nodes, secondEnv, {
      asyncCapabilities: { llm: { complete: async () => secondGate } },
      policy: 'machine-only',
    });
    releaseSecond?.();
    releaseFirst?.();

    expect((await first).completion).toEqual({ kind: 'return', value: 14 });
    expect((await second).completion).toEqual({ kind: 'return', value: 24 });
    expect(executeSourceRunnerSync([{ type: 'return', props: { value: '1' } }], firstEnv, {}).completion).toEqual({
      kind: 'return',
      value: 1,
    });
  });
});
