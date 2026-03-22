# @kernlang/review-mcp

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
