# RAG Vector Store Adapter Example

This example shows how an external vector store can plug into KERN's RAG adapter
contract without KERN owning the database implementation.

Run it from the repository root after building core:

```sh
pnpm --filter @kernlang/core build
node examples/rag-vector-store-adapter/adapter.mjs
```

The adapter exports:

- `exampleRagVectorStoreContract`: a `defineRagVectorStoreAdapterContract(...)`
  result with a manifest and factory.
- `runExampleConformance()`: a small helper that runs
  `runRagVectorStoreConformance(...)` against the contract.

Real provider adapters should keep the same shape and move the storage logic
behind `upsert`, `upsertMany`, `search`, `snapshot`, `clear`, and `close`.
KERN owns the contract and conformance profile; the adapter owns networking,
credentials, indexing, and database-specific tuning.

## Registering the adapter with the runtime ragRetrieve runner (KERN 5.2)

A conformant contract can be registered as a first-class `vectorStore kind=`
for the in-process runtime retrieval path. Registration RUNS the conformance
suite and fails closed unless every case passes; unregistered or
non-conformant kinds are rejected at semantic validation and retrieval
preparation:

```js
import { registerExternalRagVectorStoreAdapter, retrieveRagDocument } from '@kernlang/core';
import { exampleRagVectorStoreContract } from './adapter.mjs';

registerExternalRagVectorStoreAdapter({
  kind: 'example-external-memory',
  contract: exampleRagVectorStoreContract,
});
// .kern sources may now declare: vectorStore name=Docs kind=example-external-memory dims=64 metric=cosine
const report = retrieveRagDocument(source, { sourcePath, query: 'refund policy' });
```

## Grounded Answer Contract

Provider/app code should still generate the answer outside KERN. KERN validates
the answer against the retrieval result and fails closed when grounding is too
weak:

```js
import { evaluateRagAnswerContract } from '@kernlang/core';

const retrieval = {
  query: 'refund policy',
  chunks: [
    {
      id: 'refunds',
      text: 'Refunds are allowed for thirty days.',
      score: 0.95,
      source: 'docs/refunds.md',
      citation: { uri: 'docs/refunds.md', locator: 'L1-L2' },
    },
  ],
};

const answer = 'Refunds are allowed for thirty days.';
const result = evaluateRagAnswerContract({
  query: retrieval.query,
  answer,
  retrieval,
  requireCitations: true,
  minCitedChunks: 1,
  minGroundingCoverage: 1,
  evidencePolicy: { minRetrievedChunks: 1, minTopScore: 0.8 },
  groundingSpans: [{ start: 0, end: answer.length, chunkIds: ['refunds'], required: true }],
});

const rejected = evaluateRagAnswerContract({
  query: retrieval.query,
  answer,
  retrieval,
  requireCitations: true,
  minGroundingCoverage: 1,
  groundingSpans: [{ start: 0, end: answer.length, chunkIds: ['made-up'] }],
});

const abstained = evaluateRagAnswerContract({
  query: retrieval.query,
  answer: 'I do not have enough evidence to answer.',
  retrieval: { query: retrieval.query, chunks: [] },
  abstained: true,
  allowAbstain: true,
  abstainAnswer: 'I do not have enough evidence to answer.',
  evidencePolicy: { minRetrievedChunks: 1 },
});
```

`result.passed` is true. `rejected.passed` is false because the answer cites
chunk `made-up`, which was not returned by retrieval, so the contract reports
unknown-chunk and ungrounded-span diagnostics. `abstained.passed` is true
because the evidence policy was not met and the answer matches the configured
abstention response.
