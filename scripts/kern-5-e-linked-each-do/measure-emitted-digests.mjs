import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import {
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeKernKir,
  project,
  provider,
  runtimeRequest,
} from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import { CORPUS, CORPUS_NAMES, SPLICED, SPLICED_NAMES } from './corpus.mjs';
import { CORPUS_ARGUMENTS, emitSpliced, linkCorpusProgram } from './emit-support.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const rows = [];
const failures = [];
for (const name of CORPUS_NAMES) {
  const source = CORPUS[name]();
  const verified = await project(source);
  if (verified === undefined) {
    failures.push(`${name}: not projected`);
    continue;
  }
  const javascript = compileJavaScript(verified);
  if (javascript.outcome !== 'success') {
    failures.push(`${name}: javascript ${javascript.code}`);
    continue;
  }
  const python = compilePython(verified);
  const manifest = JSON.parse(Buffer.from(javascript.manifest.bytes).toString('utf8'));
  const direct = await executeKernKir(verified, runtimeRequest(`e0-${name}`, CORPUS_ARGUMENTS(source)), provider([]));
  rows.push({
    javascriptArtifact: sha256(Buffer.from(javascript.artifact.bytes)),
    kernelSha256: manifest.kernelSha256,
    linkedProgram: manifest.linkedProgramSha256,
    manifestArtifact: sha256(Buffer.from(javascript.manifest.bytes)),
    name,
    python: python.outcome === 'success' ? sha256(Buffer.from(python.artifact.bytes)) : `refused:${python.code}`,
    rt1Envelope: sha256(Buffer.from(envelopeBytes(direct))),
    rt1Outcome: direct.outcome,
  });
}

const spliced = [];
for (const name of SPLICED_NAMES) {
  const entry = SPLICED[name];
  const program = entry.splice(await linkCorpusProgram(CORPUS[entry.base]()));
  spliced.push({ javascriptArtifact: sha256(Buffer.from(await emitSpliced(program))), name });
}

const payload = {
  format: 'kern.kern-5-e.emitted-digests.v1',
  rows,
  spliced,
};
writeFileSync(new URL('./emitted-digests.json', import.meta.url), `${JSON.stringify(payload, undefined, 2)}\n`);
process.stdout.write(`rows=${rows.length} spliced=${spliced.length} failures=${failures.length}\n`);
for (const failure of failures) process.stdout.write(`FAIL ${failure}\n`);
