# KERN MCP Security Benchmark

Static analysis benchmark for MCP (Model Context Protocol) server implementations.

## Methodology

### What we test

KERN review scans MCP server **source code** for 8 vulnerability classes mapped to the [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/):

| Rule ID | Vulnerability | OWASP MCP | CWE |
|---|---|---|---|
| MCP01 | Command injection in tool handlers | MCP04 | CWE-77 |
| MCP02 | Path traversal in filesystem tools | MCP03 | CWE-22 |
| MCP03 | Tool description poisoning (hidden instructions) | MCP02 | CWE-1427 |
| MCP04 | Hardcoded secrets in server code | MCP01 | CWE-798 |
| MCP05 | Unsanitized tool responses (indirect injection) | MCP05 | CWE-1427 |
| MCP06 | Missing input validation on tool parameters | MCP04 | CWE-20 |
| MCP07 | Missing authentication on remote servers | MCP04 | CWE-306 |
| MCP08 | Namespace typosquatting | MCP06 | — |

### Test corpus

1. **Internal benchmark** (`packages/review-mcp/tests/fixtures/`)
   - `vulnerable-ts-server.ts` — 7 vulnerable patterns (TypeScript)
   - `vulnerable-py-server.py` — 7 vulnerable patterns (Python)
   - `safe-ts-server.ts` — 6 safe patterns (false positive check)
   - `safe-py-server.py` — 5 safe patterns (false positive check)

2. **External benchmark** — [appsecco/vulnerable-mcp-servers-lab](https://github.com/appsecco/vulnerable-mcp-servers-lab)
   - 9 intentionally vulnerable MCP server implementations
   - Covers: path traversal, code execution, indirect prompt injection, typosquatting, secrets exposure

### How to reproduce

```bash
# Run internal benchmark
kern review packages/review-mcp/tests/fixtures/vulnerable-ts-server.ts --mcp
kern review packages/review-mcp/tests/fixtures/vulnerable-py-server.py --mcp
kern review packages/review-mcp/tests/fixtures/safe-ts-server.ts --mcp

# Run unit tests
cd packages/review-mcp && pnpm test

# Run against external benchmark (clone first)
git clone https://github.com/appsecco/vulnerable-mcp-servers-lab /tmp/vuln-mcp
kern review /tmp/vuln-mcp --mcp --recursive
```

### How this differs from existing tools

| Capability | kern review --mcp | mcp-scan | Proximity |
|---|---|---|---|
| **Analysis type** | Static (source code) | Dynamic (running server) | Dynamic (running server) |
| **Languages** | TypeScript + Python | Any (protocol-level) | Any (protocol-level) |
| **Prompt injection** | Yes (code patterns) | Yes (tool descriptions) | Yes (tool descriptions) |
| **Command injection** | Yes (taint tracking) | No | No |
| **Path traversal** | Yes (AST analysis) | No | No |
| **Secrets detection** | Yes (pattern matching) | No | No |
| **Auth checks** | Yes (middleware analysis) | No | No |
| **Requires running server** | No | Yes | Yes |

KERN analyzes the **code that makes the server dangerous**. Dynamic tools analyze server behavior after deployment. These approaches are complementary.

### Results

Results are truthful and reproducible. Run the commands above to verify independently.

## References

- [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/)
- [OWASP LLM Top 10 (LLM01: Prompt Injection)](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [CWE-1427: Improper Neutralization of Input During LLM Interaction](https://cwe.mitre.org/data/definitions/1427.html)
- [AgentSeal: 66% of 1,808 MCP Servers Had Security Findings](https://agentseal.org/blog/mcp-server-security-findings)
- [appsecco/vulnerable-mcp-servers-lab](https://github.com/appsecco/vulnerable-mcp-servers-lab)
