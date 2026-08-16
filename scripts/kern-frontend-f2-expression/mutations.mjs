import { createHash } from 'node:crypto';

import { decodeExpression, loadPolicy } from './decoder.mjs';
import { loadComposition, runExpression } from './worker.mjs';

function sha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

export function policyForSourceOverride(path, source) {
  const policy = loadPolicy();
  const loaded = loadComposition(policy);
  const sourceOverrides = { [path]: source };
  if (path in policy.moduleSha256) {
    policy.moduleSha256 = { ...policy.moduleSha256, [path]: sha256(source) };
  } else {
    policy.parserFragmentSha256 = { ...policy.parserFragmentSha256, [path]: sha256(source) };
    policy.parserCompositeSha256 = sha256(
      loaded.parserFragments.map((fragment) => sourceOverrides[fragment.path] ?? fragment.source).join(''),
    );
  }
  return { policy, sourceOverrides };
}

export function sourceMutants() {
  const policy = loadPolicy();
  const loaded = loadComposition(policy);
  const byPath = Object.fromEntries([...loaded.modules, ...loaded.parserFragments].map((entry) => [entry.path, entry.source]));
  const catalogPath = policy.modules[0];
  const parserPath = policy.parserFragments[0];
  const mainPath = policy.modules.at(-1);
  return [
    {
      id: 'precedence-drift',
      path: catalogPath,
      source: byPath[catalogPath].replace(
        'if cond="op == \\"+\\" || op == \\"-\\""\n      return value="13"',
        'if cond="op == \\"+\\" || op == \\"-\\""\n      return value="10"',
      ),
      witness: 'a + b < c',
    },
    {
      id: 'associativity-drift',
      path: parserPath,
      source: byPath[parserPath].replace('pendingOp != \\"**\\"', 'pendingOp == \\"**\\"'),
      witness: 'a - b - c',
    },
    {
      id: 'constant-output',
      path: mainPath,
      source: byPath[mainPath].replace(
        'return value=result',
        'return value="[\\"kern.frontend.f2-expression.1\\", \\"failure\\", \\"C27:FRONTEND_INVALID_EXPRESSIONS1:0E1:1\\", \\"1\\", \\"0\\", \\"0\\", \\"0\\", \\"\\", \\"failure\\"]"',
      ),
      witness: 'answer',
    },
  ];
}

export function runSourceMutant(mutant) {
  const baseline = runExpression(mutant.witness);
  const overridden = policyForSourceOverride(mutant.path, mutant.source);
  try {
    const mutated = runExpression(mutant.witness, overridden);
    return JSON.stringify(mutated.fields) !== JSON.stringify(baseline.fields);
  } catch {
    return true;
  }
}

export function receiptMutations(fields) {
  const tape = fields[7];
  const mutate = (id, replacement) => ({ fields: [...fields.slice(0, 7), replacement, fields[8]], id });
  return [
    mutate('field-order', tape.replace('f0,1:0f1,1:0', 'f1,1:0f0,1:0')),
    mutate('kind-drift', tape.replace('f1,2:13', 'f1,1:6')),
    mutate('flag-drift', tape.replace('f4,1:0f5,1:3', 'f4,1:1f5,1:3')),
    mutate('subtree-drift', tape.replace('f5,1:3', 'f5,1:2')),
    mutate('forward-child', tape.replace('f7,8:i1:0i1:1', 'f7,8:i1:0i1:2')),
    mutate('shared-child', tape.replace('f7,8:i1:0i1:1', 'f7,8:i1:0i1:0')),
    mutate('span-drift', tape.replace('f3,1:1', 'f3,1:2')),
    mutate('payload-drift', tape.replace('f6,4:i1:+', 'f6,4:i1:?')),
    mutate('chunk-seal', tape.replace(/s0$/u, 's1')),
    mutate('chunk-ordinal', tape.replace(/^c0,/u, 'c1,')),
    mutate('framing-width', tape.replace(/^c0,0,3,171:/u, 'c0,0,3,170:')),
    { fields: [...fields.slice(0, 8), 'root:1:3:1:closed'], id: 'root-seal' },
    { fields: [fields[0], 'failure', 'C27:FRONTEND_INVALID_EXPRESSIONS1:0E1:1', fields[3], fields[4], fields[5], fields[6], fields[7], 'failure'], id: 'partial-failure' },
  ];
}

export function decoderRejects(mutant, source, policy = loadPolicy()) {
  try {
    decodeExpression(mutant.fields, source, policy);
    return false;
  } catch {
    return true;
  }
}
