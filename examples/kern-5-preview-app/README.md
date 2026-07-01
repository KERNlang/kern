# KERN 5 Preview App

This is the maintained vertical reference app for the KERN 5 native runner app
surface. The bounded KERN 5.0 contract is defined in
`docs/kern-5-support-matrix.md`; this app is the end-to-end fixture for that
manifest-driven surface, not a promise that every future runtime shape is
supported.

The demo proves that KERN can author the main app behavior while TypeScript
stays at the host boundary:

- `ui.kern` emits the browser UI markup.
- `app.kern` declares the app, browser view, answer route, grounding policy,
  response mode, and required host capabilities.
- `answer-route.kern` authors the backend route behavior, RAG query path, and
  grounding guard.
- `server.mjs` is the thin host adapter for HTTP, request query parameters, local RAG
  adapter wiring, and deterministic LLM wiring; it reads `app.kern` and fails
  closed if the route source uses undeclared capabilities.

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
app.kern
  -> declares / view, GET /api/answer, GroundedAnswerPolicy, and capabilities
ui.kern
  -> native runner emits browser HTML
  -> browser fetches /api/answer?question=...
  -> server.mjs exposes request input through app-http.queryParam
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
| KERN-authored | App manifest in `app.kern`; browser markup in `ui.kern`; backend route flow in `answer-route.kern`; RAG declaration, retrieval selection, answer check, and printed route result sections. |
| Runtime capability | `app.kern` declares `app-http.queryParam`, `rag.retrieveAsync`, `rag.promptContext`, `llm.complete`, and `rag.checkAnswer`; `answer-route.kern` calls those explicit named operations. Missing, undeclared, or failed capabilities fail closed. |
| Thin host adapter | `server.mjs` owns HTTP, filesystem reads for `.kern` sources, request query parameter injection, local corpus/vector adapter wiring, deterministic LLM preview output, and JSON shaping. It must honor the route, view, policy, response, and capability contract declared in `app.kern`. |
| Outside the 5.0 matrix | The browser script is still host bootstrap JavaScript, the LLM is deterministic unless a host swaps in a provider, broad async KERN semantics remain outside the supported matrix, and linked multi-file KERN app packages are minimal manifest wiring rather than a full package system. |

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

KERN-authored app behavior can declare the app surface, drive a browser UI, run
an HTTP answer route, perform local RAG retrieval, synthesize a deterministic
answer, and enforce grounding guards through the native runner preview. Host
code cannot be reached implicitly; every host effect crosses a named capability
declared by the app manifest and supplied by the adapter.

## Matrix Boundary

KERN 5.0 final-complete is scoped to the tested support matrix in
`docs/kern-5-support-matrix.md`. Runtime shapes outside that matrix are either
future work or fail-closed guardrails; they are not part of this app's contract
or a replacement for existing production TypeScript/Python transpiler paths.
