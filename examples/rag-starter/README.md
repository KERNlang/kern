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

Run the same local retrieval through the native runtime capability boundary:

```sh
kern run examples/rag-starter/runtime-run.kern
```

Run a KERN-authored RAG answer example through the native runtime plus the
deterministic LLM provider. `rag.answer`/`llm.complete` are promoted out of
`--async-preview`, so this runs by default without the flag:

```sh
kern run --llm-response "Refunds are available within thirty days [1]" examples/rag-starter/runtime-answer-preview.kern
```

The answer preview retrieves local support chunks, assembles them with
`rag.promptContext`, passes the resulting `context.safeText` to `llm.complete`, and
checks the deterministic cited answer with `rag.checkAnswer` before printing it.

Run the same retrieval with the dedicated answer-synthesis capability:

```sh
kern run --llm-response "Refunds are available within thirty days [1]" examples/rag-starter/runtime-answer-capability-preview.kern
```

The answer-capability preview keeps `rag.retrieve` explicit, then calls
`rag.answer` to assemble prompt context, invoke the configured `llm.complete`
provider, infer inline citation spans, and return a grounded report with
coverage and span evidence. It fails closed unless the grounding contract passes.

Use an OpenAI-compatible chat-completions provider instead of the deterministic
response by supplying a provider, model, and API key:

```sh
KERN_LLM_API_KEY=... kern run --llm-provider openai --llm-model gpt-4.1-mini examples/rag-starter/runtime-answer-preview.kern
```

`KERN_LLM_MODEL` can supply the model when `--llm-model` is omitted, and
`KERN_LLM_BASE_URL` can point at an OpenAI-compatible `/v1` endpoint.

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
