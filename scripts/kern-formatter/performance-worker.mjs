import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { formatKernSource } from './production.mjs';

const [kind, rawSize] = process.argv.slice(2);
const size = Number(rawSize);
assert.ok((kind === 'many' || kind === 'wide') && Number.isSafeInteger(size) && size > 0);
const source = kind === 'many' ? `${'value=1\n'.repeat(size)}` : `${'x'.repeat(size)}\n`;
const started = performance.now();
const result = formatKernSource(source);
const milliseconds = performance.now() - started;
assert.equal(result.outcome, 'formatted');
assert.equal(result.source, source);
process.stdout.write(`${JSON.stringify({ kind, milliseconds, size })}\n`);
