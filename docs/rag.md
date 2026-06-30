# KERN RAG

KERN RAG is a runner/tooling feature for local development, CI checks, and
retrieval contract validation. RAG declarations are consumed by `kern rag ...`
commands; emitted Express, FastAPI, Go, and native targets do not generate
target-native retrieval adapters yet.

Use `examples/rag-starter/` as the smallest maintained fixture. It includes
local-only, OpenAI, local-persistent, and CI eval variants over the same markdown
corpus.

## Corpus

A `corpus` groups source documents for indexing and evaluation.

```kern
corpus name=Docs title="Support docs"
  source name=support kind=local uri="./corpus/**/*.md" media=markdown
```

Local source globs are resolved relative to the `.kern` file. Empty globs fail
closed so CI does not accidentally evaluate an empty corpus.

## Source

`source` currently supports local files for the built-in runner path. Keep
source names stable because chunking declarations can refer to them.

```kern
source name=support kind=local uri="./corpus/**/*.md" media=markdown
```

## Chunk

`chunking` controls how source files become retrieval chunks. `ragIndex` can
pin a named chunker so indexing and retrieval use the same chunking contract.

```kern
corpus name=Docs title="Support docs"
  source name=support kind=local uri="./corpus/**/*.md" media=markdown
  chunking name=DocsChunks source=support strategy=semantic maxTokens=80 overlap=0 unit=tokens

ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding chunking=DocsChunks
```

## Embed

`embed` selects the embedding model and vector dimensions.

```kern
embed name=DocsEmbedding corpus=Docs model=local-semantic-v1 dims=64 metric=cosine
```

The deterministic local model is CI-safe. Provider-backed models, such as
`openai:text-embedding-3-small`, require `OPENAI_API_KEY`,
`KERN_OPENAI_API_KEY`, or `--openai-api-key`.

## Index

`vectorStore` and `ragIndex` define where vectors are stored and how the corpus
is indexed.

```kern
vectorStore name=DocsMemory kind=local-persistent dims=64 metric=cosine path="./index"
ragIndex name=DocsIndex corpus=Docs store=DocsMemory embed=DocsEmbedding chunking=DocsChunks
```

Use memory stores for short local runs and local-persistent stores when you want
snapshot reuse across commands.

```sh
kern rag index examples/rag-starter/eval-ci.kern --json
kern rag index examples/rag-starter/eval-ci.kern --status --json
kern rag index examples/rag-starter/eval-ci.kern --force-rebuild --json
```

The JSON report includes index status, action, chunk count, snapshot path,
manifest path, and provenance.

KERN programs can also request local-persistent indexing through the async
runtime preview:

```kern
fn name=main returns=void
  handler lang="kern"
    capability namespace=rag operation=ingest name=report
    print value="report.action"
```

```sh
kern run --async-preview path/to/app.kern
```

The `rag.ingest` capability returns KERN-friendly summary fields such as
`count`, `action`, and `chunkCount`, plus a portable `indexes` report for hosts.
Each index includes `status`, `action`, `chunkCount`, `snapshotPath`, and
`manifestPath`. Use `input="{ statusOnly: true }"` to inspect without
rebuilding, or `input="{ forceRebuild: true }"` to force a rebuild.

## Retrieve

`ragRetrieve` runs retrieval from a declared index. It can use a CLI query
parameter or a fixed literal query.

```kern
rag name=AnswerDocs retriever=DocsSearch citations=true
  ragRetrieve name=FindDocs index=DocsIndex queryParam=question topK=2 output="RetrievedChunk[]"
```

```sh
kern rag retrieve examples/rag-starter/local-only.kern --param "question=refund policy receipt" --json
```

The JSON report is suitable for automation and includes diagnostics,
`ingestion`, `indexes`, and `retrievals`.

## Eval

`ragEval` validates declared retrieval behavior with contract assertions.

```kern
ragEval name=Faithfulness metric=faithfulness threshold=0.85 mode=contract
  ragCase name=refunds query="refund policy receipt money back" topK=2 minScore=0.1 sources="corpus/refunds.md"
    ragAssert kind=sourceGlob value="*refunds.md" required=true
    ragAssert kind=citesRequired
```

Use the CI-safe fixture directly:

```sh
kern rag eval examples/rag-starter/eval-ci.kern --json
```

The JSON report includes pass/fail state, metrics, target provenance, index
lifecycle state, and assertion-level failures.

## Adapters

KERN includes memory and local-persistent reference stores. External store
authors should implement the vector store adapter contract and run the
conformance profile documented in
[`docs/rag-vector-store-adapters.md`](rag-vector-store-adapters.md).
