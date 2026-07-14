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
- `server.mjs` is the thin host adapter for HTTP, typed argument/result
  projection, local RAG adapter wiring, and deterministic LLM wiring; it reads
  `app.kern` and fails closed if the route source uses undeclared capabilities.
- `runtime-handler-config.json` owns the preview's explicit runtime limits and
  timeouts instead of embedding them in host code.

The route's async capabilities (`rag.retrieveAsync`, `llm.complete`) run
through the promoted default async lane — no `--async-preview` flag is
involved anywhere in this app. The host also exercises the KERN 5.2
policy-slot hooks (`executeKernAppEntryPolicySlot`) before and after the
answer route; real guard kinds arrive in 5.3.

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
  -> server.mjs passes the normalized question through kern.runtime.handler.v1
  -> answer-route.kern runs through executeKernRuntimeHandlerAsync
  -> rag.retrieveAsync finds local corpus chunks
  -> rag.promptContext builds prompt context with safeText instruction boundaries
  -> llm.complete host adapter returns deterministic preview text
  -> rag.checkAnswer enforces citation and grounding policy
  -> answer-route.kern returns [answer, status, source] as a typed string[]
  -> server.mjs validates the closed envelope and projects unchanged HTTP JSON
```

## Boundary

| Area | Demo status |
| --- | --- |
| KERN-authored | App manifest in `app.kern`; browser markup in `ui.kern`; backend route flow in `answer-route.kern`; RAG declaration, retrieval selection, safe prompt-context handoff, answer check, and typed answer/status/source result. |
| Runtime capability | `app.kern` declares `rag.retrieveAsync`, `rag.promptContext`, `llm.complete`, and `rag.checkAnswer`; `answer-route.kern` calls those explicit named operations. Missing, undeclared, or failed capabilities fail closed. |
| Thin host adapter | `server.mjs` owns HTTP, filesystem reads for `.kern` sources, normalized typed request input, local corpus/vector adapter wiring, deterministic LLM preview output, strict handler-envelope validation, and positional projection to the existing JSON schema. It must honor the route, view, policy, response, and capability contract declared in `app.kern`. |
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

Unsupported handler shapes and result types fail closed before the HTTP adapter
can expose partial output. `pnpm test:runtime-abi` owns the public typed-handler
contract, while `pnpm test:app-demo` proves this maintained consumer.

## What This Proves

KERN-authored app behavior can declare the app surface, drive a browser UI, run
an HTTP answer route with typed arguments/results, perform local RAG retrieval,
synthesize a deterministic answer, and enforce grounding guards through its own
handler runtime. Host code cannot be reached implicitly; every host effect
crosses a named capability declared by the app manifest and supplied by the
adapter. No application-specific stdout marker or JSON-in-text protocol becomes
the HTTP response.

## Matrix Boundary

KERN 5.0 final-complete is scoped to the tested support matrix in
`docs/kern-5-support-matrix.md`. Runtime shapes outside that matrix are either
future work or fail-closed guardrails; they are not part of this app's contract
or a replacement for existing production TypeScript/Python transpiler paths.
