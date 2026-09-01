import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KERN_KIR_JS_ESM_COMPILER_FORMAT,
  compileKernKirToJavaScriptEsm,
} from '../../packages/core/dist/compiler-kir-js-esm.js';
import { KERN_KIR_PYTHON_COMPILER_FORMAT, compileKernKirToPython } from '../../packages/core/dist/compiler-kir-python.js';
import { projectKernModules, verifyKernProjection } from '../../packages/core/dist/frontend-projection.js';
import { linkVerifiedKernKirProgram } from '../../packages/core/dist/kir-runtime/linked-kir-program/index.js';
import { KERN_KIR_RUNTIME_FORMAT, executeKernKir } from '../../packages/core/dist/runtime-kir.js';
import { envelopeBytes, executeJavaScriptChild, executePythonChild } from '../kern-5-rt2-boolean-if/k0-support.mjs';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const CENSUS_DIR = resolve(ROOT, 'scripts/kern-5-admission-census');
export const CENSUS_FORMAT = 'kern.5.admission-census.v1';

// The shadow owner's KIR_SHADOW_LIMITS cap stdout at ten events, which no real repository entry
// fits. The census declares its own budget so a rejection is a language fact, not a budget fact.
export const CENSUS_LIMITS = Object.freeze({
  maxBytes: 1_000_000,
  maxCollectionLength: 1_000,
  maxDepth: 40,
  maxDiagnostics: 10,
  maxEvents: 256,
  maxSteps: 200_000,
  maxStringBytes: 100_000,
});

export const STAGES = Object.freeze([
  'projection',
  'entry-selection',
  'link',
  'javascript-compile',
  'python-compile',
  'rt1',
  'javascript-run',
  'python-run',
  'envelope-agreement',
]);

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function rejection(stage, code, detail) {
  return { admitted: false, code, detail, stage };
}

function firstDiagnosticCode(diagnostics) {
  const first = Array.isArray(diagnostics) ? diagnostics[0] : undefined;
  return typeof first?.code === 'string' ? first.code : 'unknown-diagnostic';
}

function exportedFunctionNames(module) {
  const exports = Array.isArray(module?.exports) ? module.exports : [];
  return exports.filter((item) => item?.kind === 'fn' && typeof item.name === 'string').map((item) => item.name);
}

async function projectFile(moduleId, source) {
  const request = { modules: [{ moduleId, source }] };
  const projected = await projectKernModules(request);
  if (projected.status !== 'projected') {
    return { code: firstDiagnosticCode(projected.diagnostics), status: 'rejected' };
  }
  let verified;
  try {
    verified = await verifyKernProjection(request, projected);
  } catch (error) {
    return { code: 'projection-verification-failed', detail: String(error?.message ?? error), status: 'rejected' };
  }
  return { projected, status: 'projected', verified };
}

function runtimeRequest(requestId, entry) {
  return {
    arguments: {},
    control: { preCancelled: false, timeoutMs: null },
    entry,
    format: KERN_KIR_RUNTIME_FORMAT,
    limits: CENSUS_LIMITS,
    requestId,
  };
}

async function admitEntry(verified, entry, timings) {
  const linked = linkVerifiedKernKirProgram(verified, entry, CENSUS_LIMITS);
  timings.link = process.hrtime.bigint();
  if (linked.outcome !== 'success') return rejection('link', linked.code, undefined);

  const javascript = compileKernKirToJavaScriptEsm(verified, {
    entry,
    format: KERN_KIR_JS_ESM_COMPILER_FORMAT,
    limits: CENSUS_LIMITS,
  });
  timings.javascriptCompile = process.hrtime.bigint();
  if (javascript.outcome !== 'success') return rejection('javascript-compile', javascript.code, undefined);

  const python = compileKernKirToPython(verified, {
    entry,
    format: KERN_KIR_PYTHON_COMPILER_FORMAT,
    limits: CENSUS_LIMITS,
  });
  timings.pythonCompile = process.hrtime.bigint();
  if (python.outcome !== 'success') return rejection('python-compile', python.code, undefined);

  const request = runtimeRequest('kern-5-admission-census', entry);
  const rt1 = await executeKernKir(verified, request);
  timings.rt1 = process.hrtime.bigint();
  if (rt1.outcome !== 'success') return rejection('rt1', firstDiagnosticCode(rt1.diagnostics), rt1.outcome);

  let javascriptRun;
  try {
    javascriptRun = await executeJavaScriptChild(javascript.artifact.bytes, request);
  } catch (error) {
    return rejection('javascript-run', 'child-execution-failed', String(error?.message ?? error));
  }
  timings.javascriptRun = process.hrtime.bigint();
  if (javascriptRun.envelope.outcome !== 'success') {
    return rejection('javascript-run', firstDiagnosticCode(javascriptRun.envelope.diagnostics), undefined);
  }

  let pythonRun;
  try {
    pythonRun = await executePythonChild(python.artifact.bytes, request);
  } catch (error) {
    return rejection('python-run', 'child-execution-failed', String(error?.message ?? error));
  }
  timings.pythonRun = process.hrtime.bigint();
  if (pythonRun.envelope.outcome !== 'success') {
    return rejection('python-run', firstDiagnosticCode(pythonRun.envelope.diagnostics), undefined);
  }

  const rt1Bytes = Buffer.from(envelopeBytes(rt1));
  const javascriptBytes = Buffer.from(envelopeBytes(javascriptRun.envelope));
  const pythonBytes = Buffer.from(envelopeBytes(pythonRun.envelope));
  if (!rt1Bytes.equals(javascriptBytes)) return rejection('envelope-agreement', 'javascript-diverged', undefined);
  if (!rt1Bytes.equals(pythonBytes)) return rejection('envelope-agreement', 'python-diverged', undefined);

  return {
    admitted: true,
    completion: rt1.completion,
    envelopeDigest: sha256Hex(rt1Bytes),
    eventCount: rt1.events.length,
    events: rt1.events,
    handlerName: entry.handlerName,
    linkedProgramSha256: linked.program.sha256,
    projectionArtifactSha256: linked.program.projectionArtifactSha256,
    resultPresence: rt1.result.presence,
  };
}

export async function admitFile(file) {
  const started = process.hrtime.bigint();
  const timings = {};
  const source = await readFile(resolve(ROOT, file), 'utf8');
  const projection = await projectFile(file, source);
  timings.projection = process.hrtime.bigint();
  if (projection.status !== 'projected') {
    return {
      ...rejection('projection', projection.code, projection.detail),
      file,
      timingsMs: elapsed(started, timings),
    };
  }
  const module = projection.verified.artifact.modules[0];
  const candidates = exportedFunctionNames(module);
  if (candidates.length === 0) {
    return {
      ...rejection('entry-selection', 'no-exported-entry', undefined),
      file,
      rootCount: module.roots.length,
      timingsMs: elapsed(started, timings),
    };
  }
  const attempts = [];
  for (const handlerName of candidates) {
    const attempt = await admitEntry(projection.verified, { handlerName, moduleId: file }, timings);
    if (attempt.admitted) {
      return { ...attempt, candidates, file, timingsMs: elapsed(started, timings) };
    }
    attempts.push({ code: attempt.code, detail: attempt.detail, handlerName, stage: attempt.stage });
  }
  return {
    admitted: false,
    attempts,
    candidates,
    code: attempts[0].code,
    file,
    stage: attempts[0].stage,
    timingsMs: elapsed(started, timings),
  };
}

function elapsed(started, timings) {
  const ordered = {};
  let previous = started;
  for (const [stage, at] of Object.entries(timings)) {
    ordered[stage] = Number((at - previous) / 1_000n) / 1_000;
    previous = at;
  }
  ordered.total = Number((process.hrtime.bigint() - started) / 1_000n) / 1_000;
  return ordered;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function canonicalStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
