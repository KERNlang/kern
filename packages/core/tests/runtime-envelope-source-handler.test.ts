import { makeEnv } from '../src/ir/semantics/index.js';
import { encodeInternalRuntimeEnvelope } from '../src/runtime-envelope/normalize.js';
import {
  executeInternalRuntimeSourceHandlerAsync,
  executeInternalRuntimeSourceHandlerSync,
  resolveInternalRuntimeSourceHandler,
} from '../src/runtime-envelope/source-handler.js';
import { InternalRuntimeEnvelopeError, type InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';

const limits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxStringBytes: 4_096,
};
const enabled = { enabled: true, limits } as const;
const identity = { handlerName: 'answer', sourcePath: 'app/main.kern' } as const;

function failureCode(envelope: ReturnType<typeof executeInternalRuntimeSourceHandlerSync>): string | undefined {
  return envelope.diagnostics[0]?.code;
}

describe('internal source handler identity and link', () => {
  test('is default-off before source parsing', async () => {
    const malformed = 'not valid KERN';
    expect(() => resolveInternalRuntimeSourceHandler(malformed, identity)).toThrow(InternalRuntimeEnvelopeError);
    expect(() => executeInternalRuntimeSourceHandlerSync(malformed, identity, [], makeEnv())).toThrow(
      InternalRuntimeEnvelopeError,
    );
    await expect(executeInternalRuntimeSourceHandlerAsync(malformed, identity, [], makeEnv())).rejects.toThrow(
      InternalRuntimeEnvelopeError,
    );
  });

  test('links one exact source identity and preserves ordered legacy parameters', async () => {
    const source = [
      'fn name=answer params="value:string,index:number" returns=string',
      '  handler lang="kern"',
      '    return value="value"',
    ].join('\n');
    const linked = resolveInternalRuntimeSourceHandler(source, identity, enabled);
    expect(linked).toMatchObject({ identity, parameters: ['value', 'index'] });

    const sync = executeInternalRuntimeSourceHandlerSync(source, identity, ['ready', 0], makeEnv(), enabled);
    const asyncEnvelope = await executeInternalRuntimeSourceHandlerAsync(
      source,
      identity,
      ['ready', 0],
      makeEnv(),
      enabled,
    );
    expect(sync).toMatchObject({
      completion: { kind: 'return' },
      outcome: 'success',
      result: { presence: 'value', value: { tag: 'text', value: 'ready' } },
    });
    expect(asyncEnvelope).toEqual(sync);
    expect(encodeInternalRuntimeEnvelope(asyncEnvelope, limits)).toEqual(encodeInternalRuntimeEnvelope(sync, limits));
  });

  test('links direct param children into the existing typed entry', async () => {
    const source = [
      'fn name=answer returns=string',
      '  param name=items type="string[]"',
      '  param name=index type=number',
      '  handler lang="kern"',
      '    return value="items[index]"',
    ].join('\n');
    const sync = executeInternalRuntimeSourceHandlerSync(source, identity, [['zero', 'one'], 1], makeEnv(), enabled);
    expect(sync.result).toEqual({ presence: 'value', value: { tag: 'text', value: 'one' } });
    await expect(
      executeInternalRuntimeSourceHandlerAsync(source, identity, [['zero', 'one'], 1], makeEnv(), enabled),
    ).resolves.toEqual(sync);
  });

  test('returns stable link identities for missing, ambiguous, unsupported, and malformed source', () => {
    const fixtures: Array<[string, string]> = [
      [
        ['fn name=other returns=string', '  handler lang="kern"', '    return value="\\"x\\""'].join('\n'),
        'handler-entry-not-found',
      ],
      [
        [
          'fn name=answer returns=string',
          '  handler lang="kern"',
          '    return value="\\"a\\""',
          'fn name=answer returns=string',
          '  handler lang="kern"',
          '    return value="\\"b\\""',
        ].join('\n'),
        'handler-entry-ambiguous',
      ],
      [
        [
          'fn name=answer returns=string',
          '  handler lang="kern"',
          '    return value="\\"a\\""',
          '  handler lang="kern"',
          '    return value="\\"b\\""',
        ].join('\n'),
        'handler-entry-ambiguous',
      ],
      [
        ['fn name=answer returns=string', '  handler lang=ts <<<', '    return "x";', '  >>>'].join('\n'),
        'handler-entry-unsupported',
      ],
      [
        ['fn name=answer async=true returns=string', '  handler lang="kern"', '    return value="\\"x\\""'].join('\n'),
        'handler-entry-unsupported',
      ],
      [
        ['fn name=answer returns=string', '  param name=x type=string optional=true', '  handler lang="kern"'].join(
          '\n',
        ),
        'handler-entry-unsupported',
      ],
      ['fn', 'handler-link-error'],
    ];
    for (const [source, code] of fixtures) {
      const envelope = executeInternalRuntimeSourceHandlerSync(source, identity, [], makeEnv(), enabled);
      expect(envelope).toMatchObject({
        completion: { kind: 'error' },
        diagnostics: [{ code, phase: 'link' }],
        events: [],
        outcome: 'failure',
        result: { presence: 'absent' },
      });
    }
  });

  test('rejects module edges, mixed parameters, and invalid identities', () => {
    const valid = ['fn name=answer returns=string', '  handler lang="kern"', '    return value="\\"x\\""'].join('\n');
    const moduleSource = ['use path="./helper.kern"', valid].join('\n');
    expect(failureCode(executeInternalRuntimeSourceHandlerSync(moduleSource, identity, [], makeEnv(), enabled))).toBe(
      'handler-entry-unsupported',
    );

    const mixed = [
      'fn name=answer params="x:string" returns=string',
      '  param name=y type=string',
      '  handler lang="kern"',
      '    return value="x"',
    ].join('\n');
    expect(failureCode(executeInternalRuntimeSourceHandlerSync(mixed, identity, [], makeEnv(), enabled))).toBe(
      'handler-entry-unsupported',
    );
    expect(
      failureCode(
        executeInternalRuntimeSourceHandlerSync(
          valid,
          { ...identity, sourcePath: '../app.kern' },
          [],
          makeEnv(),
          enabled,
        ),
      ),
    ).toBe('handler-link-error');
    expect(
      failureCode(
        executeInternalRuntimeSourceHandlerSync(
          valid,
          { ...identity, handlerName: 'bad-name' },
          [],
          makeEnv(),
          enabled,
        ),
      ),
    ).toBe('handler-entry-unsupported');
  });

  test('bounds source and identity with existing runtime limits', () => {
    const tiny = { enabled: true, limits: { ...limits, maxBytes: 10, maxStringBytes: 4 } } as const;
    expect(failureCode(executeInternalRuntimeSourceHandlerSync('fn name=answer', identity, [], makeEnv(), tiny))).toBe(
      'handler-link-error',
    );
    expect(
      failureCode(
        executeInternalRuntimeSourceHandlerSync(
          'x',
          { handlerName: 'answer', sourcePath: 'long/path.kern' },
          [],
          makeEnv(),
          tiny,
        ),
      ),
    ).toBe('handler-link-error');
  });

  test('does not invoke a capability when source linking fails', async () => {
    let calls = 0;
    const host = makeEnv({
      capabilities: {
        storage: {
          get() {
            calls += 1;
            return 'leak';
          },
        },
      },
    });
    const ambiguous = [
      'fn name=answer returns=string',
      '  handler lang="kern"',
      '    capability namespace=storage operation=get name=result',
      '    return value="result"',
      'fn name=answer returns=string',
      '  handler lang="kern"',
      '    return value="\\"duplicate\\""',
    ].join('\n');
    const sync = executeInternalRuntimeSourceHandlerSync(ambiguous, identity, [], host, enabled);
    expect(sync).toMatchObject({ diagnostics: [{ code: 'handler-link-error' }], events: [], outcome: 'failure' });
    await expect(executeInternalRuntimeSourceHandlerAsync(ambiguous, identity, [], host, enabled)).resolves.toEqual(
      sync,
    );
    expect(calls).toBe(0);
  });
});
