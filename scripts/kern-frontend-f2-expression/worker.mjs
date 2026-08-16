import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { isWellFormedText } from '../../packages/core/dist/index.js';
import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { materialize } from '../kern-frontend-f1/transport-contract.mjs';
import { decodeExpression, fail, loadPolicy } from './decoder.mjs';

const FORBIDDEN = /(?:\bcapability\b|parseExpression|projectExpressionText|typescript|kern\.frontend\..*-shadow)/u;
const TEST_LIMIT_KEYS = new Set([
  'maxChunks', 'maxNestingDepth', 'maxNodes', 'maxSourceScalars', 'maxTapeScalars', 'maxTokens', 'maxWorkSteps', 'nodesPerChunk',
]);

function sourceUrl(path) {
  return new URL(`../../${path}`, import.meta.url);
}

export function assertProductionSource(source, path) {
  if (FORBIDDEN.test(source)) fail(`forbidden production authority in ${path}`);
}

export function loadComposition(policy = loadPolicy(), sourceOverrides = {}) {
  if (JSON.stringify(policy.modules) !== JSON.stringify(Object.keys(policy.moduleSha256))) fail('module order');
  if (JSON.stringify(policy.parserFragments) !== JSON.stringify(Object.keys(policy.parserFragmentSha256))) {
    fail('parser fragment order');
  }
  const modules = policy.modules.map((path) => {
    const source = sourceOverrides[path] ?? readFileSync(sourceUrl(path), 'utf8');
    assertProductionSource(source, path);
    const sha256 = createHash('sha256').update(source).digest('hex');
    if (sha256 !== policy.moduleSha256[path]) fail(`module digest mismatch in ${path}`);
    return { path, sha256, source };
  });
  const parserFragments = policy.parserFragments.map((path) => {
    const source = sourceOverrides[path] ?? readFileSync(sourceUrl(path), 'utf8');
    assertProductionSource(source, path);
    const sha256 = createHash('sha256').update(source).digest('hex');
    if (sha256 !== policy.parserFragmentSha256[path]) fail(`parser fragment digest mismatch in ${path}`);
    return { path, sha256, source };
  });
  const parserSource = parserFragments.map((fragment) => fragment.source).join('');
  if (createHash('sha256').update(parserSource).digest('hex') !== policy.parserCompositeSha256) {
    fail('parser composite digest mismatch');
  }
  const ledgerSource = readFileSync(sourceUrl(policy.sourceLedger), 'utf8');
  if (createHash('sha256').update(ledgerSource).digest('hex') !== policy.sourceLedgerSha256) fail('ledger digest');
  const composition = [modules[0].source, modules[1].source, parserSource, modules[2].source].join('\n');
  if ((composition.match(/export=true/gu) ?? []).length !== 1) fail('production export count');
  if ((parserSource.match(/fn name=f2parse\b/gu) ?? []).length !== 1 || /f2parse\s*[(]/u.test(parserSource)) {
    fail('parser entry ownership');
  }
  return { composition, modules, parserFragments, parserSource };
}

export function runExpression(source, options = {}) {
  const loadedPolicy = options.policy ?? loadPolicy();
  const overrides = options.profileLimits ?? {};
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) fail('profile limit override shape');
  for (const [key, value] of Object.entries(overrides)) {
    if (!TEST_LIMIT_KEYS.has(key) || !Number.isSafeInteger(value) || value < 1) fail('profile limit override');
  }
  const policy = { ...loadedPolicy, profileLimits: { ...loadedPolicy.profileLimits, ...overrides } };
  if (!isWellFormedText(source)) fail('worker received ill-formed source');
  const loaded = loadComposition(policy, options.sourceOverrides);
  const limits = policy.profileLimits;
  const envelope = executeKernRuntimeHandlerSync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: [
        source,
        limits.maxSourceScalars,
        limits.maxTokens,
        limits.maxNodes,
        limits.nodesPerChunk,
        limits.maxChunks,
        limits.maxTapeScalars,
        limits.maxNestingDepth,
        limits.maxWorkSteps,
        options.forceLateFailure === true,
      ],
      identity: { handlerName: 'parsef2expression', sourcePath: 'examples/kern-frontend/f2-expression-main.kern' },
      source: loaded.composition,
    },
    { enabled: true, limits: policy.runtimeLimits, scheduler: policy.scheduler },
  );
  if (envelope.outcome !== 'success' || envelope.completion.kind !== 'return' || envelope.result.presence !== 'value') {
    fail(`runtime envelope ${JSON.stringify(envelope)}`);
  }
  if (envelope.events.length !== limits.expectedEvents || envelope.result.value.tag !== 'list') fail('runtime result shape');
  const fields = materialize(envelope.result.value);
  return {
    decoded: decodeExpression(fields, source, policy, { allowForcedLateFailure: options.forceLateFailure === true }),
    fields,
    moduleSha256: Object.fromEntries(
      [...loaded.modules, ...loaded.parserFragments].map((module) => [module.path, module.sha256]),
    ),
  };
}
