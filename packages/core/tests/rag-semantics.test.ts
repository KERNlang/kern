import { generateCoreNode, isCoreNode } from '../src/codegen-core.js';
import { decompile } from '../src/decompiler.js';
import { parseDocumentWithDiagnostics } from '../src/parser.js';
import { validateSchema } from '../src/schema.js';
import { collectRagSemanticFacts, validateRagSemantics, validateSemantics } from '../src/semantic-validator.js';

function parseRoot(source: string) {
  return parseDocumentWithDiagnostics(source).root;
}

function rulesFor(source: string): string[] {
  return validateSemantics(parseRoot(source)).map((violation) => violation.rule);
}

describe('RAG language semantics', () => {
  test('registers RAG declarations as core language nodes', () => {
    for (const type of [
      'corpus',
      'source',
      'chunking',
      'embed',
      'vectorStore',
      'ragIndex',
      'retriever',
      'rag',
      'ragRetrieve',
      'grounding',
      'ragEval',
      'ragCase',
      'ragAssert',
      'ragAnswerContract',
      'answerSpan',
    ]) {
      expect(isCoreNode(type)).toBe(true);
      expect(generateCoreNode({ type, props: {} })).toEqual([]);
    }
  });

  test('parses RAG answer contract nodes without unknown-node diagnostics', () => {
    const diagnostics = parseDocumentWithDiagnostics(
      [
        'corpus name=Docs',
        'retriever name=DocsSearch corpus=Docs',
        'rag name=AnswerDocs retriever=DocsSearch',
        '  ragAnswerContract name=RefundAnswer query="q" answer="a"',
        '    answerSpan start=0 end=1 chunks=refunds',
      ].join('\n'),
    ).diagnostics;

    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'UNKNOWN_NODE_TYPE')).toEqual([]);
  });

  test('accepts a minimal grounded RAG declaration graph', () => {
    const source = [
      'corpus name=Docs title="Support docs"',
      '  source name=manuals kind=local uri="./docs/**/*.md" media=markdown',
      '  chunking source=manuals strategy=semantic maxTokens=600 overlap=80 unit=tokens',
      'embed name=DocsEmbedding corpus=Docs model=text-embedding-3-small dims=1536 metric=cosine',
      'retriever name=DocsSearch corpus=Docs embed=DocsEmbedding mode=hybrid topK=8 minScore=0.72',
      'rag name=AnswerDocs retriever=DocsSearch prompt="./answer.md" citations=true',
      '  grounding requireCitations=true policy=strict maxContext=6000',
      '  ragEval metric=faithfulness threshold=0.85',
    ].join('\n');

    expect(validateSchema(parseRoot(source))).toEqual([]);
    expect(validateSemantics(parseRoot(source))).toEqual([]);
  });

  test('collects RAG semantic facts for corpus retriever and pipeline contracts', () => {
    const root = parseRoot(
      [
        'corpus name=Docs title="Support docs"',
        '  source name=manuals kind=local uri="./docs/**/*.md" media=markdown',
        '  chunking source=manuals strategy=semantic maxTokens=600 overlap=80 unit=tokens',
        'embed name=DocsEmbedding corpus=Docs model=text-embedding-3-small dims=1536 metric=cosine',
        'retriever name=DocsSearch corpus=Docs embed=DocsEmbedding mode=hybrid topK=8 minScore=0.72',
        'rag name=AnswerDocs retriever=DocsSearch prompt="./answer.md" citations=true',
        '  grounding name=StrictGrounding requireCitations=true policy=strict maxContext=6000',
        '  ragEval name=Faithfulness metric=faithfulness threshold=0.85',
      ].join('\n'),
    );

    const facts = collectRagSemanticFacts(root);

    expect(facts.unresolvedCorpusRefs).toEqual([]);
    expect(facts.unresolvedRetrieverRefs).toEqual([]);
    expect(facts.corpora).toEqual([
      expect.objectContaining({
        name: 'Docs',
        title: 'Support docs',
        sources: [
          expect.objectContaining({
            name: 'manuals',
            corpusName: 'Docs',
            kind: 'local',
            uri: './docs/**/*.md',
            media: 'markdown',
          }),
        ],
        chunking: [
          expect.objectContaining({
            corpusName: 'Docs',
            sourceName: 'manuals',
            strategy: 'semantic',
            maxTokens: 600,
            overlap: 80,
            unit: 'tokens',
          }),
        ],
        embeds: [
          expect.objectContaining({
            name: 'DocsEmbedding',
            corpusName: 'Docs',
            model: 'text-embedding-3-small',
            dims: 1536,
            metric: 'cosine',
          }),
        ],
      }),
    ]);
    expect(facts.retrievers).toEqual([
      expect.objectContaining({
        name: 'DocsSearch',
        corpusName: 'Docs',
        embedName: 'DocsEmbedding',
        mode: 'hybrid',
        topK: 8,
        minScore: 0.72,
      }),
    ]);
    expect(facts.pipelines).toEqual([
      expect.objectContaining({
        name: 'AnswerDocs',
        retrieverName: 'DocsSearch',
        citations: true,
        groundings: [
          expect.objectContaining({
            name: 'StrictGrounding',
            ragName: 'AnswerDocs',
            requireCitations: true,
            policy: 'strict',
            maxContext: 6000,
          }),
        ],
        evals: [
          expect.objectContaining({
            name: 'Faithfulness',
            ragName: 'AnswerDocs',
            metric: 'faithfulness',
            threshold: 0.85,
          }),
        ],
      }),
    ]);
  });

  test('collects runtime RAG vector store index and retrieval contracts without emitting JS', () => {
    const root = parseRoot(
      [
        'corpus name=Docs title="Support docs"',
        '  source name=manuals kind=local uri="./docs/**/*.md" media=markdown',
        '  chunking name=DocsChunks source=manuals strategy=semantic maxTokens=600 overlap=80 unit=tokens',
        'embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine',
        'vectorStore name=DocsMemory kind=memory dims=64 metric=cosine',
        'ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding chunking=DocsChunks refresh=manual',
        'retriever name=DocsSearch corpus=Docs embed=DocsEmbedding mode=hybrid topK=8 minScore=0.72',
        'rag name=AnswerDocs retriever=DocsSearch citations=true',
        '  grounding requireCitations=true policy=strict maxContext=6000',
        '  ragRetrieve name=FindDocs index=DocsIndex queryParam=question as=context topK=4 minScore=0.72 output="RetrievedChunk[]" requireCitations=true',
      ].join('\n'),
    );

    expect(validateSchema(root)).toEqual([]);
    expect(validateSemantics(root)).toEqual([]);
    expect(generateCoreNode({ type: 'vectorStore', props: { name: 'DocsMemory' } })).toEqual([]);
    expect(generateCoreNode({ type: 'ragIndex', props: { name: 'DocsIndex' } })).toEqual([]);
    expect(generateCoreNode({ type: 'ragRetrieve', props: { name: 'FindDocs' } })).toEqual([]);
    expect(decompile(root).code).toContain('vectorStore name=DocsMemory kind=memory dims=64 metric=cosine');
    expect(decompile(root).code).toContain(
      'ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding chunking=DocsChunks refresh=manual',
    );
    expect(decompile(root).code).toContain(
      'ragRetrieve name=FindDocs index=DocsIndex queryParam=question as=context topK=4 minScore=0.72 output="RetrievedChunk[]" requireCitations=true',
    );

    const facts = collectRagSemanticFacts(root);
    expect(facts.vectorStores).toEqual([
      expect.objectContaining({
        name: 'DocsMemory',
        kind: 'memory',
        dims: 64,
        metric: 'cosine',
      }),
    ]);
    expect(facts.indexes).toEqual([
      expect.objectContaining({
        name: 'DocsIndex',
        corpusName: 'Docs',
        storeName: 'DocsMemory',
        embedName: 'DocsEmbedding',
        chunkingName: 'DocsChunks',
        refresh: 'manual',
      }),
    ]);
    expect(facts.runtimeRetrievals).toEqual([
      expect.objectContaining({
        name: 'FindDocs',
        indexName: 'DocsIndex',
        ragName: 'AnswerDocs',
        queryParam: 'question',
        as: 'context',
        topK: 4,
        minScore: 0.72,
        outputShape: 'RetrievedChunk[]',
        outputItemShape: 'RetrievedChunk',
        requireCitations: true,
        effectiveRequiresCitations: true,
      }),
    ]);
    expect(facts.mcpRetrievals).toEqual([]);
    expect(facts.unresolvedVectorStoreRefs).toEqual([]);
    expect(facts.unresolvedIndexRefs).toEqual([]);
    expect(facts.unresolvedChunkingRefs).toEqual([]);
  });

  test('runtime RAG retrieval inherits citation requirements from its rag pipeline', () => {
    const facts = collectRagSemanticFacts(
      parseRoot(
        [
          'corpus name=Docs',
          'embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine',
          'vectorStore name=DocsMemory kind=memory dims=64 metric=cosine',
          'ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding',
          'retriever name=DocsSearch corpus=Docs embed=DocsEmbedding',
          'rag name=AnswerDocs retriever=DocsSearch citations=true',
          '  grounding requireCitations=true',
          '  ragRetrieve name=FindDocs index=DocsIndex queryParam=question output="RetrievedChunk[]"',
        ].join('\n'),
      ),
    );

    expect(facts.runtimeRetrievals[0]).toEqual(
      expect.objectContaining({
        name: 'FindDocs',
        ragName: 'AnswerDocs',
        effectiveRequiresCitations: true,
      }),
    );
    expect(Object.hasOwn(facts.runtimeRetrievals[0] ?? {}, 'requireCitations')).toBe(false);
  });

  test('collects RAG eval case and assertion contracts as semantic facts', () => {
    const facts = collectRagSemanticFacts(
      parseRoot(
        [
          'corpus name=Docs',
          '  source name=manuals uri="./docs/**/*.md"',
          'retriever name=DocsSearch corpus=Docs',
          'rag name=AnswerDocs retriever=DocsSearch citations=true',
          '  grounding requireCitations=true',
          '  ragEval name=SupportEval metric=faithfulness threshold=0.85 mode=contract',
          '    ragCase name=refunds query="How do refunds work?" tags="smoke,policy" topK=4 minScore=0.72 chunkCount=2 sources="docs/refunds.md,docs/policies.md"',
          '      ragAssert kind=scoreGte threshold=0.72 required=true',
          '      ragAssert kind=sourceGlob value="docs/refunds.md" required=true',
          '      ragAssert kind=uniqueSourcesGte count=2',
          '      ragAssert kind=latencyLte valueMs=250',
          '      ragAssert kind=citesRequired',
        ].join('\n'),
      ),
    );

    expect(facts.pipelines[0]?.evals).toEqual([
      expect.objectContaining({
        name: 'SupportEval',
        ragName: 'AnswerDocs',
        metric: 'faithfulness',
        threshold: 0.85,
        mode: 'contract',
        caseCount: 1,
        assertCount: 5,
        cases: [
          expect.objectContaining({
            name: 'refunds',
            ragName: 'AnswerDocs',
            evalName: 'SupportEval',
            query: 'How do refunds work?',
            tags: ['smoke', 'policy'],
            expected: {
              topK: 4,
              minScore: 0.72,
              chunkCount: 2,
              sources: ['docs/refunds.md', 'docs/policies.md'],
            },
            asserts: [
              expect.objectContaining({
                kind: 'scoreGte',
                target: 'retrieved-chunk',
                op: 'gte',
                value: 0.72,
                required: true,
              }),
              expect.objectContaining({
                kind: 'sourceGlob',
                target: 'retrieved-chunk',
                op: 'glob',
                value: 'docs/refunds.md',
                required: true,
              }),
              expect.objectContaining({
                kind: 'uniqueSourcesGte',
                target: 'retrieved-chunks',
                op: 'gte',
                value: 2,
                required: false,
              }),
              expect.objectContaining({
                kind: 'latencyLte',
                target: 'latency',
                op: 'lte',
                value: 250,
                required: false,
              }),
              expect.objectContaining({
                kind: 'citesRequired',
                target: 'grounding',
                op: 'present',
                value: true,
                required: false,
              }),
            ],
          }),
        ],
      }),
    ]);
  });

  test('collects RAG answer contracts as semantic facts', () => {
    const facts = collectRagSemanticFacts(
      parseRoot(
        [
          'corpus name=Docs',
          'retriever name=DocsSearch corpus=Docs',
          'rag name=AnswerDocs retriever=DocsSearch citations=true',
          '  grounding requireCitations=true',
          '  ragAnswerContract name=RefundAnswer query="How do refunds work?" answer="Refunds follow the refund policy." prompt="./answer.md" requireCitations=true minGroundingCoverage=0.8',
          '    answerSpan start=0 end=33 chunks="refunds,policy" required=true',
        ].join('\n'),
      ),
    );

    expect(facts.pipelines[0]?.answerContracts).toEqual([
      expect.objectContaining({
        name: 'RefundAnswer',
        ragName: 'AnswerDocs',
        query: 'How do refunds work?',
        answer: 'Refunds follow the refund policy.',
        prompt: './answer.md',
        requireCitations: true,
        minGroundingCoverage: 0.8,
        spans: [
          expect.objectContaining({
            start: 0,
            end: 33,
            chunkIds: ['refunds', 'policy'],
            required: true,
          }),
        ],
      }),
    ]);
  });

  test('reports invalid RAG answer contract declarations', () => {
    const rules = rulesFor(
      [
        'corpus name=Docs',
        'retriever name=DocsSearch corpus=Docs',
        'rag name=AnswerDocs retriever=DocsSearch',
        '  ragAnswerContract name=Bad query="" answer="" requireCitations=true minGroundingCoverage=1.5',
        '    answerSpan start=4 end=4 chunks=""',
        '  ragAnswerContract name=LowCoverage query="q" answer="abcd" minGroundingCoverage=1',
        '    answerSpan start=0 end=2 chunks=half',
        '  ragAnswerContract name=LongSpan query="q" answer="abcd"',
        '    answerSpan start=0 end=10 chunks=tooLong',
        'ragAnswerContract name=Detached rag=Missing query="q" answer="a"',
        'answerSpan start=0 end=1 chunks=orphan',
      ].join('\n'),
    );

    expect(rules).toEqual(
      expect.arrayContaining([
        'rag-answer-contract-query-required',
        'rag-answer-contract-answer-required',
        'rag-answer-contract-min-grounding-coverage-invalid',
        'rag-answer-contract-citations-require-grounding',
        'rag-answer-span-range-invalid',
        'rag-answer-span-chunks-required',
        'rag-answer-contract-grounding-coverage-insufficient',
        'rag-answer-contract-unknown-rag',
        'rag-answer-span-missing-contract',
      ]),
    );
  });

  test('keeps RAG eval case facts scoped to their parent eval node', () => {
    const facts = collectRagSemanticFacts(
      parseRoot(
        [
          'corpus name=Docs',
          'retriever name=DocsSearch corpus=Docs',
          'rag name=AnswerDocs retriever=DocsSearch citations=true',
          '  grounding requireCitations=true',
          '  ragEval name=SupportEval metric=faithfulness threshold=0.85 mode=contract',
          '    ragCase name=nested query="nested case"',
          '      ragAssert kind=contains value="nested"',
          'ragEval rag=AnswerDocs name=SupportEval metric=faithfulness threshold=0.85 mode=contract',
          '  ragCase name=topLevel query="top-level case"',
          '    ragAssert kind=contains value="top-level"',
        ].join('\n'),
      ),
    );

    expect(facts.pipelines[0]?.evals).toEqual([
      expect.objectContaining({
        caseCount: 1,
        assertCount: 1,
        cases: [expect.objectContaining({ name: 'nested', query: 'nested case' })],
      }),
      expect.objectContaining({
        caseCount: 1,
        assertCount: 1,
        cases: [expect.objectContaining({ name: 'topLevel', query: 'top-level case' })],
      }),
    ]);
  });

  test('accepts MCP resource-backed corpus sources as static ingress contracts', () => {
    const source = [
      'mcp name=Support',
      '  resource name=DocsResource uri="docs://manuals"',
      'corpus name=Docs',
      '  source name=manuals kind=mcp resource=DocsResource uri="mcp://DocsResource" media=markdown',
      '  chunking source=manuals strategy=semantic maxTokens=600 overlap=80',
      'retriever name=DocsSearch corpus=Docs',
    ].join('\n');

    expect(validateSchema(parseRoot(source))).toEqual([]);
    expect(validateSemantics(parseRoot(source))).toEqual([]);

    const facts = collectRagSemanticFacts(parseRoot(source));
    expect(facts.unresolvedResourceRefs).toEqual([]);
    expect(facts.corpora[0]?.sources).toEqual([
      expect.objectContaining({
        name: 'manuals',
        corpusName: 'Docs',
        kind: 'mcp',
        uri: 'mcp://DocsResource',
        resourceName: 'DocsResource',
      }),
    ]);
    expect(facts.resourceFeedsCorpora).toEqual([
      expect.objectContaining({
        corpusName: 'Docs',
        sourceName: 'manuals',
        resourceName: 'DocsResource',
        uri: 'mcp://DocsResource',
      }),
    ]);
  });

  test('accepts MCP tool and prompt retrieval intents against RAG contracts', () => {
    const source = [
      'corpus name=Docs',
      '  source name=manuals uri="./docs/**/*.md"',
      'embed name=DocsEmbedding corpus=Docs',
      'retriever name=DocsSearch corpus=Docs embed=DocsEmbedding topK=8 minScore=0.72',
      'rag name=AnswerDocs retriever=DocsSearch citations=true',
      '  grounding requireCitations=true policy=strict',
      'mcp name=Support',
      '  tool name=answerQuestion',
      '    param name=question type=string required=true',
      '    retrieve rag=AnswerDocs queryParam=question as=context topK=4 minScore=0.8 output="RetrievedChunk[]" requireCitations=true provenance=source citationField=citation sourceField=uri scoreField=score',
      '  prompt name=summarizeDocs',
      '    param name=question type=string required=true',
      '    retrieve retriever=DocsSearch queryParam=question as=chunks requireGrounding=true output="RetrievedChunk[]" scoreField=score',
    ].join('\n');

    expect(validateSchema(parseRoot(source))).toEqual([]);
    expect(validateSemantics(parseRoot(source))).toEqual([]);
  });

  test('collects MCP retrieval intent facts from tools and prompts', () => {
    const facts = collectRagSemanticFacts(
      parseRoot(
        [
          'corpus name=Docs',
          '  source name=manuals uri="./docs/**/*.md"',
          'retriever name=DocsSearch corpus=Docs',
          'rag name=AnswerDocs retriever=DocsSearch citations=true',
          '  grounding requireCitations=true',
          'mcp name=Support',
          '  tool name=answerQuestion',
          '    param name=question type=string required=true',
          '    retrieve name=answerDocs rag=AnswerDocs queryParam=question as=context topK=4 minScore=0.8 output="RetrievedChunk[]" requireCitations=true provenance=source citationField=citation sourceField=uri scoreField=score',
          '  prompt name=summarizeDocs',
          '    param name=question type=string required=true',
          '    retrieve retriever=DocsSearch queryParam=question as=chunks requireGrounding=true output="RetrievedChunk[]" scoreField=score',
        ].join('\n'),
      ),
    );

    expect(facts.unresolvedRetrieverRefs).toEqual([]);
    expect(facts.unresolvedRagRefs).toEqual([]);
    expect(facts.mcpRetrievals).toEqual([
      expect.objectContaining({
        containerKind: 'tool',
        containerName: 'answerQuestion',
        targetKind: 'rag',
        targetName: 'AnswerDocs',
        name: 'answerDocs',
        queryParam: 'question',
        as: 'context',
        topK: 4,
        minScore: 0.8,
        requireGrounding: true,
        outputShape: 'RetrievedChunk[]',
        outputItemShape: 'RetrievedChunk',
        requireCitations: true,
        effectiveRequiresCitations: true,
        provenance: 'source',
        citationField: 'citation',
        sourceField: 'uri',
        scoreField: 'score',
        contractStatus: 'valid',
      }),
      expect.objectContaining({
        containerKind: 'prompt',
        containerName: 'summarizeDocs',
        targetKind: 'retriever',
        targetName: 'DocsSearch',
        queryParam: 'question',
        as: 'chunks',
        requireGrounding: true,
        outputShape: 'RetrievedChunk[]',
        outputItemShape: 'RetrievedChunk',
        effectiveRequiresCitations: false,
        scoreField: 'score',
        contractStatus: 'valid',
      }),
    ]);
  });

  test('treats explicit false RAG booleans as false', () => {
    const root = parseRoot(
      [
        'corpus name=Docs',
        '  source name=manuals uri="./docs/**/*.md"',
        'embed name=DocsEmbedding corpus=Docs',
        'retriever name=DocsSearch corpus=Docs embed=DocsEmbedding',
        'rag name=AnswerDocs retriever=DocsSearch citations=false',
        '  grounding requireCitations=false',
      ].join('\n'),
    );

    expect(validateSemantics(root)).toEqual([]);
    expect(collectRagSemanticFacts(root).pipelines[0]).toEqual(
      expect.objectContaining({
        citations: false,
        groundings: [expect.objectContaining({ requireCitations: false })],
      }),
    );
  });

  test('reports invalid RAG references and numeric contracts', () => {
    const source = [
      'corpus name=Docs',
      '  source name=manuals uri="./docs/**/*.md"',
      '  chunking source=missing strategy=semantic maxTokens=64 overlap=64',
      'embed name=BadEmbedding corpus=Missing dims=0',
      'embed name=OtherEmbedding corpus=Docs',
      'corpus name=OtherDocs',
      'retriever name=BadRetriever corpus=Missing embed=MissingEmbed topK=0 minScore=1.1',
      'retriever name=MismatchRetriever corpus=OtherDocs embed=OtherEmbedding',
      'rag name=BadRag retriever=MissingRetriever citations=true',
      'grounding rag=MissingRag maxContext=0',
      'ragEval rag=MissingRag threshold=1.1',
    ].join('\n');

    expect(rulesFor(source)).toEqual(
      expect.arrayContaining([
        'rag-chunking-unknown-source',
        'rag-chunking-overlap-invalid',
        'rag-embed-unknown-corpus',
        'rag-embed-dims-invalid',
        'rag-retriever-unknown-corpus',
        'rag-retriever-unknown-embed',
        'rag-retriever-topk-invalid',
        'rag-retriever-minscore-invalid',
        'rag-retriever-embed-corpus-mismatch',
        'rag-unknown-retriever',
        'rag-citations-require-grounding',
        'rag-grounding-unknown-rag',
        'rag-grounding-max-context-invalid',
        'rag-eval-unknown-rag',
        'rag-eval-threshold-invalid',
      ]),
    );
  });

  test('rejects semantic chunking with character units instead of silently downgrading strategy', () => {
    const source = [
      'corpus name=Docs',
      '  source name=manuals uri="./docs/**/*.md"',
      '  chunking source=manuals strategy=semantic maxTokens=64 overlap=8 unit=chars',
    ].join('\n');

    expect(rulesFor(source)).toContain('rag-chunking-semantic-unit-invalid');
  });

  test('rejects unsupported RAG chunking strategies instead of silently using window chunking', () => {
    const source = [
      'corpus name=Docs',
      '  source name=manuals uri="./docs/**/*.md"',
      '  chunking source=manuals strategy=semnatic maxTokens=64 overlap=8 unit=tokens',
    ].join('\n');

    expect(rulesFor(source)).toContain('rag-chunking-strategy-invalid');
  });

  test('rejects unsupported RAG embed models', () => {
    const source = [
      'corpus name=Docs',
      'embed name=DocsEmbedding corpus=Docs model=unknown-embedder dims=64 metric=cosine',
    ].join('\n');

    expect(rulesFor(source)).toContain('rag-embed-model-unsupported');
  });

  test('rejects embed dimensions that disagree with a supported model', () => {
    const source = [
      'corpus name=Docs',
      'embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=1536 metric=cosine',
    ].join('\n');

    expect(rulesFor(source)).toContain('rag-embed-dims-model-mismatch');
  });

  test('rejects embed dimensions that disagree with the default local semantic model', () => {
    const source = ['corpus name=Docs', 'embed name=DocsEmbedding corpus=Docs dims=1536 metric=cosine'].join('\n');

    expect(rulesFor(source)).toContain('rag-embed-dims-model-mismatch');
  });

  test('allows reduced OpenAI embedding dimensions supported by the provider API', () => {
    const source = [
      'corpus name=Docs',
      'embed name=DocsEmbedding corpus=Docs model="openai:text-embedding-3-small" dims=512 metric=cosine',
    ].join('\n');

    expect(rulesFor(source)).not.toContain('rag-embed-dims-model-mismatch');
  });

  test('reports invalid RAG eval case and assertion contracts', () => {
    const source = [
      'corpus name=Docs',
      'retriever name=DocsSearch corpus=Docs',
      'rag name=AnswerDocs retriever=DocsSearch',
      '  ragEval metric=faithfulness threshold=0.85',
      '    ragCase name=missingMode query="What changed?" sources="docs/refunds.md" topK=0 minScore=1.2 chunkCount=-1',
      '      ragAssert kind=unknownKind',
      '      ragAssert kind=scoreGte threshold=1.5',
      '      ragAssert kind=scoreLte',
      '      ragAssert kind=chunkHash value=not-a-hash',
      '      ragAssert kind=chunkCountEq count=-1',
      '      ragAssert kind=latencyLte valueMs=-1',
      '      ragAssert kind=sourceEq',
      '      ragAssert kind=citesRequired',
      'ragCase name=loose query="outside eval"',
      'ragAssert kind=citesRequired',
    ].join('\n');

    expect(rulesFor(source)).toEqual(
      expect.arrayContaining([
        'rag-eval-name-required',
        'rag-eval-mode-required',
        'rag-case-topk-invalid',
        'rag-case-minscore-invalid',
        'rag-case-chunk-count-invalid',
        'rag-case-sources-require-citations',
        'rag-case-missing-eval',
        'rag-assert-kind-invalid',
        'rag-assert-threshold-required',
        'rag-assert-threshold-invalid',
        'rag-assert-chunk-hash-invalid',
        'rag-assert-count-invalid',
        'rag-assert-value-ms-invalid',
        'rag-assert-value-required',
        'rag-assert-citations-require-grounding',
        'rag-assert-missing-eval',
        'rag-assert-missing-case',
      ]),
    );
  });

  test('reports invalid MCP retrieval bindings into RAG contracts', () => {
    const source = [
      'corpus name=Docs',
      'retriever name=DocsSearch corpus=Docs',
      'rag name=AnswerDocs retriever=DocsSearch citations=true',
      '  grounding requireCitations=true',
      'mcp name=Support',
      '  tool name=badTool',
      '    param name=question type=string required=true',
      '    retrieve rag=AnswerDocs retriever=MissingRetriever queryParam=missing query={{question}} topK=0 minScore=1.2 requireGrounding=false',
      '    retrieve retriever=AlsoMissing queryParam=question',
      'retrieve rag=MissingRag',
    ].join('\n');

    expect(rulesFor(source)).toEqual(
      expect.arrayContaining([
        'mcp-retrieve-target-exclusive',
        'mcp-retrieve-unknown-retriever',
        'mcp-retrieve-query-param-unknown',
        'mcp-retrieve-query-exclusive',
        'mcp-retrieve-topk-invalid',
        'mcp-retrieve-minscore-invalid',
        'mcp-retrieve-citations-require-grounding',
        'mcp-retrieve-duplicate',
        'mcp-retrieve-missing-container',
        'mcp-retrieve-unknown-rag',
      ]),
    );

    const facts = collectRagSemanticFacts(parseRoot(source));
    expect(facts.unresolvedRetrieverRefs).toEqual(['AlsoMissing', 'MissingRetriever']);
    expect(facts.unresolvedRagRefs).toEqual(['MissingRag']);
  });

  test('reports invalid MCP retrieval output contracts', () => {
    const source = [
      'corpus name=Docs',
      'retriever name=DocsSearch corpus=Docs',
      'rag name=AnswerDocs retriever=DocsSearch citations=true',
      '  grounding requireCitations=true',
      'rag name=PlainAnswer retriever=DocsSearch',
      'mcp name=Support',
      '  tool name=badOutput',
      '    param name=question type=string required=true',
      '    retrieve retriever=DocsSearch queryParam=question output="Foo[]"',
      '  tool name=scalarOutput',
      '    param name=question type=string required=true',
      '    retrieve retriever=DocsSearch queryParam=question output=RetrievedChunk',
      '  tool name=fieldWithoutOutput',
      '    param name=question type=string required=true',
      '    retrieve retriever=DocsSearch queryParam=question citationField=citation',
      '  tool name=requireCitationsWithoutOutput',
      '    param name=question type=string required=true',
      '    retrieve retriever=DocsSearch queryParam=question requireCitations=true',
      '  tool name=missingCitationField',
      '    param name=question type=string required=true',
      '    retrieve rag=PlainAnswer queryParam=question output="RetrievedChunk[]" requireCitations=true provenance=source',
      '  tool name=missingSourceField',
      '    param name=question type=string required=true',
      '    retrieve rag=PlainAnswer queryParam=question output="RetrievedChunk[]" requireCitations=true citationField=citation',
      '  tool name=weakensCitations',
      '    param name=question type=string required=true',
      '    retrieve rag=AnswerDocs queryParam=question output="RetrievedChunk[]" requireCitations=false',
    ].join('\n');

    expect(rulesFor(source)).toEqual(
      expect.arrayContaining([
        'mcp-retrieve-output-unknown',
        'mcp-retrieve-output-array-required',
        'mcp-retrieve-output-field-without-output',
        'mcp-retrieve-output-required',
        'mcp-retrieve-output-citation-field-required',
        'mcp-retrieve-output-source-required',
        'mcp-retrieve-output-citations-cannot-weaken-rag',
      ]),
    );

    const facts = collectRagSemanticFacts(parseRoot(source));
    expect(facts.mcpRetrievals.map((fact) => fact.contractStatus)).toEqual([
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
    ]);
  });

  test('reports invalid MCP resource-backed corpus source bindings', () => {
    const source = [
      'mcp name=Support',
      '  tool name=DocsTool',
      '  prompt name=DocsPrompt',
      '  resource name=DocsResource uri="docs://manuals"',
      '  resource name=UniqueResource uri="docs://unique"',
      'mcp name=OtherSupport',
      '  resource name=DocsResource uri="docs://other-manuals"',
      'corpus name=Docs',
      '  source name=missingResource kind=mcp uri="mcp://MissingResource"',
      '  source name=unknownResource kind=mcp resource=MissingResource uri="mcp://MissingResource"',
      '  source name=toolResource kind=mcp resource=DocsTool uri="mcp://DocsTool"',
      '  source name=promptResource kind=mcp resource=DocsPrompt uri="mcp://DocsPrompt"',
      '  source name=ambiguousMcp kind=mcp resource=DocsResource uri="mcp://DocsResource"',
      '  source name=validMcp kind=mcp resource=UniqueResource uri="mcp://UniqueResource"',
      '  source name=fileResource kind=local resource=DocsResource uri="./docs/**/*.md"',
    ].join('\n');

    expect(rulesFor(source)).toEqual(
      expect.arrayContaining([
        'rag-source-mcp-resource-required',
        'rag-source-mcp-resource-unknown',
        'rag-source-mcp-resource-kind',
        'rag-source-mcp-resource-ambiguous',
        'rag-source-resource-requires-mcp-kind',
      ]),
    );

    const facts = collectRagSemanticFacts(parseRoot(source));
    expect(facts.resourceFeedsCorpora).toEqual([
      expect.objectContaining({
        sourceName: 'validMcp',
        resourceName: 'UniqueResource',
      }),
    ]);
    expect(facts.unresolvedResourceRefs).toEqual(['MissingResource']);
  });

  test('reports MCP retrieval declarations without a target', () => {
    expect(
      rulesFor(['mcp name=Support', '  tool name=badTool', '    retrieve queryParam=question'].join('\n')),
    ).toContain('mcp-retrieve-target-required');
  });

  test('reports MCP retrieval declarations without a query source', () => {
    expect(
      rulesFor(
        [
          'corpus name=Docs',
          'retriever name=DocsSearch corpus=Docs',
          'mcp name=Support',
          '  tool name=badTool',
          '    retrieve retriever=DocsSearch',
        ].join('\n'),
      ),
    ).toContain('mcp-retrieve-query-required');
  });

  test('reports disconnected and duplicate RAG declarations', () => {
    const source = [
      'corpus name=Docs',
      'corpus name=Docs',
      'source name=topLevel uri="./loose.md"',
      'corpus name=DuplicatedSources',
      '  source name=manuals uri="./a.md"',
      '  source name=manuals uri="./b.md"',
      'embed name=DocsEmbedding corpus=Docs',
      'embed name=DocsEmbedding corpus=Docs',
      'retriever name=DocsSearch corpus=Docs',
      'retriever name=DocsSearch corpus=Docs',
      'rag name=AnswerDocs retriever=DocsSearch',
      'rag name=AnswerDocs retriever=DocsSearch',
      'chunking source=manuals maxTokens=abc',
      'grounding maxContext=abc',
      'ragEval threshold=abc',
    ].join('\n');

    expect(rulesFor(source)).toEqual(
      expect.arrayContaining([
        'rag-duplicate-corpus-name',
        'rag-source-missing-corpus',
        'rag-duplicate-source-name',
        'rag-duplicate-embed-name',
        'rag-duplicate-retriever-name',
        'rag-duplicate-rag-name',
        'rag-chunking-missing-corpus',
        'rag-chunking-max-tokens-invalid',
        'rag-grounding-missing-rag',
        'rag-grounding-max-context-invalid',
        'rag-eval-missing-rag',
        'rag-eval-threshold-invalid',
      ]),
    );
  });

  test('reports invalid runtime RAG vector store index and retrieval contracts', () => {
    const source = [
      'corpus name=Docs',
      'corpus name=OtherDocs',
      '  chunking name=OtherChunks maxTokens=100',
      'embed name=OtherEmbedding corpus=OtherDocs model=local-semantic-v1 dims=64 metric=cosine',
      'embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine',
      'vectorStore name=BadStore kind=local dims=0 metric=dot url="postgres://db" table=rag_chunks',
      'vectorStore name=BadStore kind=memory dims=64 metric=cosine path="./bad"',
      'vectorStore name=Store32 kind=memory dims=32 metric=cosine',
      'ragIndex name=BadIndex corpus=MissingCorpus store=MissingStore embed=MissingEmbed chunking=MissingChunks',
      'ragIndex name=MismatchIndex corpus=Docs store=BadStore embed=OtherEmbedding chunking=OtherChunks',
      'ragIndex name=DimsMismatch corpus=Docs store=Store32 embed=DocsEmbedding',
      'ragIndex name=DuplicateIndex corpus=Docs store=Store32 embed=DocsEmbedding',
      'ragIndex name=DuplicateIndex corpus=Docs store=Store32 embed=DocsEmbedding',
      'retriever name=DocsSearch corpus=Docs embed=DocsEmbedding',
      'rag name=AnswerDocs retriever=DocsSearch',
      '  ragRetrieve name=ConflictRetrieve index=DimsMismatch rag=OtherRag queryParam=question',
      'rag name=OtherRag retriever=DocsSearch',
      'rag name=CitedRag retriever=DocsSearch citations=true',
      '  grounding requireCitations=true',
      '  ragRetrieve name=WeakRetrieve index=DimsMismatch queryParam=question requireCitations=false',
      '  ragRetrieve name=NeedsCitationOutput index=DimsMismatch queryParam=question requireCitations=true',
      'ragRetrieve name=BadRetrieve index=MissingIndex rag=MissingRag queryParam=question query={{ question }} topK=0 minScore=1.5 output=RetrievedChunk',
      'ragRetrieve name=BadRetrieve index=DimsMismatch output="Wrong[]"',
    ].join('\n');

    expect(rulesFor(source)).toEqual(
      expect.arrayContaining([
        'rag-duplicate-vector-store-name',
        'rag-duplicate-index-name',
        'rag-duplicate-runtime-retrieve-name',
        'rag-vector-store-dims-invalid',
        'rag-vector-store-metric-unsupported',
        'rag-vector-store-path-required',
        'rag-vector-store-memory-config-invalid',
        'rag-vector-store-local-config-invalid',
        'rag-index-unknown-corpus',
        'rag-index-unknown-vector-store',
        'rag-index-unknown-embed',
        'rag-index-unknown-chunking',
        'rag-index-embed-corpus-mismatch',
        'rag-index-store-embed-dims-mismatch',
        'rag-retrieve-unknown-index',
        'rag-retrieve-unknown-rag',
        'rag-retrieve-rag-conflicts-parent',
        'rag-retrieve-citations-cannot-weaken-rag',
        'rag-retrieve-query-required',
        'rag-retrieve-query-exclusive',
        'rag-retrieve-topk-invalid',
        'rag-retrieve-minscore-invalid',
        'rag-retrieve-output-required',
        'rag-retrieve-output-array-required',
        'rag-retrieve-output-unknown',
      ]),
    );

    const facts = collectRagSemanticFacts(parseRoot(source));
    expect(facts.unresolvedCorpusRefs).toEqual(['MissingCorpus']);
    expect(facts.unresolvedVectorStoreRefs).toEqual(['MissingStore']);
    expect(facts.unresolvedIndexRefs).toEqual(['MissingIndex']);
    expect(facts.unresolvedChunkingRefs).toEqual(['MissingChunks', 'OtherChunks']);
    expect(facts.unresolvedEmbedRefs).toEqual(['MissingEmbed']);
    expect(facts.unresolvedRagRefs).toEqual(['MissingRag']);
  });

  test('reports duplicate RAG eval and case names in their contract namespaces', () => {
    const source = [
      'corpus name=Docs',
      'retriever name=DocsSearch corpus=Docs',
      'rag name=AnswerDocs retriever=DocsSearch',
      '  ragEval name=Faithfulness metric=faithfulness threshold=0.85 mode=contract',
      '    ragCase name=refunds query="first"',
      '    ragCase name=refunds query="duplicate"',
      'ragEval rag=AnswerDocs name=Faithfulness metric=faithfulness threshold=0.9 mode=contract',
      '  ragCase name=external query="duplicate eval"',
    ].join('\n');

    expect(rulesFor(source)).toEqual(expect.arrayContaining(['rag-duplicate-eval-name', 'rag-duplicate-case-name']));
  });

  test('allows RAG eval and case name reuse across separate namespaces', () => {
    const source = [
      'corpus name=Docs',
      'retriever name=DocsSearch corpus=Docs',
      'rag name=AnswerDocs retriever=DocsSearch',
      '  ragEval name=Faithfulness metric=faithfulness threshold=0.85 mode=contract',
      '    ragCase name=refunds query="answer docs"',
      'rag name=AuditDocs retriever=DocsSearch',
      '  ragEval name=Faithfulness metric=faithfulness threshold=0.85 mode=contract',
      '    ragCase name=refunds query="audit docs"',
      'ragEval rag=AnswerDocs name=Relevance metric=relevance threshold=0.85 mode=contract',
      '  ragCase name=refunds query="same case name, different eval"',
    ].join('\n');

    expect(validateSemantics(parseRoot(source))).toEqual([]);
  });

  test('requires chunking source refs to resolve inside the referenced corpus', () => {
    const source = [
      'corpus name=Docs',
      'corpus name=OtherDocs',
      '  source name=manuals uri="./other/**/*.md"',
      'chunking corpus=Docs source=manuals maxTokens=100',
    ].join('\n');

    expect(rulesFor(source)).toContain('rag-chunking-unknown-source');
    expect(collectRagSemanticFacts(parseRoot(source)).unresolvedSourceRefs).toEqual(['manuals']);
  });

  test('can validate only RAG rules when consumers need a focused pass', () => {
    const root = parseRoot(
      ['machine name=Flow', '  transition name=go from=Missing to=Missing', 'rag name=Bad retriever=Missing'].join(
        '\n',
      ),
    );

    expect(validateRagSemantics(root).map((violation) => violation.rule)).toEqual(['rag-unknown-retriever']);
  });
});
