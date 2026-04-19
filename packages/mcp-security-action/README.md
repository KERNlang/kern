# KERN MCP Security — GitHub Action

Scan MCP (Model Context Protocol) servers for vulnerabilities.
**12 rules mapped to OWASP MCP Top 10.** SARIF upload, PR comments, tool pinning verification.

Powered by [`@kernlang/review-mcp`](https://www.npmjs.com/package/@kernlang/review-mcp).
Full docs: [kernlang.dev/review](https://kernlang.dev/review)

## Quick start

```yaml
name: MCP Security
on:
  push:
    branches: [main]
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
      - uses: KERNlang/mcp-security-action@v1
        with:
          path: ./src
          threshold: 70
```

## Inputs

| Input           | Default                      | Description                                          |
|-----------------|------------------------------|------------------------------------------------------|
| `path`          | `.`                          | Path to scan                                         |
| `format`        | `sarif`                      | Output format: `json`, `sarif`, `text`               |
| `output`        | `kern-mcp-security.sarif`    | Output file path                                     |
| `threshold`     | `60`                         | Minimum score (0–100). `0` disables the gate         |
| `verify-lock`   | `true`                       | Verify `.kern-mcp-lock.json` for tool pinning drift  |
| `upload-sarif`  | `true`                       | Upload SARIF to GitHub Code Scanning                 |
| `pr-comment`    | `true`                       | Post summary comment on PRs                          |
| `version`       | `latest`                     | Version of `@kernlang/review-mcp`                    |
| `node-version`  | `20`                         | Node.js version                                      |
| `github-token`  | `${{ github.token }}`        | Token for PR comments and SARIF upload               |

## Outputs

| Output       | Description                  |
|--------------|------------------------------|
| `grade`      | Security grade (A–F)         |
| `score`      | Security score (0–100)       |
| `findings`   | Total number of findings     |
| `sarif-file` | Path to generated SARIF file |

## License

Dual-licensed: **AGPL-3.0 + Commercial**.
For commercial use, contact: hello@kernlang.dev
