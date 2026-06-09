import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectRagSemanticFacts,
  decompile,
  evaluateRagEvalContract,
  evaluateRagSemanticAnswerContract,
  generateCoreNode,
  parseDocumentWithDiagnostics,
  type RagSemanticFacts,
  type RetrieveResult,
  validateRagSemantics,
  validateSchema,
  withRagRuntimeProvenance,
} from '../src/index.js';
import type { IRNode } from '../src/types.js';

interface RagConformanceFixture {
  readonly file: string;
  readonly answerContractName: string;
  readonly evalContractName: string;
  readonly expectedAnswerPassed: boolean;
  readonly expectedAnswerStatus: string;
  readonly expectedEvalPassed: boolean;
  readonly retrieval: RetrieveResult;
}

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/rag-answer-contracts');

const FIXTURES: readonly RagConformanceFixture[] = [
  {
    file: 'full-grounded.kern',
    answerContractName: 'RefundAnswer',
    evalContractName: 'Faithfulness',
    expectedAnswerPassed: true,
    expectedAnswerStatus: 'grounded',
    expectedEvalPassed: true,
    retrieval: {
      query: 'refund policy',
      chunks: [
        {
          id: 'refunds',
          text: 'Refunds follow the refund policy.',
          score: 1,
          source: 'docs/refunds.md',
          citation: { uri: 'docs/refunds.md', locator: 'L1-L2' },
        },
      ],
    },
  },
  {
    file: 'multi-span-grounded.kern',
    answerContractName: 'MultiSpanAnswer',
    evalContractName: 'Faithfulness',
    expectedAnswerPassed: true,
    expectedAnswerStatus: 'grounded',
    expectedEvalPassed: true,
    retrieval: {
      query: 'refund policy',
      chunks: [
        {
          id: 'refunds',
          text: 'Refunds follow policy.',
          score: 0.95,
          source: 'docs/refunds.md',
          citation: { uri: 'docs/refunds.md' },
        },
        {
          id: 'shipping',
          text: 'Shipping is separate.',
          score: 0.9,
          source: 'docs/policies.md',
          citation: { uri: 'docs/policies.md' },
        },
      ],
    },
  },
  {
    file: 'unknown-chunk.kern',
    answerContractName: 'MissingChunkAnswer',
    evalContractName: 'Faithfulness',
    expectedAnswerPassed: false,
    expectedAnswerStatus: 'invalid',
    expectedEvalPassed: true,
    retrieval: {
      query: 'refund policy',
      chunks: [
        {
          id: 'refunds',
          text: 'refund policy',
          score: 1,
          source: 'docs/refunds.md',
          citation: { uri: 'docs/refunds.md' },
        },
      ],
    },
  },
];

describe('RAG eval and answer contract conformance', () => {
  for (const fixture of FIXTURES) {
    test(`${fixture.file} agrees across semantic, decompile, codegen, and runtime views`, () => {
      const source = readFixture(fixture.file);
      const original = parseValidRagSource(source, fixture.file);
      const decompiled = decompile(original).code;
      expect(decompiled, `${fixture.file} decompiled answer contract`).toContain(
        `ragAnswerContract name=${fixture.answerContractName}`,
      );
      expect(decompiled, `${fixture.file} decompiled answer span`).toContain('answerSpan ');
      expect(decompiled, `${fixture.file} decompiled eval contract`).toContain(
        `ragEval name=${fixture.evalContractName}`,
      );
      const reparsed = parseValidRagSource(decompiled, `${fixture.file}:decompiled`);
      const originalFacts = collectRagSemanticFacts(original);
      const decompiledFacts = collectRagSemanticFacts(reparsed);

      expect(normalizedRagFacts(decompiledFacts)).toEqual(normalizedRagFacts(originalFacts));
      expect(generateCoreNode(original)).toEqual([]);
      expect(generateCoreNode(reparsed)).toEqual([]);

      const originalResult = evaluateFixtureAnswerContract(originalFacts, fixture);
      const decompiledResult = evaluateFixtureAnswerContract(decompiledFacts, fixture);
      expect(normalizedAnswerResult(decompiledResult)).toEqual(normalizedAnswerResult(originalResult));
      expect(originalResult.passed).toBe(fixture.expectedAnswerPassed);
      expect(originalResult.status).toBe(fixture.expectedAnswerStatus);

      const originalEval = evaluateFixtureEval(originalFacts, fixture);
      const decompiledEval = evaluateFixtureEval(decompiledFacts, fixture);
      expect(normalizedEvalResult(decompiledEval)).toEqual(normalizedEvalResult(originalEval));
      expect(originalEval.passed).toBe(fixture.expectedEvalPassed);
    });
  }
});

function readFixture(file: string): string {
  const path = resolve(FIXTURE_DIR, file);
  try {
    return readFileSync(path, 'utf-8');
  } catch (error) {
    throw new Error(`failed to read RAG conformance fixture ${path}`, { cause: error });
  }
}

function parseValidRagSource(source: string, label: string): IRNode {
  const parsed = parseDocumentWithDiagnostics(source);
  const parseErrors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  expect(parseErrors, `${label} parse errors`).toEqual([]);
  expect(parsed.diagnostics.filter((diagnostic) => diagnostic.code === 'UNKNOWN_NODE_TYPE')).toEqual([]);
  expect(validateSchema(parsed.root), `${label} schema violations`).toEqual([]);
  expect(validateRagSemantics(parsed.root), `${label} RAG semantic violations`).toEqual([]);
  return parsed.root;
}

function evaluateFixtureAnswerContract(facts: RagSemanticFacts, fixture: RagConformanceFixture) {
  const answerContract = facts.pipelines
    .flatMap((pipeline) => pipeline.answerContracts)
    .find((contract) => contract.name === fixture.answerContractName);
  if (!answerContract) throw new Error(`missing answer contract ${fixture.answerContractName}`);
  const retrieval = withRagRuntimeProvenance(fixture.retrieval, {
    retrieverName: 'DocsSearch',
    targetKind: 'rag',
    targetName: answerContract.ragName,
    citationsRequired: answerContract.requireCitations,
    startedAtMs: 100,
    durationMs: 5,
  });
  return evaluateRagSemanticAnswerContract(answerContract, retrieval);
}

function evaluateFixtureEval(facts: RagSemanticFacts, fixture: RagConformanceFixture) {
  const evaluation = facts.pipelines
    .flatMap((pipeline) => pipeline.evals)
    .find((contract) => contract.name === fixture.evalContractName);
  if (!evaluation) throw new Error(`missing eval ${fixture.evalContractName} in ${fixture.file}`);
  return evaluateRagEvalContract(evaluation, () => fixture.retrieval, { now: fixedNow() });
}

function fixedNow(): () => number {
  let now = 1000;
  return () => {
    now += 5;
    return now;
  };
}

function normalizedRagFacts(facts: RagSemanticFacts) {
  return {
    corpora: facts.corpora.map((corpus) => ({
      name: corpus.name,
      sources: corpus.sources.map((source) => source.name),
      chunking: corpus.chunking.length,
    })),
    retrievers: facts.retrievers.map((retriever) => ({
      name: retriever.name,
      corpusName: retriever.corpusName,
      topK: retriever.topK,
      minScore: retriever.minScore,
    })),
    pipelines: facts.pipelines.map((pipeline) => ({
      name: pipeline.name,
      retrieverName: pipeline.retrieverName,
      citations: pipeline.citations,
      groundingCount: pipeline.groundings.length,
      evals: pipeline.evals.map((evaluation) => ({
        name: evaluation.name,
        caseCount: evaluation.caseCount,
        assertCount: evaluation.assertCount,
      })),
      answerContracts: pipeline.answerContracts.map((contract) => ({
        name: contract.name,
        ragName: contract.ragName,
        query: contract.query,
        answer: contract.answer,
        requireCitations: contract.requireCitations,
        minGroundingCoverage: contract.minGroundingCoverage,
        spans: contract.spans.map((span) => ({
          start: span.start,
          end: span.end,
          chunkIds: [...span.chunkIds],
          required: span.required,
        })),
      })),
    })),
  };
}

function normalizedAnswerResult(result: ReturnType<typeof evaluateFixtureAnswerContract>) {
  return {
    id: result.id,
    ragName: result.ragName,
    query: result.query,
    passed: result.passed,
    status: result.status,
    groundingCoverage: result.groundingCoverage,
    groundedChars: result.groundedChars,
    answerChars: result.answerChars,
    citedChunkIds: [...result.citedChunkIds],
    sources: [...result.sources],
    diagnostics: result.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      spanIndex: diagnostic.spanIndex,
      chunkId: diagnostic.chunkId,
    })),
  };
}

function normalizedEvalResult(result: ReturnType<typeof evaluateFixtureEval>) {
  return {
    passed: result.passed,
    ragName: result.ragName,
    evalName: result.evalName,
    caseCount: result.caseCount,
    passedCaseCount: result.passedCaseCount,
    assertionCount: result.assertionCount,
    passedAssertionCount: result.passedAssertionCount,
    cases: result.cases.map((evaluationCase) => ({
      name: evaluationCase.name,
      query: evaluationCase.query,
      passed: evaluationCase.passed,
      retrieveOptions: evaluationCase.retrieveOptions,
      chunks: evaluationCase.chunks.map((chunk) => ({ id: chunk.id, source: chunk.source })),
      assertions: evaluationCase.assertions.map((assertion) => ({
        kind: assertion.kind,
        passed: assertion.passed,
        code: assertion.code,
      })),
    })),
  };
}
