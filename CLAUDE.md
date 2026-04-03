# KERN Monorepo Rules

## Before Every Push

- **ALWAYS run `tsc -b && pnpm test && node packages/cli/dist/cli.js review packages/ --recursive --llm` before `git push`.** No exceptions. If any step fails, fix it before pushing. Never skip this.

## KERN Review (how AI assistants MUST use it)

When the user says "review", "kern review", or before push — you MUST do a **full semantic review**, not just run the command and show output. This is the workflow:

1. Run `node packages/cli/dist/cli.js review <path> --recursive --llm` — this outputs static findings, taint analysis, and KERN IR (compiled semantic representation)
2. **READ the output carefully** — it contains `<kern-findings>`, `<kern-taint>`, and `<kern-ir>` sections, followed by a structured review prompt
3. **FOLLOW THE 3-STEP REVIEW** from the output:
   - **STEP 1:** Validate `<kern-findings>` — real bug or false positive?
   - **STEP 2:** Analyze `<kern-taint>` — are taint paths exploitable? Are sanitizers sufficient?
   - **STEP 3:** Review `<kern-ir>` for what static analysis MISSED — reference node aliases (N1, N2, etc.)
4. **Write a structured review** with your findings — severity, node alias or line number, explanation, suggested fix
5. Focus on: correctness, error handling, data flow, security, concurrency, API contracts, resource management — NOT style or formatting

**IMPORTANT:** Do NOT just dump the kern review output and stop. That is useless to the user. You are the reviewer — kern review gives you signal, you give the user a proper code review.

For CI/GitHub Actions, set `KERN_LLM_API_KEY` and kern review auto-calls an LLM API. For dev workflow in AI CLI tools, the AI assistant IS the LLM — no API key needed.

## Build

- Build: `tsc -b` from root (NOT `pnpm -r build`). Root tsconfig.json has all project references.
- Playground builds separately: `pnpm --filter @kernlang/playground build`
- Never commit `tsconfig.tsbuildinfo` files — they are gitignored.

## Branching

- `dev` = daily work branch.
- `main` = release branch. Only merge via PR. CI must pass.

## Language

- TypeScript monorepo. Always run typecheck after changes.
- ESM throughout (`"type": "module"`).
- `moduleResolution: "bundler"` — package.json exports must include `types` field.
