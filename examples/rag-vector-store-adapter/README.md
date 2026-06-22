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
