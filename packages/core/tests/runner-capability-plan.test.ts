import {
  analyzeKernSourceCapabilities,
  CAPABILITY_DESCRIPTORS,
  type CapabilityId,
  invokeRunnerCapability,
  invokeRunnerCapabilityAsync,
  KernCapabilityError,
} from '../src/runner.js';

function program(bodyLines: string[]): string {
  return ['fn name=main returns=void', '  handler lang="kern"', ...bodyLines.map((line) => `    ${line}`)].join('\n');
}

describe('@kernlang/core/runner capability preflight', () => {
  test('classifies shipped capability requirements with source lines and literal input', () => {
    const source = program([
      'capability namespace=storage operation=set name=setOk input="{ key: \\"theme\\", value: \\"dark\\" }"',
      'capability namespace=crypto operation=randomHex name=hex input="{ length: 4 }"',
      'capability namespace=rag operation=retrieve name=chunks input="{ question: \\"refund\\", retrieval: \\"FindDocs\\" }"',
      'capability namespace=rag operation=promptContext name=context input="{ chunks: chunks }"',
      'capability namespace=rag operation=checkAnswer name=check input="{ query: \\"refund\\", answer: \\"Refunds follow policy.\\", chunks: chunks, groundingSpans: [{ start: 0, end: 22, chunkIndexes: [0] }] }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source);

    expect(analysis.parseDiagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(analysis.hasParseErrors).toBe(false);
    expect(analysis.unknownCapabilities).toEqual([]);
    expect(analysis.malformedCapabilities).toEqual([]);
    expect(analysis.unknownProvidedCapabilities).toEqual([]);
    expect(analysis.plannedCapabilities).toEqual([]);
    expect(analysis.missingProviders).toEqual([]);
    expect(analysis.requirements.map((requirement) => requirement.id)).toEqual([
      'storage.set',
      'crypto.randomHex',
      'rag.retrieve',
      'rag.promptContext',
      'rag.checkAnswer',
    ]);
    expect(analysis.requirements[0]).toEqual(
      expect.objectContaining({
        bindingName: 'setOk',
        literalInput: '{ key: "theme", value: "dark" }',
        sourceLine: 3,
      }),
    );
    expect(analysis.requirements.map((requirement) => requirement.descriptor.status)).toEqual([
      'shipped',
      'shipped',
      'shipped',
      'shipped',
      'shipped',
    ]);
  });

  test('flags planned fs, net, llm, and rag answer capabilities without marking them unknown', () => {
    const source = program([
      'capability namespace=fs operation=readText name=file input="{ path: \\"README.md\\" }"',
      'capability namespace=net operation=fetch name=response input="{ method: \\"GET\\", url: \\"https://example.test\\" }"',
      'capability namespace=llm operation=complete name=text input="{ prompt: \\"hello\\" }"',
      'capability namespace=rag operation=answer name=answer input="{ query: \\"refund\\", chunks: [] }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source);

    expect(analysis.unknownCapabilities).toEqual([]);
    expect(analysis.plannedCapabilities.map((requirement) => requirement.id)).toEqual([
      'fs.readText',
      'net.fetch',
      'llm.complete',
      'rag.answer',
    ]);
    expect(analysis.asyncBoundaryRequired).toBe(true);
    expect(analysis.asyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual([
      'fs.readText',
      'net.fetch',
      'llm.complete',
      'rag.answer',
    ]);
    expect(analysis.plannedCapabilities.map((requirement) => requirement.descriptor.syncBoundary)).toEqual([
      'async-planned',
      'async-planned',
      'async-planned',
      'async-planned',
    ]);
  });

  test('reports async provider coverage separately from sync shipped providers', () => {
    const source = program([
      'capability namespace=fs operation=readText name=file input="{ path: \\"README.md\\" }"',
      'capability namespace=net operation=fetch name=response input="{ method: \\"GET\\", url: \\"https://example.test\\" }"',
      'capability namespace=storage operation=get name=mode input="{ key: \\"mode\\" }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source, {
      providedCapabilities: ['storage.get'],
      providedAsyncCapabilities: ['net.fetch', 'net.nope'],
    });

    expect(analysis.missingProviders).toEqual([]);
    expect(analysis.missingAsyncProviders.map((requirement) => requirement.id)).toEqual(['fs.readText']);
    expect(analysis.unknownProvidedAsyncCapabilities).toEqual(['net.nope']);
    expect(analysis.asyncBoundaryRequired).toBe(true);
  });

  test('allows async capability requirements inside preview-supported try/catch shapes', () => {
    const source = program([
      'try',
      '  capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
      '  catch name=e',
      '    print value="e.message"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['net.fetch'],
    });

    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('allows async capability requirements inside preview-supported while, for, and each loops', () => {
    const source = program([
      'let kind=let name=n value="0"',
      'while cond="n < 1"',
      '  capability namespace=llm operation=complete name=loopValue input="{ prompt: n }"',
      '  assign target=n value="n + 1"',
      'for name=i from="0" to="2"',
      '  capability namespace=llm operation=complete name=value input="{ prompt: i }"',
      'let name=items value="[1, 2]"',
      'each name=item in=items',
      '  capability namespace=llm operation=complete name=other input="{ prompt: item }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.asyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual([
      'llm.complete',
      'llm.complete',
      'llm.complete',
    ]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('allows async capability requirements inside selected branch paths', () => {
    const source = program([
      'branch on="\\"paid\\""',
      '  path value="paid"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"selected\\" }"',
      '  path default=true',
      '    capability namespace=llm operation=complete name=fallback input="{ prompt: \\"fallback\\" }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.asyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual([
      'llm.complete',
      'llm.complete',
    ]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('allows async try/catch requirements inside branch paths for tooling preflight', () => {
    const source = program([
      'branch on="\\"safe\\""',
      '  path value="safe"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"selected\\" }"',
      '  path value="danger"',
      '    try',
      '      capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
      '      catch name=e',
      '        print value="e.message"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete', 'net.fetch'],
    });

    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.asyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual([
      'llm.complete',
      'net.fetch',
    ]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('reports async capability requirements outside the main handler source execution lane', () => {
    const source = [
      'fn name=helper returns=void',
      '  handler lang="kern"',
      '    capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"ok\\""',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['net.fetch'],
    });

    expect(analysis.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({
        id: 'net.fetch',
        reason: 'outside-main-handler',
      }),
    ]);
  });

  test('reports unknown capability tokens separately from known planned capabilities', () => {
    const source = program([
      'capability namespace=foo operation=bar name=value input="{ x: 1 }"',
      'capability namespace=fs operation=list name=files input="{ path: \\".\\" }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source);

    expect(analysis.requirements.map((requirement) => requirement.id)).toEqual(['fs.list']);
    expect(analysis.plannedCapabilities.map((requirement) => requirement.id)).toEqual(['fs.list']);
    expect(analysis.unknownCapabilities).toEqual([
      expect.objectContaining({
        id: 'foo.bar',
        namespace: 'foo',
        operation: 'bar',
        bindingName: 'value',
        sourceLine: 3,
      }),
    ]);
  });

  test('reports malformed capability nodes separately from unknown capabilities', () => {
    const source = program([
      'capability namespace=storage name=value input="{ key: \\"mode\\" }"',
      'capability operation=get name=value input="{ key: \\"mode\\" }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source);

    expect(analysis.requirements).toEqual([]);
    expect(analysis.unknownCapabilities).toEqual([]);
    expect(analysis.malformedCapabilities).toEqual([
      expect.objectContaining({
        namespace: 'storage',
        sourceLine: 3,
        reason: expect.stringContaining('operation is required'),
      }),
      expect.objectContaining({
        operation: 'get',
        sourceLine: 4,
        reason: expect.stringContaining('namespace is required'),
      }),
    ]);
  });

  test('reports runtime-invalid capability tokens as malformed capabilities', () => {
    const source = program([
      'capability namespace="storage.v2" operation=get name=value input="{ key: \\"mode\\" }"',
      'capability namespace=storage operation="_get" name=value input="{ key: \\"mode\\" }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source);

    expect(analysis.requirements).toEqual([]);
    expect(analysis.unknownCapabilities).toEqual([]);
    expect(analysis.malformedCapabilities).toEqual([
      expect.objectContaining({
        sourceLine: 3,
        reason: expect.stringContaining("namespace 'storage.v2'"),
      }),
      expect.objectContaining({
        sourceLine: 4,
        reason: expect.stringContaining("operation '_get'"),
      }),
    ]);
  });

  test('reports missing shipped providers only when a host provider set is supplied', () => {
    const source = program([
      'capability namespace=storage operation=get name=mode input="{ key: \\"mode\\" }"',
      'capability namespace=crypto operation=randomUUID name=id',
      'capability namespace=rag operation=retrieve name=chunks input="{ question: \\"refund\\" }"',
      'capability namespace=rag operation=promptContext name=context input="{ chunks: chunks }"',
      'capability namespace=rag operation=checkAnswer name=check input="{ query: \\"refund\\", answer: \\"Refunds follow policy.\\", chunks: chunks, groundingSpans: [{ start: 0, end: 22, chunkIndexes: [0] }] }"',
      'capability namespace=net operation=fetch name=response input="{ method: \\"GET\\", url: \\"https://example.test\\" }"',
    ]);
    const provided: CapabilityId[] = ['storage.get', 'crypto.randomUUID'];

    const analysis = analyzeKernSourceCapabilities(source, { providedCapabilities: provided });

    expect(analysis.missingProviders.map((requirement) => requirement.id)).toEqual([
      'rag.retrieve',
      'rag.promptContext',
      'rag.checkAnswer',
    ]);
    expect(analysis.plannedCapabilities.map((requirement) => requirement.id)).toEqual(['net.fetch']);
  });

  test('reports unknown provided capability ids without satisfying requirements', () => {
    const source = program([
      'capability namespace=storage operation=get name=mode input="{ key: \\"mode\\" }"',
      'capability namespace=crypto operation=randomUUID name=id',
    ]);

    const analysis = analyzeKernSourceCapabilities(source, {
      providedCapabilities: ['storage.get', 'storage.nope'],
    });

    expect(analysis.unknownProvidedCapabilities).toEqual(['storage.nope']);
    expect(analysis.missingProviders.map((requirement) => requirement.id)).toEqual(['crypto.randomUUID']);
  });

  test('surfaces parse errors distinctly from an empty capability set', () => {
    const analysis = analyzeKernSourceCapabilities('fn name=main returns=void\n  handler lang="kern');

    expect(analysis.hasParseErrors).toBe(true);
    expect(analysis.parseDiagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    expect(analysis.requirements).toEqual([]);
  });

  test('descriptor table makes remaining adapter status explicit', () => {
    expect(CAPABILITY_DESCRIPTORS['storage.get']).toEqual(expect.objectContaining({ status: 'shipped' }));
    expect(CAPABILITY_DESCRIPTORS['crypto.randomBytes']).toEqual(expect.objectContaining({ status: 'shipped' }));
    expect(CAPABILITY_DESCRIPTORS['rag.retrieve']).toEqual(expect.objectContaining({ status: 'shipped' }));
    expect(CAPABILITY_DESCRIPTORS['rag.promptContext']).toEqual(expect.objectContaining({ status: 'shipped' }));
    expect(CAPABILITY_DESCRIPTORS['rag.checkAnswer']).toEqual(expect.objectContaining({ status: 'shipped' }));
    expect(CAPABILITY_DESCRIPTORS['fs.readText']).toEqual(expect.objectContaining({ status: 'planned' }));
    expect(CAPABILITY_DESCRIPTORS['net.fetch']).toEqual(expect.objectContaining({ status: 'planned' }));
    expect(CAPABILITY_DESCRIPTORS['llm.complete']).toEqual(expect.objectContaining({ status: 'planned' }));
    expect(CAPABILITY_DESCRIPTORS['rag.answer']).toEqual(expect.objectContaining({ status: 'planned' }));
  });

  test('descriptor table keeps async boundary ids explicit', () => {
    expect(
      Object.values(CAPABILITY_DESCRIPTORS)
        .filter((descriptor) => descriptor.syncBoundary === 'async-planned')
        .map((descriptor) => descriptor.id)
        .sort(),
    ).toEqual(['fs.list', 'fs.readText', 'fs.writeText', 'llm.complete', 'net.fetch', 'rag.answer', 'rag.ingest']);
  });
});

describe('@kernlang/core/runner sync capability dispatch contract', () => {
  test('fails closed before invoking a provider with non-portable input', () => {
    expect(() =>
      invokeRunnerCapability(
        {
          storage: {
            get() {
              throw new Error('should not call provider');
            },
          },
        },
        { namespace: 'storage', operation: 'get', input: { startedAt: new Date() } as never },
      ),
    ).toThrow("runner capability 'storage.get' received a non-portable input");
  });
});

describe('@kernlang/core/runner async capability dispatch contract', () => {
  test('awaits an injected async capability provider and validates portable values', async () => {
    const result = await invokeRunnerCapabilityAsync(
      {
        net: {
          async fetch(call, context) {
            return {
              ok: true,
              url: (call.input as { readonly url?: string } | undefined)?.url ?? '',
              runId: context.runId ?? null,
            };
          },
        },
      },
      { namespace: 'net', operation: 'fetch', input: { url: 'https://example.test' } },
      { runId: 'async-run' },
    );

    expect(result).toEqual({ ok: true, url: 'https://example.test', runId: 'async-run' });
  });

  test('supports namespace handler form and undefined async capability results', async () => {
    const result = await invokeRunnerCapabilityAsync(
      {
        net(call) {
          if (call.operation === 'fetch') return { ok: true, url: 'https://example.test' };
          return undefined;
        },
      },
      { namespace: 'net', operation: 'fetch' },
    );
    const undefinedResult = await invokeRunnerCapabilityAsync(
      {
        net() {
          return undefined;
        },
      },
      { namespace: 'net', operation: 'fetch' },
    );

    expect(result).toEqual({ ok: true, url: 'https://example.test' });
    expect(undefinedResult).toBeUndefined();
  });

  test('fails closed for malformed, missing, thrown, non-portable input, and non-portable async results', async () => {
    await expect(
      invokeRunnerCapabilityAsync({}, { namespace: 'bad namespace', operation: 'complete' }),
    ).rejects.toThrow('runner async capability call is malformed');
    await expect(invokeRunnerCapabilityAsync({}, { namespace: 'llm', operation: 'complete' })).rejects.toThrow(
      KernCapabilityError,
    );
    await expect(
      invokeRunnerCapabilityAsync(
        {
          llm: {
            async complete() {
              throw new Error('provider down');
            },
          },
        },
        { namespace: 'llm', operation: 'complete' },
      ),
    ).rejects.toThrow("runner async capability 'llm.complete' threw: provider down");
    await expect(
      invokeRunnerCapabilityAsync(
        {
          net: {
            async fetch() {
              throw new Error('should not call provider');
            },
          },
        },
        { namespace: 'net', operation: 'fetch', input: { startedAt: new Date() } as never },
      ),
    ).rejects.toThrow("runner async capability 'net.fetch' received a non-portable input");
    await expect(
      invokeRunnerCapabilityAsync(
        {
          net: {
            async fetch() {
              return { response: new Date() } as never;
            },
          },
        },
        { namespace: 'net', operation: 'fetch' },
      ),
    ).rejects.toThrow("runner async capability 'net.fetch' returned a non-portable value");
  });
});
