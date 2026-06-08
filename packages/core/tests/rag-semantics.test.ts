import { generateCoreNode, isCoreNode } from '../src/codegen-core.js';
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
    for (const type of ['corpus', 'source', 'chunking', 'embed', 'retriever', 'rag', 'grounding', 'ragEval']) {
      expect(isCoreNode(type)).toBe(true);
      expect(generateCoreNode({ type, props: {} })).toEqual([]);
    }
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
