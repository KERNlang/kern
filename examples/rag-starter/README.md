# RAG Starter

This directory is the canonical small RAG fixture for KERN. All variants use the
same local markdown corpus in `corpus/` and only change the embedding provider or
vector store.

## Variants

- `local-only.kern`: deterministic local embeddings with an in-memory vector store.
- `local-persistent.kern`: deterministic local embeddings with reusable snapshots in `index/`.
- `openai.kern`: OpenAI embeddings with an in-memory vector store. Requires `OPENAI_API_KEY` or `KERN_OPENAI_API_KEY`.
- `eval-ci.kern`: local-persistent indexing plus a contract eval suitable for CI.

## Commands

Run these commands from the repository root.

Run a local retrieval:

```sh
kern rag retrieve examples/rag-starter/local-only.kern --param "question=refund policy receipt" --json
```

Build or reuse a persistent snapshot:

```sh
kern rag index examples/rag-starter/local-persistent.kern --json
kern rag index examples/rag-starter/local-persistent.kern --status --json
```

Run the CI-safe eval fixture:

```sh
kern rag eval examples/rag-starter/eval-ci.kern --json
```

Run the OpenAI variant when credentials are available:

```sh
OPENAI_API_KEY=sk-... kern rag retrieve examples/rag-starter/openai.kern --param "question=refund policy" --json
```

Local-persistent snapshots are written beside the `.kern` file under `index/`.
They can be deleted when you want a clean rebuild; the next `kern rag index` or
`kern rag retrieve` run recreates them.
