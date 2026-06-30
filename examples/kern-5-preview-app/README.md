# KERN 5 Preview App

This is the first vertical "native runner preview" app demo:

- `ui.kern` emits the browser UI markup.
- `answer-route.kern` authors the backend route behavior, RAG query path, and grounding guard.
- `server.mjs` is the thin host adapter: HTTP serving, request input storage, local RAG adapters, and deterministic LLM adapter.

Run it after building core:

```sh
pnpm --filter @kernlang/core build
node examples/kern-5-preview-app/server.mjs
```

Then open the printed local URL and submit a question such as:

```text
refund policy receipt
```

The smoke gate is:

```sh
node scripts/check-kern-5-preview-app.mjs
```
