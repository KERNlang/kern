import { createHash } from 'node:crypto';

import { encodeCanonical } from '../kir-seam-probe/canonical.mjs';
import { hostileModules } from '../kir-seam-probe/fixtures.mjs';
import { projectModules } from '../kir-seam-probe/project.mjs';

function collectKinds(nodes, kinds) {
  for (const node of nodes) {
    kinds.add(node.kind);
    collectKinds(node.children, kinds);
  }
}

export function verifyFixtureWitness(policy, inputs = hostileModules, project = projectModules) {
  if (policy.candidateWitness.fixture !== 'scripts/kir-seam-probe/fixtures.mjs') {
    throw new Error('KIR v1 eligibility: candidate fixture source changed');
  }
  const envelope = project(inputs);
  if (envelope.format !== policy.candidateWitness.format) {
    throw new Error(
      `KIR v1 eligibility: projected fixture format ${String(envelope.format)} does not match ${policy.candidateWitness.format}`,
    );
  }
  const actualKinds = new Set();
  for (const module of envelope.modules) collectKinds(module.nodes, actualKinds);
  const expectedKinds = new Set(policy.candidateWitness.nodeKinds);
  if (
    actualKinds.size !== expectedKinds.size ||
    [...actualKinds].some((kind) => !expectedKinds.has(kind))
  ) {
    throw new Error(
      `KIR v1 eligibility: projected fixture kinds ${[...actualKinds].join(', ')} do not exactly witness ${[...expectedKinds].join(', ')}`,
    );
  }
  const canonicalSha256 = createHash('sha256').update(encodeCanonical(envelope)).digest('hex');
  if (canonicalSha256 !== policy.candidateWitness.canonicalSha256) {
    throw new Error(
      `KIR v1 eligibility: projected fixture digest ${canonicalSha256} does not match ${policy.candidateWitness.canonicalSha256}`,
    );
  }
  return [...actualKinds];
}
