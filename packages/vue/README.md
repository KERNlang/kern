# @kernlang/vue

Kern Vue/Nuxt transpilers — Vue 3 SFC + Nuxt 3 output

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install @kernlang/vue
```

## Usage

```ts
import { parse } from '@kernlang/core';
import { transpileVue } from '@kernlang/vue';

const ir = parse(`page "Home" { text "Hello" }`);
const result = transpileVue(ir, { target: 'vue' });
```

## License

AGPL-3.0
