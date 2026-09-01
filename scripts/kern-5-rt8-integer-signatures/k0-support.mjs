import assert from 'node:assert/strict';

import { runProjection } from '../kern-frontend-f5-projection/worker.mjs';
import { ENTRY, emittedArtifacts, moduleSource, runtimeRequest, threeLegBytes } from '../kern-5-rt6-void-fallthrough/k0-support.mjs';

export { ENTRY, emittedArtifacts, runtimeRequest, threeLegBytes };

export const SPELLINGS = Object.freeze(['number', 'integer']);

export function routeSource({ body = ['return value="v"'], parameter, returns }) {
  return moduleSource([{
    body,
    exported: 'true',
    name: ENTRY.handlerName,
    parameters: [{ name: 'v', type: parameter }],
    returns,
  }]);
}

export function twin(spelling, shape) {
  const scalar = spelling;
  const list = `${spelling}[]`;
  if (shape === 'parameter') return routeSource({ parameter: scalar, returns: 'number' });
  if (shape === 'return') return routeSource({ parameter: 'number', returns: scalar });
  if (shape === 'both') return routeSource({ parameter: scalar, returns: scalar });
  if (shape === 'list') return routeSource({ body: ['return value="v"'], parameter: list, returns: list });
  throw new Error(`unknown twin shape ${shape}`);
}

export const SHAPES = Object.freeze(['parameter', 'return', 'both', 'list']);

export function canonicalKir(source) {
  const result = runProjection([{ moduleId: ENTRY.moduleId, source }]);
  assert.equal(result.receipt.status, 'projected', `fixture must project: ${JSON.stringify(result.receipt.diagnostics)}`);
  return Buffer.from(result.bytes);
}

export function projectionOf(source) {
  const result = runProjection([{ moduleId: ENTRY.moduleId, source }]);
  return {
    codes: [...new Set(result.receipt.diagnostics.map(({ code }) => code))].sort(),
    status: result.receipt.status,
  };
}

export const INTEGER_ARGUMENT = Object.freeze({ tag: 'integer', value: '3' });
export const FRACTIONAL_ARGUMENT = Object.freeze({ tag: 'decimal', value: '1.5' });

export const FRACTIONAL_REJECTION = Object.freeze({
  completion: { kind: 'error' },
  diagnostics: [{ category: 'runtime', code: 'invalid-handler-arguments', phase: 'link' }],
  events: [],
  format: 'kern.runtime.kir.v1',
  outcome: 'failure',
  result: { presence: 'absent' },
});
