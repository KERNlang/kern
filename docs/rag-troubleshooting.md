# RAG Troubleshooting

This page covers common failures for `kern rag index`, `kern rag retrieve`, and
`kern rag eval`.

## Empty Source Globs

If a local source glob matches no files, the command fails and prints the
pattern. Confirm that the glob is correct relative to the `.kern` file, not the
shell's current directory.

```kern
source name=support kind=local uri="./corpus/**/*.md" media=markdown
```

## Missing Query Input

A `ragRetrieve` with `queryParam=question` needs a CLI parameter:

```sh
kern rag retrieve examples/rag-starter/local-only.kern --param "question=refund policy"
```

Malformed parameters fail closed. Use `name=value`; empty names and empty values
are rejected.

## OpenAI Credentials

Specs that use an OpenAI embedding model require provider options:

```sh
OPENAI_API_KEY=sk-... kern rag retrieve examples/rag-starter/openai.kern --param "question=refund policy"
```

The CLI also accepts `KERN_OPENAI_API_KEY` or `--openai-api-key`. The local
fixtures use `local-semantic-v1` and do not require network access.

## Local-Persistent Paths

For `kind=local-persistent`, the `path` is resolved relative to the `.kern`
file. `kern rag index` writes both `examples/rag-starter/index/DocsIndex.json`
and `examples/rag-starter/index/DocsIndex.manifest.json` for this example:

```kern
vectorStore name=DocsMemory kind=local-persistent dims=64 metric=cosine path="./index"
```

## Stale, Missing, Corrupt, Or Incompatible Snapshots

Check snapshot state without rebuilding:

```sh
kern rag index examples/rag-starter/eval-ci.kern --status --json
```

Common states:

- `missing`: no snapshot exists.
- `stale`: corpus, chunker, embedder, vector store, or provenance changed.
- `corrupt`: the snapshot cannot be read.
- `incompatible`: dimensions, metric, store kind, or fingerprint no longer match.
- `fresh`: the snapshot and manifest match the current provenance. The action
  field reports whether it was `reused` or only `inspected`.

Rebuild explicitly when needed:

```sh
kern rag index examples/rag-starter/eval-ci.kern --force-rebuild --json
```

## Snapshot Cleanup

Delete local-persistent snapshot files when you want to discard all cached
retrieval state:

```sh
rm -f examples/rag-starter/index/DocsIndex.json
rm -f examples/rag-starter/index/DocsIndex.manifest.json
```

The next `kern rag index` run recreates both files. `kern rag retrieve` and
`kern rag eval` can recreate the snapshot JSON for runtime reuse, but they do
not write the index manifest. Do not commit generated `index/*.json` or
`index/*.manifest.json` files unless you intentionally want to version a fixture
snapshot.

## CI Output

Use JSON mode for automation:

```sh
kern rag index examples/rag-starter/eval-ci.kern --status --json
kern rag retrieve examples/rag-starter/local-only.kern --param "question=refund policy" --json
kern rag eval examples/rag-starter/eval-ci.kern --json
```

All three commands exit non-zero for invalid specs. `rag eval` also exits
non-zero when contract assertions fail.
