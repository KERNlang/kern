# KERN 5 Preview App

This is the first maintained vertical app for the KERN native runner preview.
It is intentionally positioned as a **KERN 5 preview app**, not the final KERN
5.0 runtime contract.

The demo proves that KERN can author the main app behavior while TypeScript
stays at the host boundary:

- `ui.kern` emits the browser UI markup.
- `answer-route.kern` authors the backend route behavior, RAG query path, and
  grounding guard.
- `server.mjs` is the thin host adapter for HTTP, request storage, local RAG
  adapter wiring, and deterministic LLM wiring.

## Run

Start the local demo with one command:

```sh
pnpm demo:kern-5-preview
```

Then open the printed local URL and submit a question such as:

```text
refund policy receipt
```

Run the repeatable smoke gate with:

```sh
pnpm test:app-demo
```

The broader runner gate also includes this app:

```sh
pnpm test:runner-smoke
```

## Flow

```text
ui.kern
  -> native runner emits browser HTML
  -> browser fetches /api/answer?question=...
  -> server.mjs stores request input through storage capability
  -> answer-route.kern runs through executeKernSourceAsync
  -> rag.retrieveAsync finds local corpus chunks
  -> rag.promptContext builds prompt context
  -> llm.complete host adapter returns deterministic preview text
  -> rag.checkAnswer enforces citation and grounding policy
  -> server.mjs returns structured JSON
```

## Boundary

| Area | Demo status |
| --- | --- |
| KERN-authored | Browser markup in `ui.kern`; backend route flow in `answer-route.kern`; RAG declaration, retrieval selection, answer check, and printed route result sections. |
| Runtime capability | `storage.get`, `rag.retrieveAsync`, `rag.promptContext`, `llm.complete`, and `rag.checkAnswer` are explicit named operations. Missing or failed capabilities fail closed. |
| Thin host adapter | `server.mjs` owns HTTP, filesystem reads for `.kern` sources, request parameter storage injection, local corpus/vector adapter wiring, deterministic LLM preview output, and JSON shaping. |
| Preview / not supported yet | This is not the canonical KERN 5 runtime ABI. The browser script is still host bootstrap JavaScript, the LLM is deterministic unless a host swaps in a provider, broad async KERN semantics remain preview-only, and linked multi-file KERN app packages are not designed yet. |

## API Shape

Happy path:

```sh
curl "http://127.0.0.1:<port>/api/answer?question=refund%20policy%20receipt"
```

```json
{
  "answer": "Refunds are available within thirty days when the customer includes the receipt [1].\nSupport should cite the refund policy before promising money back [1].",
  "status": "grounded",
  "grounded": true,
  "citations": [{ "label": "[1]", "source": "corpus/refunds.md", "chunkIndex": 0 }],
  "chunkCount": 1,
  "source": "corpus/refunds.md",
  "sources": ["corpus/refunds.md"],
  "diagnostics": {
    "status": "grounded",
    "grounded": true,
    "chunkCount": 1,
    "sources": ["corpus/refunds.md"]
  }
}
```

Fail-closed examples:

```sh
curl "http://127.0.0.1:<port>/api/answer?question=shipping%20tracking%20delivery"
curl "http://127.0.0.1:<port>/api/answer?question=refund%20policy%20receipt&failure=ungrounded"
curl "http://127.0.0.1:<port>/api/answer?question=refund%20policy%20receipt&failure=missing-llm"
```

These return safe JSON errors instead of partial answers:

```json
{ "error": "no grounded answer for this question", "diagnostics": { "grounded": false } }
```

```json
{
  "error": "required host capability is unavailable",
  "diagnostics": { "capability": "llm.complete", "grounded": false }
}
```

Unsupported async execution shapes are fail-closed in the runner before app code
can leak partial output. The focused contract example lives in
`packages/cli/tests/run.test.ts` under "async preview execution fails closed for
unsupported async helper expression slots"; the broader `pnpm test:runner-smoke`
gate keeps that preview boundary separate from this app's happy path.

## What This Proves

KERN-authored app behavior can drive a browser UI, an HTTP answer route, local
RAG retrieval, deterministic answer synthesis, and grounding guards through the
native runner preview. Host code cannot be reached implicitly; every host effect
crosses a named capability supplied by the adapter.

## Still Preview

The native runner and async capability path are still preview surfaces. Keep this
demo polished and repeatable, but do not treat it as the final runtime ABI or a
replacement for the existing production TypeScript/Python transpiler paths.
