import { writeFileSync } from 'node:fs';

import { ENTRY, LIMITS, POSITIONS, POSITION_NAMES, linkVerifiedKernKirProgram, project } from './k0-support.mjs';
import { compileJavaScript, compilePython } from '../kern-5-rt4-user-fn-call/k0-support.mjs';

const rows = [];
for (const name of POSITION_NAMES) {
  const source = POSITIONS[name]();
  const verified = await project(source);
  if (verified === undefined) {
    rows.push({ javascript: 'not-projected', linkMessage: null, name, projection: 'not-projected', python: 'not-projected' });
    continue;
  }
  const linked = linkVerifiedKernKirProgram(verified, ENTRY, LIMITS);
  let linkMessage = null;
  if (linked.outcome !== 'success') {
    try {
      const { RuntimeMeter } = await import('../../packages/core/dist/kir-runtime/inspect.js');
      const { linkVerifiedKernKirProgramOrThrow } = await import(
        '../../packages/core/dist/kir-runtime/linked-kir-program/index.js'
      );
      linkVerifiedKernKirProgramOrThrow(verified, ENTRY, new RuntimeMeter(LIMITS));
    } catch (error) {
      linkMessage = error.message;
    }
  }
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  rows.push({
    javascript: javascript.outcome === 'failure' ? javascript.code : 'admitted',
    linkMessage,
    name,
    projection: 'projected',
    python: python.outcome === 'failure' ? python.code : 'admitted',
    rt1: linked.outcome === 'success' ? 'admitted' : linked.code,
  });
}

writeFileSync(
  new URL('./probe-matrix.json', import.meta.url),
  `${JSON.stringify({ format: 'kern.kern-5-e.probe-matrix.v1', rows }, undefined, 2)}\n`,
);
process.stdout.write(`rows=${rows.length}\n`);
for (const row of rows) {
  process.stdout.write(`${row.name} ${row.projection} ${row.rt1 ?? '-'} :: ${row.linkMessage ?? ''}\n`);
}
