# @kernlang/protocol

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
