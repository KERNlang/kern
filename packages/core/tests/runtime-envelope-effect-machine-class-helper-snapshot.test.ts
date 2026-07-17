import { assertInternalMachineHelperGraph } from '../src/ir/semantics/internal-effect-machine-helper-graph.js';
import { executeSourceRunnerAsync } from '../src/runtime-envelope/source-runner-engine.js';
import type { IRNode } from '../src/types.js';
import { classHelperEnv, helper, member } from './runtime-envelope-effect-machine-class-helper-fixtures.js';

describe('M3.31b2b2 helper snapshot metadata', () => {
  test.each(['this', 'super', 'this["field"]'])('rejects private receiver expression %s in a helper body', (value) => {
    const env = classHelperEnv({
      classes: [],
      helpers: [helper('leak', [], [{ type: 'return', props: { value } }])],
    });

    expect(() => assertInternalMachineHelperGraph([{ type: 'return', props: { value: 'leak()' } }], env)).toThrow(
      /class use is outside the pure helper domain/,
    );
  });

  test('deep-snapshots nested node props and return metadata', () => {
    const nestedProps = { labels: ['old'] };
    const returns = { contract: { name: 'old' } };
    const body: readonly IRNode[] = [{ type: 'return', props: { metadata: nestedProps, value: 'value' } }];
    const env = classHelperEnv({
      classes: [],
      helpers: [helper('identity', ['value'], body, returns)],
    });

    const graph = assertInternalMachineHelperGraph([{ type: 'return', props: { value: 'identity(1)' } }], env);
    nestedProps.labels[0] = 'new';
    returns.contract.name = 'new';

    const snapshot = graph.functions.get('identity');
    expect(snapshot?.body[0].props?.metadata).toEqual({ labels: ['old'] });
    expect(snapshot?.returns).toEqual({ contract: { name: 'old' } });
  });

  test('snapshots nested helper call metadata across async suspension', async () => {
    let entered!: () => void;
    let release!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    const innerParams = ['value'];
    const env = classHelperEnv({
      classes: [
        {
          constructor: undefined,
          fields: [],
          getters: new Map(),
          methods: new Map([
            [
              'read',
              member('Worker', 'read', [
                { type: 'capability', props: { name: 'answer', namespace: 'llm', operation: 'complete' } },
                { type: 'return', props: { value: 'outer(answer)' } },
              ]),
            ],
          ]),
          name: 'Worker',
        },
      ],
      helpers: [
        helper('outer', ['value'], [{ type: 'return', props: { value: 'inner(value)' } }], 'string'),
        helper('inner', innerParams, [{ type: 'return', props: { value: 'value + "-old"' } }], 'string'),
      ],
    });
    const pending = executeSourceRunnerAsync(
      [
        { type: 'let', props: { name: 'worker', value: 'new Worker()' } },
        { type: 'return', props: { value: 'worker.read()' } },
      ],
      env,
      {
        asyncCapabilities: {
          llm: {
            complete: async () => {
              entered();
              await providerRelease;
              return 'x';
            },
          },
        },
        policy: 'machine-only',
      },
    );
    await providerEntered;
    innerParams.splice(0);
    release();

    await expect(pending).resolves.toEqual(expect.objectContaining({ completion: { kind: 'return', value: 'x-old' } }));
  });
});
