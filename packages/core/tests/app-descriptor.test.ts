import {
  executeKernAppEntryPolicySlot,
  findMissingKernAppEntryCapability,
  type KernAppPolicySlot,
  loadKernAppDescriptor,
} from '../src/runtime.js';

function manifest(lines: string[]): string {
  return lines.join('\n');
}

function source(bodyLines: string[]): string {
  return ['fn name=main returns=void', '  handler lang="kern"', ...bodyLines.map((line) => `    ${line}`)].join('\n');
}

async function load(manifestSource: string, files: Readonly<Record<string, string>> = {}) {
  return loadKernAppDescriptor(manifestSource, {
    appRoot: '/app',
    canonicalizePath(path) {
      return path;
    },
    readSource(sourcePath) {
      return files[sourcePath];
    },
  });
}

describe('@kernlang/core/runtime app descriptor', () => {
  test('loads views, routes, policies, paths, and capability requirements', async () => {
    const descriptor = await load(
      manifest([
        'app name=SupportApp version=5.0 requires="storage.get"',
        '  view name=Home path="/" source="./ui.kern" handler=main',
        '  route name=Answer method=get path="/api/answer" source="./answer.kern" handler=main policy=Grounded response=json requires="rag.checkAnswer,llm.complete"',
        '  policy name=Grounded kind=rag-grounding failureStatus=422 requires="rag.checkAnswer"',
      ]),
      {
        '/app/ui.kern': source(['print value="\\"ok\\""']),
        '/app/answer.kern': source([
          'capability namespace=storage operation=get name=question input="{ key: \\"question\\" }"',
          'capability namespace=llm operation=complete name=answer input="{ prompt: question }"',
          'capability namespace=rag operation=checkAnswer name=check input="{ query: question, answer: answer, chunks: [] }"',
          'print value="check.status"',
        ]),
      },
    );

    expect(descriptor.app.props.name).toBe('SupportApp');
    expect(descriptor.views[0]).toEqual(
      expect.objectContaining({
        name: 'Home',
        path: '/',
        sourcePath: '/app/ui.kern',
        handler: 'main',
      }),
    );
    expect(descriptor.routes[0]).toEqual(
      expect.objectContaining({
        name: 'Answer',
        method: 'get',
        key: 'GET /api/answer',
        sourcePath: '/app/answer.kern',
        policyName: 'Grounded',
        response: 'json',
      }),
    );
    expect(descriptor.routes[0].requiredCapabilities).toEqual(['storage.get', 'rag.checkAnswer', 'llm.complete']);
    expect(descriptor.routes[0].requiredSyncCapabilities).toEqual(['storage.get', 'rag.checkAnswer']);
    expect(descriptor.routes[0].requiredAsyncCapabilities).toEqual(['llm.complete']);
  });

  test('fails closed on duplicate route, view, and policy declarations', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  view name=Home path="/" source="./ui.kern"',
          '  view name=OtherHome path="/" source="./other.kern"',
        ]),
      ),
    ).rejects.toThrow(/duplicate view path \//);

    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=A method=get path="/api/answer" source="./a.kern"',
          '  route name=B method=GET path="/api/answer" source="./b.kern"',
        ]),
      ),
    ).rejects.toThrow(/duplicate route GET \/api\/answer/);

    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  policy name=Grounded kind=rag-grounding',
          '  policy name=Grounded kind=other',
        ]),
      ),
    ).rejects.toThrow(/duplicate policy Grounded/);
  });

  test('fails closed on unknown policy and unknown capability declarations', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" policy=Missing',
        ]),
      ),
    ).rejects.toThrow(/references unknown policy Missing/);

    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" requires="storage.telepathy"',
        ]),
      ),
    ).rejects.toThrow(/unknown capability storage\.telepathy/);
  });

  test('fails closed on source path escape and missing source', async () => {
    await expect(load(manifest(['app name=SupportApp', '  view name=Home path="/" source="ui.kern"']))).rejects.toThrow(
      /source must be relative to the app directory/,
    );

    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./../secret.kern"',
        ]),
      ),
    ).rejects.toThrow(/source must stay inside the app directory/);

    await expect(
      load(
        manifest(['app name=SupportApp', '  route name=Answer method=get path="/api/answer" source="./missing.kern"']),
      ),
    ).rejects.toThrow(/route Answer source does not exist/);
  });

  test('requires canonical source loading for filesystem-backed hosts', async () => {
    await expect(
      loadKernAppDescriptor(manifest(['app name=SupportApp', '  view name=Home path="/" source="./ui.kern"']), {
        appRoot: '/app',
        readSource() {
          return source(['print value="\\"ok\\""']);
        },
      }),
    ).rejects.toThrow(/readSource requires canonicalizePath/);

    await expect(
      loadKernAppDescriptor(manifest(['app name=RootApp', '  view name=Home path="/" source="./ui.kern"']), {
        appRoot: '/',
        allowLexicalSourcePaths: true,
        readSource(sourcePath) {
          return sourcePath === '/ui.kern' ? source(['print value="\\"ok\\""']) : undefined;
        },
      }),
    ).rejects.toThrow(/readSource requires canonicalizePath/);

    await expect(
      loadKernAppDescriptor(manifest(['app name=SupportApp', '  view name=Home path="/" source="./link.kern"']), {
        appRoot: '/app',
        canonicalizePath(path) {
          if (path === '/app') return '/app';
          if (path === '/app/link.kern') return '/outside/secret.kern';
          return path;
        },
        readSource() {
          return source(['print value="\\"escaped\\""']);
        },
      }),
    ).rejects.toThrow(/source must stay inside the app directory/);

    await expect(
      loadKernAppDescriptor(manifest(['app name=SupportApp', '  view name=Home path="/" source="./missing.kern"']), {
        appRoot: '/app',
        canonicalizePath(path) {
          if (path === '/app') return '/app';
          throw new Error('ENOENT');
        },
        readSource() {
          return undefined;
        },
      }),
    ).rejects.toThrow(/view Home source does not exist/);
  });

  test('normalizes Windows-style canonical paths before containment checks', async () => {
    await expect(
      loadKernAppDescriptor(manifest(['app name=SupportApp', '  view name=Home path="/" source="./ui.kern"']), {
        appRoot: 'C:\\app',
        canonicalizePath(path) {
          return path.includes('ui.kern') ? 'C:\\app\\ui.kern' : 'C:\\app';
        },
        readSource(sourcePath) {
          return sourcePath === 'c:/app/ui.kern' ? source(['print value="\\"ok\\""']) : undefined;
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ views: [expect.objectContaining({ sourcePath: 'c:/app/ui.kern' })] }));

    await expect(
      loadKernAppDescriptor(manifest(['app name=RootApp', '  view name=Home path="/" source="./ui.kern"']), {
        appRoot: 'C:\\',
        canonicalizePath(path) {
          return path.includes('ui.kern') ? 'C:\\ui.kern' : 'C:\\';
        },
        readSource(sourcePath) {
          return sourcePath === 'c:/ui.kern' ? source(['print value="\\"ok\\""']) : undefined;
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ views: [expect.objectContaining({ sourcePath: 'c:/ui.kern' })] }));
  });

  test('fails closed on malformed entry source without throwing a TypeError', async () => {
    await expect(
      load(manifest(['app name=SupportApp', '  view name=Home path="/" source="./ui.kern"']), {
        '/app/ui.kern': 'fn name=renderHome returns=void\n  handler lang="kern',
      }),
    ).rejects.toThrow(/Unclosed multiline block|Unclosed quoted string|source has parse errors|unterminated/i);
  });

  test('fails closed when source uses undeclared capabilities', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" requires="storage.get"',
        ]),
        {
          '/app/answer.kern': source([
            'capability namespace=storage operation=get name=question input="{ key: \\"question\\" }"',
            'capability namespace=rag operation=checkAnswer name=check input="{ query: question, answer: \\"ok\\", chunks: [] }"',
          ]),
        },
      ),
    ).rejects.toThrow(/uses undeclared capabilities: rag\.checkAnswer/);
  });

  test('fails closed when a synchronous view requires async-only capabilities', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  view name=Home path="/" source="./ui.kern" handler=main requires="llm.complete"',
        ]),
        {
          '/app/ui.kern': source([
            'capability namespace=llm operation=complete name=answer input="{ prompt: \\"view\\" }"',
            'print value="answer"',
          ]),
        },
      ),
    ).rejects.toThrow(/view Home uses async-only capabilities: llm\.complete/);
  });

  test('scopes source capability declarations to the selected descriptor handler', async () => {
    const descriptor = await load(
      manifest([
        'app name=SupportApp',
        '  route name=Question method=get path="/api/question" source="./routes.kern" handler=questionRoute requires="storage.get"',
        '  route name=Answer method=get path="/api/answer" source="./routes.kern" handler=answerRoute requires="llm.complete"',
      ]),
      {
        '/app/routes.kern': [
          'fn name=questionRoute returns=void',
          '  handler lang="kern"',
          '    capability namespace=storage operation=get name=question input="{ key: \\"question\\" }"',
          '    print value="question"',
          'fn name=answerRoute returns=void',
          '  handler lang="kern"',
          '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"refund\\" }"',
          '    print value="answer"',
        ].join('\n'),
      },
    );

    expect(descriptor.routes.map((route) => route.requiredCapabilities)).toEqual([['storage.get'], ['llm.complete']]);
  });

  test('ignores unsupported async work outside the selected non-main descriptor handler', async () => {
    const descriptor = await load(
      manifest([
        'app name=SupportApp',
        '  route name=Answer method=get path="/api/answer" source="./routes.kern" handler=answerRoute requires="storage.get"',
      ]),
      {
        '/app/routes.kern': [
          'fn name=unusedHelper returns=string',
          '  handler lang="kern"',
          '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"unused\\" }"',
          '    return value="answer"',
          'fn name=answerRoute returns=void',
          '  handler lang="kern"',
          '    capability namespace=storage operation=get name=question input="{ key: \\"question\\" }"',
          '    print value="question"',
        ].join('\n'),
      },
    );

    expect(descriptor.routes[0].requiredCapabilities).toEqual(['storage.get']);
  });

  test('fails closed when helper capabilities are hidden inside member-call arguments', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" handler=answerRoute',
        ]),
        {
          '/app/answer.kern': [
            'class name=Sink',
            '  method name=accept returns=string',
            '    param name=value type=string',
            '    handler lang="kern"',
            '      return value="value"',
            'fn name=helper returns=string',
            '  handler lang="kern"',
            '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"helper\\" }"',
            '    return value="answer"',
            'fn name=answerRoute returns=void',
            '  handler lang="kern"',
            '    let name=sink value="new Sink()"',
            '    print value="sink.accept(helper())"',
          ].join('\n'),
        },
      ),
    ).rejects.toThrow(/uses undeclared capabilities: llm\.complete/);
  });

  test('fails closed when getter capabilities are undeclared by the selected entry', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" handler=answerRoute',
        ]),
        {
          '/app/answer.kern': [
            'class name=RemoteLabel',
            '  getter name=read returns=string',
            '    handler lang="kern"',
            '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"getter\\" }"',
            '      return value="answer"',
            'fn name=answerRoute returns=void',
            '  handler lang="kern"',
            '    let name=label value="new RemoteLabel()"',
            '    print value="label.read"',
          ].join('\n'),
        },
      ),
    ).rejects.toThrow(/uses undeclared capabilities: llm\.complete/);
  });

  test('fails closed when helper-returned getter capabilities are undeclared by the selected entry', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" handler=answerRoute',
        ]),
        {
          '/app/answer.kern': [
            'class name=RemoteLabel',
            '  getter name=read returns=string',
            '    handler lang="kern"',
            '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"getter\\" }"',
            '      return value="answer"',
            'fn name=makeLabel returns=RemoteLabel',
            '  handler lang="kern"',
            '    return value="new RemoteLabel()"',
            'fn name=answerRoute returns=void',
            '  handler lang="kern"',
            '    let name=label value="makeLabel()"',
            '    print value="label.read"',
          ].join('\n'),
        },
      ),
    ).rejects.toThrow(/uses undeclared capabilities: llm\.complete/);
  });

  test('fails closed when class methods use declared async-only capabilities', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" handler=answerRoute requires="llm.complete"',
        ]),
        {
          '/app/answer.kern': [
            'class name=RemoteLabel',
            '  method name=read returns=string',
            '    handler lang="kern"',
            '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"method\\" }"',
            '      return value="answer"',
            'fn name=answerRoute returns=void',
            '  handler lang="kern"',
            '    let name=label value="new RemoteLabel()"',
            '    print value="label.read()"',
          ].join('\n'),
        },
      ),
    ).rejects.toThrow(/bad async: llm\.complete/);
  });

  test('fails closed when class field and super-argument helpers use declared async-only capabilities', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" handler=answerRoute requires="llm.complete"',
        ]),
        {
          '/app/answer.kern': [
            'fn name=remoteValue returns=string',
            '  handler lang="kern"',
            '    capability namespace=llm operation=complete name=value input="{ prompt: \\"super\\" }"',
            '    return value="value"',
            'class name=Base',
            '  constructor',
            '    param name=value type=string',
            '    handler lang="kern"',
            '      assign target="this.value" value="value"',
            'class name=Child extends=Base',
            '  field name=mode type=string value="remoteValue()"',
            '  constructor',
            '    handler lang="kern"',
            '      do value="super(remoteValue())"',
            'fn name=answerRoute returns=void',
            '  handler lang="kern"',
            '    let name=item value="new Child()"',
          ].join('\n'),
        },
      ),
    ).rejects.toThrow(/bad async: llm\.complete/);
  });

  test('fails closed when constructor capabilities are undeclared by the selected entry', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" handler=answerRoute',
        ]),
        {
          '/app/answer.kern': [
            'class name=NeedsStorage',
            '  constructor',
            '    handler lang="kern"',
            '      capability namespace=storage operation=get name=value input="{ key: \\"mode\\" }"',
            'fn name=answerRoute returns=void',
            '  handler lang="kern"',
            '    let name=item value="new NeedsStorage()"',
          ].join('\n'),
        },
      ),
    ).rejects.toThrow(/uses undeclared capabilities: storage\.get/);
  });

  test('fails closed when entry declares capabilities unused by its handler', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" handler=answerRoute requires="llm.complete"',
        ]),
        {
          '/app/answer.kern': [
            'fn name=answerRoute returns=void',
            '  handler lang="kern"',
            '    print value="\\"no model call\\""',
          ].join('\n'),
        },
      ),
    ).rejects.toThrow(/declares unused capabilities: llm\.complete/);
  });

  test('fails closed on missing and duplicate declared source handlers', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" handler=answerRoute',
        ]),
        {
          '/app/answer.kern': source(['print value="\\"main only\\""']),
        },
      ),
    ).rejects.toThrow(/route Answer references missing handler answerRoute/);

    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" handler=answerRoute',
        ]),
        {
          '/app/answer.kern': [
            'fn name=answerRoute returns=void',
            '  handler lang="kern"',
            '    print value="\\"a\\""',
            'fn name=answerRoute returns=void',
            '  handler lang="kern"',
            '    print value="\\"b\\""',
          ].join('\n'),
        },
      ),
    ).rejects.toThrow(/route Answer references duplicate handler answerRoute/);
  });

  test('fails closed when policy capability is not enforced by source', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" policy=Grounded requires="storage.get"',
          '  policy name=Grounded kind=rag-grounding requires="rag.checkAnswer"',
        ]),
        {
          '/app/answer.kern': source([
            'capability namespace=storage operation=get name=question input="{ key: \\"question\\" }"',
            'print value="question"',
          ]),
        },
      ),
    ).rejects.toThrow(/does not enforce policy capabilities: rag\.checkAnswer/);
  });

  test('fails closed when policy capability is only used by an unreachable helper', async () => {
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" handler=answerRoute policy=Grounded requires="rag.checkAnswer"',
          '  policy name=Grounded kind=rag-grounding requires="rag.checkAnswer"',
        ]),
        {
          '/app/answer.kern': [
            'fn name=deadHelper returns=void',
            '  handler lang="kern"',
            '    capability namespace=rag operation=checkAnswer name=check input="{ query: \\"q\\", answer: \\"a\\", chunks: [] }"',
            'fn name=answerRoute returns=void',
            '  handler lang="kern"',
            '    print value="\\"unguarded\\""',
          ].join('\n'),
        },
      ),
    ).rejects.toThrow(/does not enforce policy capabilities: rag\.checkAnswer/);
  });

  test('reports missing host providers for descriptor entries', async () => {
    const descriptor = await load(
      manifest([
        'app name=SupportApp',
        '  route name=Answer method=get path="/api/answer" source="./answer.kern" requires="storage.get,llm.complete"',
      ]),
      {
        '/app/answer.kern': source([
          'capability namespace=storage operation=get name=question input="{ key: \\"question\\" }"',
          'capability namespace=llm operation=complete name=answer input="{ prompt: question }"',
          'print value="answer"',
        ]),
      },
    );

    expect(findMissingKernAppEntryCapability(descriptor.routes[0], ['storage.get'], [])).toBe('llm.complete');
    expect(findMissingKernAppEntryCapability(descriptor.routes[0], ['storage.get'], ['llm.complete'])).toBeUndefined();
  });
});

describe('@kernlang/core/runtime policy-slot skeleton (5.2 scaffolding for 5.3 guards)', () => {
  const ROUTE_SOURCE = source(['print value="\\"ok\\""']);
  const POLICY_SOURCE = [
    'fn name=checkRequest returns=void',
    '  handler lang="kern"',
    '    print value="\\"policy\\""',
  ].join('\n');

  test('routes gain pre/post policy slots from slot= policies; declarative policies stay slot-less', async () => {
    const descriptor = await load(
      manifest([
        'app name=SupportApp',
        '  route name=Answer method=get path="/api/answer" source="./answer.kern" policy=PreGate',
        '  route name=Audit method=get path="/api/audit" source="./answer.kern" policy=PostGate',
        '  route name=Plain method=get path="/api/plain" source="./answer.kern" policy=Declarative',
        '  policy name=PreGate kind=passthrough slot=pre',
        '  policy name=PostGate kind=passthrough slot=post',
        '  policy name=Declarative kind=rag-grounding failureStatus=422',
      ]),
      { '/app/answer.kern': ROUTE_SOURCE },
    );

    const [answer, audit, plain] = descriptor.routes;
    expect(answer.prePolicies.map((policy) => policy.name)).toEqual(['PreGate']);
    expect(answer.postPolicies).toEqual([]);
    expect(answer.prePolicies[0]).toEqual(
      expect.objectContaining({ slot: 'pre', kind: 'passthrough', handler: 'main' }),
    );
    expect(audit.prePolicies).toEqual([]);
    expect(audit.postPolicies.map((policy) => policy.name)).toEqual(['PostGate']);
    expect(plain.prePolicies).toEqual([]);
    expect(plain.postPolicies).toEqual([]);
  });

  test('a slot policy with source=/handler= resolves inside the app root and validates fail-closed', async () => {
    const descriptor = await load(
      manifest([
        'app name=SupportApp',
        '  route name=Answer method=get path="/api/answer" source="./answer.kern" policy=PreGate',
        '  policy name=PreGate kind=passthrough slot=pre source="./policy.kern" handler=checkRequest',
      ]),
      { '/app/answer.kern': ROUTE_SOURCE, '/app/policy.kern': POLICY_SOURCE },
    );
    expect(descriptor.routes[0].prePolicies[0]).toEqual(
      expect.objectContaining({ sourcePath: '/app/policy.kern', handler: 'checkRequest' }),
    );

    // Missing policy source file fails the whole load.
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" policy=PreGate',
          '  policy name=PreGate kind=passthrough slot=pre source="./missing.kern"',
        ]),
        { '/app/answer.kern': ROUTE_SOURCE },
      ),
    ).rejects.toThrow(/policy PreGate source does not exist/);

    // Policy source without the referenced handler fails the whole load.
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" policy=PreGate',
          '  policy name=PreGate kind=passthrough slot=pre source="./policy.kern" handler=missingHandler',
        ]),
        { '/app/answer.kern': ROUTE_SOURCE, '/app/policy.kern': POLICY_SOURCE },
      ),
    ).rejects.toThrow(/missingHandler/);

    // Policy source escaping the app root fails the whole load.
    await expect(
      load(
        manifest([
          'app name=SupportApp',
          '  route name=Answer method=get path="/api/answer" source="./answer.kern" policy=PreGate',
          '  policy name=PreGate kind=passthrough slot=pre source="./../outside.kern"',
        ]),
        { '/app/answer.kern': ROUTE_SOURCE },
      ),
    ).rejects.toThrow(/must stay inside the app directory/);
  });

  test('fails closed on unknown slots, non-passthrough slot kinds, and orphaned slot props — even when unreferenced', async () => {
    const routeLine = '  route name=Answer method=get path="/api/answer" source="./answer.kern"';
    const files = { '/app/answer.kern': ROUTE_SOURCE };

    await expect(
      load(manifest(['app name=SupportApp', routeLine, '  policy name=Bad kind=passthrough slot=around']), files),
    ).rejects.toThrow(/policy Bad declares unknown slot 'around' \(expected pre or post\)/);

    await expect(
      load(manifest(['app name=SupportApp', routeLine, '  policy name=Bad kind=rag-grounding slot=pre']), files),
    ).rejects.toThrow(
      /policy Bad slot=pre requires an executable kind \(passthrough only in KERN 5\.2\), got 'rag-grounding'/,
    );

    await expect(
      load(manifest(['app name=SupportApp', routeLine, '  policy name=Bad slot=pre']), files),
    ).rejects.toThrow(/policy Bad slot=pre requires an executable kind/);

    await expect(
      load(manifest(['app name=SupportApp', routeLine, '  policy name=Bad kind=passthrough source="./p.kern"']), files),
    ).rejects.toThrow(/policy Bad declares source\/handler without slot=/);

    await expect(
      load(
        manifest(['app name=SupportApp', routeLine, '  policy name=Bad kind=passthrough slot=pre handler=check']),
        files,
      ),
    ).rejects.toThrow(/policy Bad declares handler= without source=/);
  });

  test('executeKernAppEntryPolicySlot runs passthrough hooks in order and fails closed on unknown slots', async () => {
    const descriptor = await load(
      manifest([
        'app name=SupportApp',
        '  route name=Answer method=get path="/api/answer" source="./answer.kern" policy=PreGate',
        '  policy name=PreGate kind=passthrough slot=pre',
      ]),
      { '/app/answer.kern': ROUTE_SOURCE },
    );
    const route = descriptor.routes[0];

    await expect(executeKernAppEntryPolicySlot(route, 'pre')).resolves.toEqual([
      { name: 'PreGate', slot: 'pre', kind: 'passthrough', action: 'passthrough' },
    ]);
    await expect(executeKernAppEntryPolicySlot(route, 'post')).resolves.toEqual([]);
    await expect(executeKernAppEntryPolicySlot(route, 'around' as KernAppPolicySlot)).rejects.toThrow(
      /unknown policy slot 'around' \(expected pre or post\)/,
    );
  });
});
