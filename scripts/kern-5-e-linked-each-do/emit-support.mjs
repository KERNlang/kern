import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { KERN_KIR_RUNTIME_FORMAT } from '../../packages/core/dist/kir-runtime/contracts.js';
import { ENTRY, LIMITS, linkVerifiedKernKirProgram, project } from '../kern-5-rt4-user-fn-call/k0-support.mjs';

const require = createRequire(import.meta.url);

export async function linkCorpusProgram(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'E_PROJECTION_LOST: a corpus program must project');
  const linked = linkVerifiedKernKirProgram(verified, ENTRY, LIMITS);
  assert.equal(linked.outcome, 'success', `E_LINK_REFUSED: a corpus program must link (${linked.code})`);
  return linked.program;
}

// The same entrypoint compileKernKirToJavaScriptEsm uses, so a spliced program is emitted by the
// real emitter rather than a test double.
export async function emitSpliced(program) {
  const { TARGET_KERNEL_SHA256, emitJavaScriptEsm } = require('../../packages/core/dist/compiler/kir-js-esm/emitter.js');
  const contracts = require('../../packages/core/dist/compiler/kir-js-esm/contracts.js');
  assert.equal(typeof emitJavaScriptEsm, 'function', 'E_EMITTER_MISSING: emitJavaScriptEsm must be exported');
  return emitJavaScriptEsm(program, {
    artifactFormat: contracts.KERN_KIR_JS_ESM_ARTIFACT_FORMAT,
    canonicalization: 'kern.canonical-json.v1',
    compilerFormat: contracts.KERN_KIR_JS_ESM_COMPILER_FORMAT,
    compilerRequestSha256: '0'.repeat(64),
    entry: ENTRY,
    hashAlgorithm: 'sha256',
    hostProfile: contracts.KERN_KIR_JS_ESM_HOST_PROFILE,
    kernelSha256: TARGET_KERNEL_SHA256,
    linkedProgramSha256: program.sha256,
    projectionArtifactSha256: program.projectionArtifactSha256,
    runtimeFormat: KERN_KIR_RUNTIME_FORMAT,
  });
}

const ARGUMENT_VALUES = Object.freeze({
  a: Object.freeze({ tag: 'integer', value: '2' }),
  bs: Object.freeze({ tag: 'list', value: Object.freeze([Object.freeze({ tag: 'boolean', value: true })]) }),
  flag: Object.freeze({ tag: 'boolean', value: true }),
  ns: Object.freeze({ tag: 'list', value: Object.freeze([Object.freeze({ tag: 'integer', value: '7' })]) }),
  t: Object.freeze({ tag: 'text', value: '"seed"' }),
  xs: Object.freeze({ tag: 'list', value: Object.freeze([Object.freeze({ tag: 'text', value: 'one' })]) }),
});

// The entry's parameter names are read back off its own source line, so one argument table serves
// every corpus program and a renamed parameter fails loudly instead of running with no arguments.
export function CORPUS_ARGUMENTS(source) {
  const entryAt = source.lastIndexOf('fn name=');
  const names = [...source.slice(entryAt).matchAll(/^\s*param name=([A-Za-z0-9_]+)/gmu)].map((match) => match[1]);
  const args = {};
  for (const name of names) {
    assert.ok(name in ARGUMENT_VALUES, `E_ARGUMENT_TABLE: no pinned argument for parameter ${name}`);
    args[name] = ARGUMENT_VALUES[name];
  }
  return args;
}
