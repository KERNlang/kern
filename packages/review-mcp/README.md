# @kernlang/review-mcp

[![npm](https://img.shields.io/npm/v/@kernlang/review-mcp?color=cb3837&label=npm)](https://www.npmjs.com/package/@kernlang/review-mcp)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/KERNlang/kern/blob/main/LICENSE)

MCP server security scanner -- static analysis for Model Context Protocol implementations

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install @kernlang/review-mcp
```

## Usage

```ts
import { reviewMCPSource, detectMCPServer } from '@kernlang/review-mcp';

if (detectMCPServer(source, 'server.ts')) {
  const findings = reviewMCPSource(source, 'server.ts');
}
```

## License

AGPL-3.0
