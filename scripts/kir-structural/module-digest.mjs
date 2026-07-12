import { createHash } from 'node:crypto';

import { encodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';

const limits = {
  maxBytes: 262144,
  maxDepth: 64,
  maxNodes: 4096,
  maxStringBytes: 8192,
  maxCollectionLength: 1024,
  maxRecordFields: 512,
  maxMapEntries: 64,
  maxIntegerDigits: 256,
  maxFractionDigits: 256,
  maxDecimalChars: 520,
};
const modules = [
  {
    id: 'lib/symbols.kern',
    roots: [{ type: 'class', props: { export: true, name: 'Counter' } }],
  },
  {
    id: 'main.kern',
    roots: [
        {
          type: 'use',
          props: { path: './lib/symbols' },
          children: [{ type: 'from', props: { as: 'LocalCounter', kind: 'class', name: 'Counter' } }],
        },
        { type: 'fn', props: { export: true, name: 'main' } },
      ],
  },
];

process.stdout.write(`${createHash('sha256').update(encodeModuleKir(modules, limits)).digest('hex')}\n`);
