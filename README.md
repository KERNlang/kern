<div align="center">
  <br>
  <img src="assets/banner.svg" alt="KERN — The LLM Programming Language" width="100%">
  <br><br>

  [![npm](https://img.shields.io/npm/v/@kernlang/cli?color=cb3837&label=npm)](https://www.npmjs.com/package/@kernlang/cli)
  [![CI](https://img.shields.io/github/actions/workflow/status/KERNlang/kern/ci.yml?branch=main&label=CI)](https://github.com/KERNlang/kern/actions/workflows/ci.yml)
  [![GitHub release](https://img.shields.io/github/v/release/KERNlang/kern?label=release)](https://github.com/KERNlang/kern/releases)
  [![license](https://img.shields.io/github/license/KERNlang/kern)](LICENSE)

  <br>

  **Built for humans and AI.** 192-line spec. 11 compile targets. 76 review rules.<br>
  <sub>LLMs write .kern in 85% fewer tokens. 7 LLMs verified.</sub>

  <br>

  [**kernlang.dev**](https://kernlang.dev) &nbsp;&bull;&nbsp; [Playground](https://kernlang.dev/playground) &nbsp;&bull;&nbsp; [Review Rules](https://kernlang.dev/review) &nbsp;&bull;&nbsp; [Docs](https://kernlang.dev/docs) &nbsp;&bull;&nbsp; [For LLMs](https://kernlang.dev/llm)

  <br>
</div>

---

## Install

```bash
npm install -g @kernlang/cli
```

```bash
kern review src/ --recursive                      # Static analysis (76 rules, taint tracking, OWASP LLM01)
kern compile src/ --target=nextjs                  # .kern → Next.js
kern compile src/ --target=fastapi                 # .kern → FastAPI Python
kern evolve src/ --recursive                       # Detect gaps → propose templates
kern dev src/ --target=nextjs                      # Watch & hot-transpile
```

---

## What is KERN?

**KERN is a structural language with five capabilities: Compile, Review, Evolve, Infer, and MCP Security.**

Write `.kern` once, compile to 11 targets. Or skip `.kern` entirely and use `kern review` to scan your existing TypeScript and Python for security bugs, unguarded effects, and prompt injection — 76 AST-based rules that catch what ESLint misses.

```
Same .kern → Next.js, React, Vue, Nuxt, Express, FastAPI, Native, CLI, Terminal, Ink, Tailwind
```

For detailed examples, interactive demos, and the full rule reference, visit **[kernlang.dev](https://kernlang.dev)**.

---

## Quick Example

**7 lines of .kern:**

```kern
machine name=Order initial=pending
  transition from=pending to=confirmed event=confirm
  transition from=confirmed to=shipped event=ship
  transition from=shipped to=delivered event=deliver
```

**Compiles to 140+ lines** of typed TypeScript — enums, transition functions, exhaustive checks, error classes.

---

## kern review

Static analysis with taint tracking, concept-level checks, and OWASP LLM01 coverage. No AI needed.

```bash
kern review src/ --recursive            # Full scan
kern review src/ --enforce --min-coverage=80  # CI gate
kern review --diff origin/main          # Only changed files
kern review src/ --lint                 # KERN + ESLint + tsc unified
kern review src/ --llm                  # Export IR for AI review
```

**76 rules** across 10 layers: Base, React, Next.js, Vue, Express, Security (v1-v4), Dead Logic, Null Safety, Concept Rules, Taint Tracking.

Full rule reference: **[kernlang.dev/review](https://kernlang.dev/review)**

### MCP Server Security

Scan MCP servers for vulnerabilities. 13 rules mapped to the [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/).

```bash
npx kern-mcp-security ./src/server.ts
```

Available as: **[VS Code Extension](https://github.com/KERNlang/kern-sight-mcp)** | **CLI** (`npx kern-mcp-security`) | **GitHub Action** (see CI/CD below)

---

## CI/CD

### KERN Review — GitHub Action

Drop this into `.github/workflows/kern-review.yml` to run `kern review` on every push and PR:

```yaml
name: KERN Review

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v5
        with:
          version: 9

      - uses: actions/setup-node@v6
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      - name: KERN Review
        run: npx @kernlang/cli review src/ --recursive

      # Optional: enforce minimum coverage
      # - name: KERN Review (enforced)
      #   run: npx @kernlang/cli review src/ --recursive --enforce --min-coverage=80
```

### MCP Security — GitHub Action

Drop this into `.github/workflows/mcp-security.yml` for MCP server scanning with SARIF upload and PR comments:

```yaml
name: MCP Security

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main]

permissions:
  contents: read
  security-events: write
  pull-requests: write

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install KERN MCP Security
        run: npm install -g @kernlang/review-mcp@latest

      - name: Scan MCP server code
        id: scan
        run: |
          kern-mcp-security --format json --output kern-mcp-security.json . || true
          kern-mcp-security --format sarif --output kern-mcp-security.sarif . || true

          RESULT=$(kern-mcp-security --quiet . 2>&1) || true
          GRADE=$(echo "$RESULT" | head -1 | awk '{print $1}')
          SCORE=$(echo "$RESULT" | head -1 | awk '{print $2}')

          echo "grade=$GRADE" >> $GITHUB_OUTPUT
          echo "score=$SCORE" >> $GITHUB_OUTPUT
          echo "MCP Security Score: $GRADE ($SCORE/100)"

      - name: Verify tool pinning lockfile
        run: |
          if [ -f .kern-mcp-lock.json ]; then
            kern-mcp-security --verify . || echo "::warning::Tool pinning drift detected"
          else
            echo "No .kern-mcp-lock.json found — run 'npx kern-mcp-security --lock .' to generate one"
          fi

      - name: Upload SARIF to Code Scanning
        if: always() && hashFiles('kern-mcp-security.sarif') != ''
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: kern-mcp-security.sarif
          category: kern-mcp-security
        continue-on-error: true

      - name: Post PR comment
        if: github.event_name == 'pull_request' && always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            let report;
            try {
              report = JSON.parse(fs.readFileSync('kern-mcp-security.json', 'utf-8'));
            } catch { return; }

            const { grade, total } = report.score;
            const color = { A: '22c55e', B: '84cc16', C: 'f97316', D: 'f59e0b', F: 'ef4444' }[grade];
            const badge = `![Score](https://img.shields.io/badge/MCP_Security-${grade}_(${total}%25)-${color})`;

            let body = `## KERN MCP Security Report\n\n${badge}\n\n`;
            body += `| Metric | Score |\n|--------|-------|\n`;
            body += `| Guard Coverage | ${report.score.guardCoverage}% |\n`;
            body += `| Input Validation | ${report.score.inputValidation}% |\n`;
            body += `| Rule Compliance | ${report.score.ruleCompliance}% |\n`;
            body += `| Auth Posture | ${report.score.authPosture}% |\n\n`;
            body += `**${report.findingsCount} finding(s)**\n\n`;
            body += `> Scanned by [KERN MCP Security](https://kernlang.dev/review)`;

            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner, repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find(c => c.body?.includes('KERN MCP Security Report'));

            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner, repo: context.repo.repo,
                comment_id: existing.id, body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner, repo: context.repo.repo,
                issue_number: context.issue.number, body,
              });
            }

      - name: Enforce score threshold
        if: always()
        run: |
          SCORE="${{ steps.scan.outputs.score }}"
          THRESHOLD=60
          if [ -n "$SCORE" ] && [ "$SCORE" -lt "$THRESHOLD" ] 2>/dev/null; then
            echo "::error::MCP Security score $SCORE is below threshold $THRESHOLD"
            exit 1
          fi
```

---

## Ecosystem

| Package | What it does |
|:--------|:-------------|
| **[@kernlang/cli](https://www.npmjs.com/package/@kernlang/cli)** | CLI — compile, review, evolve, dev |
| **[@kernlang/core](https://www.npmjs.com/package/@kernlang/core)** | Parser, codegen, types — the compiler engine |
| **[@kernlang/review](https://www.npmjs.com/package/@kernlang/review)** | 76 rules, taint tracking, OWASP LLM01, concept model |
| **[@kernlang/review-mcp](https://www.npmjs.com/package/@kernlang/review-mcp)** | MCP security scanner (13 rules, OWASP MCP Top 10) |
| @kernlang/react | Next.js, Tailwind, Web transpilers |
| @kernlang/vue | Vue 3 SFC, Nuxt 3 transpilers |
| @kernlang/native | React Native transpiler |
| @kernlang/express | Express backend + WebSocket transpiler |
| @kernlang/fastapi | FastAPI Python + WebSocket transpiler |
| @kernlang/terminal | ANSI terminal + Ink transpilers |
| @kernlang/evolve | Self-extending template system |
| @kernlang/review-python | Python review support (FastAPI, Django) |
| @kernlang/playground | [Interactive compiler UI](https://kernlang.dev/playground) |
| @kernlang/metrics | Language coverage analysis |
| @kernlang/protocol | AI draft communication protocol |

### VS Code Extensions

- **[Kern Sight MCP](https://github.com/KERNlang/kern-sight-mcp)** — MCP security scanner with inline findings, Security Score, autofixes
- **Kern Sight** *(coming soon)* — Review findings as inline diagnostics + webview code review panel

---

## License

**AGPL-3.0** — Swiss-engineered with precision.

Copyright (c) 2026 cukas

---

<div align="center">
  <a href="https://kernlang.dev"><strong>kernlang.dev</strong></a>
</div>
