# @kernlang/protocol

[![npm](https://img.shields.io/npm/v/@kernlang/protocol?color=cb3837&label=npm)](https://www.npmjs.com/package/@kernlang/protocol)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/KERNlang/kern/blob/main/LICENSE)

Kern draft protocol — structured AI communication format

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install @kernlang/protocol
```

## Usage

```ts
import { buildKernDraftPrompt, parseKernDraft, buildKernRankPrompt } from '@kernlang/protocol';

const prompt = buildKernDraftPrompt(spec);
const draft = parseKernDraft(llmResponse);
const rankPrompt = buildKernRankPrompt(drafts);
```

## License

AGPL-3.0
