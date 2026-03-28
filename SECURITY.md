# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 3.x     | Yes       |
| < 3.0   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in KERN, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **security@kernlang.dev**

You will receive an acknowledgment within 48 hours and a detailed response within 5 business days.

## What qualifies

- Vulnerabilities in `@kernlang/core`, `@kernlang/review`, `@kernlang/cli`, or any `@kernlang/*` package
- Code injection through `.kern` input that bypasses safe emitters
- Review rule bypasses that miss real vulnerabilities
- MCP security rule evasion

## What does not qualify

- Findings in generated output code (KERN compiles to user-editable TypeScript/Python)
- False positives or false negatives in review rules (report these as regular issues)
- Vulnerabilities in dependencies (report upstream)

## Disclosure

We follow coordinated disclosure. We will work with you to understand the issue, develop a fix, and coordinate public disclosure. Credit will be given unless you prefer to remain anonymous.
