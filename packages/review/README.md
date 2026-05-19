# @kernlang/review

[![npm](https://img.shields.io/npm/v/@kernlang/review?color=cb3837&label=npm)](https://www.npmjs.com/package/@kernlang/review)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/KERNlang/kern/blob/main/LICENSE)

Kern Review -- 220 rules, taint tracking, OWASP LLM01 coverage, and framework-aware review checks

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install @kernlang/review
```

## Usage

```ts
import { reviewFile, reviewSource, reviewDirectory } from '@kernlang/review';

const report = reviewFile('src/handler.ts');
console.log(report.findings);
```

## Coverage

Kern Review ships 220 AST-based rules across base correctness, security, framework, performance, test-quality, null-safety, dead-logic, concept, and taint-aware analysis layers.

Recent framework coverage includes:

- Next.js App Router: JSON body parsing hazards, unvalidated typed request bodies, unsafe forwarded headers, mock routes without environment guards, env/path rewrites and redirects, client-boundary env exposure, wildcard image hosts, sensitive public cache headers, SWR invalidation drift, and auth/session storage drift.
- React and browser apps: legacy unsafe class lifecycles, event listener cleanup identity mismatches, immediate cleanup calls in effects, timer cleanup drift, module-scoped timer handles, stale `.length`/`.size` hook deps, props-array mutation in render, unsafe browser storage JSON parsing, client-side open redirects from query params, and wildcard `postMessage` target origins.
- Storybook: secret-looking args, non-deterministic story data, unmocked network calls, and interaction `play` functions that perform user events without assertions.
- Playwright and tests: focused `.only` tests, fixed `waitForTimeout` sleeps, brittle `networkidle` waits, no-op `expect(x)` assertions, and empty test files.
- Security: cookie hardening for Express and Next cookies, response error leaks, CSP strength, CORS, JWT verification, path traversal, command injection, hardcoded secrets, XSS, prompt injection, and MCP/LLM risk patterns.

## License

AGPL-3.0
