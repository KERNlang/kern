describe('Express transpiler RAG boundary diagnostics', () => {
  test('classifies RAG declarations as runner-only consumed nodes', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileExpress } = await import('../src/transpiler-express.js');
    const source = [
      'server name=Api',
      '  route method=GET path="/health" response=Health',
      'interface name=Health',
      '  field name=ok type=boolean',
      'corpus name=Docs',
      '  source name=manuals kind=local uri="./docs/**/*.md"',
      'vectorStore name=DocsMemory kind=memory dims=64 metric=cosine',
      'ragIndex name=DocsIndex corpus=Docs store=DocsMemory',
      'ragRetrieve name=FindDocs index=DocsIndex queryParam=question output="RetrievedChunk[]"',
    ].join('\n');

    const result = transpileExpress(parse(source));
    const ragDiagnostics = (result.diagnostics ?? []).filter((diagnostic: any) =>
      ['corpus', 'source', 'vectorStore', 'ragIndex', 'ragRetrieve'].includes(diagnostic.nodeType),
    );

    expect(ragDiagnostics.map((diagnostic: any) => diagnostic.nodeType).sort()).toEqual([
      'corpus',
      'ragIndex',
      'ragRetrieve',
      'source',
      'vectorStore',
    ]);
    expect(ragDiagnostics.every((diagnostic: any) => diagnostic.outcome === 'consumed')).toBe(true);
    expect(ragDiagnostics.every((diagnostic: any) => diagnostic.target === 'express')).toBe(true);
    expect(ragDiagnostics.every((diagnostic: any) => diagnostic.reason?.includes('rag-runner-only-boundary'))).toBe(
      true,
    );
  });

  test('does not hide malformed non-RAG nodes under RAG declarations', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileExpress } = await import('../src/transpiler-express.js');
    const source = ['server name=Api', 'corpus name=Docs', '  button text=BadNest', 'source uri="./loose.md"'].join(
      '\n',
    );

    const result = transpileExpress(parse(source));
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeType: 'corpus', outcome: 'consumed' }),
        expect.objectContaining({ nodeType: 'button', outcome: 'unsupported' }),
        expect.objectContaining({ nodeType: 'source', outcome: 'unsupported' }),
      ]),
    );
  });
});
