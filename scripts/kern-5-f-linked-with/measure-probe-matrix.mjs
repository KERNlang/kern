import { writeFileSync } from 'node:fs';

import {
  ENTRY,
  LIMITS,
  POSITIONS,
  POSITION_NAMES,
  PROBE_MATRIX_FORMAT,
  compileJavaScript,
  compilePython,
  linkVerifiedKernKirProgram,
  project,
} from './k0-support.mjs';

async function linkMessageOf(verified) {
  try {
    const { RuntimeMeter } = await import('../../packages/core/dist/kir-runtime/inspect.js');
    const { linkVerifiedKernKirProgramOrThrow } = await import(
      '../../packages/core/dist/kir-runtime/linked-kir-program/index.js'
    );
    linkVerifiedKernKirProgramOrThrow(verified, ENTRY, new RuntimeMeter(LIMITS));
  } catch (error) {
    return error.message;
  }
  return null;
}

const rows = [];
for (const name of POSITION_NAMES) {
  const verified = await project(POSITIONS[name]());
  if (verified === undefined) {
    rows.push({
      javascript: 'not-projected',
      linkMessage: null,
      name,
      projection: 'not-projected',
      python: 'not-projected',
      rt1: 'not-projected',
    });
    continue;
  }
  const linked = linkVerifiedKernKirProgram(verified, ENTRY, LIMITS);
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  rows.push({
    javascript: javascript.outcome === 'failure' ? javascript.code : 'admitted',
    linkMessage: linked.outcome === 'success' ? null : await linkMessageOf(verified),
    name,
    projection: 'projected',
    python: python.outcome === 'failure' ? python.code : 'admitted',
    rt1: linked.outcome === 'success' ? 'admitted' : linked.code,
  });
}

writeFileSync(
  new URL('./probe-matrix.json', import.meta.url),
  `${JSON.stringify({ format: PROBE_MATRIX_FORMAT, rows }, undefined, 2)}\n`,
);
process.stdout.write(`rows=${rows.length}\n`);
for (const row of rows) {
  process.stdout.write(`${row.name} ${row.projection} ${row.rt1} ${row.python} :: ${row.linkMessage ?? ''}\n`);
}
